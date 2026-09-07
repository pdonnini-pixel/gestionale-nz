/**
 * Liquidazione IVA mensile previsionale — logica pura, senza Supabase.
 *
 * Ingredienti (vista v_iva_componenti_mensili, migration 193):
 *   - corrispettivi netti del mese, da tre fonti in ordine di preferenza:
 *       chiusure di cassa confermate (daily_revenue) → consuntivo granitico di
 *       Budget & Controllo → preventivo di Budget & Controllo
 *   - IVA delle fatture attive emesse nel mese
 *   - IVA delle fatture passive RICEVUTE nel mese (data ricezione SDI), meno
 *     le note di credito; le integrazioni reverse charge sono neutre
 *
 * Formula del mese M:
 *   importo = IVA corrispettivi + IVA fatture attive − IVA credito − riporto(M−1)
 *   importo > 0 → F24 entro il 16 del mese dopo (codice 60MM)
 *   importo < 0 → credito riportato al mese successivo
 *
 * Un mese CONFERMATO (vat_settlements) sostituisce la stima con i numeri
 * definitivi; un mese PAGATO (fiscal_deadlines iva_periodica, status paid) usa
 * l'importo versato come risultato della catena.
 */

export interface IvaComponentiMese {
  year: number
  month: number
  chiusure_netto: number
  giorni_chiusura: number
  consuntivo_netto: number
  preventivo_netto: number
  iva_fatture_attive: number
  n_fatture_attive: number
  iva_fatture_passive: number
  iva_note_credito: number
  iva_integrazioni: number
  n_fatture_passive: number
  n_note_credito: number
  n_integrazioni: number
}

export interface IvaSettings {
  salesVatRate: number
  startYear: number
  startMonth: number
  openingCredit: number
}

export interface IvaMeseConfermato {
  year: number
  month: number
  corrispettivi_netti: number
  iva_debito_corrispettivi: number
  iva_debito_fatture_attive: number
  iva_credito: number
  note?: string | null
}

export interface IvaMesePagato {
  year: number
  month: number
  amount: number
}

export type FonteCorrispettivi =
  | 'chiusure'          // mese chiuso, tutte le chiusure di cassa
  | 'chiusure_parziali' // mese in corso: chiusure fino a oggi + preventivo per i giorni restanti
  | 'consuntivo'        // consuntivo granitico di Budget & Controllo
  | 'preventivo'        // preventivo di Budget & Controllo
  | 'confermata'        // numeri definitivi inseriti a mano
  | 'nessuna'

export type StatoLiquidazione = 'pagata' | 'confermata' | 'stima' | 'in_corso' | 'futura'

export interface IvaLiquidazioneRow {
  year: number
  month: number
  key: string // YYYY-MM
  fonteCorrispettivi: FonteCorrispettivi
  corrispettiviNetti: number
  ivaDebitoCorrispettivi: number
  ivaFattureAttive: number
  ivaCredito: number
  ivaCreditoStimato: boolean
  ivaIntegrazioni: number
  nFatturePassive: number
  nNoteCredito: number
  giorniChiusura: number
  riportoPrecedente: number
  importo: number
  stato: StatoLiquidazione
  dueDate: string
  f24Code: string
  note: string | null
}

