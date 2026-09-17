import { describe, it, expect } from 'vitest'
import {
  parseItAmount, parseDotAmount, toIsoDate, detectIssuer, parseNumiaLines, parseMpsLines, parseTascaAoa, parseTascaLines,
  parseGenericLines, parseCardStatementLines, periodOf, sourceLabelOf, matchStatementDebit, matchRicariche, matchPayables,
  buildCartaRow, totaliCarta, type CardLine,
  parseDebitPos, debitCardsFromMovements, bankShortName, debitCardLabel, RE_POS_DEBITO,
  prepaidBalances, nettoCarta, conSaldoProgressivo,
} from './cartaEstratto'

// Righe come le ricostruisce extractPdfLines (pdf.js, righe per geometria)
// dagli estratti veri di maggio 2026 di NZ.
const NUMIA_5388 = [
  'Servizio Clienti - H24', 'dall’Italia e dall’estero + 39 (06) 80.80.800', 'Denominazione', 'NEW ZAGO S.R.L.', 'Azienda:',
  'Carta Numero: 5582 **** **** 5388', 'Nominativo: GALLO MASSIMO',
  'DATA ACQUISTO DATA REGISTR. DESCRIZIONE DELLE OPERAZIONI IMPORTO IN EURO',
  '29/04/2026 30/04/2026 VAIMO S.P.A-VALMONTON. VALMONTONE ITA 10,70',
  '06/05/2026 07/05/2026 BAR QUOTIDIANO CAMPI BISENZI ITA 34,80',
  '13/05/2026 14/05/2026 GRUPPO NEGOZI SRL VALMONTONE ITA 7,20',
  '14/05/2026 15/05/2026 I PIACERI DELLA PASTA BRUGNATO ITA 15,20',
  '18/05/2026 19/05/2026 BAR QUOTIDIANO CAMPI BISENZI ITA 35,00',
  '18/05/2026 19/05/2026 SISSI PRATO ITA 201,30',
  'TOTALE OPERAZIONI 304,20',
  'Imposta di bollo assolta in modo virtuale - Autorizz. Agenzia delle Entrate', 'Numia S.p.A.',
]
const NUMIA_3145 = [
  'Carta Numero: 5582 **** **** 3145', 'Nominativo: GALLO MASSIMO',
  'DATA ACQUISTO DATA REGISTR. DESCRIZIONE DELLE OPERAZIONI IMPORTO IN EURO',
  '02/05/2026 04/05/2026 Indeed IEI26-01391760 Dublin IRL 367,32',
  '08/05/2026 11/05/2026 TRENITALIA - LEFRECCE ROMA ITA 12,40',
  '09/05/2026 11/05/2026 ITALOTRENO ROMA ITA 222,90',
  '14/05/2026 15/05/2026 HOTEL ROMANO TORINO ITA 206,50',
  '15/05/2026 18/05/2026 TRENITALIA - LEFRECCE ROMA ITA 172,30',
  '16/05/2026 18/05/2026 ITALOTRENO ROMA ITA 75,80',
  '18/05/2026 19/05/2026 WWW.URBANTREND.IT PALMANOVA ITA 130,00',
  '22/05/2026 25/05/2026 HOTEL LA FONTE ROMANO DI LOM ITA 76,50',
  'TOTALE OPERAZIONI 1.263,72',
]
const MPS = [
  'Carta Montepaschi', 'Siena, 31 maggio 2026 NEW ZAGO S.R.L.',
  'QUESTO MESE HA SPESO Euro 50,00', 'QUESTO MESE LE SARANNO ADDEBITATI Euro 50,00', 'In data 15 giugno 2026',
  'RIEPILOGO DEI SUOI MOVIMENTI', 'Data Descrizione Importo in Euro',
  '30/04/26 Debito residuo al mese precedente 0,00', 'Totale spese con carte a saldo 50,00', 'TOTALE ADDEBITO SUL SUO C/C 50,00', 'Debito residuo al 31/05/2026 0,00',
  'TITOLARE', 'GALLO MASSIMO CARTA MONTEPASCHI NUMERO **** **** **** 6820 A SALDO SCADENZA 05/28',
  'DETTAGLIO DEI SUOI MOVIMENTI', 'Data Descrizione Importo in Euro Importo in altre valute Cambio',
  '30/05/26 Quota Annua 50,00',
  '12/05/26 AMAZON EU LUXEMBOURG 1.234,56 1.300,00 USD 1,0530',
  'TOTALE SPESE 1.284,56',
  'NUMERI UTILI',
]

