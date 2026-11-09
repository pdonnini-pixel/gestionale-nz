// Timbrature: codice QR del dipendente e lettura della giornata.
//
// Il QR del dipendente cambia ogni 30 secondi e si calcola anche senza rete:
//   NZT1.<employee_id>.<passo>.<firma>
// passo = secondi Unix / 30, firma = HMAC-SHA256(segreto, "<employee_id>.<passo>")
// in esadecimale, primi 16 caratteri. Stessa formula di timbrature_firma()
// nella migration 348: la firma la controlla il server, il cellulare del
// negozio non conosce i segreti.
//
// Regole di Patrizio (05/11/2026): fine turno + margine (30 minuti di
// default, attendance_settings.margine_uscita_minuti). Chi esce entro il
// margine non fa straordinario e non riceve l'avviso; chi a fine turno +
// margine risulta ancora dentro riceve l'avviso WhatsApp.

export const PREFISSO_QR = 'NZT1'
export const PASSO_SECONDI = 30
export const MARGINE_USCITA_DEFAULT = 30

export type TipoTimbratura = 'entrata' | 'inizio_pausa' | 'fine_pausa' | 'uscita'
export type StatoPresenza = 'fuori' | 'dentro' | 'in_pausa'

export const ETICHETTA_TIPO: Record<TipoTimbratura, string> = {
  entrata: 'Entrata',
  inizio_pausa: 'Inizio pausa',
  fine_pausa: 'Fine pausa',
  uscita: 'Uscita',
}

export const AZIONE_TIPO: Record<TipoTimbratura, string> = {
  entrata: 'Entra',
  inizio_pausa: 'Vado in pausa',
  fine_pausa: 'Rientro dalla pausa',
  uscita: 'Esco',
}

export interface Timbratura { tipo: TipoTimbratura; ora: string }
export interface Turno { data: string; inizio: string; fine: string; pausa_minuti?: number | null }

// ─── QR ────────────────────────────────────────────────────────────────

export function passoDa(ms: number): number {
  return Math.floor(ms / 1000 / PASSO_SECONDI)
}

/** Secondi che mancano al prossimo cambio del QR. */
export function secondiAlCambio(ms: number): number {
  const s = Math.floor(ms / 1000)
  return PASSO_SECONDI - (s % PASSO_SECONDI)
}

