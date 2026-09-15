import { describe, it, expect } from 'vitest'
import { buildCashClosingsSheets, sheetName, type ExportClosing } from './cashClosingsExport'
import type { PaymentChannel } from './cashClosings'

const ch = (id: string, outlet_id: string, label: string, sort_order: number): PaymentChannel =>
  ({ id, outlet_id, label, kind: 'pos', bank_account_id: null, terminal_code: null, pos_terminal_id: null, bank_tolerance_pct: 0, counts_in_total: true, sort_order, is_active: true })
const closing = (p: Partial<ExportClosing> & { id: string; outlet_id: string; closing_date: string }): ExportClosing =>
  ({ status: 'confermata', is_closed_day: false, total_receipts: 0, cash_expenses: 0, customer_refunds: 0, cash_deposit: 0, cash_float_declared: null, cash_difference: 0, closed_by_name: null, notes: null, ...p })

describe('sheetName', () => {
  it('rispetta i limiti di Excel ed evita i doppioni', () => {
    const used = new Set<string>()
    expect(sheetName('VICOLO c/o FRANCIACORTA [outlet]', used)).toBe('VICOLO c o FRANCIACORTA  outlet')
    expect(sheetName('A'.repeat(40), used)).toHaveLength(31)
    expect(sheetName('Riepilogo', used)).toBe('Riepilogo')
    expect(sheetName('riepilogo', used)).toBe('riepilogo (2)')
  })
})

describe('buildCashClosingsSheets', () => {
  it('riepilogo giorni × outlet e un foglio per outlet con i canali', () => {
    const days = ['2026-09-01', '2026-09-02']
    const outlets = [{ id: 'o1', name: 'VALDICHIANA' }, { id: 'o2', name: 'TORINO' }]
    const channels = [ch('c1', 'o1', 'Contanti', 1), ch('c2', 'o1', 'POS MPS', 2), ch('c3', 'o2', 'Contanti', 1)]
    const closings = [
      closing({ id: 'k1', outlet_id: 'o1', closing_date: '2026-09-01', total_receipts: '1019.63', cash_deposit: 500, closed_by_name: 'Anna' }),
      closing({ id: 'k2', outlet_id: 'o2', closing_date: '2026-09-01', total_receipts: 633.45 }),
      closing({ id: 'k3', outlet_id: 'o2', closing_date: '2026-09-02', is_closed_day: true }),
    ]
    const linesByClosing = new Map([['k1', new Map([['c1', 95.1], ['c2', 924.53]])], ['k2', new Map([['c3', 202.65]])]])
    const sheets = buildCashClosingsSheets({ days, outlets, channels, closings, linesByClosing })
    expect(sheets.map((s) => s.name)).toEqual(['Riepilogo', 'VALDICHIANA', 'TORINO'])
    const r = sheets[0].aoa
    expect(r[0]).toEqual(['Data', 'VALDICHIANA', 'TORINO', 'Totale'])
    expect(r[1].slice(1)).toEqual([1019.63, 633.45, 1653.08])
    expect(r[2].slice(1)).toEqual([null, 'chiuso', 0])
    expect(r[3]).toEqual(['Totale', 1019.63, 633.45, 1653.08])
    const v = sheets[1].aoa
    expect(v[0].slice(0, 6)).toEqual(['Data', 'Totale corrispettivi', 'Fatture', 'Totale incassato', 'Contanti', 'POS MPS'])
    expect(v[1].slice(1, 6)).toEqual([1019.63, 0, 1019.63, 95.1, 924.53])
    expect(v[1][8]).toBe(500)
    expect(v[1][12]).toBe('Confermata')
    expect(v[1][13]).toBe('Anna')
    expect(v[2][1]).toBeNull()
    expect(v[3][0]).toBe('Totale')
    expect(v[3][1]).toBe(1019.63)
    const t = sheets[2].aoa
    expect(t[2][1]).toBe('chiuso')
    expect(t[2][11]).toBe('Negozio chiuso')
  })
})