describe('numeri e date', () => {
  it('importi italiani e a punto', () => {
    expect(parseItAmount('1.263,72')).toBe(1263.72)
    expect(parseItAmount('-29,99')).toBe(-29.99)
    expect(parseItAmount('12.20')).toBeNull()
    expect(parseDotAmount('-111.23')).toBe(-111.23)
    expect(parseDotAmount('1,300.00')).toBe(1300)
    expect(parseDotAmount('12,20')).toBeNull()
  })
  it('date dd/mm/yyyy e dd/mm/yy', () => {
    expect(toIsoDate('29/04/2026')).toBe('2026-04-29')
    expect(toIsoDate('30/05/26')).toBe('2026-05-30')
    expect(toIsoDate('30/06/2026 20:19:25')).toBe('2026-06-30')
    expect(toIsoDate('x')).toBeNull()
  })
})

describe('riconoscimento del documento', () => {
  it('dal testo, non dal nome del file', () => {
    expect(detectIssuer(NUMIA_5388)).toBe('numia')
    expect(detectIssuer(MPS)).toBe('mps')
    expect(detectIssuer(['MASSIMO GALLO 522675******0580 Prepaid Business MC 0.00 EUR EUR 133.68', 'Lista Movimenti'])).toBe('tasca')
    expect(detectIssuer(['boh'])).toBe('generico')
  })
})

describe('CartaBCC / Numia', () => {
  it('legge carta, titolare, righe e totale; spese negative, totale che quadra', () => {
    const s = parseNumiaLines(NUMIA_5388)
    expect(s.issuer).toBe('numia')
    expect(s.cards).toEqual([{ card_last4: '5388', holder: 'GALLO MASSIMO', total_declared: -304.2 }])
    expect(s.lines).toHaveLength(6)
    expect(s.lines[0]).toEqual({ card_last4: '5388', purchase_date: '2026-04-29', posting_date: '2026-04-30', description: 'VAIMO S.P.A-VALMONTON. VALMONTONE ITA', amount: -10.7, fee: 0, currency: 'EUR', original_amount: null })
    expect(s.total_declared).toBe(-304.2)
    expect(s.total_computed).toBe(-304.2)
    expect(s.period).toEqual({ year: 2026, month: 5 })
    expect(s.warnings).toEqual([])
  })
  it('due carte nello stesso PDF: ogni riga con la sua carta, totale sommato', () => {
    const s = parseNumiaLines([...NUMIA_5388, ...NUMIA_3145])
    expect(s.cards.map(c => c.card_last4)).toEqual(['5388', '3145'])
    expect(s.lines.filter(l => l.card_last4 === '3145')).toHaveLength(8)
    expect(s.total_declared).toBe(-1567.92)
    expect(s.total_computed).toBe(-1567.92)
    expect(s.warnings).toEqual([])
  })
  it('storno con segno meno diventa un accredito', () => {
    const s = parseNumiaLines(['Carta Numero: 5582 **** **** 3145', '22/06/2026 25/06/2026 ADOBE *ADOBE DUBLIN IRL 29,99', '23/06/2026 26/06/2026 ADOBE *ADOBE DUBLIN IRL -29,99', 'TOTALE OPERAZIONI 0,00'])
    expect(s.lines.map(l => l.amount)).toEqual([-29.99, 29.99])
    expect(s.warnings).toEqual([])
  })
  it('totale che non torna: avviso', () => {
    const s = parseNumiaLines(['Carta Numero: 5582 **** **** 3145', '22/06/2026 25/06/2026 ADOBE DUBLIN IRL 29,99', 'TOTALE OPERAZIONI 59,98'])
    expect(s.warnings.some(w => w.includes('non coincide'))).toBe(true)
  })
})

describe('Carta Montepaschi', () => {
  it('solo il dettaglio, non il riepilogo; data di addebito; valuta estera', () => {
    const s = parseMpsLines(MPS)
    expect(s.issuer).toBe('mps')
    expect(s.cards).toEqual([{ card_last4: '6820', holder: 'GALLO MASSIMO', total_declared: -1284.56 }])
    expect(s.lines).toHaveLength(2)
    expect(s.lines[0]).toMatchObject({ purchase_date: '2026-05-30', description: 'Quota Annua', amount: -50, currency: 'EUR' })
    expect(s.lines[1]).toMatchObject({ purchase_date: '2026-05-12', description: 'AMAZON EU LUXEMBOURG', amount: -1234.56, currency: 'USD', original_amount: 1300 })
    expect(s.debit_date).toBe('2026-06-15')
    expect(s.total_declared).toBe(-1284.56)
    expect(s.warnings).toEqual([])
  })
})

