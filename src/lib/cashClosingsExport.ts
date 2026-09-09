// Export Excel dello specchietto incassi (fase 4): un foglio «Riepilogo»
// giorni × punti vendita e un foglio per punto vendita nella forma del
// vecchio foglio Excel (una riga al giorno, una colonna per canale).
// Funzione pura: riceve i dati già caricati dalla pagina e restituisce le
// matrici (array of arrays) che la pagina passa a xlsx.

import { CLOSING_STATUS_LABELS, formatDateIt, type PaymentChannel } from './cashClosings'

export interface ExportClosing {
  id: string
  outlet_id: string
  closing_date: string
  status: string
  is_closed_day: boolean
  total_receipts: number | string
  cash_expenses: number | string
  customer_refunds: number | string
  cash_deposit: number | string
  cash_float_declared: number | string | null
  cash_difference: number | string | null
  /** Fatture (kind=fattura): si sommano ai corrispettivi. Opzionale per compatibilità. */
  invoices_total?: number | string | null
  /** Contanti ancora da versare contati stasera. */
  cash_pending_declared?: number | string | null
  closed_by_name: string | null
  notes: string | null
}

export interface ExportInput {
  days: string[]
  outlets: Array<{ id: string; name: string }>
  channels: PaymentChannel[]
  closings: ExportClosing[]
  /** closing_id → (channel_id → importo) */
  linesByClosing: Map<string, Map<string, number>>
}

export type Cell = string | number | null
export interface ExportSheet { name: string; aoa: Cell[][] }

const num = (v: number | string | null | undefined): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

/** Nome foglio Excel valido: max 31 caratteri, senza \ / ? * [ ] : */
export function sheetName(name: string, used: Set<string>): string {
  const base = (name.replace(/[\\/?*[\]:]/g, ' ').trim() || 'Foglio').slice(0, 31)
  let n = base
  let i = 2
  while (used.has(n.toLowerCase())) { const suf = ` (${i++})`; n = base.slice(0, 31 - suf.length) + suf }
  used.add(n.toLowerCase())
  return n
}

export function buildCashClosingsSheets(input: ExportInput): ExportSheet[] {
  const closingAt = new Map<string, ExportClosing>()
  for (const c of input.closings) closingAt.set(`${c.outlet_id}|${c.closing_date}`, c)
  const used = new Set<string>()
  const sheets: ExportSheet[] = []

  // Riepilogo: giorni × outlet (totale corrispettivi; «chiuso» per il giorno di negozio chiuso)
  const head: Cell[] = ['Data', ...input.outlets.map((o) => o.name), 'Totale']
  const body: Cell[][] = input.days.map((d) => {
    let tot = 0
    const cells: Cell[] = input.outlets.map((o) => {
      const c = closingAt.get(`${o.id}|${d}`)
      if (!c) return null
      if (c.is_closed_day) return 'chiuso'
      const v = num(c.total_receipts) ?? 0
      tot += v
      return v
    })
    return [formatDateIt(d, true), ...cells, Math.round(tot * 100) / 100]
  })
  const colTot: Cell[] = input.outlets.map((o) => Math.round(input.days.reduce((s, d) => { const c = closingAt.get(`${o.id}|${d}`); return s + (c && !c.is_closed_day ? num(c.total_receipts) ?? 0 : 0) }, 0) * 100) / 100)
  const grand = Math.round((colTot as number[]).reduce((s, v) => s + v, 0) * 100) / 100
  sheets.push({ name: sheetName('Riepilogo', used), aoa: [head, ...body, ['Totale', ...colTot, grand]] })

  // Un foglio per punto vendita, come il foglio Excel
  for (const o of input.outlets) {
    const chs = input.channels.filter((ch) => ch.outlet_id === o.id && ch.is_active).sort((a, b) => a.sort_order - b.sort_order)
    const h: Cell[] = ['Data', 'Totale corrispettivi', 'Fatture', 'Totale incassato', ...chs.map((ch) => ch.label), 'Spese cassa', 'Rimborsi', 'Versamenti', 'Fondo cassa', 'Da versare', 'Diff. cassa', 'Stato', 'Chiuso da', 'Note']
    const rows: Cell[][] = input.days.map((d) => {
      const c = closingAt.get(`${o.id}|${d}`)
      if (!c) return [formatDateIt(d, true), null, null, null, ...chs.map(() => null), null, null, null, null, null, null, '', '', '']
      const lm = input.linesByClosing.get(c.id)
      return [
        formatDateIt(d, true),
        c.is_closed_day ? 'chiuso' : num(c.total_receipts),
        c.is_closed_day ? null : num(c.invoices_total ?? 0),
        c.is_closed_day ? 'chiuso' : Math.round(((num(c.total_receipts) ?? 0) + (num(c.invoices_total ?? 0) ?? 0)) * 100) / 100,
        ...chs.map((ch) => (lm ? num(lm.get(ch.id) ?? 0) : null)),
        num(c.cash_expenses), num(c.customer_refunds), num(c.cash_deposit), num(c.cash_float_declared), num(c.cash_pending_declared), num(c.cash_difference),
        c.is_closed_day ? 'Negozio chiuso' : (CLOSING_STATUS_LABELS[c.status as keyof typeof CLOSING_STATUS_LABELS] ?? c.status),
        c.closed_by_name ?? '', c.notes ?? '',
      ]
    })
    const sum = (pick: (c: ExportClosing, lm: Map<string, number> | undefined) => number) =>
      Math.round(input.days.reduce((s, d) => { const c = closingAt.get(`${o.id}|${d}`); return c && !c.is_closed_day ? s + pick(c, input.linesByClosing.get(c.id)) : s }, 0) * 100) / 100
    const tot: Cell[] = [
      'Totale', sum((c) => num(c.total_receipts) ?? 0), sum((c) => num(c.invoices_total ?? 0) ?? 0), sum((c) => (num(c.total_receipts) ?? 0) + (num(c.invoices_total ?? 0) ?? 0)),
      ...chs.map((ch) => sum((_c, lm) => lm?.get(ch.id) ?? 0)),
      sum((c) => num(c.cash_expenses) ?? 0), sum((c) => num(c.customer_refunds) ?? 0), sum((c) => num(c.cash_deposit) ?? 0), null, null, sum((c) => num(c.cash_difference) ?? 0), '', '', '',
    ]
    sheets.push({ name: sheetName(o.name, used), aoa: [h, ...rows, tot] })
  }
  return sheets
}
