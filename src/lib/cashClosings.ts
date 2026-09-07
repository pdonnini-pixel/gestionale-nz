// Chiusura di cassa giornaliera (specchietto incassi) — helper puri + tipi.
//
// Qui vive la logica che la pagina della cassiera (ChiusuraCassa) e quella
// amministrativa (IncassiGiornalieri) condividono: parsing degli importi
// scritti all'italiana, le due quadrature dell'Excel (totale = somma canali,
// fondo cassa atteso = fondo di ieri + contanti − spese − versamento),
// calendario del mese e riduzione delle foto prima del caricamento.
// La stessa quadratura la ricalcola il DB (trigger fn_cash_closing_compute):
// qui serve solo per il feedback in tempo reale mentre si scrive.

export type ChannelKind = 'contanti' | 'pos' | 'pos_amex' | 'paybylink' | 'fattura' | 'bonifico' | 'altro'
export type ClosingStatus = 'bozza' | 'confermata' | 'verificata'
export type AttachmentKind = 'rt_chiusura' | 'rt_rapporto_finanziario' | 'rt_trasmissione' | 'pos_chiusura' | 'scontrino_spesa' | 'ricevuta_versamento' | 'altro'
/** A cosa si riferisce una foto: ogni valore della chiusura ha la sua (migrazione 174). */
export type AttachmentTarget = 'totale' | 'canale' | 'spesa' | 'versamento' | 'altro'

export const ATTACHMENT_TARGET_LABELS: Record<AttachmentTarget, string> = {
  totale: 'Scontrino di chiusura',
  canale: 'Chiusura POS',
  spesa: 'Scontrino spesa',
  versamento: 'Ricevuta versamento',
  altro: 'Altro',
}

/** Tipo di documento atteso per una riga: serve alla lettura automatica (fase 1b). */
export function kindForTarget(target: AttachmentTarget, channelKind?: ChannelKind): AttachmentKind {
  switch (target) {
    case 'totale': return 'rt_chiusura'
    case 'canale': return channelKind === 'pos' || channelKind === 'pos_amex' ? 'pos_chiusura' : 'altro'
    case 'spesa': return 'scontrino_spesa'
    case 'versamento': return 'ricevuta_versamento'
    default: return 'altro'
  }
}

/** Stato della lettura automatica della foto (fase 1b, edge function closing-photo-extract). */
export type ExtractionStatus = 'in_attesa' | 'letta' | 'da_rivedere' | 'fallita'

export const EXTRACTION_STATUS_LABELS: Record<ExtractionStatus, string> = {
  in_attesa: 'Foto non ancora letta',
  letta: 'Letta dalla foto',
  da_rivedere: 'Lettura incerta',
  fallita: 'Lettura non riuscita',
}

/** Dati letti da una foto: chiavi libere per tipo di documento, più "amount" (valore chiave della riga). */
export type ExtractedData = Record<string, unknown>

/** Importo chiave letto dalla foto (totale corrispettivi, totale POS, totale spesa, importo versato). */
export function extractedAmount(extracted: unknown): number | null {
  if (!extracted || typeof extracted !== 'object') return null
  const v = (extracted as ExtractedData).amount
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null
}