describe('Prepagata Tasca', () => {
  const HEADER = ['NR CARTA', 'TITOLARE', 'DATA REGISTR.', 'DATA ACQUISTO', 'DESCRIZIONE DELLE OPERAZIONI', 'IMPORTO IN EURO', 'IMPORTO IN VALUTA ORIGINALE', 'VALUTA ORIGINALE', 'COMMISSIONI']
  const AOA = [
    ['Movimenti'], HEADER,
    ['522675******0580', 'MASSIMO GALLO', '30/06/2026', '30/06/2026 20:19:25', 'RICARICA DA HB BANCA COLLOCATRICE', '500,00', '500,00', 'EUR', '-1,00'],
    ['522675******0580', 'MASSIMO GALLO', '01/07/2026', '30/06/2026 13:19:16', 'BLUGEST SRL GALLICANO NEL ITA SF_FPR 4108/26', '-92,80', '-92,80', 'EUR', ''],
    ['522675******0580', 'MASSIMO GALLO', '25/06/2026', '24/06/2026 15:24:26', 'Q8 - CANTAGALLO OVEST CASALECCHIO D ITA SF2026/FE3934/5300', -109.2, -109.2, 'EUR', null],
    [], ['Autorizzazioni'], HEADER,
    ['522675******0580', 'MASSIMO GALLO', '02/07/2026', '02/07/2026 09:00:00', 'AUTORIZZAZIONE PENDENTE', '-10,00', '-10,00', 'EUR', ''],
  ]
  it('Excel del portale: solo i movimenti, ricarica positiva con commissione, spese negative', () => {
    const s = parseTascaAoa(AOA)
    expect(s.issuer).toBe('tasca')
    expect(s.cards).toEqual([{ card_last4: '0580', holder: 'MASSIMO GALLO', total_declared: null }])
    expect(s.lines).toHaveLength(3)
    expect(s.lines[0]).toEqual({ card_last4: '0580', purchase_date: '2026-06-30', posting_date: '2026-06-30', description: 'RICARICA DA HB BANCA COLLOCATRICE', amount: 500, fee: -1, currency: 'EUR', original_amount: 500 })
    expect(s.lines[1]).toMatchObject({ purchase_date: '2026-06-30', posting_date: '2026-07-01', amount: -92.8, fee: 0 })
    expect(s.lines[2]).toMatchObject({ purchase_date: '2026-06-24', amount: -109.2 })
    expect(s.total_computed).toBe(297)
    expect(s.period).toEqual({ year: 2026, month: 6 })
  })
  it('PDF «Lista Movimenti»: importi a punto, totale dichiarato, autorizzazioni escluse', () => {
    const s = parseTascaLines([
      'Intestatario Numero Carta Tipo Carta Plafond Disponibilità',
      'MASSIMO GALLO 522675******0580 Prepaid Business MC 0.00 EUR EUR 133.68',
      'Lista Movimenti',
      'Data acquisto Data registrazione Descrizione operazioni Importo Importo originale EURO Commissioni Valuta',
      '28/07/2026 13:04:54 29/07/2026 SALERNI FALIERA & C. S PIETRASANTA ITA -12.00 -12.00 0.00 EUR',
      '21/07/2026 08:21:49 21/07/2026 RICARICA DA HB BANCA COLLOCATRICE 500.00 500.00 -1.00 EUR',
      'Totale Movimenti 487.00',
      'Lista Autorizzazioni',
      '30/07/2026 10:00:00 30/07/2026 PENDENTE ITA -5.00 -5.00 0.00 EUR',
    ])
    expect(s.cards).toEqual([{ card_last4: '0580', holder: 'MASSIMO GALLO', total_declared: 487 }])
    expect(s.lines).toHaveLength(2)
    expect(s.lines[0]).toMatchObject({ purchase_date: '2026-07-28', posting_date: '2026-07-29', description: 'SALERNI FALIERA & C. S PIETRASANTA ITA', amount: -12, fee: 0 })
    expect(s.lines[1]).toMatchObject({ amount: 500, fee: -1 })
    expect(s.total_computed).toBe(487)
    expect(s.warnings).toEqual([])
  })
})

