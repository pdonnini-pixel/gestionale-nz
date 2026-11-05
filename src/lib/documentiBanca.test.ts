// Test della porta unica dei documenti banca. IBAN e nomi sono inventati: il
// repository e' pubblico e i conti veri non ci vanno.
import { describe, it, expect } from 'vitest'
import {
  ibanNelTesto, trovaConto, classificaDocumento, saldiDichiarati, periodoDelle,
  righePerDb, leggiEstratto, fraseEsito, chiusuraCaricamento, normIban, numeroConto, righeIntestazione,
  contoDaiMovimenti, leggiDistintaMps, numeriDallaCausale, fraseEsitoDistinta, righeCartaPerDb,
  fraseEsitoCarta, motivoNonSupportato, excelEstrattoDifettoso, type ContoLite,
} from './documentiBanca'

const IBAN_A = 'IT60X0542811101000000123456'
const IBAN_B = 'IT02L1234512345123456789012'

const conti: ContoLite[] = [
  { id: 'a-vecchio', bank_name: 'Banca A', iban: IBAN_A, account_name: IBAN_A, account_type: 'account', acube_account_uuid: null },
  { id: 'a-ob', bank_name: 'Banca A', iban: IBAN_A, account_name: IBAN_A, account_type: 'conto_corrente', acube_account_uuid: 'uuid-ob' },
  { id: 'b', bank_name: 'Banca B', iban: null, account_name: IBAN_B, account_type: 'conto_corrente', acube_account_uuid: 'uuid-b' },
]

describe('IBAN e conto', () => {
  it('trova l\'IBAN anche stampato a gruppi di quattro', () => {
    expect(ibanNelTesto('Conto IT60 X054 2811 1010 0000 0123 456 intestato a ...')).toEqual([IBAN_A])
    expect(normIban('it60 x054 2811 1010 0000 0123 456')).toBe(IBAN_A)
  })
  it('se lo stesso IBAN e\' su due righe, vince quella collegata all\'open banking', () => {
    expect(trovaConto(`Estratto conto ${IBAN_A}`, conti)?.id).toBe('a-ob')
  })
  it('riconosce l\'IBAN scritto nel nome del conto', () => {
    expect(trovaConto(`IBAN: ${IBAN_B}`, conti)?.id).toBe('b')
  })
  it('senza IBAN o con un IBAN che non e\' nostro non indovina', () => {
    expect(trovaConto('Estratto conto di agosto', conti)).toBeNull()
    expect(trovaConto('IT99Z9999999999999999999999', conti)).toBeNull()
  })
})

describe('conto senza IBAN nel file', () => {
  it('il numero del conto e\' la coda dell\'IBAN senza zeri davanti', () => {
    expect(numeroConto(IBAN_A)).toBe('123456')
    expect(numeroConto('IT02L1234512345000000000042')).toBeNull() // troppo corto: si confonderebbe
    expect(numeroConto(null)).toBeNull()
  })
  it('riconosce il conto dal «Numero conto» dell\'intestazione (come il PDF Intesa)', () => {
    const intest = ['Intestatario conto: Saldo contabile finale:', 'Numero conto: Saldo contabile iniziale:', '123456 6.361,36']
    expect(trovaConto(intest.join('\n'), conti)?.id).toBe('a-ob')
  })
  it('senza l\'etichetta «numero conto» un numero uguale non basta', () => {
    expect(trovaConto('Totale 123456 movimenti', conti)).toBeNull()
  })
  it('gli IBAN nelle causali sono dei beneficiari: non decidono il conto', () => {
    const righe = ['Data contabile Data valuta Importo Descrizione', `-4280,98 Bonifico Iban beneficiario: ${IBAN_B} saldo fattura 524`]
    const intest = righeIntestazione(righe, [{ description: `Bonifico Iban beneficiario: ${IBAN_B} saldo fattura 524` }])
    expect(intest).toEqual(['Data contabile Data valuta Importo Descrizione'])
    expect(trovaConto(intest.join('\n'), conti)).toBeNull()
  })
  it('dai movimenti: vince il conto che li ritrova quasi tutti', () => {
    expect(contoDaiMovimenti([
      { bank_account_id: 'b', righe_trovate: 190, righe: 190 },
      { bank_account_id: 'a-ob', righe_trovate: 2, righe: 190 },
    ], conti)?.id).toBe('b')
  })
  it('dai movimenti: se non c\'e\' un vincitore netto si chiede', () => {
    expect(contoDaiMovimenti([
      { bank_account_id: 'b', righe_trovate: 100, righe: 190 },
      { bank_account_id: 'a-ob', righe_trovate: 90, righe: 190 },
    ], conti)).toBeNull()
    expect(contoDaiMovimenti([{ bank_account_id: 'b', righe_trovate: 50, righe: 190 }], conti)).toBeNull()
    expect(contoDaiMovimenti([{ bank_account_id: 'b', righe_trovate: 2, righe: 2 }], conti)).toBeNull()
    expect(contoDaiMovimenti([], conti)).toBeNull()
  })
})