function esadecimaleInByte(hex: string): Uint8Array<ArrayBuffer> {
  const pulito = hex.trim().toLowerCase()
  if (!/^([0-9a-f]{2})+$/.test(pulito)) throw new Error('Segreto non valido')
  const out = new Uint8Array(new ArrayBuffer(pulito.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = parseInt(pulito.slice(i * 2, i * 2 + 2), 16)
  return out
}

function byteInEsadecimale(b: ArrayBuffer): string {
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('')
}

export async function firma(segretoHex: string, employeeId: string, passo: number): Promise<string> {
  const chiave = await crypto.subtle.importKey(
    'raw', esadecimaleInByte(segretoHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const dati = new TextEncoder().encode(`${employeeId}.${passo}`)
  const mac = await crypto.subtle.sign('HMAC', chiave, dati)
  return byteInEsadecimale(mac).slice(0, 16)
}

export async function codiceQr(segretoHex: string, employeeId: string, ms: number): Promise<string> {
  const passo = passoDa(ms)
  return `${PREFISSO_QR}.${employeeId}.${passo}.${await firma(segretoHex, employeeId, passo)}`
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Legge un QR del dipendente. Null se non e' un nostro codice. */
export function leggiCodice(testo: string): { employeeId: string; passo: number } | null {
  const parti = testo.trim().split('.')
  if (parti.length !== 4 || parti[0] !== PREFISSO_QR) return null
  if (!RE_UUID.test(parti[1]) || !/^\d{1,12}$/.test(parti[2]) || !/^[0-9a-f]{16}$/.test(parti[3])) return null
  return { employeeId: parti[1], passo: Number(parti[2]) }
}

// ─── Stato e azioni ────────────────────────────────────────────────────

export function statoDa(ultima: TipoTimbratura | null | undefined): StatoPresenza {
  if (ultima === 'entrata' || ultima === 'fine_pausa') return 'dentro'
  if (ultima === 'inizio_pausa') return 'in_pausa'
  return 'fuori'
}

/** Ordinate per ora; l'ultima della lista e' quella che vale. */
export function ordina<T extends { ora: string }>(righe: T[]): T[] {
  return [...righe].sort((a, b) => a.ora.localeCompare(b.ora))
}

export function haGiaFattoPausa(timbrature: Timbratura[]): boolean {
  return timbrature.some((t) => t.tipo === 'inizio_pausa')
}

/**
 * L'azione proposta col pulsante grande e quelle secondarie.
 * Fuori → Entra. In pausa → Rientro. Dentro → Esco, oppure Vado in pausa se il
 * turno prevede la pausa, non e' ancora fatta e manca piu' di un'ora alla fine.
 */
export function azioni(
  timbrature: Timbratura[],
  turno: Turno | null,
  adessoMs: number,
): { principale: TipoTimbratura; altre: TipoTimbratura[] } {
  const ord = ordina(timbrature)
  const stato = statoDa(ord.length ? ord[ord.length - 1].tipo : null)
  if (stato === 'fuori') return { principale: 'entrata', altre: [] }
  if (stato === 'in_pausa') return { principale: 'fine_pausa', altre: ['uscita'] }
  const pausaPrevista = (turno?.pausa_minuti ?? 0) > 0
  const fineMs = turno ? oraRomaInMs(turno.data, turno.fine) : null
  const lontanoDallaFine = fineMs === null || fineMs - adessoMs > 60 * 60 * 1000
  if (pausaPrevista && !haGiaFattoPausa(ord) && lontanoDallaFine) {
    return { principale: 'inizio_pausa', altre: ['uscita'] }
  }
  return { principale: 'uscita', altre: haGiaFattoPausa(ord) ? [] : ['inizio_pausa'] }
}

// ─── Ora di Roma ───────────────────────────────────────────────────────

const FMT_DATA = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' })
const FMT_ORA = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false })

/** Data di Roma (YYYY-MM-DD) di un istante. */
export function dataRoma(ms: number): string {
  return FMT_DATA.format(new Date(ms))
}

/** «09:05», ora di Roma. */
export function oraRoma(iso: string | number): string {
  return FMT_ORA.format(new Date(iso))
}

/** Scarto in minuti fra l'ora di Roma e UTC in un certo istante (60 o 120). */
function scartoRomaMinuti(ms: number): number {
  const parti = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  }).formatToParts(new Date(ms))
  const v = (t: string) => Number(parti.find((p) => p.type === t)?.value ?? 0)
  const comeUtc = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'))
  return Math.round((comeUtc - Math.floor(ms / 60000) * 60000) / 60000)
}

/** Istante (ms) di una data e un'ora scritte nell'ora di Roma. */
export function oraRomaInMs(data: string, ora: string): number {
  const [y, m, d] = data.split('-').map(Number)
  const [hh, mm] = ora.split(':').map(Number)
  const comeUtc = Date.UTC(y, m - 1, d, hh, mm)
  // Due passi: lo scarto dipende dall'istante (ora legale).
  let ms = comeUtc - scartoRomaMinuti(comeUtc) * 60000
  ms = comeUtc - scartoRomaMinuti(ms) * 60000
  return ms
}

// ─── Riepilogo della giornata ──────────────────────────────────────────

export type EsitoGiorno =
  | 'non_timbrato'      // nessuna timbratura
  | 'in_negozio'
  | 'in_pausa'
  | 'uscito'
  | 'uscita_mancante'   // fine turno + margine passati e risulta ancora dentro

export interface RiepilogoGiorno {
  esito: EsitoGiorno
  entrata: string | null
  uscita: string | null
  minutiPausa: number
  minutiLavorati: number
  /** Minuti dopo la fine del turno (uscita timbrata). */
  minutiOltreTurno: number
  /** Oltre il margine: da guardare come straordinario. Entro il margine no. */
  straordinario: boolean
  /** Minuti di ritardo all'entrata rispetto al turno (0 se puntuale). */
  minutiRitardo: number
}

export function riepilogoGiorno(
  timbrature: Timbratura[],
  turno: Turno | null,
  adessoMs: number,
  margineMinuti: number = MARGINE_USCITA_DEFAULT,
): RiepilogoGiorno {
  const ord = ordina(timbrature)
  const vuoto: RiepilogoGiorno = {
    esito: 'non_timbrato', entrata: null, uscita: null, minutiPausa: 0, minutiLavorati: 0,
    minutiOltreTurno: 0, straordinario: false, minutiRitardo: 0,
  }
  if (!ord.length) return vuoto

  let lavoro = 0
  let pausa = 0
  let dentroDa: number | null = null
  let pausaDa: number | null = null
  for (const t of ord) {
    const ms = Date.parse(t.ora)
    if (t.tipo === 'entrata') { dentroDa = ms; pausaDa = null }
    else if (t.tipo === 'inizio_pausa') {
      if (dentroDa !== null) lavoro += ms - dentroDa
      dentroDa = null; pausaDa = ms
    } else if (t.tipo === 'fine_pausa') {
      if (pausaDa !== null) pausa += ms - pausaDa
      pausaDa = null; dentroDa = ms
    } else if (t.tipo === 'uscita') {
      if (dentroDa !== null) lavoro += ms - dentroDa
      if (pausaDa !== null) pausa += ms - pausaDa
      dentroDa = null; pausaDa = null
    }
  }
  if (dentroDa !== null) lavoro += Math.max(0, adessoMs - dentroDa)
  if (pausaDa !== null) pausa += Math.max(0, adessoMs - pausaDa)

  const entrata = ord.find((t) => t.tipo === 'entrata')?.ora ?? null
  const ultima = ord[ord.length - 1]
  const uscita = ultima.tipo === 'uscita' ? ultima.ora : null
  const stato = statoDa(ultima.tipo)

  let esito: EsitoGiorno = stato === 'fuori' ? 'uscito' : stato === 'in_pausa' ? 'in_pausa' : 'in_negozio'
  let oltre = 0
  let ritardo = 0
  if (turno) {
    const fineMs = oraRomaInMs(turno.data, turno.fine)
    const inizioMs = oraRomaInMs(turno.data, turno.inizio)
    if (stato !== 'fuori' && adessoMs >= fineMs + margineMinuti * 60000) esito = 'uscita_mancante'
    if (uscita) oltre = Math.max(0, Math.round((Date.parse(uscita) - fineMs) / 60000))
    if (entrata) ritardo = Math.max(0, Math.round((Date.parse(entrata) - inizioMs) / 60000))
  }

  return {
    esito,
    entrata,
    uscita,
    minutiPausa: Math.round(pausa / 60000),
    minutiLavorati: Math.round(lavoro / 60000),
    minutiOltreTurno: oltre,
    straordinario: oltre > margineMinuti,
    minutiRitardo: ritardo,
  }
}

/** «7 h 30'» */
export function formatMinuti(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (!h) return `${m}'`
  return m ? `${h} h ${m}'` : `${h} h`
}

export const ETICHETTA_ESITO: Record<EsitoGiorno, string> = {
  non_timbrato: 'Non timbrato',
  in_negozio: 'In negozio',
  in_pausa: 'In pausa',
  uscito: 'Uscito',
  uscita_mancante: 'Uscita non timbrata',
}

// ─── Ritardi, uscite anticipate, straordinari (migration 372) ─────────────
// Stesse regole di timbrature_evento_da_timbratura: il telefono del negozio
// le mostra prima di salvare (anche senza rete), il server le registra.

export const CAUSALI_USCITA: Record<'personale' | 'malattia' | 'accordo', string> = {
  personale: 'Motivo personale (permesso)',
  malattia: 'Sto male (malattia)',
  accordo: "D'accordo con il responsabile",
}
export const CAUSALI_STRAORDINARIO: Record<'assenza_collega' | 'cliente' | 'riassortimento' | 'allestimento', string> = {
  assenza_collega: 'Concordato per assenza di un collega',
  cliente: 'Cliente da gestire',
  riassortimento: 'Riassortimento',
  allestimento: 'Allestimento',
}
export type CausaleUscita = keyof typeof CAUSALI_USCITA
export type CausaleStraordinario = keyof typeof CAUSALI_STRAORDINARIO

export const TOLLERANZA_ENTRATA_DEFAULT = 10
export const MARGINE_USCITA_NUOVO_DEFAULT = 15

/** Entrata rispetto all'inizio del turno: minuti dopo l'inizio, se oltre la tolleranza e il permesso a blocchi di 15. */
export function valutaEntrata(turno: Turno, oraMs: number, tolleranza: number): { minuti: number; oltre: boolean; permesso: number } {
  const minuti = Math.ceil((oraMs - oraRomaInMs(turno.data, turno.inizio)) / 60000)
  const oltre = minuti > tolleranza
  return { minuti: Math.max(0, minuti), oltre, permesso: oltre ? Math.ceil(minuti / 15) * 15 : 0 }
}

/**
 * Uscita rispetto alla fine del turno. «anticipata» se prima della fine (e
 * dopo non c'e' un altro pezzo di turno), «straordinario» se oltre il
 * margine: conta solo i minuti oltre il margine.
 */
export function valutaUscita(
  turno: Turno,
  oraMs: number,
  margine: number,
  altroTurnoDopo: boolean,
): { tipo: 'anticipata' | 'straordinario' | 'normale'; minuti: number; proposti: number } {
  const fineMs = oraRomaInMs(turno.data, turno.fine)
  const prima = Math.floor((fineMs - oraMs) / 60000)
  if (prima >= 1 && !altroTurnoDopo) return { tipo: 'anticipata', minuti: prima, proposti: prima }
  const dopo = Math.floor((oraMs - fineMs) / 60000)
  if (dopo > margine) return { tipo: 'straordinario', minuti: dopo, proposti: dopo - margine }
  return { tipo: 'normale', minuti: Math.max(0, dopo), proposti: 0 }
}