describe('generico e selezione automatica', () => {
  it('parseCardStatementLines sceglie il lettore giusto', () => {
    expect(parseCardStatementLines(NUMIA_3145).lines).toHaveLength(8)
    expect(parseCardStatementLines(MPS).lines).toHaveLength(2)
  })
  it('generico: righe data descrizione importo, spese negative, con avviso', () => {
    const s = parseGenericLines(['01/08/2026 QUALCOSA 12,50', 'testo', '02/08/2026 03/08/2026 ALTRO 1,000.00'])
    expect(s.lines.map(l => l.amount)).toEqual([-12.5, -1000])
    expect(s.lines[1].posting_date).toBe('2026-08-03')
    expect(s.warnings[0]).toContain('formato non riconosciuto')
  })
  it('periodo = mese dell\'ultimo acquisto; etichette fonte', () => {
    const mk = (d: string): CardLine => ({ card_last4: null, purchase_date: d, posting_date: null, description: '', amount: -1, fee: 0, currency: 'EUR', original_amount: null })
    expect(periodOf([mk('2026-07-30'), mk('2026-08-02'), mk('2026-08-10')])).toEqual({ year: 2026, month: 8 })
    expect(periodOf([])).toBeNull()
    expect(sourceLabelOf('numia', '5388')).toBe('Carta credito BCC *5388')
    expect(sourceLabelOf('tasca', '0580')).toBe('Carta prepagata Tasca *0580')
    expect(sourceLabelOf('mps', null)).toBe('Carta credito MPS')
  })
})

describe('quadratura con la banca', () => {
  const movs = [
    { id: 'a', transaction_date: '2026-06-25', amount: -1571.21, description: 'Carta del Credito Cooperativo ******283 CCP DIRECT ISSUING' },
    { id: 'b', transaction_date: '2026-06-15', amount: -50, description: 'ADDEBITO SDD A FAVORE BANCA MONTE DEI PASCHI' },
    { id: 'c', transaction_date: '2026-06-22', amount: -500, description: 'Ricarica carta prepagata TASCA' },
    { id: 'd', transaction_date: '2026-07-01', amount: -500, description: 'Ricarica carta prepagata TASCA' },
  ]
  it('carta di credito: addebito unico con lo stesso importo, il piu\' vicino alla data annunciata', () => {
    const r = matchStatementDebit({ total_declared: -50, total_computed: -50, period: { year: 2026, month: 5 }, debit_date: '2026-06-15' }, movs)
    expect(r.movement?.id).toBe('b')
    expect(r.differenza).toBe(0)
    const none = matchStatementDebit({ total_declared: -304.2, total_computed: -304.2, period: { year: 2026, month: 5 }, debit_date: null }, movs)
    expect(none.movement).toBeNull()
    expect(none.differenza).toBe(-304.2)
  })
  it('BCC addebita le due carte in un movimento solo piu\' 3,29 di commissioni (maggio 2026: 304,20 + 1.263,72 → 1.571,21 il 25/06)', () => {
    const r = matchStatementDebit({ total_declared: -1567.92, total_computed: -1567.92, period: { year: 2026, month: 5 }, debit_date: null }, movs)
    expect(r.movement?.id).toBe('a')
    expect(r.differenza).toBe(3.29)
    // troppo distante dal totale: non e' lui
    expect(matchStatementDebit({ total_declared: -1500, total_computed: -1500, period: { year: 2026, month: 5 }, debit_date: null }, movs).movement).toBeNull()
  })
  it('prepagata: ogni ricarica trova il suo addebito entro 3 giorni, una volta sola', () => {
    const lines: CardLine[] = [
      { card_last4: '0580', purchase_date: '2026-06-22', posting_date: '2026-06-22', description: 'RICARICA DA HB BANCA COLLOCATRICE', amount: 500, fee: -1, currency: 'EUR', original_amount: 500 },
      { card_last4: '0580', purchase_date: '2026-06-30', posting_date: '2026-06-30', description: 'RICARICA DA HB BANCA COLLOCATRICE', amount: 500, fee: -1, currency: 'EUR', original_amount: 500 },
      { card_last4: '0580', purchase_date: '2026-06-24', posting_date: null, description: 'Q8', amount: -109.2, fee: 0, currency: 'EUR', original_amount: null },
    ]
    const m = matchRicariche(lines, movs)
    expect(m.get(0)?.id).toBe('c')
    expect(m.get(1)?.id).toBe('d')
    expect(m.has(2)).toBe(false)
  })
})

