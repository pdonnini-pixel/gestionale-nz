// Coda offline del cellulare del negozio (timbratrice).
//
// Ogni timbratura si salva prima qui (IndexedDB, resta anche se il telefono si
// spegne) e poi parte verso il server con timbrature_registra(). Il server
// risponde riga per riga: le salvate escono dalla coda, quelle rifiutate
// (codice illeggibile, persona sconosciuta) passano in un elenco a parte che
// la pagina mostra, cosi' non si perdono e non bloccano le altre.

import { supabase } from './supabase'
import type { TipoTimbratura } from './timbrature'

export interface RigaCoda {
  id: string
  outlet_id: string
  codice: string
  tipo: TipoTimbratura
  ora_dispositivo: string
  scarto_secondi: number
  dispositivo_id: string
  sequenza: number
  /** Motivo scelto sul telefono del negozio (uscita anticipata o straordinario, migration 372). */
  causale?: string
  /** Entrata dimenticata (migration 382): l'ora dichiarata, ISO. Il server la
   *  accetta solo con il QR valido e nessuna timbratura prima nella giornata;
   *  altrimenti salva l'entrata all'ora del QR. */
  ora_dichiarata?: string
  /** PIN cifrato (pacchetto privacy, 12/11/2026): nella coda il codice PIN
   *  resta mascherato e il PIN vero sta qui, cifrato con una chiave del
   *  browser che non si può esportare. Si decifra solo al momento dell'invio. */
  pin_cifrato?: { iv: number[]; dati: number[] }
  /** Solo per la pagina: chi e' e quando, anche senza rete. */
  employee_id: string
  nome: string
}

export interface RigaScartata extends RigaCoda { esito: string }

const DB_NOME = 'nz-timbrature'
const STORE = 'coda'
const STORE_CHIAVI = 'chiavi'
const K_DISPOSITIVO = 'nz-timbra-dispositivo'
const K_SEQUENZA = 'nz-timbra-sequenza'
const K_SCARTO = 'nz-timbra-scarto'
const K_SCARTATE = 'nz-timbra-scartate'

function apri(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOME, 2)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' })
      if (!req.result.objectStoreNames.contains(STORE_CHIAVI)) req.result.createObjectStore(STORE_CHIAVI)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function conStore<T>(modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await apri()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, modo)
    const req = fn(tx.objectStore(STORE))
    tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined) }
    tx.onerror = () => { db.close(); reject(tx.error) }
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Salvataggio interrotto')) }
  })
}

export async function inCoda(): Promise<RigaCoda[]> {
  const righe = (await conStore<RigaCoda[]>('readonly', (s) => s.getAll() as IDBRequest<RigaCoda[]>)) ?? []
  return righe.sort((a, b) => a.ora_dispositivo.localeCompare(b.ora_dispositivo))
}

async function aggiungi(r: RigaCoda): Promise<void> {
  await conStore('readwrite', (s) => { s.put(r) })
}

async function togli(ids: string[]): Promise<void> {
  if (!ids.length) return
  await conStore('readwrite', (s) => { for (const id of ids) s.delete(id) })
}

// ─── PIN cifrato nella coda ──────────────────────────────────────────────
// Chiave AES-GCM creata sul telefono del negozio, non esportabile: chi copia la
// memoria del browser trova solo dati cifrati, non il PIN.

let chiaveInCorso: Promise<CryptoKey> | null = null

/** Una sola chiave per telefono: le chiamate vicine aspettano la stessa promessa (niente due chiavi diverse). */
function chiavePin(): Promise<CryptoKey> {
  if (!chiaveInCorso) chiaveInCorso = leggiOCreaChiave().catch((e) => { chiaveInCorso = null; throw e })
  return chiaveInCorso
}

async function leggiOCreaChiave(): Promise<CryptoKey> {
  const db = await apri()
  const leggi = () => new Promise<CryptoKey | undefined>((resolve, reject) => {
    const req = db.transaction(STORE_CHIAVI, 'readonly').objectStore(STORE_CHIAVI).get('pin')
    req.onsuccess = () => resolve(req.result as CryptoKey | undefined)
    req.onerror = () => reject(req.error)
  })
  try {
    const esistente = await leggi()
    if (esistente) return esistente
    const nuova = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    // add() e non put(): se un'altra scheda l'ha appena creata, vince la sua e si rilegge
    const scritta = await new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORE_CHIAVI, 'readwrite')
      tx.objectStore(STORE_CHIAVI).add(nuova, 'pin')
      tx.oncomplete = () => resolve(true)
      tx.onerror = (ev) => { ev.preventDefault(); resolve(false) }
      tx.onabort = () => resolve(false)
    })
    if (scritta) return nuova
    const altra = await leggi()
    if (!altra) throw new Error('Chiave del PIN non salvata')
    return altra
  } finally { db.close() }
}