describe('che documento e\'', () => {
  it('le parole nelle causali non cambiano il tipo: «carta prepagata» e «Nexi» dentro un estratto conto', () => {
    const righe = [
      'Data contabile Data valuta Importo Descrizione',
      '-100 Ricarica carta prepagata da Home Banking',
      '-12,50 Commissioni Nexi Payments POS',
    ]
    const intestazione = righeIntestazione(righe, [
      { description: 'Ricarica carta prepagata da Home Banking' },
      { description: 'Commissioni Nexi Payments POS' },
    ])
    const base = { testo: righe.join('\n'), righe, conto: null, righeEstratto: 2 }
    expect(classificaDocumento(base)).not.toBe('estratto_conto')
    expect(classificaDocumento({ ...base, intestazione })).toBe('estratto_conto')
  })
  it('distinta di ritiro effetti MPS', () => {
    const righe = ['Distinta Di Ritiro Effetti Pagati', 'N° disposizioni: 1', 'Totale distinta: EUR 44.070,67']
    expect(classificaDocumento({ testo: righe.join('\n'), righe, conto: null, righeEstratto: 0 })).toBe('distinta_riba')
  })
  it('estratto commissioni Amex', () => {
    const righe = ['Estratto Conto Commissioni', 'Codice AX N. 1234567890']
    expect(classificaDocumento({ testo: righe.join('\n'), righe, conto: null, righeEstratto: 0 })).toBe('commissioni')
  })
  it('estratto conto corrente: IBAN nostro e righe di movimenti', () => {
    const righe = [`IBAN ${IBAN_A}`, '03/08/2026 03/08/2026 BONIFICO A FAVORE DI ROSSI SRL 1.200,00']
    expect(classificaDocumento({ testo: righe.join('\n'), righe, conto: conti[1], righeEstratto: 1 })).toBe('estratto_conto')
  })
  it('estratto carta CartaBCC', () => {
    const righe = ['CartaBCC Business', 'DATA ACQUISTO DATA REGISTR. DESCRIZIONE IMPORTO']
    expect(classificaDocumento({ testo: righe.join('\n'), righe, conto: null, righeEstratto: 0 })).toBe('estratto_carta')
  })
  it('un estratto conto con la parola carta resta un estratto conto', () => {
    const righe = [`IBAN ${IBAN_A}`, '25/08/2026 25/08/2026 ADDEBITO CARTA DI CREDITO 2.415,80']
    expect(classificaDocumento({ testo: righe.join('\n'), righe, conto: conti[1], righeEstratto: 1 })).toBe('estratto_conto')
  })
  it('quello che non si riconosce non si forza', () => {
    expect(classificaDocumento({ testo: 'Gentile cliente', righe: ['Gentile cliente'], conto: null, righeEstratto: 0 })).toBe('sconosciuto')
  })
})

describe('saldi dichiarati', () => {
  it('saldo iniziale e finale, anche col segno in coda', () => {
    const r = saldiDichiarati(['SALDO INIZIALE AL 31/07/2026 12.345,67', 'movimenti...', 'SALDO FINALE AL 31/08/2026 1.234,50-'])
    expect(r).toEqual({ iniziale: 12345.67, finale: -1234.5 })
  })
  it('se non c\'e\' scritto, niente numeri inventati', () => {
    expect(saldiDichiarati(['03/08/2026 BONIFICO 100,00'])).toEqual({ iniziale: null, finale: null })
  })
})

