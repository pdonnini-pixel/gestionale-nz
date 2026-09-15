import { describe, it, expect } from 'vitest'
import { parseFatturaJson, parseInvoiceContent } from './InvoiceViewer'

// Fixture ricalcata sulla struttura reale delle fatture salvate come JSON
// strutturato A-Cube (es. fattura 88-2026 di PATRIZIA NIGRO su tenant NZ):
// `electronic_invoices.xml_content` contiene JSON, non XML FatturaPA grezzo.
// Prima del fix il viewer mostrava "XML non valido" per queste fatture.
const ACUBE_JSON = JSON.stringify({
  fattura_elettronica_header: {
    cedente_prestatore: {
      sede: { cap: '59100', comune: 'Prato', nazione: 'IT', indirizzo: 'Via F. Vannetti Donnini', provincia: 'PO', numero_civico: '74/2' },
      dati_anagrafici: {
        anagrafica: { nome: 'PATRIZIA', cognome: 'NIGRO', denominazione: null },
        codice_fiscale: 'NGRPRZ75M69G999Y',
        id_fiscale_iva: { id_paese: 'IT', id_codice: '02063730978' },
      },
    },
    cessionario_committente: {
      sede: { cap: '50129', comune: 'Firenze', nazione: 'IT', indirizzo: 'VIA IX FEBBRAIO 7', provincia: 'FI' },
      dati_anagrafici: {
        anagrafica: { denominazione: 'NEW ZAGO SRL' },
        codice_fiscale: '07362100484',
        id_fiscale_iva: { id_paese: 'IT', id_codice: '07362100484' },
      },
    },
  },
  fattura_elettronica_body: [
    {
      allegati: ['<base64 pdf omitted>'],
      dati_generali: {
        dati_generali_documento: {
          data: '2026-08-03',
          divisa: 'EUR',
          numero: '88-2026',
          causale: ['Fattura'],
          tipo_documento: 'TD01',
          importo_totale_documento: '13075.14',
        },
      },
      dati_pagamento: [
        {
          condizioni_pagamento: 'TP02',
          dettaglio_pagamento: [
            {
              iban: 'IT28G0306921526100000011974',
              importo_pagamento: '13075.14',
              modalita_pagamento: 'MP12',
              istituto_finanziario: 'INTESA SANPAOLO SPA',
              data_scadenza_pagamento: '2026-08-31',
            },
          ],
        },
      ],
      dati_beni_servizi: {
        dati_riepilogo: [
          { natura: null, imposta: '2357.81', aliquota_iva: '22.00', esigibilita_iva: 'I', imponibile_importo: '10717.33' },
        ],
        dettaglio_linee: [
          { descrizione: 'CAMICIA 55%LINO 45%VISCOSA MADE IN ITALY', quantita: '133.00', aliquota_iva: '22.00', numero_linea: 1, unita_misura: 'Pz.', prezzo_totale: '1928.50', prezzo_unitario: '14.50' },
          { descrizione: 'ABITO 55%LINO 45%VISCOSA MADE IN ITALY', quantita: '73.00', aliquota_iva: '22.00', numero_linea: 2, unita_misura: 'Pz.', prezzo_totale: '1131.50', prezzo_unitario: '15.50' },
        ],
      },
    },
  ],
})

describe('parseFatturaJson (A-Cube structured JSON)', () => {
  it('mappa fornitore, cliente, documento, linee, riepilogo e pagamento', () => {
    const data = parseFatturaJson(ACUBE_JSON)

    // Fornitore (persona fisica: nome + cognome, nessuna denominazione)
    expect(data.fornitore.denominazione).toBe('PATRIZIA NIGRO')
    expect(data.fornitore.partitaIva).toBe('02063730978')
    expect(data.fornitore.codiceFiscale).toBe('NGRPRZ75M69G999Y')
    expect(data.fornitore.comune).toBe('Prato')
    expect(data.fornitore.indirizzo).toBe('Via F. Vannetti Donnini 74/2')

    // Cliente
    expect(data.cliente.denominazione).toBe('NEW ZAGO SRL')

    // Documento
    expect(data.documento.tipo).toBe('TD01')
    expect(data.documento.tipoLabel).toBe('Fattura')
    expect(data.documento.numero).toBe('88-2026')
    expect(data.documento.data).toBe('2026-08-03')
    expect(data.documento.importoTotale).toBe('13075.14')
    expect(data.documento.causale).toBe('Fattura')

    // Linee
    expect(data.linee).toHaveLength(2)
    expect(data.linee[0].descrizione).toContain('CAMICIA')
    expect(data.linee[0].numero).toBe('1')
    expect(data.linee[0].prezzoTotale).toBe('1928.50')

    // Riepilogo IVA
    expect(data.riepilogo).toHaveLength(1)
    expect(data.riepilogo[0].aliquota).toBe('22.00')
    expect(data.riepilogo[0].imposta).toBe('2357.81')

    // Pagamento (RIBA MP12)
    expect(data.pagamento).toHaveLength(1)
    expect(data.pagamento[0].modalita).toBe('MP12')
    expect(data.pagamento[0].modalitaLabel).toBe('RIBA')
    expect(data.pagamento[0].scadenza).toBe('2026-08-31')
    expect(data.pagamento[0].importo).toBe('13075.14')
    expect(data.pagamento[0].iban).toBe('IT28G0306921526100000011974')
  })

  it('parseInvoiceContent instrada il JSON al parser JSON', () => {
    const data = parseInvoiceContent(ACUBE_JSON)
    expect(data.documento.numero).toBe('88-2026')
  })

  it('lancia "XML non valido" su JSON malformato', () => {
    expect(() => parseFatturaJson('{not valid json')).toThrow('XML non valido')
  })
})
