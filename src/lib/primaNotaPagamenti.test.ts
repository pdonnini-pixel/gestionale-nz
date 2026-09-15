// Test del foglio «Pagamenti fornitori» su casi REALI di agosto 2026 (tenant NZ).
import { describe, it, expect } from 'vitest'
import {
  fonteOf, importoPagato, metodoLabel, rataOf, buildPagamentoRow, includePagamento,
  sortPagamenti, summarizePagamenti, type PnPagamento, type PnLookups,
} from './primaNotaPagamenti'

const base: PnPagamento = {
  id: 'p1', payment_date: '2026-08-31', invoice_number: '3797', invoice_date: '2026-06-02',
  supplier_name: 'GRUPPO FB SRL', supplier_vat: '01234567890',
  net_amount: 1000, vat_amount: 220, gross_amount: 1220, amount_paid: 1220, withholding_amount: null,
  payment_method: 'riba_90', payment_method_label: null, status: 'pagato',
  closed_manually: false, manual_close_reason: null, is_provisional_paid: false,
  installment_number: 1, installment_total: 3,
  bank_transaction_id: 'tx-riba', payment_bank_account_id: 'acc-bcc', cost_category_id: 'cat-merce', outlet_id: null,
}
const pg = (over: Partial<PnPagamento>): PnPagamento => ({ ...base, ...over })

const lk: PnLookups = {
  bankAccounts: new Map([
    ['acc-bcc', { bank_name: 'BCC Valdarno Fiorentino', iban: 'IT37H0845705463000000017334' }],
    ['acc-mps', { bank_name: 'MPS', iban: 'IT04V0103038020000000621460' }],
  ]),
  bankTx: new Map([
    ['tx-riba', { transaction_date: '2026-08-31', bank_account_id: 'acc-bcc', description: 'Causale: EFFETTI RITIRATI' }],
    ['tx-mps', { transaction_date: '2026-08-25', bank_account_id: 'acc-mps', description: 'Carta del Credito Cooperativo' }],
  ]),
  categories: new Map([['cat-merce', { name: 'Acquisto merce', ce_account_code: '610134' }]]),
  outlets: new Map([['out-vdc', { code: 'VDC', name: 'Valdichiana' }]]),
}
const d = (s: string) => s

describe('fonteOf: da dove risulta pagata la fattura', () => {
  it('riscontro in banca', () => expect(fonteOf(base)).toBe('banca'))
  it('contanti e carta, anche se segnate provvisorie', () => {
    expect(fonteOf(pg({ bank_transaction_id: null, payment_method: 'contanti', is_provisional_paid: true }))).toBe('contanti')
    expect(fonteOf(pg({ bank_transaction_id: null, payment_method: 'carta_credito', is_provisional_paid: true }))).toBe('carta')
  })
  it('una carta riscontrata sull\'estratto carta resta banca', () => {
    expect(fonteOf(pg({ bank_transaction_id: 'tx-mps', payment_method: 'carta_credito', closed_manually: true }))).toBe('banca')
  })
  it('nota di credito: per stato o per lordo negativo dentro una RiBa', () => {
    expect(fonteOf(pg({ status: 'nota_credito', gross_amount: -237.34, amount_paid: 0, bank_transaction_id: null }))).toBe('nota_credito')
    expect(fonteOf(pg({ status: 'pagato', gross_amount: -2914.9, amount_paid: -2914.9 }))).toBe('nota_credito')
  })
  it('chiusa a mano senza banca, provvisoria, senza riscontro', () => {
    expect(fonteOf(pg({ bank_transaction_id: null, payment_method: 'bonifico_ordinario', closed_manually: true }))).toBe('chiusa_a_mano')
    expect(fonteOf(pg({ bank_transaction_id: null, payment_method: 'bonifico_ordinario', is_provisional_paid: true }))).toBe('provvisoria')
    expect(fonteOf(pg({ bank_transaction_id: null, payment_method: 'bonifico_ordinario' }))).toBe('senza_riscontro')
  })
})

describe('importi, metodo, rata', () => {
  it('pagato = amount_paid, o il lordo se manca; per la nota di credito il lordo negativo', () => {
    expect(importoPagato(base)).toBe(1220)
    expect(importoPagato(pg({ amount_paid: null, gross_amount: 56.93 }))).toBe(56.93)
    expect(importoPagato(pg({ status: 'nota_credito', gross_amount: -237.34, amount_paid: 0 }))).toBe(-237.34)
  })
  it('metodo leggibile dall\'enum, poi dall\'etichetta libera', () => {
    expect(metodoLabel(base)).toBe('Ri.Ba. 90gg')
    expect(metodoLabel(pg({ payment_method: 'sdd_core', payment_method_label: 'SEPA Direct Debit' }))).toBe('SDD Core')
    expect(metodoLabel(pg({ payment_method: null, payment_method_label: 'Contanti' }))).toBe('Contanti')
    expect(metodoLabel(pg({ payment_method: null, payment_method_label: null }))).toBe('')
  })
  it('rata solo se il piano ha più di una rata', () => {
    expect(rataOf(base)).toBe('1/3')
    expect(rataOf(pg({ installment_number: 1, installment_total: 1 }))).toBe('')
    expect(rataOf(pg({ installment_number: null, installment_total: null }))).toBe('')
  })
})

