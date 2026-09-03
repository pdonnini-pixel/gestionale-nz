import { describe, it, expect } from 'vitest'
import { splitWithholding, transformInvoiceToRecords, type FatturaInvoice } from './xmlInvoiceParser'

// Caso reale NZ (settembre 2026): fattura 191 SIGNORINI ASSOCIATI del 09/03/2026,
// totale documento 8.098,75 €, ritenuta d'acconto 20% = 1.276,60 €,
// <ImportoPagamento> 6.822,15 €. Il bonifico in banca e' di 6.822,15 €.
const base = (over: Partial<FatturaInvoice> = {}): FatturaInvoice => ({
  tipo_documento: 'TD06',
  tipo_label: 'Parcella',
  invoice_number: '191',
  invoice_date: '2026-03-09',
  divisa: 'EUR',
  supplier_name: 'SIGNORINI ASSOCIATI',
  supplier_vat: '06511620483',
  net_amount: 6638.32,
  vat_amount: 1460.43,
  gross_amount: 8098.75,
  causale: null,
  line_items: [],
  vat_summary: [],
  payment_details: [{ modalita: 'MP05', data_scadenza: '2026-04-08', importo: 6822.15, iban: null, bic: null }],
  ritenuta_acconto: { tipo: 'RT02', importo: 1276.6, aliquota: 20, causale_pagamento: 'A' },
  _raw: { tipo_documento: 'TD06', numero: '191', data: '2026-03-09', importo_totale: 8098.75 },
  ...over,
})

const ctx = { company_id: 'c1', import_batch_id: null, raw_xml: null }

describe('splitWithholding', () => {
  it('scompone totale documento in dovuto + ritenuta', () => {
    expect(splitWithholding(base())).toEqual({ docTotal: 8098.75, dueTotal: 6822.15, ritenuta: 1276.6 })
  })
  it('senza ritenuta il dovuto e\' il totale documento', () => {
    expect(splitWithholding(base({ ritenuta_acconto: null }))).toEqual({ docTotal: 8098.75, dueTotal: 8098.75, ritenuta: 0 })
  })
  it('ignora una ritenuta piu\' alta del documento (XML corrotto)', () => {
    expect(splitWithholding(base({ ritenuta_acconto: { tipo: 'RT02', importo: 99999, aliquota: 20, causale_pagamento: 'A' } })).ritenuta).toBe(0)
  })
})

describe('transformInvoiceToRecords con ritenuta d\'acconto', () => {
  it('la scadenza nasce al netto (dovuto al fornitore) con la ritenuta a parte', () => {
    const { invoiceRecords, payableRecords } = transformInvoiceToRecords([base()], null, ctx)
    expect(invoiceRecords[0].gross_amount).toBe(8098.75)      // totale documento invariato
    expect(invoiceRecords[0].withholding_amount).toBe(1276.6)
    expect(payableRecords).toHaveLength(1)
    const p = payableRecords[0]
    expect(p.gross_amount).toBe(6822.15)                       // = bonifico in banca
    expect(p.withholding_amount).toBe(1276.6)
    expect(p.amount_remaining).toBe(6822.15)
    // imponibile/IVA restano quelli del documento (quota 100%)
    expect(p.net_amount).toBe(6638.32)
    expect(p.vat_amount).toBe(1460.43)
  })

  it('rate espresse al lordo vengono riproporzionate sul netto, ritenuta pro-quota', () => {
    const inv = base({
      payment_details: [
        { modalita: 'MP05', data_scadenza: '2026-04-08', importo: 4049.38, iban: null, bic: null },
        { modalita: 'MP05', data_scadenza: '2026-05-08', importo: 4049.37, iban: null, bic: null },
      ],
    })
    const { payableRecords } = transformInvoiceToRecords([inv], null, ctx)
    expect(payableRecords).toHaveLength(2)
    const dovuto = payableRecords.reduce((s, p) => s + Number(p.gross_amount), 0)
    const rit = payableRecords.reduce((s, p) => s + Number(p.withholding_amount), 0)
    expect(+dovuto.toFixed(2)).toBe(6822.15)
    expect(+rit.toFixed(2)).toBe(1276.6)
  })

  it('senza DatiPagamento: unica scadenza al netto', () => {
    const { payableRecords } = transformInvoiceToRecords([base({ payment_details: [] })], null, ctx)
    expect(payableRecords[0].gross_amount).toBe(6822.15)
    expect(payableRecords[0].withholding_amount).toBe(1276.6)
  })

  it('senza ritenuta nulla cambia rispetto a prima', () => {
    const inv = base({ ritenuta_acconto: null, payment_details: [{ modalita: 'MP05', data_scadenza: '2026-04-08', importo: 8098.75, iban: null, bic: null }] })
    const { payableRecords } = transformInvoiceToRecords([inv], null, ctx)
    expect(payableRecords[0].gross_amount).toBe(8098.75)
    expect(payableRecords[0].withholding_amount).toBe(0)
  })

  it('nota di credito con ritenuta: segno negativo su dovuto e ritenuta', () => {
    const inv = base({ tipo_documento: 'TD04', payment_details: [] })
    const { payableRecords } = transformInvoiceToRecords([inv], null, ctx)
    expect(payableRecords[0].gross_amount).toBe(-6822.15)
    expect(payableRecords[0].withholding_amount).toBe(-1276.6)
    expect(payableRecords[0].status).toBe('nota_credito')
  })
})