describe('aggancio alle fatture pagate con carta (dati NZ luglio 2026)', () => {
  const pay = [
    { id: 'p1', payment_date: '2026-07-01', invoice_date: '2026-07-01', gross_amount: 92.8, supplier_name: 'BLUGEST S.R.L.', invoice_number: 'FPR 4108/26' },
    { id: 'p2', payment_date: '2026-07-01', invoice_date: '2026-07-01', gross_amount: 26, supplier_name: 'C.C.S. DI CANONICI GIOVANNI & C. S.N.C.', invoice_number: '2026/C/4877' },
    { id: 'p3', payment_date: '2026-07-16', invoice_date: '2026-07-16', gross_amount: 26, supplier_name: 'C.C.S. DI CANONICI GIOVANNI & C. S.N.C.', invoice_number: '2026/C/5324' },
    { id: 'p4', payment_date: '2026-07-20', invoice_date: '2026-06-17', gross_amount: 80, supplier_name: 'ALTOMUGELLO SRL', invoice_number: '1636' },
  ]
  const L = (d: string, desc: string, amt: number): CardLine => ({ card_last4: '0580', purchase_date: d, posting_date: null, description: desc, amount: amt, fee: 0, currency: 'EUR', original_amount: null })
  it('stesso importo, numero fattura in descrizione o data vicina; ogni fattura una volta', () => {
    const lines = [
      L('2026-06-30', 'BLUGEST SRL GALLICANO NEL ITA SF_FPR 4108/26', -92.8),
      L('2026-07-01', 'STAZIONE BEYFIN C.C.S. REGGELLO ITA', -26),
      L('2026-07-15', 'STAZIONE BEYFIN C.C.S. REGGELLO ITA', -26),
      L('2026-06-17', 'HOTEL BARBERINO BARBERINO DI ITA', -80),
      L('2026-07-21', 'RICARICA DA HB BANCA', 500),
      L('2026-07-05', 'SCONOSCIUTO', -1.5),
    ]
    const m = matchPayables(lines, pay)
    expect(m.get(0)?.id).toBe('p1')
    expect(m.get(1)?.id).toBe('p2')
    expect(m.get(2)?.id).toBe('p3')
    expect(m.get(3)?.id).toBe('p4')
    expect(m.has(4)).toBe(false)
    expect(m.has(5)).toBe(false)
  })
  it('il nome del fornitore non aggancia una fattura di mesi dopo', () => {
    // Stesso fornitore, stesso importo, due volte nell'anno: il biglietto di
    // marzo non e' la fattura di luglio (133 giorni), e resta senza fattura.
    const treni = [
      { id: 't1', payment_date: '2026-08-25', invoice_date: '2026-07-16', gross_amount: 24.8, supplier_name: 'Trenitalia S.p.A.', invoice_number: '2026/9001977886' },
    ]
    const m = matchPayables([L('2026-03-05', 'TRENITALIA - LEFRECCE ROMA ITA', -24.8)], treni)
    expect(m.has(0)).toBe(false)
    const m2 = matchPayables([L('2026-07-16', 'TRENITALIA - LEFRECCE ROMA ITA', -24.8)], treni)
    expect(m2.get(0)?.id).toBe('t1')
  })
  it('il numero di fattura nella descrizione vale anche a due mesi', () => {
    const f = [{ id: 'f1', payment_date: '2026-08-25', invoice_date: '2026-06-17', gross_amount: 92.8, supplier_name: 'BLUGEST S.R.L.', invoice_number: 'FPR 4108/26' }]
    const m = matchPayables([L('2026-06-15', 'BLUGEST SRL GALLICANO ITA SF_FPR 4108/26', -92.8)], f)
    expect(m.get(0)?.id).toBe('f1')
  })
})

describe('righe export e totali', () => {
  it('buildCartaRow e totaliCarta', () => {
    const fmt = (d: string) => d.split('-').reverse().join('/')
    const l: CardLine = { card_last4: '5388', purchase_date: '2026-05-18', posting_date: '2026-05-19', description: 'SISSI PRATO ITA', amount: -201.3, fee: 0, currency: 'EUR', original_amount: null }
    expect(buildCartaRow('Carta credito BCC *5388', l, { id: 'p', payment_date: '2026-05-18', invoice_date: null, gross_amount: 201.3, supplier_name: 'SISSI', invoice_number: '12' }, 'addebito 25/06/2026', fmt)).toEqual({
      Carta: 'Carta credito BCC *5388', 'Data acquisto': '18/05/2026', 'Data registrazione': '19/05/2026', Descrizione: 'SISSI PRATO ITA', Importo: -201.3, Commissioni: '', Valuta: 'EUR',
      Fornitore: 'SISSI', Fattura: '12', 'Pagata il': '18/05/2026', 'Riscontro banca': 'addebito 25/06/2026', Saldo: '',
    })
    const t = totaliCarta([l, { ...l, amount: 500, fee: -1 }])
    expect(t).toEqual({ spese: 201.3, accrediti: 500, commissioni: -1, netto: 297.7, n: 2 })
  })
})