describe('periodo e righe per il database', () => {
  it('il mese e\' quello con piu\' righe', () => {
    expect(periodoDelle([{ date: '2026-07-31' }, { date: '2026-08-01' }, { date: '2026-08-20' }])).toEqual({ year: 2026, month: 8 })
  })
  it('dal PDF l\'importo va senza segno e segnato come non sicuro', () => {
    const p = leggiEstratto({ righePdf: ['03/08/2026 03/08/2026 BONIFICO A FAVORE DI ROSSI SRL SALDO FATTURA 12 1.200,00'] })
    const r = righePerDb(p, true)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ row_no: 1, date: '2026-08-03', amount: 1200, sign_known: false })
  })
  it('dall\'Excel il segno viene da dare/avere', () => {
    const aoa = [
      ['Data contabile', 'Data valuta', 'Descrizione', 'Dare', 'Avere'],
      ['03/08/2026', '03/08/2026', 'BONIFICO A FAVORE DI ROSSI SRL', '1.200,00', ''],
      ['04/08/2026', '04/08/2026', 'VERSAMENTO CONTANTI', '', '500,00'],
    ]
    const r = righePerDb(leggiEstratto({ fogli: [aoa] }), false)
    expect(r.map((x) => [x.amount, x.sign_known])).toEqual([[-1200, true], [500, true]])
  })
})

describe('esito in una frase', () => {
  it('tutto a posto', () => {
    expect(fraseEsito({ righe: 10, confermati: 10, corretti: 0, inseriti: 0, ambigui: 0, altro_conto: 0, non_inseriti: 0, domande_nuove: 0, quadratura: { scarto_gestionale: 0 } }))
      .toBe('10 movimenti: 10 già a posto. Il periodo torna al centesimo.')
  })
  it('con correzioni e una domanda', () => {
    expect(fraseEsito({ righe: 21, confermati: 19, corretti: 1, inseriti: 1, ambigui: 0, altro_conto: 0, non_inseriti: 0, domande_nuove: 1, quadratura: { scarto_gestionale: -297.27 } }))
      .toBe('21 movimenti: 19 già a posto, 1 corretto come dice la banca, 1 aggiunto perché mancavano. Scarto sul periodo: -297,27 €. Una cosa da chiederti qui sotto.')
  })
  it('movimenti registrati dalla banca dopo la stampa: si dice, non si chiede', () => {
    expect(fraseEsito({ righe: 595, confermati: 595, corretti: 0, inseriti: 0, ambigui: 0, altro_conto: 0, non_inseriti: 0, domande_nuove: 0, dopo_estratto: 8, quadratura: { scarto_gestionale: 0 } }))
      .toBe('595 movimenti: 595 già a posto. Il periodo torna al centesimo. 8 movimenti la banca li ha registrati dopo questo estratto: li controllo con il prossimo.')
  })
  it('PDF con i saldi: dice che il saldo della banca torna', () => {
    expect(fraseEsito({ righe: 20, confermati: 20, corretti: 0, inseriti: 0, ambigui: 0, altro_conto: 0, non_inseriti: 0, domande_nuove: 0, dopo_estratto: 0, quadratura: { saldo_iniziale: 20425.14, saldo_finale: 16961.66, scarto_documento: 0, scarto_gestionale: 0 } }))
      .toBe('20 movimenti: 20 già a posto. Saldo finale della banca 16.961,66 €: torna. Il periodo torna al centesimo.')
  })
})

describe('messaggio di fine caricamento', () => {
  const zero = { inCorso: 0, fatti: 0, nonCaricati: 0, errori: 0, daScegliere: 0, domande: 0 }
  it('finche\' un file e\' in lettura non dice niente', () => {
    expect(chiusuraCaricamento({ ...zero, inCorso: 1, fatti: 1 })).toBeNull()
    expect(chiusuraCaricamento(zero)).toBeNull()
  })
  it('tutto a posto', () => {
    expect(chiusuraCaricamento({ ...zero, fatti: 2 })).toEqual({
      tono: 'ok', titolo: 'Finito, tutti i dati sono aggiornati',
      testo: '2 documenti caricati e applicati. Non c\'è niente da chiarire.',
    })
  })
  it('con domande e un file non caricato', () => {
    expect(chiusuraCaricamento({ ...zero, fatti: 1, nonCaricati: 1, domande: 2 })).toEqual({
      tono: 'ok', titolo: 'Finito',
      testo: '1 documento caricato e applicato. 1 file non è stato caricato: il motivo è scritto accanto; restano 2 cose da chiarire nel riquadro «Da chiarire» qui sotto.',
    })
  })
  it('manca il conto: quasi finito', () => {
    const c = chiusuraCaricamento({ ...zero, fatti: 1, daScegliere: 1 })
    expect(c?.tono).toBe('attenzione')
    expect(c?.titolo).toBe('Quasi finito')
  })
  it('niente caricato per errore', () => {
    expect(chiusuraCaricamento({ ...zero, errori: 1 })).toEqual({
      tono: 'errore', titolo: 'Nessun documento caricato', testo: '1 file non è riuscito: il motivo è scritto in rosso accanto.',
    })
  })
})

