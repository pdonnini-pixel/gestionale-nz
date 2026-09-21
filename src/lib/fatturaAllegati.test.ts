import { describe, it, expect } from 'vitest'
import { parseFatturaAllegati } from './fatturaAllegati'

// Fixture ricalcata sulla struttura reale delle fatture entrate dal Cassetto
// Fiscale A-Cube (dal 23/07/2026): `electronic_invoices.xml_content` contiene il
// JSON strutturato, e gli allegati stanno in fattura_elettronica_body[].allegati[]
// con chiavi snake_case. Prima del fix il pulsante "PDF" di Fornitori rispondeva
// "Nessun PDF allegato" su 106 fatture che il PDF ce l'avevano eccome.

// "%PDF-1.4" + un po' di corpo, in base64: basta a far scattare looksLikePdf.
const PDF_B64 = btoa('%PDF-1.4\nfake pdf body\n%%EOF')
// Un allegato non PDF (hash SHA256 in TXT): esiste davvero sulle fatture Enel.
const TXT_B64 = btoa('9e8c5ee935b7f7c0')

function jsonInvoice(allegati: unknown): string {
  return JSON.stringify({
    fattura_elettronica_header: { dati_trasmissione: { formato_trasmissione: 'FPR12' } },
    fattura_elettronica_body: [{ allegati, dati_generali: { dati_generali_documento: { numero: '1077' } } }],
  })
}

describe('parseFatturaAllegati — JSON strutturato A-Cube', () => {
  it('estrae il PDF del fornitore con nome e formato dichiarati', () => {
    const out = parseFatturaAllegati(jsonInvoice([
      { attachment: PDF_B64, nome_attachment: 'ft_8-1986_25082026.pdf', formato_attachment: 'pdf', algoritmo_compressione: null },
    ]))
    expect(out).toHaveLength(1)
    expect(out[0].nome).toBe('ft_8-1986_25082026.pdf')
    expect(out[0].isPdf).toBe(true)
    expect(out[0].data.length).toBeGreaterThan(0)
  })

  it('distingue il PDF dagli altri allegati della stessa fattura', () => {
    const out = parseFatturaAllegati(jsonInvoice([
      { attachment: TXT_B64, nome_attachment: 'SHA256_PDF_005468001345', formato_attachment: 'TXT', algoritmo_compressione: null },
      { attachment: PDF_B64, nome_attachment: 'Fattura.pdf', formato_attachment: 'PDF', algoritmo_compressione: null },
    ]))
    expect(out.map(a => a.isPdf)).toEqual([false, true])
  })

  it('riconosce il PDF dai primi byte anche senza formato dichiarato', () => {
    const out = parseFatturaAllegati(jsonInvoice([
      { attachment: PDF_B64, nome_attachment: '755289501', formato_attachment: null },
    ]))
    expect(out[0].isPdf).toBe(true)
  })

  it('regge la forma abbreviata allegati: ["<base64>"]', () => {
    const out = parseFatturaAllegati(jsonInvoice([PDF_B64]))
    expect(out).toHaveLength(1)
    expect(out[0].nome).toBe('allegato_1')
    expect(out[0].isPdf).toBe(true)
  })

  it('scarta gli allegati vuoti o con base64 non decodificabile', () => {
    const out = parseFatturaAllegati(jsonInvoice([
      { attachment: '', nome_attachment: 'vuoto.pdf', formato_attachment: 'PDF' },
      { attachment: '!!!non-base64!!!', nome_attachment: 'rotto.pdf', formato_attachment: 'PDF' },
    ]))
    expect(out).toEqual([])
  })

  it('restituisce lista vuota su fattura senza allegati, JSON malformato o contenuto assente', () => {
    expect(parseFatturaAllegati(jsonInvoice(null))).toEqual([])
    expect(parseFatturaAllegati('{ non-json')).toEqual([])
    expect(parseFatturaAllegati(null)).toEqual([])
    expect(parseFatturaAllegati('')).toEqual([])
  })
})