describe('carte di debito: pagamenti POS letti dalle causali del conto', () => {
  const bcc = 'Operazione POS Eurozona Del 17.02.26 17:36 Carta *453 COSTO DEL NOLEGGIO FIRENZE IT'
  const mps1 = 'PAGAMENTO TRAMITE POS PAG.POS MASTERCARD DATA 28/01/26 ORA 10.31 LOC.BOARA-ROV.N. ESERCENTE : ASPIT INCISA REGGELLO- IMP.IN DIV.ORIG -18.20 COM. E. 0.00 N.CARTA: 98957552'
  const mps2 = 'Causale: PAG.POS MASTERCARD - Descrizione: DATA 14/05/26 ORA 00.00 LOC.TORINO ESERCENTE : SCANNABUE IMP.IN DIV.ORIG -53.00 COM. E. 0.00 N.CARTA: 99899952'
  it('BCC: data di acquisto, ultime cifre della carta ed esercente', () => {
    expect(parseDebitPos(bcc, '2026-02-18')).toEqual({ card: '453', purchase_date: '2026-02-17', merchant: 'COSTO DEL NOLEGGIO FIRENZE IT', place: null, fee: 0, original_amount: null })
  })
  it('MPS, entrambi i formati: numero carta, data, localita, esercente, importo in divisa e commissioni', () => {
    expect(parseDebitPos(mps1, '2026-01-30')).toEqual({ card: '98957552', purchase_date: '2026-01-28', merchant: 'ASPIT INCISA REGGELLO-', place: 'BOARA-ROV.N.', fee: -0, original_amount: -18.2 })
    expect(parseDebitPos(mps2, '2026-05-15')).toEqual({ card: '99899952', purchase_date: '2026-05-14', merchant: 'SCANNABUE', place: 'TORINO', fee: -0, original_amount: -53 })
  })
  it('non e\' un POS: commissioni PagoBancomat, incassi POS, ricariche, bonifici', () => {
    expect(parseDebitPos('Commissioni PagoBancomat 618108700001 CIRCUITO PAGOBANCOMAT', '2026-08-01')).toBeNull()
    expect(parseDebitPos('Incassi PagoBancomat 30.08.26 - 618108700003 VICOLO', '2026-08-30')).toBeNull()
    expect(parseDebitPos('Ricarica carta prepagata TASCA da CARTA : 5226*********580', '2026-08-30')).toBeNull()
    expect(RE_POS_DEBITO.test('BONIFICO PER ORDINE/CONTO')).toBe(false)
  })
  it('raggruppa per conto e carta, ordina per data di acquisto, ignora le entrate', () => {
    const groups = debitCardsFromMovements([
      { id: 'b2', bank_account_id: 'bcc', transaction_date: '2026-02-24', posting_date: '2026-02-24', amount: -50, description: 'Operazione POS Eurozona Del 23.02.26 10:00 Carta *453 FERRAMENTA SOLDI SAS FIGLINE E INC IT' },
      { id: 'b1', bank_account_id: 'bcc', transaction_date: '2026-02-18', posting_date: null, amount: -1200, description: bcc },
      { id: 'm1', bank_account_id: 'mps', transaction_date: '2026-01-30', posting_date: '2026-01-30', amount: -18.2, description: mps1 },
      { id: 'x', bank_account_id: 'bcc', transaction_date: '2026-02-18', posting_date: null, amount: 300, description: 'Incassi PagoBancomat 18.02.26 - 618108700003 VICOLO' },
      { id: 'y', bank_account_id: 'bcc', transaction_date: '2026-02-18', posting_date: null, amount: -7, description: 'Causale: CANONE RAPPORTO PACKAGE' },
    ])
    expect(groups.map(g => [g.key, g.card, g.lines.map(l => l.id)])).toEqual([['bcc|453', '453', ['b1', 'b2']], ['mps|98957552', '98957552', ['m1']]])
    const l = groups[0].lines[0]
    expect(l).toMatchObject({ id: 'b1', card_last4: '453', purchase_date: '2026-02-17', posting_date: '2026-02-18', description: 'COSTO DEL NOLEGGIO FIRENZE IT', amount: -1200, currency: 'EUR' })
    expect(groups[1].lines[0].description).toBe('ASPIT INCISA REGGELLO- (BOARA-ROV.N.)')
  })
  it('etichette: nome breve della banca e carta', () => {
    expect(bankShortName('MPS - Banca Monte dei Paschi di Siena Small Business / Corporate')).toBe('MPS')
    expect(bankShortName('BCC Valdarno Fiorentino Banca di Cascia')).toBe('BCC Valdarno')
    expect(debitCardLabel('BCC Valdarno Fiorentino Banca di Cascia', '453')).toBe('Carta di debito BCC Valdarno *453')
    expect(debitCardLabel('MPS - Banca Monte dei Paschi', '99899952')).toBe('Carta di debito MPS n. 99899952')
  })
})

