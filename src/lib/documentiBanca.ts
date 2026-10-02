// Documenti della banca: la porta unica da cui Sabrina carica tutto (R27, R28
// in RICONCILIAZIONE_REGOLE.md).
//
// Qui c'e' solo logica pura e testata: riconoscere che documento e' arrivato
// (dal contenuto, non dal nome del file), a quale conto appartiene (dall'IBAN
// nell'intestazione o, se manca, da dove stanno i suoi movimenti), quali saldi
// dichiara, e preparare le righe per la
// funzione del database `apply_bank_statement`, che le confronta coi movimenti
// e applica la regola «l'estratto comanda».
//
// Il file lo legge la pagina (SheetJS per Excel, extractPdfLines per PDF): qui
// arrivano righe di testo e celle.

import { parseEcAoa, parseEcLines, parseAmountCell, type EcParsed, type EcRow } from './estrattoConto'
import { detectIssuer } from './cartaEstratto'
import { tipoEstratto } from './acquirerFees'
import { extractBeneficiary } from './reconcileMatch'

export type TipoDocumento = 'estratto_conto' | 'estratto_carta' | 'distinta_riba' | 'commissioni' | 'sconosciuto'

export const ETICHETTA_TIPO: Record<TipoDocumento, string> = {
  estratto_conto: 'Estratto conto corrente',
  estratto_carta: 'Estratto carta',
  distinta_riba: 'Distinta RiBa',
  commissioni: 'Estratto commissioni Nexi/Amex',
  sconosciuto: 'Documento non riconosciuto',
}

export type ContoLite = {
  id: string
  bank_name: string | null
  iban: string | null
  account_name: string | null
  account_type?: string | null
  acube_account_uuid?: string | null
  is_active?: boolean | null
}

const norm = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim()

/** IBAN senza spazi, maiuscolo. */
export const normIban = (s: string | null | undefined): string => String(s ?? '').replace(/[\s-]/g, '').toUpperCase()

// IBAN italiano: IT + 2 cifre di controllo + CIN + ABI(5) + CAB(5) + conto(12).
// Le banche lo stampano spesso a gruppi di quattro, quindi gli spazi sono ammessi.
const RE_IBAN_IT = /I\s*T\s*\d\s*\d\s*[A-Z](?:\s*\d){10}(?:\s*[0-9A-Z]){12}/gi

/** Tutti gli IBAN italiani che compaiono nel testo, normalizzati. */
export function ibanNelTesto(testo: string): string[] {
  const out = new Set<string>()
  for (const m of String(testo || '').matchAll(RE_IBAN_IT)) out.add(normIban(m[0]))
  return [...out]
}

/**
 * Le righe del file che non sono movimenti: intestazione, riepiloghi, totali.
 *
 * L'IBAN del conto e le parole che dicono che documento e' (distinta, carta,
 * commissioni) si cercano solo qui. Nelle causali dei movimenti ci sono gli IBAN
 * dei beneficiari e parole come «Ricarica carta prepagata» o «Nexi»: provato sugli
 * estratti veri di agosto 2026, l'Excel MPS veniva preso per un estratto
 * commissioni e quello BCC per un estratto carta.
 */
export function righeIntestazione(righe: string[], movimenti: Array<{ description?: string | null }>): string[] {
  const causali = [...new Set(movimenti.map((m) => norm(m.description)).filter((d) => d.length >= 6))]
  if (causali.length === 0) return righe
  return righe.filter((l) => {
    const riga = norm(l)
    return !causali.some((c) => riga.includes(c))
  })
}

/**
 * Il conto a cui appartiene il documento, dall'IBAN scritto nell'intestazione
 * (vedi righeIntestazione: gli IBAN nelle causali sono dei beneficiari).
 *
 * Su NZ lo stesso IBAN compare su due righe di `bank_accounts` (una collegata
 * all'open banking, una rimasta dal primo caricamento): si preferisce quella
 * collegata, poi quella attiva. Se l'IBAN non c'e' o non corrisponde a nessun
 * conto torna null: allora si guarda dove stanno i movimenti (contoDaiMovimenti).
 */
export function trovaConto(testo: string, conti: ContoLite[]): ContoLite | null {
  const ibans = ibanNelTesto(testo)
  let candidati = ibans.length === 0 ? [] : conti.filter((c) => {
    const a = normIban(c.iban)
    const b = normIban(c.account_name)
    return ibans.some((i) => i === a || i === b)
  })
  // Senza IBAN, il numero del conto: e' la coda dell'IBAN (le ultime 12 cifre,
  // senza gli zeri davanti). Intesa lo stampa cosi': «Numero conto: 1000000…».
  // Vale solo con l'etichetta nell'intestazione e almeno 6 cifre, per non
  // scambiarlo con un numero qualunque.
  if (candidati.length === 0 && RE_NUMERO_CONTO.test(testo)) {
    const numeri = new Set(testo.match(/\d{6,12}/g) ?? [])
    candidati = conti.filter((c) => {
      const n = numeroConto(c.iban) ?? numeroConto(c.account_name)
      return n !== null && numeri.has(n)
    })
  }
  if (candidati.length === 0) return null
  const punteggio = (c: ContoLite) => (c.acube_account_uuid ? 2 : 0) + (c.is_active === false ? 0 : 1)
  return [...candidati].sort((x, y) => punteggio(y) - punteggio(x))[0]
}