// ── Carte e distinte RiBa (05/10/2026) ──────────────────────────────────────
// Le righe imitano il testo che pdf.js estrae dalla «Distinta di ritiro effetti
// pagati» MPS vera; fornitore, partita IVA e importi sono inventati.
const DISTINTA_MPS = [
  '03/09/26, 14:02 Distinta di Ritiro effetti Pagati',
  'Distinta Di Ritiro Effetti Pagati',
  'N° disposizioni: 3',
  'Nome supporto: 999000111',
  'Data Creazione: 31/08/2026',
  'Ordinante: AZIENDA PROVA S.R.L.',
  'Conto Corrente: 01234 56789 000000123456',
  'Stato distinta: Ricevuta Banca',
  'Totale distinta: EUR 1.290,44',
  'DETTAGLIO DISPOSIZIONI',
  ' Creaz. Scad. Stato Dati Beneficiario Importo',
  'FORNITORE ESEMPIO S.R.L.',
  'cod.fiscale/P.iva creditore:',
  'Ricevu',
  '01234567890',
  ' 31/08/26 31/08/26 ta 1.000,00',
  '-',
  'Banca',
  'Domiciliataria: 01234 56789',
  'SALDO FATT 2548',
  'https://banca.example/home# 1/2',
  '03/09/26, 14:02 Distinta di Ritiro effetti Pagati',
  ' Creaz. Scad. Stato Dati Beneficiario Importo',
  'FORNITORE ESEMPIO S.R.L.',
  'cod.fiscale/P.iva creditore:',
  'Ricevu 01234567890',
  ' 31/08/26 31/08/26 ta - 290,44',
  'Banca Domiciliataria: 01234 56789',
  'SALDO FATT 3480 MENO NC N.3438',
  'N.3439',
]

describe('distinta RiBa MPS', () => {
  it('legge testata ed effetti, con la causale che va a capo', () => {
    const d = leggiDistintaMps(DISTINTA_MPS)
    expect(d).not.toBeNull()
    expect(d!.supporto).toBe('999000111')
    expect(d!.dataCreazione).toBe('2026-08-31')
    expect(d!.stato).toBe('Ricevuta Banca')
    expect(d!.totale).toBe(1290.44)
    expect(d!.disposizioni).toHaveLength(2)
    expect(d!.disposizioni[0]).toMatchObject({ beneficiario: 'FORNITORE ESEMPIO S.R.L.', vat: '01234567890', due_date: '2026-08-31', amount: 1000, fatture: ['2548'], note_credito: [] })
    expect(d!.disposizioni[1]).toMatchObject({ amount: 290.44, causale: 'SALDO FATT 3480 MENO NC N.3438 N.3439', fatture: ['3480'], note_credito: ['3438', '3439'] })
  })
  it('un documento che non e\' la distinta MPS non si legge come tale', () => {
    expect(leggiDistintaMps(['ANALISI SCADENZE ATTIVE', 'Totali 19.723,74'])).toBeNull()
  })
  it('numeri dalla causale: fatture prima di «NC», note di credito dopo, anni esclusi', () => {
    expect(numeriDallaCausale('SALDO FATT N.3657 MENO NC 3797')).toEqual({ fatture: ['3657'], noteCredito: ['3797'] })
    expect(numeriDallaCausale('SALDO FT 882/26 E 916/26')).toEqual({ fatture: ['882', '916'], noteCredito: [] })
    expect(numeriDallaCausale('RI.BA SCAD. 31/08/2026')).toEqual({ fatture: [], noteCredito: [] })
    expect(numeriDallaCausale('ACCONTO')).toEqual({ fatture: [], noteCredito: [] })
  })
  it('esito in una frase', () => {
    expect(fraseEsitoDistinta({ disposizioni: 5, totale: 19546.51, riconosciute: 5, confermate: 4, corrette: 1, in_scadenza: 0, ambigue: 0, non_trovate: 0, domande_nuove: 0, addebito: null }))
      .toBe('5 effetti per 19.546,51 €, 4 già a posto, 1 sistemati come dice la distinta.')
  })
})