export const MESI_IVA = ['', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

/** Periodo nel formato usato da fiscal_deadlines.tax_period ("MM/YYYY"). */
export function taxPeriod(year: number, month: number): string {
  return `${String(month).padStart(2, '0')}/${year}`
}

export function parseTaxPeriod(p: string | null | undefined): { year: number; month: number } | null {
  const m = /^(\d{1,2})\/(\d{4})$/.exec((p || '').trim())
  if (!m) return null
  const month = Number(m[1]); const year = Number(m[2])
  if (month < 1 || month > 12) return null
  return { year, month }
}

export function f24CodeIvaMensile(month: number): string {
  return `60${String(month).padStart(2, '0')}`
}

export function titoloScadenzaIva(year: number, month: number): string {
  return `IVA mensile ${MESI_IVA[month]} ${year}`
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Scadenza del versamento per la liquidazione del mese: il 16 del mese
 * successivo. Regole applicate:
 *  - proroga di Ferragosto (art. 37 c. 11-bis DL 223/2006): gli adempimenti
 *    tra il 1° e il 20 agosto slittano al 20 agosto → la liquidazione di
 *    luglio scade il 20 agosto;
 *  - sabato o domenica → primo giorno lavorativo successivo.
 */
export function dueDateLiquidazione(year: number, month: number): string {
  // new Date(year, month, 16): month e' 1-based, quindi l'indice JS punta gia' al mese dopo
  let d = new Date(year, month, 16)
  if (d.getMonth() === 7 && d.getDate() <= 20) d = new Date(d.getFullYear(), 7, 20)
  const dow = d.getDay()
  if (dow === 6) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 2)
  else if (dow === 0) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  return toYMD(d)
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function cmpYM(y1: number, m1: number, y2: number, m2: number): number {
  return y1 !== y2 ? y1 - y2 : m1 - m2
}

const EMPTY: Omit<IvaComponentiMese, 'year' | 'month'> = {
  chiusure_netto: 0, giorni_chiusura: 0, consuntivo_netto: 0, preventivo_netto: 0,
  iva_fatture_attive: 0, n_fatture_attive: 0, iva_fatture_passive: 0, iva_note_credito: 0,
  iva_integrazioni: 0, n_fatture_passive: 0, n_note_credito: 0, n_integrazioni: 0,
}

export interface BuildLiquidazioniParams {
  componenti: IvaComponentiMese[]
  settings: IvaSettings
  confermati?: IvaMeseConfermato[]
  pagati?: IvaMesePagato[]
  /** Ultimo mese da produrre (incluso). */
  toYear: number
  toMonth: number
  today?: Date
}

/**
 * Costruisce la catena mensile dal mese di partenza (settings) a toYear/toMonth.
 * I mesi precedenti al mese di partenza non vengono prodotti: e' Patrizio a
 * dire da quando parte il calcolo e con quale credito iniziale.
 */
export function buildLiquidazioni(p: BuildLiquidazioniParams): IvaLiquidazioneRow[] {
  const today = p.today ?? new Date()
  const tY = today.getFullYear(); const tM = today.getMonth() + 1; const tD = today.getDate()
  const rate = Number(p.settings.salesVatRate) || 0
  const comp = new Map<string, IvaComponentiMese>()
  p.componenti.forEach(c => comp.set(monthKey(c.year, c.month), c))
  const conf = new Map<string, IvaMeseConfermato>()
  ;(p.confermati || []).forEach(c => conf.set(monthKey(c.year, c.month), c))
  const paid = new Map<string, IvaMesePagato>()
  ;(p.pagati || []).forEach(c => paid.set(monthKey(c.year, c.month), c))

  // Media dell'IVA a credito degli ultimi 3 mesi CHIUSI con fatture: e' la
  // stima per i mesi futuri (non ancora ricevute). Si guarda solo dal mese di
  // partenza in poi: prima di quello i dati di ricezione possono essere
  // falsati (es. il backfill A-Cube di giugno 2026 su NZ).
  const creditoMese = (y: number, m: number): number => {
    const k = monthKey(y, m)
    const cf = conf.get(k)
    if (cf) return Number(cf.iva_credito) || 0
    const c = comp.get(k)
    return c ? round2(Number(c.iva_fatture_passive) - Number(c.iva_note_credito)) : 0
  }
  const mediaCreditoRecente = (): number => {
    const vals: number[] = []
    let y = tY; let m = tM
    for (let i = 0; i < 12 && vals.length < 3; i++) {
      m -= 1; if (m === 0) { m = 12; y -= 1 }
      if (cmpYM(y, m, p.settings.startYear, p.settings.startMonth) < 0) break
      const c = comp.get(monthKey(y, m))
      const v = creditoMese(y, m)
      if ((c && c.n_fatture_passive > 0) || conf.has(monthKey(y, m))) vals.push(v)
    }
    if (vals.length === 0) return 0
    return round2(vals.reduce((a, b) => a + b, 0) / vals.length)
  }
  const mediaCredito = mediaCreditoRecente()

  const rows: IvaLiquidazioneRow[] = []
  let prevImporto = -Math.abs(Number(p.settings.openingCredit) || 0) // credito iniziale = "importo negativo" del mese prima
  let y = p.settings.startYear; let m = p.settings.startMonth
  let guard = 0
  while (cmpYM(y, m, p.toYear, p.toMonth) <= 0 && guard++ < 240) {
    const key = monthKey(y, m)
    const c: IvaComponentiMese = comp.get(key) ?? { year: y, month: m, ...EMPTY }
    const cf = conf.get(key)
    const pg = paid.get(key)
    const rel = cmpYM(y, m, tY, tM) // <0 passato, 0 in corso, >0 futuro

    let fonte: FonteCorrispettivi = 'nessuna'
    let corr = 0
    let ivaAtt = Number(c.iva_fatture_attive) || 0
    let ivaCred = 0
    let credStim = false
    let note: string | null = null

    if (cf) {
      fonte = 'confermata'
      corr = Number(cf.corrispettivi_netti) || 0
      ivaAtt = Number(cf.iva_debito_fatture_attive) || 0
      ivaCred = Number(cf.iva_credito) || 0
      note = cf.note ?? null
    } else if (rel < 0) {
      if (c.giorni_chiusura > 0) { fonte = 'chiusure'; corr = Number(c.chiusure_netto) }
      else if (Number(c.consuntivo_netto) > 0) { fonte = 'consuntivo'; corr = Number(c.consuntivo_netto) }
      else if (Number(c.preventivo_netto) > 0) { fonte = 'preventivo'; corr = Number(c.preventivo_netto) }
      ivaCred = creditoMese(y, m)
    } else if (rel === 0) {
      const base = Number(c.consuntivo_netto) > 0 ? Number(c.consuntivo_netto) : Number(c.preventivo_netto)
      if (c.giorni_chiusura > 0) {
        const dim = daysInMonth(y, m)
        const restanti = Math.max(0, dim - tD)
        fonte = 'chiusure_parziali'
        corr = round2(Number(c.chiusure_netto) + base * (restanti / dim))
      } else if (Number(c.consuntivo_netto) > 0) { fonte = 'consuntivo'; corr = Number(c.consuntivo_netto) }
      else if (Number(c.preventivo_netto) > 0) { fonte = 'preventivo'; corr = Number(c.preventivo_netto) }
      // IVA a credito del mese in corso: il ricevuto finora, ma mai meno della
      // media recente (le fatture del mese arrivano fino all'ultimo giorno).
      const finora = creditoMese(y, m)
      ivaCred = Math.max(finora, mediaCredito)
      credStim = ivaCred !== finora
    } else {
      if (Number(c.preventivo_netto) > 0) { fonte = 'preventivo'; corr = Number(c.preventivo_netto) }
      ivaCred = mediaCredito
      credStim = true
    }

    const ivaDeb = cf ? Number(cf.iva_debito_corrispettivi) || 0 : round2(corr * rate / 100)
    const riporto = prevImporto < 0 ? round2(-prevImporto) : 0
    let importo = round2(ivaDeb + ivaAtt - ivaCred - riporto)
    let stato: StatoLiquidazione = cf ? 'confermata' : rel < 0 ? 'stima' : rel === 0 ? 'in_corso' : 'futura'
    if (pg && !cf) {
      // Versamento riscontrato: e' lui il risultato del mese, la stima resta solo informativa.
      importo = round2(Number(pg.amount) || 0)
      stato = 'pagata'
    } else if (pg && cf) {
      stato = 'pagata'
    }

    rows.push({
      year: y, month: m, key,
      fonteCorrispettivi: fonte,
      corrispettiviNetti: round2(corr),
      ivaDebitoCorrispettivi: ivaDeb,
      ivaFattureAttive: round2(ivaAtt),
      ivaCredito: round2(ivaCred),
      ivaCreditoStimato: credStim,
      ivaIntegrazioni: round2(Number(c.iva_integrazioni) || 0),
      nFatturePassive: Number(c.n_fatture_passive) || 0,
      nNoteCredito: Number(c.n_note_credito) || 0,
      giorniChiusura: Number(c.giorni_chiusura) || 0,
      riportoPrecedente: riporto,
      importo,
      stato,
      dueDate: dueDateLiquidazione(y, m),
      f24Code: f24CodeIvaMensile(m),
      note,
    })
    prevImporto = importo
    m += 1; if (m === 13) { m = 1; y += 1 }
  }
  return rows
}

export const FONTE_LABEL: Record<FonteCorrispettivi, string> = {
  chiusure: 'Chiusure cassa',
  chiusure_parziali: 'Chiusure + preventivo',
  consuntivo: 'Consuntivo B&C',
  preventivo: 'Preventivo B&C',
  confermata: 'Confermata',
  nessuna: 'Nessun dato',
}

export const STATO_LABEL: Record<StatoLiquidazione, string> = {
  pagata: 'Pagata',
  confermata: 'Confermata',
  stima: 'Stima',
  in_corso: 'In corso',
  futura: 'Previsione',
}