const RE_NUMERO_CONTO = /N(?:UMERO|\.|°)\s*(?:DI\s+)?CONTO|CONTO\s+N(?:UMERO|\.|°)/i

/** Il numero del conto dentro un IBAN italiano: le ultime 12 cifre senza zeri davanti. */
export function numeroConto(iban: string | null | undefined): string | null {
  const i = normIban(iban)
  if (!/^IT\d{2}[A-Z]\d{10}[0-9A-Z]{12}$/.test(i)) return null
  const n = i.slice(-12).replace(/^0+/, '')
  return /^\d{6,12}$/.test(n) ? n : null
}

/** Una riga di `fn_bank_doc_guess_account`: quante righe del file ritrova su quel conto. */
export type ContoTrovato = { bank_account_id: string; righe_trovate: number; righe: number }

/**
 * Il conto di un estratto senza IBAN, da dove il gestionale ritrova i suoi
 * movimenti (stesso importo, data entro 3 giorni). Si sceglie solo se il
 * vincitore e' netto: almeno 3 righe e il 60% del file, e il secondo conto non
 * oltre un quinto del primo. Sugli estratti veri di agosto: BCC 190/190 contro 2,
 * MPS 150/150 contro 0. Altrimenti null, e si chiede a Sabrina.
 */
export function contoDaiMovimenti(trovati: ContoTrovato[], conti: ContoLite[]): ContoLite | null {
  const ord = [...trovati].sort((a, b) => b.righe_trovate - a.righe_trovate)
  const primo = ord[0]
  if (!primo || primo.righe <= 0) return null
  const secondo = ord[1]?.righe_trovate ?? 0
  if (primo.righe_trovate < Math.max(3, Math.ceil(primo.righe * 0.6))) return null
  if (secondo > primo.righe_trovate * 0.2) return null
  return conti.find((c) => c.id === primo.bank_account_id) ?? null
}

// Distinte RiBa MPS: «Distinta Di Ritiro Effetti Pagati», «Effetti - Disposizioni».
const RE_DISTINTA = /DISTINTA\s+DI\s+RITIRO\s+EFFETTI|RITIRO\s+EFFETTI\s+PAGATI|EFFETTI\s*-\s*DISPOSIZIONI|DISTINTA\s+(?:RI\.?\s*BA|EFFETTI)/i

/**
 * Che documento e', letto dal contenuto.
 *
 * Ordine: la distinta e le commissioni hanno intestazioni inconfondibili; un
 * estratto conto corrente si riconosce perche' porta l'IBAN di un nostro conto
 * e righe «data · causale · importo»; una carta dal lettore delle carte.
 */
export function classificaDocumento(p: {
  testo: string
  righe: string[]
  conto: ContoLite | null
  righeEstratto: number
  /** Le righe che non sono movimenti (righeIntestazione). Se c'e', le parole si cercano solo qui. */
  intestazione?: string[]
}): TipoDocumento {
  const righe = p.intestazione ?? p.righe
  const testo = p.intestazione ? p.intestazione.join('\n') : p.testo
  if (RE_DISTINTA.test(testo)) return 'distinta_riba'
  if (tipoEstratto(righe)) return 'commissioni'
  if (p.conto && p.righeEstratto > 0) return 'estratto_conto'
  if (detectIssuer(righe) !== 'generico') return 'estratto_carta'
  if (/ESTRATTO\s+CONTO\s+CARTA|CARTA\s+DI\s+CREDITO|CARTA\s+PREPAGATA/i.test(testo) && !p.conto) return 'estratto_carta'
  if (p.righeEstratto > 0) return 'estratto_conto'
  return 'sconosciuto'
}

// Saldi dichiarati. Le banche li scrivono in tanti modi: si accetta solo una
// riga che dice esplicitamente «saldo iniziale/finale» (o «precedente»,
// «contabile al») e porta un importo. Se non si trova, si torna null: meglio
// nessuna quadratura sul documento che una quadratura su un numero sbagliato.
const RE_SALDO_INIZ = /SALDO\s+(?:CONTABILE\s+)?(?:INIZIALE|PRECEDENTE|DI\s+APERTURA|INIZIO\s+PERIODO)/i
const RE_SALDO_FIN = /SALDO\s+(?:CONTABILE\s+)?(?:FINALE|DI\s+CHIUSURA|FINE\s+PERIODO)/i
const RE_IMPORTO = /-?\d{1,3}(?:\.\d{3})*,\d{2}-?/g