describe('estratti carta', () => {
  it('righe nel formato del database, con le ultime cifre della carta', () => {
    const r = righeCartaPerDb({
      issuer: 'mps', cards: [{ card_last4: '1234', holder: 'X', total_declared: -50 }],
      lines: [{ card_last4: null, purchase_date: '2026-05-30', posting_date: null, description: 'Quota Annua', amount: -50, fee: 0, currency: 'EUR', original_amount: null }],
      total_declared: -50, total_computed: -50, debit_date: '2026-06-15', period: { year: 2026, month: 5 }, available_balance: null, warnings: [],
    })
    expect(r).toEqual([{ row_no: 1, card_last4: '1234', purchase_date: '2026-05-30', posting_date: null, description: 'Quota Annua', amount: -50, fee: 0, currency: 'EUR', original_amount: null }])
  })
  it('la firma «Carta Montepaschi» vince sul conto di addebito stampato', () => {
    const righe = ['Carta Montepaschi', 'C/C addebito: *********214', `IBAN ${IBAN_A}`]
    expect(classificaDocumento({ testo: righe.join('\n'), righe, conto: conti[1], righeEstratto: 1, intestazione: righe })).toBe('estratto_carta')
  })
  it('esito in una frase, anche senza addebito', () => {
    const f = fraseEsitoCarta({ righe: 8, spese: 8, abbinate_nuove: 1, confermate: 2, corrette: 1, conflitti: 0, domande_nuove: 1, prepagata: false, addebito: null })
    expect(f).toContain('8 spese lette')
    expect(f).toContain('3 fatture ritrovate (1 sistemate come dice l\'estratto)')
    expect(f).toContain('non è ancora arrivato')
    expect(f).toContain('Una cosa da chiarire')
  })
})

describe('cosa non si carica qui', () => {
  it('scansione, distinta di versamento, prospetto del fornitore', () => {
    expect(motivoNonSupportato({ nome: 'x.pdf', righe: [], dalPdf: true })).toMatch(/scansione/)
    expect(motivoNonSupportato({ nome: 'DISTINTA VERSAMENTO NEGOZIO.pdf', righe: ['Versamento contanti presso la filiale numero 1 di prova'], dalPdf: true })).toMatch(/versamento contanti/)
    expect(motivoNonSupportato({ nome: 'f.pdf', righe: ['ANALISI SCADENZE ATTIVE', 'Da data scadenza: 31/08/2026 fino al 31/08/2026'], dalPdf: true })).toMatch(/prospetto del fornitore/)
    expect(motivoNonSupportato({ nome: 'ec.xls', righe: ['Data Valuta Dare Avere'], dalPdf: false })).toBeNull()
  })
})

// La «Distinta Effetti Pagati» di MPS (NEW PasKey Base), come la stampa da ottobre
// 2026. Fornitori, partite IVA e numeri inventati.
const DISTINTA_EFFETTI = [
  'BANCA DI PROVA S.P.A. NEW PasKey Base',
  'Distinta Effetti Pagati',
  'Ordinante: AZIENDA DI PROVA S.R.L.',
  'Conto addebito: 0542-8 11-101 -0000-0012-3456 - CONTO A PACCHETT',
  'Data creazione: 29/10/2026',
  'Nome supporto: 555000111',
  'Numero disposizioni: 3',
  'Stato distinta: Ricevuta Banca',
  'Totale distinta: 1.300,50 EUR',
  'Descrizione: FORNITORI SCAD. 31/10/2026',
  'Creditore',
  'Data Scadenza Stato Banca Domiciliataria Importo',
  'Rif. operazione',
  '29/10/2026 31/10/2026 Ricevuta ALFA TESSUTI S.R.L. 1.000,00',
  'Banca 01234567890',
  'Domiciliataria: 01030 38020',
  'SALDO FATT N 4340 MENO NC 4336 E 4307',
  '29/10/2026 31/10/2026 Ricevuta BETA SPEDIZIONI SPA MILANO 200,25',
  'Banca 09876543210',
  'Domiciliataria: 01030 38020',
  'Rif- 8-1846 8-1847 8-1848 8-1849 8-1850 8-1851 8-',
  '1852',
  'Stampa del 02/11/2026',
  'pag. 1',
  '29/10/2026 10/11/2026 Ricevuta GAMMA SRL 100,25',
  'Banca 11122233344',
  'Domiciliataria: 01030 38020',
  '872FV-95NC',
]