function extractedStr(e: ExtractedData, key: string): string | null {
  const v = e[key]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
function extractedNum(e: ExtractedData, key: string): number | null {
  const v = e[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Riassunto leggibile dei campi letti da una foto, per il dettaglio
 * amministrativo: "totale 1.234,56 € · contanti 612,00 € · 14/09 21:03 · 38 documenti".
 */
export function extractedSummary(target: AttachmentTarget, extracted: unknown): string[] {
  if (!extracted || typeof extracted !== 'object') return []
  const e = extracted as ExtractedData
  const out: string[] = []
  const money = (label: string, key: string) => { const n = extractedNum(e, key); if (n != null) out.push(`${label} ${formatEuro(n)}`) }
  const text = (label: string, key: string) => { const s = extractedStr(e, key); if (s) out.push(label ? `${label} ${s}` : s) }
  const count = (label: string, key: string) => { const n = extractedNum(e, key); if (n != null) out.push(`${n} ${label}`) }
  if (e.document_ok === false) out.push('documento diverso da quello atteso')
  switch (target) {
    case 'totale':
      money('totale', 'total_sales'); money('contanti', 'cash'); money('elettronico', 'electronic'); money('altro', 'other_payments')
      count('documenti', 'documents_count'); money('resi', 'returns_total'); money('annulli', 'cancellations_total')
      money('gran totale', 'grand_total'); count('azzeramenti', 'closure_number'); text('RT', 'serial')
      if (e.transmission_ok === true) out.push('trasmissione ok')
      if (e.transmission_ok === false) out.push('trasmissione NON riuscita')
      break
    case 'canale':
      money('totale', 'total'); count('transazioni', 'transactions_count'); text('terminale', 'terminal_id'); text('', 'merchant'); text('', 'description')
      break
    case 'spesa':
      money('totale', 'total'); text('', 'merchant'); text('', 'description')
      break
    case 'versamento':
      money('importo', 'amount'); text('', 'bank'); text('conto', 'account_hint'); text('rif.', 'reference')
      break
    default:
      money('importo', 'total'); text('', 'description')
  }
  const d = extractedStr(e, 'date'); const t = extractedStr(e, 'time')
  if (d) out.push(`${/^\d{4}-\d{2}-\d{2}$/.test(d) ? formatDateIt(d) : d}${t ? ` ${t}` : ''}`)
  if (e.uncertain === true) out.push('lettura incerta')
  const notes = extractedStr(e, 'notes'); if (notes) out.push(notes)
  return out
}

/** Esito del riscontro con la banca (fase 3): righe POS/Amex e versamento. */
export type BankStatus = 'in_attesa' | 'accreditato' | 'differenza' | 'mancante' | 'non_verificabile'

export const BANK_STATUS_LABELS: Record<BankStatus, string> = {
  in_attesa: 'In attesa dell\'accredito',
  accreditato: 'Accreditato in banca',
  differenza: 'Accreditato con differenza',
  mancante: 'Accredito non trovato',
  non_verificabile: 'Non verificabile (canale senza codice terminale)',
}

/** Simbolo compatto per le celle: ✓ accreditato, ≠ differenza, ✗ mancante, · in attesa, ? non verificabile. */
export function bankStatusMark(status: string | null | undefined): { mark: string; cls: string } {
  switch (status) {
    case 'accreditato': return { mark: '✓', cls: 'text-emerald-700' }
    case 'differenza': return { mark: '≠', cls: 'text-amber-700' }
    case 'mancante': return { mark: '✗', cls: 'text-red-700' }
    case 'non_verificabile': return { mark: '?', cls: 'text-slate-400' }
    default: return { mark: '', cls: 'text-slate-400' }
  }
}

/** Riga di uscita in contanti: spesa cassa (con scontrino) o rimborso a cliente (solo nota). */
export type ExpenseKind = 'spesa' | 'rimborso_cliente'

export const EXPENSE_KIND_LABELS: Record<ExpenseKind, string> = {
  spesa: 'Spesa cassa',
  rimborso_cliente: 'Rimborso a cliente',
}

export interface ClosingExpense {
  id: string
  kind: ExpenseKind
  amount: number
  description: string | null
  sort_order: number
}

export const CHANNEL_KIND_LABELS: Record<ChannelKind, string> = {
  contanti: 'Contanti',
  pos: 'POS (carte)',
  pos_amex: 'POS American Express',
  paybylink: 'Pay by link',
  fattura: 'Fatture',
  bonifico: 'Bonifico',
  altro: 'Altro',
}

export const CLOSING_STATUS_LABELS: Record<ClosingStatus, string> = {
  bozza: 'Bozza',
  confermata: 'Confermata',
  verificata: 'Verificata con la banca',
}

export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  rt_chiusura: 'Chiusura registratore',
  rt_rapporto_finanziario: 'Rapporto finanziario',
  rt_trasmissione: 'Trasmissione AdE',
  pos_chiusura: 'Chiusura POS',
  scontrino_spesa: 'Scontrino spesa',
  ricevuta_versamento: 'Ricevuta versamento',
  altro: 'Altro',
}

/** Canali proposti quando un outlet non ne ha ancora: si rinominano e si integrano dopo. */
export const DEFAULT_CHANNELS: Array<{ label: string; kind: ChannelKind; sort_order: number }> = [
  { label: 'Contanti', kind: 'contanti', sort_order: 1 },
  { label: 'POS', kind: 'pos', sort_order: 2 },
  { label: 'Pay by link', kind: 'paybylink', sort_order: 3 },
  { label: 'Fatture', kind: 'fattura', sort_order: 4 },
  { label: 'Bonifico', kind: 'bonifico', sort_order: 5 },
]

export interface PaymentChannel {
  id: string
  outlet_id: string
  label: string
  kind: ChannelKind
  bank_account_id: string | null
  terminal_code: string | null
  pos_terminal_id: string | null
  counts_in_total: boolean
  sort_order: number
  is_active: boolean
}

/**
 * Importo scritto dalla cassiera: accetta "1.234,56", "1234,56", "1234.56",
 * "1234", spazi ed euro. Vuoto → null. Non numerico → null.
 */
export function parseAmount(raw: string | null | undefined): number | null {
  if (raw == null) return null
  let s = String(raw).trim().replace(/€/g, '').replace(/\s+/g, '')
  if (!s) return null
  const hasComma = s.includes(',')
  const hasDot = s.includes('.')
  if (hasComma && hasDot) {
    // "1.234,56": il punto e' il separatore delle migliaia
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (hasComma) {
    s = s.replace(',', '.')
  } else if (hasDot) {
    // "1.234" (migliaia) vs "12.5" (decimali): se dopo il punto ci sono
    // esattamente 3 cifre e non e' l'unico gruppo, e' un separatore migliaia.
    const parts = s.split('.')
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3)) {
      s = parts.join('')
    }
  }
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100) / 100
}