describe('prepagata Tasca, PDF «Lista Movimenti» del portale: movimenti spezzati su piu\' righe', () => {
  const lines = [
    'Intestatario MASSIMO GALLO', 'Numero Carta 522675******0580', 'Tipo Carta Prepaid Business MC', 'Plafond 0.00 EUR', 'Disponibilità 133.68 EUR',
    'Lista Movimenti', 'Data Importo Importo', 'Data acquisto Descrizione operazioni Commissioni Valuta', 'registrazione originale EURO',
    '28/07/2026 29/07/2026 SALERNI FALIERA & C. S', '-12.00 -12.00 0.00 EUR', '13:04:54 PIETRASANTA ITA',
    '21/07/2026 22/07/2026', 'ALICE PIZZA VALMONTONE ITA -20.03 -20.03 0.00 EUR', '12:59:43',
    '21/07/2026 21/07/2026 RICARICA DA HB BANCA', '500.00 500.00 -1.00 EUR', '08:21:49 COLLOCATRICE',
    'Totale Movimenti -477.91 EUR', 'Lista Autorizzazioni', 'Pag. 1 di 2', 'Totale Autorizzazioni 0.00 EUR',
  ]
  const p = parseTascaLines(lines)
  it('ricompone i blocchi: date, descrizione su piu\' righe, importi e commissioni', () => {
    expect(p.lines.map(l => [l.purchase_date, l.posting_date, l.amount, l.fee, l.description])).toEqual([
      ['2026-07-28', '2026-07-29', -12, 0, 'SALERNI FALIERA & C. S PIETRASANTA ITA'],
      ['2026-07-21', '2026-07-22', -20.03, 0, 'ALICE PIZZA VALMONTONE ITA'],
      ['2026-07-21', '2026-07-21', 500, -1, 'RICARICA DA HB BANCA COLLOCATRICE'],
    ])
    expect(p.cards).toEqual([{ card_last4: '0580', holder: 'MASSIMO GALLO', total_declared: -477.91 }])
    expect(p.lines.every(l => l.card_last4 === '0580')).toBe(true)
    expect(p.available_balance).toBe(133.68)
    expect(p.period).toEqual({ year: 2026, month: 7 })
    expect(p.total_computed).toBe(466.97)
  })
  it('il formato vecchio su una riga sola si legge ancora', () => {
    const q = parseTascaLines(['MASSIMO GALLO 522675******0580 Prepaid Business MC', 'Lista Movimenti', '04/08/2026 15:23:14 04/08/2026 RICARICA DA HB BANCA COLLOCATRICE 300.00 300.00 -1.00 EUR', 'Totale Movimenti 299.00 EUR'])
    expect(q.lines).toHaveLength(1)
    expect(q.lines[0]).toMatchObject({ purchase_date: '2026-08-04', amount: 300, fee: -1, description: 'RICARICA DA HB BANCA COLLOCATRICE', card_last4: '0580' })
    expect(q.available_balance).toBeNull()
  })
})