const ultimoImporto = (riga: string): number | null => {
  const tutti = riga.match(RE_IMPORTO)
  if (!tutti || tutti.length === 0) return null
  let t = tutti[tutti.length - 1]
  // Alcune banche mettono il segno meno in coda: «1.234,56-».
  if (t.endsWith('-')) t = '-' + t.slice(0, -1)
  return parseAmountCell(t)
}

export function saldiDichiarati(righe: string[]): { iniziale: number | null; finale: number | null } {
  let iniziale: number | null = null
  let finale: number | null = null
  for (const raw of righe) {
    const r = norm(raw)
    if (iniziale == null && RE_SALDO_INIZ.test(r)) iniziale = ultimoImporto(r)
    else if (RE_SALDO_FIN.test(r)) finale = ultimoImporto(r) ?? finale
  }
  return { iniziale, finale }
}

/** Mese a cui si riferisce l'estratto: quello con piu' righe. */
export function periodoDelle(righe: Array<{ date: string }>): { year: number; month: number } | null {
  if (righe.length === 0) return null
  const conta = new Map<string, number>()
  for (const r of righe) {
    const k = r.date.slice(0, 7)
    conta.set(k, (conta.get(k) ?? 0) + 1)
  }
  const [k] = [...conta.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]
  return { year: Number(k.slice(0, 4)), month: Number(k.slice(5, 7)) }
}

export type RigaPerDb = {
  row_no: number
  date: string
  value_date: string | null
  amount: number
  sign_known: boolean
  description: string
  flusso_cbi: string | null
  beneficiario: string | null
}

/**
 * Le righe nel formato di `apply_bank_statement`.
 * Dal PDF il segno (dare/avere) non si legge: sign_known=false, e il database
 * confronta l'importo in valore assoluto e non inserisce righe senza segno.
 */
export function righePerDb(parsed: EcParsed, dalPdf: boolean): RigaPerDb[] {
  return parsed.rows.map((r: EcRow, i: number) => ({
    row_no: i + 1,
    date: r.date,
    value_date: r.value_date,
    amount: dalPdf ? Math.abs(r.amount) : r.amount,
    sign_known: !dalPdf,
    description: r.description,
    flusso_cbi: r.flusso_cbi,
    beneficiario: extractBeneficiary(r.description) || null,
  }))
}

/** Tutte le celle di un foglio come righe di testo, per cercarci IBAN e saldi. */
export function righeDaFoglio(aoa: unknown[][]): string[] {
  return aoa.map((r) => (r ?? []).map((c) => (c instanceof Date ? '' : norm(c))).filter(Boolean).join(' ')).filter(Boolean)
}

/** Lettura di un estratto conto: dal foglio Excel che produce piu' righe, o dal PDF. */
export function leggiEstratto(p: { fogli?: unknown[][][]; righePdf?: string[] }): EcParsed {
  if (p.righePdf) return parseEcLines(p.righePdf)
  let migliore: EcParsed = { rows: [], columns: null, warnings: [] }
  for (const aoa of p.fogli ?? []) {
    const q = parseEcAoa(aoa)
    if (q.rows.length > migliore.rows.length) migliore = q
  }
  return migliore
}

export type EsitoApplicazione = {
  righe: number
  confermati: number
  corretti: number
  inseriti: number
  ambigui: number
  altro_conto: number
  non_inseriti: number
  domande_nuove: number
  quadratura?: {
    periodo_da?: string
    periodo_a?: string
    saldo_iniziale?: number | null
    saldo_finale?: number | null
    scarto_documento?: number | null
    scarto_gestionale?: number | null
  }
}

const eur = (n: number): string => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

/**
 * L'esito in una frase, per Sabrina: cosa e' stato fatto, senza sigle.
 * Esempio: «412 movimenti: 405 gia' a posto, 3 date corrette, 2 inseriti. Torna al centesimo.»
 */
export function fraseEsito(e: EsitoApplicazione): string {
  const pezzi: string[] = []
  pezzi.push(`${e.confermati} già a posto`)
  if (e.corretti) pezzi.push(`${e.corretti} ${e.corretti === 1 ? 'corretto' : 'corretti'} come dice la banca`)
  if (e.inseriti) pezzi.push(`${e.inseriti} ${e.inseriti === 1 ? 'aggiunto' : 'aggiunti'} perché mancavano`)
  if (e.non_inseriti) pezzi.push(`${e.non_inseriti} non ${e.non_inseriti === 1 ? 'aggiunto' : 'aggiunti'}`)
  let frase = `${e.righe} movimenti: ${pezzi.join(', ')}.`
  const scarto = e.quadratura?.scarto_gestionale
  if (scarto === 0) frase += ' Il periodo torna al centesimo.'
  else if (typeof scarto === 'number') frase += ` Scarto sul periodo: ${eur(scarto)}.`
  if (e.domande_nuove) frase += ` ${e.domande_nuove === 1 ? 'Una cosa da chiederti' : `${e.domande_nuove} cose da chiederti`} qui sotto.`
  return frase
}