/**
 * Formato it-IT con due decimali: 1234.5 → "1.234,50". Fatto a mano (non
 * toLocaleString) cosi' il risultato e' identico in browser, test e Deno,
 * indipendentemente dai dati ICU installati.
 */
export function formatAmount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return ''
  const sign = n < 0 ? '-' : ''
  const abs = Math.round(Math.abs(n) * 100)
  const intPart = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const dec = String(abs % 100).padStart(2, '0')
  return `${sign}${intPart},${dec}`
}

export function formatEuro(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${formatAmount(n)} €`
}

export interface QuadratureInput {
  totalReceipts: number
  lines: Array<{ kind: ChannelKind; counts_in_total: boolean; amount: number }>
  cashExpenses: number
  /** Rimborsi a cliente pagati in contanti (riducono il fondo come le spese). */
  customerRefunds?: number
  cashDeposit: number
  /** Fondo di ieri (ultima chiusura confermata) oppure fondo iniziale; null se ignoto. */
  prevFloat: number | null
  cashFloatDeclared: number | null
}

export interface QuadratureResult {
  channelsTotal: number
  receiptsDifference: number
  cashLine: number
  cashFloatExpected: number | null
  cashDifference: number | null
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** Le due quadrature dell'Excel, identiche al trigger DB. */
export function computeQuadrature(q: QuadratureInput): QuadratureResult {
  const channelsTotal = r2(q.lines.filter((l) => l.counts_in_total).reduce((s, l) => s + (l.amount || 0), 0))
  const cashLine = r2(q.lines.filter((l) => l.kind === 'contanti').reduce((s, l) => s + (l.amount || 0), 0))
  const receiptsDifference = r2((q.totalReceipts || 0) - channelsTotal)
  if (q.prevFloat == null) {
    return { channelsTotal, receiptsDifference, cashLine, cashFloatExpected: null, cashDifference: null }
  }
  const cashFloatExpected = r2(q.prevFloat + cashLine - (q.cashExpenses || 0) - (q.customerRefunds || 0) - (q.cashDeposit || 0))
  const cashDifference = q.cashFloatDeclared == null ? null : r2(q.cashFloatDeclared - cashFloatExpected)
  return { channelsTotal, receiptsDifference, cashLine, cashFloatExpected, cashDifference }
}

/** Data locale in formato ISO (YYYY-MM-DD), senza sorprese di fuso orario. */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayIso(): string {
  return toIsoDate(new Date())
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return toIsoDate(dt)
}

/** Tutti i giorni (ISO) di un mese: month e' 1-12. */
export function monthDays(year: number, month: number): string[] {
  const n = new Date(year, month, 0).getDate()
  return Array.from({ length: n }, (_, i) => `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)
}

export const MESI_IT = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
const GIORNI_IT = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']

export function formatDateIt(iso: string, withWeekday = false): string {
  const [y, m, d] = iso.split('-').map(Number)
  const base = `${d} ${MESI_IT[m - 1].toLowerCase()} ${y}`
  if (!withWeekday) return base
  return `${GIORNI_IT[new Date(y, m - 1, d).getDay()].toLowerCase()} ${base}`
}

/** Percorso nel bucket 'cash-closings' (la RLS legge azienda e outlet dai primi due segmenti). */
export function attachmentPath(companyId: string, outletId: string, dateIso: string, fileId: string, ext = 'jpg'): string {
  return `${companyId}/${outletId}/${dateIso}/${fileId}.${ext}`
}

/**
 * Riduce una foto dello smartphone (spesso 3-6 MB) a lato massimo `maxSide`
 * in JPEG: abbastanza per leggere uno scontrino, leggera per la rete del
 * negozio. Se il browser non riesce a decodificare il file (es. HEIC su
 * desktop), restituisce il file originale.
 */
export async function compressImage(file: File, maxSide = 1600, quality = 0.82): Promise<Blob> {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
    const w = Math.round(bmp.width * scale)
    const h = Math.round(bmp.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    return blob ?? file
  } catch {
    return file
  }
}