describe('distinta RiBa MPS «Distinta Effetti Pagati»', () => {
  it('legge testata ed effetti, anche con la causale spezzata a capo e su due pagine', () => {
    const d = leggiDistintaMps(DISTINTA_EFFETTI)
    expect(d).not.toBeNull()
    expect(d!.supporto).toBe('555000111')
    expect(d!.dataCreazione).toBe('2026-10-29')
    expect(d!.conto).toBe('0542811101000000123456')
    expect(d!.stato).toBe('Ricevuta Banca')
    expect(d!.totale).toBe(1300.5)
    expect(d!.nDichiarate).toBe(3)
    expect(d!.disposizioni).toHaveLength(3)
    expect(d!.disposizioni[0]).toMatchObject({ beneficiario: 'ALFA TESSUTI S.R.L.', vat: '01234567890', due_date: '2026-10-31', amount: 1000, fatture: ['4340'], note_credito: ['4336', '4307'] })
    expect(d!.disposizioni[1]).toMatchObject({ amount: 200.25, causale: 'Rif- 8-1846 8-1847 8-1848 8-1849 8-1850 8-1851 8-1852' })
    expect(d!.disposizioni[1].fatture).toEqual(['1846', '1847', '1848', '1849', '1850', '1851', '1852'])
    expect(d!.disposizioni[2]).toMatchObject({ due_date: '2026-11-10', vat: '11122233344', fatture: ['872'], note_credito: ['95'] })
    const somma = d!.disposizioni.reduce((a, x) => a + Math.round(x.amount * 100), 0) / 100
    expect(somma).toBe(d!.totale)
  })
  it('una causale che continua dopo il cambio pagina resta intera', () => {
    const righe = [
      'Distinta Effetti Pagati',
      'Nome supporto: 555000222',
      'Totale distinta: 50,00 EUR',
      '29/10/2026 31/10/2026 Ricevuta DELTA SRL 50,00',
      'Banca 12312312312',
      'Domiciliataria: 01030 38020',
      'SALDO FATT 101 102',
      'Stampa del 02/11/2026',
      'pag. 1',
      'BANCA DI PROVA S.P.A. NEW PasKey Base',
      'Distinta Effetti Pagati',
      'Nome supporto: 555000222',
      'Data Scadenza Stato Banca Domiciliataria Importo',
      'Rif. operazione',
      '103',
    ]
    const d = leggiDistintaMps(righe)!
    expect(d.disposizioni).toHaveLength(1)
    expect(d.disposizioni[0].fatture).toEqual(['101', '102', '103'])
  })
  it('la vecchia distinta di ritiro si legge ancora come prima', () => {
    expect(leggiDistintaMps(DISTINTA_MPS)?.disposizioni).toHaveLength(2)
  })
})

describe('numeri dalla causale, casi delle distinte di ottobre 2026', () => {
  it('le date scritte con spazi o senza separatore non sono fatture', () => {
    expect(numeriDallaCausale('201 RB20260010863656 DOC.N.000526199 DEL 30- 09-26').fatture).toEqual(['201', '526199'])
    expect(numeriDallaCausale('fattura n 208-2026 del 27 08 2026').fatture).toEqual(['208'])
  })
  it('gli importi non sono fatture', () => {
    expect(numeriDallaCausale('NS.FATTURA N. 964090 DEL 30-09-26 DI 345,32 EURO*').fatture).toEqual(['964090'])
  })
  it('numeri attaccati: «872FV-95NC», «FATTURE26102973», «MILR001929410»', () => {
    expect(numeriDallaCausale('872FV-95NC')).toEqual({ fatture: ['872'], noteCredito: ['95'] })
    expect(numeriDallaCausale('FATTURE26102973 - 1*').fatture).toEqual(['26102973'])
    expect(numeriDallaCausale('. REF.INVOICE MILR001929410 30.09.2026').fatture).toEqual(['1929410'])
  })
  it('fatture separate da virgola restano fatture: solo gli importi scritti come tali si tolgono', () => {
    expect(numeriDallaCausale('FATT 12,13,14').fatture).toEqual(['12', '13', '14'])
    expect(numeriDallaCausale('FATTURE 23,24 E 30').fatture).toEqual(['23', '24', '30'])
    expect(numeriDallaCausale('FT 501 IMPORTO 1.234,56').fatture).toEqual(['501'])
  })
  it('una fattura scritta prima di «NC» con lo spazio resta una fattura', () => {
    expect(numeriDallaCausale('SALDO FATT N 4340 NC 4336')).toEqual({ fatture: ['4340'], noteCredito: ['4336'] })
  })
})