describe('buildPagamentoRow', () => {
  it('riga completa per una fattura riscontrata in banca', () => {
    const row = buildPagamentoRow(base, lk, d)
    expect(row).toMatchObject({
      'Data pagamento': '2026-08-31', Fonte: 'Banca', 'Conto Banca': 'BCC Valdarno Fiorentino', IBAN: 'IT37H0845705463000000017334',
      'Data movimento': '2026-08-31', Fornitore: 'GRUPPO FB SRL', 'P.IVA': '01234567890', 'N. fattura': '3797', 'Data fattura': '2026-06-02',
      Rata: '1/3', Imponibile: 1000, IVA: 220, Ritenuta: '', Lordo: 1220, Pagato: 1220, Metodo: 'Ri.Ba. 90gg',
      Categoria: 'Acquisto merce', 'Conto CE': '610134', Outlet: '', Note: '',
    })
  })
  it('il conto viene dal movimento riscontrato, non da quello previsto in distinta', () => {
    const row = buildPagamentoRow(pg({ bank_transaction_id: 'tx-mps', payment_bank_account_id: 'acc-bcc' }), lk, d)
    expect(row['Conto Banca']).toBe('MPS')
    expect(row['Data movimento']).toBe('2026-08-25')
  })
  it('contanti: niente conto, niente movimento, nota vuota', () => {
    const row = buildPagamentoRow(pg({ bank_transaction_id: null, payment_bank_account_id: null, payment_method: 'contanti', is_provisional_paid: true, installment_total: 1 }), lk, d)
    expect(row.Fonte).toBe('Contanti')
    expect(row['Conto Banca']).toBe('')
    expect(row.IBAN).toBe('')
    expect(row['Data movimento']).toBe('')
    expect(row.Note).toBe('')
  })
  it('chiusa a mano: la motivazione scritta vince sulla nota standard', () => {
    const std = buildPagamentoRow(pg({ bank_transaction_id: null, closed_manually: true }), lk, d)
    expect(std.Note).toBe('Segnata pagata a mano, senza movimento bancario collegato')
    const custom = buildPagamentoRow(pg({ bank_transaction_id: null, closed_manually: true, manual_close_reason: 'NC gia\' scalata da Sabrina' }), lk, d)
    expect(custom.Note).toBe('NC gia\' scalata da Sabrina')
  })
  it('outlet e ritenuta quando ci sono', () => {
    const row = buildPagamentoRow(pg({ outlet_id: 'out-vdc', withholding_amount: 200 }), lk, d)
    expect(row.Outlet).toBe('VDC · Valdichiana')
    expect(row.Ritenuta).toBe(200)
  })
})

describe('includePagamento, ordine e riepilogo', () => {
  it('esclude segnaposto, previsioni e fatture senza data di pagamento', () => {
    expect(includePagamento({ ...base, is_placeholder: true }, lk, 'all')).toBe(false)
    expect(includePagamento({ ...base, is_forecast: true }, lk, 'all')).toBe(false)
    expect(includePagamento(pg({ payment_date: null }), lk, 'all')).toBe(false)
    expect(includePagamento(base, lk, 'all')).toBe(true)
  })
  it('filtro conto: guarda il conto del movimento riscontrato, poi quello disposto; contanti fuori', () => {
    expect(includePagamento(base, lk, 'acc-bcc')).toBe(true)
    expect(includePagamento(base, lk, 'acc-mps')).toBe(false)
    expect(includePagamento(pg({ bank_transaction_id: null, payment_bank_account_id: 'acc-mps' }), lk, 'acc-mps')).toBe(true)
    expect(includePagamento(pg({ bank_transaction_id: null, payment_bank_account_id: null, payment_method: 'contanti' }), lk, 'acc-mps')).toBe(false)
  })
  it('ordina per data, fornitore, numero fattura (numerico)', () => {
    const rows = sortPagamenti([
      pg({ id: 'c', payment_date: '2026-08-31', supplier_name: 'MIAN SRL', invoice_number: '115' }),
      pg({ id: 'a', payment_date: '2026-08-07', supplier_name: 'WOLF GROUP S.R.L.', invoice_number: '218' }),
      pg({ id: 'b', payment_date: '2026-08-31', supplier_name: 'MIAN SRL', invoice_number: '56' }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
  it('riepilogo per fonte con importi pagati', () => {
    const s = summarizePagamenti([
      base,
      pg({ id: 'p2', gross_amount: 100, amount_paid: 100 }),
      pg({ id: 'p3', bank_transaction_id: null, payment_method: 'contanti', gross_amount: 22.75, amount_paid: 22.75 }),
      pg({ id: 'p4', status: 'nota_credito', bank_transaction_id: null, gross_amount: -237.34, amount_paid: 0 }),
    ])
    expect(s).toEqual([
      { fonte: 'banca', label: 'Banca', n: 2, importo: 1320 },
      { fonte: 'contanti', label: 'Contanti', n: 1, importo: 22.75 },
      { fonte: 'nota_credito', label: 'Nota di credito', n: 1, importo: -237.34 },
    ])
  })
})