/** «NZP1.<id>.<pin>» → codice mascherato + PIN cifrato. Gli altri codici restano come sono. */
async function proteggiPin(codice: string): Promise<{ codice: string; pin_cifrato?: RigaCoda['pin_cifrato'] }> {
  const m = /^(NZP1\.[^.]+)\.(\d{4})$/.exec(codice)
  if (!m) return { codice }
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const dati = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await chiavePin(), new TextEncoder().encode(m[2]))
  return { codice: `${m[1]}.****`, pin_cifrato: { iv: Array.from(iv), dati: Array.from(new Uint8Array(dati)) } }
}

/** Codice da mandare al server; null se il PIN non si può più decifrare. */
async function codiceDaInviare(r: RigaCoda): Promise<string | null> {
  if (!r.pin_cifrato) return r.codice
  try {
    const chiaro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(r.pin_cifrato.iv) }, await chiavePin(), new Uint8Array(r.pin_cifrato.dati))
    return r.codice.replace(/\.\*\*\*\*$/, '.' + new TextDecoder().decode(chiaro))
  } catch { return null }
}

/** Chiede al browser di non cancellare la memoria della timbratrice. */
export async function chiediMemoriaPersistente(): Promise<void> {
  try { await navigator.storage?.persist?.() } catch { /* non tutti i browser */ }
}

export function idDispositivo(): string {
  let id = localStorage.getItem(K_DISPOSITIVO)
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(K_DISPOSITIVO, id) }
  return id
}

function prossimaSequenza(): number {
  const n = Number(localStorage.getItem(K_SEQUENZA) ?? '0') + 1
  localStorage.setItem(K_SEQUENZA, String(n))
  return n
}

/** Secondi da aggiungere all'ora del telefono per avere l'ora del server. */
export function scartoOrologio(): number {
  return Number(localStorage.getItem(K_SCARTO) ?? '0') || 0
}

export function aggiornaScarto(oraServerIso: string, inviataAlleMs: number, ricevutaAlleMs: number): void {
  const server = Date.parse(oraServerIso)
  if (!Number.isFinite(server)) return
  const meta = (inviataAlleMs + ricevutaAlleMs) / 2
  localStorage.setItem(K_SCARTO, String(Math.round((server - meta) / 1000)))
}

export function scartate(): RigaScartata[] {
  try { return JSON.parse(localStorage.getItem(K_SCARTATE) ?? '[]') as RigaScartata[] } catch { return [] }
}

/** Salva una timbratura in coda (subito, anche senza rete). */
export async function registraInCoda(args: {
  outletId: string; codice: string; tipo: TipoTimbratura; employeeId: string; nome: string; causale?: string
  oraDichiarata?: string
}): Promise<RigaCoda> {
  const protetto = await proteggiPin(args.codice)
  const riga: RigaCoda = {
    id: crypto.randomUUID(),
    outlet_id: args.outletId,
    codice: protetto.codice,
    ...(protetto.pin_cifrato ? { pin_cifrato: protetto.pin_cifrato } : {}),
    tipo: args.tipo,
    ora_dispositivo: new Date().toISOString(),
    scarto_secondi: scartoOrologio(),
    dispositivo_id: idDispositivo(),
    sequenza: prossimaSequenza(),
    ...(args.causale ? { causale: args.causale } : {}),
    ...(args.oraDichiarata && args.tipo === 'entrata' ? { ora_dichiarata: args.oraDichiarata } : {}),
    employee_id: args.employeeId,
    nome: args.nome,
  }
  await aggiungi(riga)
  return riga
}

let invioInCorso: Promise<{ inviate: number; inAttesa: number }> | null = null