describe('Excel e PDF che non vanno', () => {
  it('l\'elenco delle distinte MPS non contiene gli effetti: si chiedono i PDF', () => {
    const righe = ['Creazione Supporto N° Stato Rif. Operazione / Conto di Addebito Tipo Ori. Pdf Div. Importo', '555000111 1 Ricevuta Banca FORNITORE SCAD. 31/10/2026 P M EUR 338']
    expect(motivoNonSupportato({ nome: 'RI.BA SCAD.xls', righe, dalPdf: false })).toMatch(/elenco delle distinte/)
  })
  it('Excel BCC con date vere e date scritte nella stessa colonna: difettoso', () => {
    const foglio = [
      ['Data contabile', 'Data valuta', 'Importo', 'Descrizione', 'Note'],
      [new Date(2026, 1, 11), new Date(2026, 1, 11), -70, 'Commissioni su bonifico'],
      [new Date(2026, 1, 11), new Date(2026, 1, 11), -51899, 'Bonifico'],
      ['28/10/2026', '28/10/2026', 1.835, 'Versamento contante'],
      ['26/10/2026', '26/10/2026', -70, 'Commissioni su bonifico'],
    ]
    expect(excelEstrattoDifettoso([foglio])).toBe(true)
  })
  it('una sola riga scritta in mezzo a date vere (un totale) non basta a rifiutare il file', () => {
    expect(excelEstrattoDifettoso([[['Data contabile', 'Importo'], [new Date(2026, 9, 1), 10], [new Date(2026, 9, 2), -5], ['31/10/2026', 5]]])).toBe(false)
  })
  it('Excel con tutte date vere (MPS, Intesa) o tutte scritte: va bene', () => {
    expect(excelEstrattoDifettoso([[['Data contabile', 'Importo'], [new Date(2026, 9, 1), 10], [new Date(2026, 9, 2), -5]]])).toBe(false)
    expect(excelEstrattoDifettoso([[['Data contabile', 'Importo'], ['01/10/2026', '10,00'], ['02/10/2026', '-5,00']]])).toBe(false)
  })
})

describe('estratto MPS in PDF, causali su piu\' righe', () => {
  it('l\'IBAN scritto con i trattini si riconosce', () => {
    expect(ibanNelTesto('IBAN : IT60-X054-2811-1010-0000-0123-456 - CONTO A PACCHETT')).toEqual([IBAN_A])
  })
  it('i pezzi di causale non decidono il tipo: «Nexi Payments» dentro un movimento', () => {
    const righe = [
      'IBAN : IT60-X054-2811-1010-0000-0123-456 - CONTO A PACCHETT',
      'DATA CONT. VALUTA MOV. DARE MOV. AVERE CS. DESCRIZIONE OPERAZIONI',
      '01/10/2026 100,00 SALDO INIZIALE',
      '01/10/2026 01/10/2026 12,50 50 ADDEBITO DIRETTO SDD',
      'NEXI PAYMENTS SPA CODICE MANDATO',
      '02/10/2026 02/10/2026 40,00 09 INCASSO TRAMITE P.O.S.',
      '087-00007 300926 NEGOZIO DI PROVA',
      '120,00 52,50 Riporti',
      '02/10/2026 127,50 SALDO FINALE',
    ]
    const parsed = leggiEstratto({ righePdf: righe })
    expect(parsed.rows).toHaveLength(2)
    const int = righeIntestazione(righe, parsed.rows)
    expect(int.join(' ')).not.toMatch(/NEXI/)
    const conto = trovaConto(int.join('\n'), conti)
    expect(conto?.id).toBe('a-ob')
    expect(classificaDocumento({ testo: righe.join('\n'), righe, conto, righeEstratto: parsed.rows.length, intestazione: int })).toBe('estratto_conto')
  })
})