describe('saldo della prepagata: catena degli estratti ancorata alla Disponibilita\' del PDF', () => {
  // Numeri reali NZ 2026: netto per mese; luglio stampato il 03/08 con Disponibilita' 133.68
  const stmts = [
    { key: 'feb', period: { year: 2026, month: 2 }, netto: 1706.5, available_balance: null },
    { key: 'mar', period: { year: 2026, month: 3 }, netto: -1605.9, available_balance: null },
    { key: 'apr', period: { year: 2026, month: 4 }, netto: -3.81, available_balance: null },
    { key: 'mag', period: { year: 2026, month: 5 }, netto: 79.42, available_balance: null },
    { key: 'giu', period: { year: 2026, month: 6 }, netto: 435.38, available_balance: null },
    { key: 'lug', period: { year: 2026, month: 7 }, netto: -477.91, available_balance: 133.68 },
    { key: 'ago', period: { year: 2026, month: 8 }, netto: -17.46, available_balance: 82.69 },
  ]
  it('dal primo documento con la disponibilita\' ricostruisce avanti e indietro: febbraio parte da 0,00, agosto chiude a 116,22', () => {
    const b = prepaidBalances(stmts)
    expect(b.get('lug')).toEqual({ saldo_iniziale: 611.59, saldo_finale: 133.68, ancoraggio: 'documento', anchor_key: 'lug' })
    expect(b.get('ago')).toEqual({ saldo_iniziale: 133.68, saldo_finale: 116.22, ancoraggio: 'catena', anchor_key: 'lug' })
    expect(b.get('giu')).toEqual({ saldo_iniziale: 176.21, saldo_finale: 611.59, ancoraggio: 'catena', anchor_key: 'lug' })
    expect(b.get('feb')).toEqual({ saldo_iniziale: 0, saldo_finale: 1706.5, ancoraggio: 'catena', anchor_key: 'lug' })
  })
  it('senza nessuna disponibilita\' parte da zero al primo estratto e lo dichiara', () => {
    const b = prepaidBalances(stmts.map(s => ({ ...s, available_balance: null })))
    expect(b.get('feb')).toEqual({ saldo_iniziale: 0, saldo_finale: 1706.5, ancoraggio: 'da_zero', anchor_key: null })
    expect(b.get('ago')?.saldo_finale).toBe(116.22)
    expect(prepaidBalances([]).size).toBe(0)
  })
  it('netto e saldo progressivo in ordine cronologico', () => {
    const lines = [
      { purchase_date: '2026-08-27', amount: -12.4, fee: 0 }, { purchase_date: '2026-08-04', amount: 300, fee: -1 }, { purchase_date: '2026-08-04', amount: -18.7, fee: 0 },
    ]
    expect(nettoCarta(lines)).toBe(267.9)
    expect(conSaldoProgressivo(lines, 133.68).map(x => [x.index, x.saldo])).toEqual([[1, 432.68], [2, 413.98], [0, 401.58]])
  })
  it('stesso giorno: la ricarica precede le spese, il saldo non va sotto zero (Tasca 27/08/2026)', () => {
    const lines = [
      { purchase_date: '2026-08-27', amount: -12.4, fee: 0 }, { purchase_date: '2026-08-27', amount: -90.03, fee: 0 },
      { purchase_date: '2026-08-27', amount: 100, fee: -1 }, { purchase_date: '2026-08-27', amount: 100, fee: -1 },
    ]
    const out = conSaldoProgressivo(lines, 20.65)
    expect(out.map(x => x.index)).toEqual([2, 3, 0, 1])
    expect(out.map(x => x.saldo)).toEqual([119.65, 218.65, 206.25, 116.22])
    expect(out.every(x => x.saldo >= 0)).toBe(true)
  })
})

describe('CartaBCC / Numia: PDF di agosto 2026 (numero di carta sulla riga dopo, righe di fine luglio)', () => {
  const AGO_3145 = [
    'Denominazione', 'NEW ZAGO S.R.L.', 'Azienda:', 'Carta Numero:', '5582 **** **** 3145', 'Nominativo: GALLO MASSIMO',
    'DATA ACQUISTO DATA REGISTR. DESCRIZIONE DELLE OPERAZIONI IMPORTO IN EURO',
    '29/07/2026 30/07/2026 Indeed IEI26-02262414 Dublin IRL 515,01',
    '29/07/2026 30/07/2026 HABITA 79 POMPEI FOH POMPEI ITA 8,00',
    '29/07/2026 30/07/2026 HOTEL BARBERINO BARBERINO DI ITA 80,00',
    '02/08/2026 03/08/2026 Indeed IEI26-02380427 Dublin IRL 32,31',
    '20/08/2026 21/08/2026 Adobe Systems Software Saggart, Dubl IRL 6,71',
    'TOTALE OPERAZIONI 642,03',
  ]
  it('legge il numero di carta spezzato su due righe e attribuisce il totale', () => {
    const s = parseNumiaLines(AGO_3145)
    expect(s.cards.map(c => c.card_last4)).toEqual(['3145'])
    expect(s.lines.every(l => l.card_last4 === '3145')).toBe(true)
    expect(s.total_declared).toBe(-642.03)
    expect(s.total_computed).toBe(-642.03)
    expect(s.warnings).toEqual([])
  })
  it('il mese dell\'estratto e\' quello dell\'ultimo acquisto, non il piu\' frequente (e non la registrazione)', () => {
    expect(parseNumiaLines(AGO_3145).period).toEqual({ year: 2026, month: 8 })
    // Tasca: acquisto del 30/06 registrato l'1/07 resta in giugno
    expect(periodOf([{ card_last4: null, purchase_date: '2026-06-30', posting_date: '2026-07-01', description: 'x', amount: -1, fee: 0, currency: 'EUR', original_amount: null }])).toEqual({ year: 2026, month: 6 })
  })
  it('senza numero di carta il totale resta attribuito a una sezione implicita e l\'avviso lo dice', () => {
    const s = parseNumiaLines(['04/08/2026 05/08/2026 PASTICCERIA PRATO ITA 46,60', 'TOTALE OPERAZIONI 46,60'])
    expect(s.total_declared).toBe(-46.6)
    expect(s.warnings).toContain('numero di carta non trovato nel documento')
  })
})