/** Manda la coda al server. Una sola alla volta. */
export function inviaCoda(): Promise<{ inviate: number; inAttesa: number }> {
  if (invioInCorso) return invioInCorso
  invioInCorso = (async () => {
    let inviate = 0
    try {
      const righe = await inCoda()
      for (let i = 0; i < righe.length; i += 100) {
        const lotto = righe.slice(i, i + 100)
        // PIN: si decifra solo adesso; se non si puo' (memoria del browser cambiata) la riga va fra le rifiutate
        const pronte = await Promise.all(lotto.map(async (r) => ({ r, codice: await codiceDaInviare(r) })))
        const illeggibili = pronte.filter((x) => x.codice === null).map((x) => x.r)
        if (illeggibili.length) {
          localStorage.setItem(K_SCARTATE, JSON.stringify([...scartate(), ...illeggibili.map(({ pin_cifrato: _p, ...r }) => ({ ...r, esito: 'pin_non_leggibile' }))].slice(-200)))
          await togli(illeggibili.map((r) => r.id))
        }
        const daInviare = pronte.filter((x) => x.codice !== null)
        if (!daInviare.length) continue
        const t0 = Date.now()
        const { data, error } = await supabase.rpc('timbrature_registra', {
          p_righe: daInviare.map(({ r: { employee_id: _e, nome: _n, pin_cifrato: _p, ...r }, codice }) => ({ ...r, codice: codice as string })),
        })
        if (error) break // rete o sessione: si riprova dopo, la coda resta
        const risposta = data as { ora_server?: string; esiti?: { id: string; esito: string; verifica?: string }[] } | null
        if (risposta?.ora_server) aggiornaScarto(risposta.ora_server, t0, Date.now())
        const esiti = new Map((risposta?.esiti ?? []).map((e) => [e.id, e.esito]))
        // Salvate ma con il QR non valido (telefono non piu' attivo, migration 387): si segnalano come le rifiutate
        const dubbie = new Set((risposta?.esiti ?? []).filter((e) => e.esito === 'salvata' && e.verifica === 'firma_non_valida').map((e) => e.id))
        // qr_gia_usato: la stessa azione con lo stesso QR e' gia' registrata (doppio tocco).
        // Rifiuti certi: QR illeggibile o di qualcuno che non e' (piu') in azienda.
        // Tutto il resto (errore_temporaneo, negozio_non_autorizzato, nessuna
        // risposta) resta in coda e si riprova: una timbratura vera non sparisce.
        const fatte = (e: string | undefined) => e === 'salvata' || e === 'qr_gia_usato'
        // PIN sbagliato o bloccato (migration 384): riprovare non serve
        const RIFIUTI_CERTI = ['codice_illeggibile', 'persona_sconosciuta', 'persona_non_in_servizio', 'riga_non_valida', 'pin_errato', 'pin_bloccato', 'pin_non_attivo', 'pin_altro_negozio']
        const salvate = lotto.filter((r) => fatte(esiti.get(r.id))).map((r) => r.id)
        const rifiutate = lotto.filter((r) => RIFIUTI_CERTI.includes(esiti.get(r.id) ?? ''))
        const daSegnalare = [...rifiutate, ...lotto.filter((r) => dubbie.has(r.id))]
        if (daSegnalare.length) {
          const prima = scartate()
          // Il PIN non resta in chiaro fra le rifiutate (migration 384)
          const nuove = daSegnalare.map(({ pin_cifrato: _p, ...r }) => ({ ...r, codice: r.codice.startsWith('NZP1.') ? r.codice.replace(/\.\d{4}$/, '.****') : r.codice, esito: dubbie.has(r.id) ? 'qr_non_valido' : esiti.get(r.id) ?? 'rifiutata' }))
          localStorage.setItem(K_SCARTATE, JSON.stringify([...prima, ...nuove].slice(-200)))
        }
        await togli([...salvate, ...rifiutate.map((r) => r.id)])
        inviate += salvate.length
      }
    } finally {
      invioInCorso = null
    }
    return { inviate, inAttesa: (await inCoda()).length }
  })()
  return invioInCorso
}

// ─── Dati del negozio in memoria (per lavorare offline) ─────────────────

export interface DatiTimbratrice {
  ora_server: string
  outlet: { id: string; nome: string }
  margine_uscita_minuti: number
  /** tolleranza e margine valgono per la persona (eccezione o regola del negozio): migration 372. */
  persone: { id: string; nome: string; tolleranza?: number; margine?: number; pin?: boolean }[]
  /** pausa_pagata_minuti: pausa che si timbra ma non si toglie dalle ore (migration 401); puo' mancare. */
  turni: { employee_id: string; data: string; inizio: string; fine: string; pausa_minuti: number | null; pausa_pagata_minuti?: number | null }[]
  /** dichiarata: entrata segnata a posteriori, ancora da confermare (migration 382). */
  timbrature: { id: string; employee_id: string; tipo: TipoTimbratura; ora: string; dichiarata?: boolean }[]
  /** Quando e' stata scaricata (ora del telefono). */
  scaricati_il?: string
}

const kDati = (outletId: string) => `nz-timbra-dati-${outletId}`

export function datiInMemoria(outletId: string): DatiTimbratrice | null {
  try {
    const s = localStorage.getItem(kDati(outletId))
    return s ? JSON.parse(s) as DatiTimbratrice : null
  } catch { return null }
}

export async function scaricaDati(outletId: string): Promise<DatiTimbratrice | null> {
  const t0 = Date.now()
  const { data, error } = await supabase.rpc('timbratrice_dati', { p_outlet_id: outletId })
  if (error || !data) return null
  const dati = { ...(data as unknown as DatiTimbratrice), scaricati_il: new Date().toISOString() }
  aggiornaScarto(dati.ora_server, t0, Date.now())
  localStorage.setItem(kDati(outletId), JSON.stringify(dati))
  return dati
}
