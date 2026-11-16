import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FatturaInvoice, FatturaSupplier } from './xmlInvoiceParser'

// Database finto in memoria: basta per le catene che usa processInvoiceXML.
type Riga = Record<string, unknown>
const db: Record<string, Riga[]> = {}
let seq = 0

function query(tabella: string) {
  const filtri: Array<[string, unknown]> = []
  const righe = () => (db[tabella] || []).filter(r => filtri.every(([k, v]) => r[k] === v))
  const q = {
    eq(k: string, v: unknown) { filtri.push([k, v]); return q },
    or() { return q },
    maybeSingle: async () => ({ data: righe()[0] ?? null, error: null }),
    then(res: (v: { data: Riga[]; error: null }) => unknown) { return Promise.resolve({ data: righe(), error: null }).then(res) },
  }
  return q
}

vi.mock('../supabase', () => ({
  supabase: {
    from: (tabella: string) => ({
      select: () => query(tabella),
      insert: (r: Riga | Riga[]) => {
        const nuove = (Array.isArray(r) ? r : [r]).map(x => ({ id: `id-${++seq}`, ...x }))
        db[tabella] = [...(db[tabella] || []), ...nuove]
        const out = { data: nuove.map(n => ({ id: n.id })), error: null }
        return { select: () => Object.assign(Promise.resolve(out), { single: async () => ({ data: out.data[0], error: null }) }) }
      },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
}))

const fornitore: FatturaSupplier = {
  ragione_sociale: 'FORNITORE SRL', partita_iva: '01234567890', codice_fiscale: null, paese: 'IT',
  sede: { indirizzo: null, cap: null, comune: null, provincia: null, nazione: 'IT' }, regime_fiscale: null,
} as FatturaSupplier

const fattura: FatturaInvoice = {
  tipo_documento: 'TD01', tipo_label: 'Fattura', invoice_number: '12/A', invoice_date: '2026-10-05', divisa: 'EUR',
  supplier_name: 'FORNITORE SRL', supplier_vat: '01234567890', net_amount: 100, vat_amount: 22, gross_amount: 122,
  causale: null, line_items: [], vat_summary: [],
  payment_details: [{ modalita: 'MP05', data_scadenza: '2026-11-30', importo: 122, iban: null, bic: null }],
  ritenuta_acconto: null,
  _raw: { tipo_documento: 'TD01', numero: '12/A', data: '2026-10-05', importo_totale: 122 },
}

vi.mock('./xmlInvoiceParser', async (orig) => ({
  ...(await orig<typeof import('./xmlInvoiceParser')>()),
  parseFatturaPA: () => ({ invoices: [fattura], supplier: fornitore, errors: [] }),
}))

const { processInvoiceXML, sdiIdDiRipiego, numeroFatturaConfrontabile } = await import('./importEngine')
const ctx = { company_id: 'c1' } as Parameters<typeof processInvoiceXML>[1]
const nulla = () => {}

describe('processInvoiceXML: ricaricare lo stesso XML non crea doppioni', () => {
  beforeEach(() => { for (const k of Object.keys(db)) delete db[k]; seq = 0 })

  it('la prima volta inserisce fattura e scadenza legate a fattura e fornitore', async () => {
    const r = await processInvoiceXML('<xml/>', ctx, 'b1', nulla)
    expect(r.imported).toBe(1)
    expect(db.electronic_invoices).toHaveLength(1)
    expect(db.electronic_invoices[0].sdi_id).toBe('SDI_01234567890_12/A_2026-10-05')
    expect(db.payables).toHaveLength(1)
    expect(db.payables[0].electronic_invoice_id).toBe(db.electronic_invoices[0].id)
    expect(db.payables[0].supplier_id).toBe(db.suppliers[0].id)
  })

  it('la seconda volta la salta e lo dice', async () => {
    await processInvoiceXML('<xml/>', ctx, 'b1', nulla)
    const r = await processInvoiceXML('<xml/>', ctx, 'b2', nulla)
    expect(r.imported).toBe(0)
    expect(r.errors).toHaveLength(0)
    expect(db.electronic_invoices).toHaveLength(1)
    expect(db.payables).toHaveLength(1)
    expect(String(r.warnings?.[0]?.message)).toContain('già presente')
    expect(r.details?.giaPresenti).toBe(1)
  })

  it('riconosce la stessa fattura anche se il numero ha spazi o minuscole diverse', async () => {
    db.electronic_invoices = [{ id: 'x', company_id: 'c1', supplier_vat: '01234567890', invoice_date: '2026-10-05', invoice_number: '12/a ' }]
    const r = await processInvoiceXML('<xml/>', ctx, 'b1', nulla)
    expect(r.imported).toBe(0)
    expect(db.electronic_invoices).toHaveLength(1)
  })
})

describe('chiavi di confronto', () => {
  it('numero fattura senza spazi e maiuscolo', () => {
    expect(numeroFatturaConfrontabile(' 12 /a ')).toBe('12/A')
  })
  it('sdi_id di ripiego come sdi-receive, solo con tutti e tre i dati', () => {
    expect(sdiIdDiRipiego('0123', '5', '2026-01-02')).toBe('SDI_0123_5_2026-01-02')
    expect(sdiIdDiRipiego(null, '5', '2026-01-02')).toBeNull()
  })
})
