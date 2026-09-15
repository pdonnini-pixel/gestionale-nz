// Test dei helper Prima Nota su causali REALI di agosto 2026 (tenant NZ),
// prese dall'audit AUDIT_PRIMA_NOTA_COMMERCIALISTA_2026-09-14.md.
import { describe, it, expect } from 'vitest'
import {
  classifyMovement, counterpartOf, pivaOf, causaleOf, buildRow, summarizeByKind, outletCodeFromNote,
  isRiba, ribaCountOf, tipoMovimentoOf,
  invoicesTotalOf, type PnMovement, type PnPayable,
} from './primaNotaExport'

const mv = (over: Partial<PnMovement> & { amount: number; description: string }): PnMovement => ({
  reference: null, category: null, counterpart: null, merchant_name: null,
  supplier: null, payables: [], fiscal_deadlines: [],
  ...over,
})
const pay = (invoice_number: string, supplier_name: string, supplier_vat: string | null, gross_amount = 100): PnPayable =>
  ({ invoice_number, supplier_name, supplier_vat, gross_amount })

describe('classifyMovement: tipo di movimento dalla causale, dall\'aggancio e dall\'etichetta', () => {
  it('un movimento con fatture agganciate è un pagamento fornitore, qualunque sia la causale', () => {
    const m = mv({ amount: -53311.75, description: 'Causale: EFFETTI RITIRATI - Descrizione: NUM.EFFETTI: 0000010 RIF.OP. 20260828 0', payables: [pay('1', 'A', '01234567890')] })
    expect(classifyMovement(m)).toBe('fornitore')
  })
  it('una scadenza fiscale agganciata vince sulla causale', () => {
    const m = mv({ amount: -39063.8, description: 'Causale: IMPOSTE,TASSE SU DELEGHE - Descrizione: DELEGHE MOD.F24 (DA RBWEB)', fiscal_deadlines: [{ title: 'IVA mensile — Luglio 2026', f24_code: '6007', tax_period: '07/2026', deadline_type: 'iva_periodica' }] })
    expect(classifyMovement(m)).toBe('f24')
  })
  it('deleghe non censite: I24 e Delega Unificata sono comunque F24', () => {
    expect(classifyMovement(mv({ amount: -37454.77, description: 'Causale: IMPOSTE/TASSE DELEGHE I24 - Descrizione: DELEGHE MOD.I24 CODICE ATTO 28866140636.09' }))).toBe('f24')
    expect(classifyMovement(mv({ amount: -720, description: 'Imposte e Tasse:Delega Unificata(C' }))).toBe('f24')
  })
  it('emolumenti = stipendi, anche senza etichetta', () => {
    expect(classifyMovement(mv({ amount: -8840.45, description: 'Causale: DISPOSIZ.PER EMOLUMENTI - Descrizione: FILIALE DISPONENTE 2430' }))).toBe('stipendi')
  })
  it('incassi POS nelle quattro forme viste in banca', () => {
    for (const d of [
      'Causale: INCASSO TRAMITE P.O.S. - Descrizione: ACCREDITO POS - COD.SIA:6181087-00009 CBI:0941 INSEGNA: VICOLO ID: 140350',
      'Incassi Internazionali Numia SpA 7943410 01.08.26 618108700001 VICOLO',
      'Incassi PagoBancomat 30.08.26 - 618108700003 VICOLO',
      'Accredito per incassi 31.08.2026 BRUGNATO 5 TERRE OUTLET 618108700010 American Express',
    ]) expect(classifyMovement(mv({ amount: 125.44, description: d }))).toBe('pos')
  })
  it('versamenti contanti nelle forme delle tre banche', () => {
    for (const d of [
      'VERS.SPORT.AUT. Effettuato presso ABI 01025 - ATM 9750 il 01.08.2026 a',
      'Causale: VERS. CONTANTE SELF SERV. - Descrizione: VERSAMENTO DA ATM 01',
      'Causale: VERS. CONTANTI C. CONTINU - Descrizione: VERS. GDO DATA PR: 0',
      'Versamento contante - cassa contin 3.8.26',
    ]) expect(classifyMovement(mv({ amount: 600, description: d }))).toBe('versamento')
  })
  it('carte: estratto carta cooperativa e ricariche prepagata', () => {
    expect(classifyMovement(mv({ amount: -2415.8, description: 'Carta del Credito Cooperativo ******************283 CCP DIRECT ISSUING' }))).toBe('carta')
    expect(classifyMovement(mv({ amount: -300, description: 'Ricarica carta prepagata TASCA da CARTA : 5226*********580 Ricariche d' }))).toBe('carta')
    expect(classifyMovement(mv({ amount: -16.9, description: 'Causale: ADD.DIRETTO CARTA CREDITO - Descrizione: ADDEBITO SDD N. 648302 A FAVORE NEXI', category: 'commissioni_incasso' }))).toBe('carta')
    // commissioni sul bonifico: la parola «bonifico» non le trasforma in un pagamento da chiarire
    expect(classifyMovement(mv({ amount: -0.75, description: 'Commissioni su bonifico tramite co', category: 'spese_banca' }))).toBe('spese_banca')
    expect(classifyMovement(mv({ amount: -13.5, description: 'SDD Core - Richiesta Incasso SEPA 50129 AMERICAN EXPRESS PAYMENTS EUSL', category: 'commissioni_incasso' }))).toBe('spese_banca')
  })
  it('rata di finanziamento, fideiussione, canoni, commissioni, Nexi e Global Blue', () => {
    expect(classifyMovement(mv({ amount: -1177.41, description: 'Causale: PAGAMENTO RATA DI MUTUO - Descrizione: ADD. RATA FINANZ. N 0994486821 SCAD. 31-08-2026' }))).toBe('finanziamento')
    expect(classifyMovement(mv({ amount: -905.19, description: 'Causale: COMM/SPESE SU FIDEJUSSION - Descrizione: ORD: NEW ZAGO S.R.L. FIDEIUSSIONE DEL 28.08.2025 N. 7016701' }))).toBe('spese_banca')
    expect(classifyMovement(mv({ amount: -20, description: 'CANONE MENSILE CANONE MENSILE MESE DI AGOSTO' }))).toBe('spese_banca')
    expect(classifyMovement(mv({ amount: -7, description: 'Causale: CANONE RAPPORTO PACKAGE - Descrizione: CANONE SET DI BASE MPS MIO Business' }))).toBe('spese_banca')
    expect(classifyMovement(mv({ amount: -3, description: 'Comm. richiesta incasso SEPA B2C' }))).toBe('spese_banca')
    expect(classifyMovement(mv({ amount: -601.79, description: 'Causale: ADDEBITO DIRETTO - Descrizione: ADDEBITO SDD N. 648302229 A FAVORE NEXI PAYMENTS SPA CODICE MANDATO C' }))).toBe('spese_banca')
    expect(classifyMovement(mv({ amount: -146.13, description: 'Causale: ADDEBITO DIRETTO - Descrizione: ADDEBITO SDD N. 650192680 A FAVORE GLOBAL BLUE ITALIA SRL CODICE MAND' }))).toBe('spese_banca')
  })
  it('un flusso CBI o un bonifico senza aggancio resta da chiarire, anche se cita le commissioni', () => {
    expect(classifyMovement(mv({ amount: -35787.62, description: 'Causale: DISPOSIZIONE - Descrizione: FILIALE DISPONENTE 2430 ID FLUSSO CBI: 1365 IMPORTO BONIFICI 35.785,87 IMPORTO COMMISSIONI 1,75' }))).toBe('da_chiarire')
    expect(classifyMovement(mv({ amount: -39445.9, description: 'Bonifico tramite Internet Banking *WOLF GROUP S.R.L CF-218-NC68 ID.BON:0845700003207890480546302800IT' }))).toBe('da_chiarire')
  })
  it('un canone di locazione in SDD non è una spesa bancaria', () => {
    expect(classifyMovement(mv({ amount: -11927.43, description: 'Causale: ADDEBITO DIRETTO - Descrizione: ADDEBITO SDD N. 648876013 A FAVORE PROPCO CANONE LOCAZIONE AGOSTO', category: 'real_estate' }))).toBe('da_chiarire')
  })
  it('l\'etichetta della banca è l\'ultimo ripiego', () => {
    expect(classifyMovement(mv({ amount: -777.53, description: 'Spese', category: 'spese_banca' }))).toBe('spese_banca')
    expect(classifyMovement(mv({ amount: 450, description: 'Causale: BONIFICO PER ORDINE/CONTO - Descrizione: FILIALE DISPONENTE 00560 BON. SEPA 030692653212840' }))).toBe('da_chiarire')
  })
})

describe('contropartita, P.IVA e causale con TUTTE le fatture del movimento', () => {
  const riba = mv({
    amount: -6896.19,
    description: 'Causale: EFFETTI RITIRATI - Descrizione: NUM.EFFETTI: 0000010 RIF.OP. 20260828 0',
    payables: [
      pay('R1/0003572', 'ARCO SPEDIZIONI SPA', '01234567890', 1076.54),
      pay('R1/0003573', 'ARCO SPEDIZIONI SPA', 'IT01234567890', 3000),
      pay('99', 'ALFATECNO S.R.L.', '09876543210', 2815.65),
    ],
  })
  it('più fornitori: conta i fornitori distinti per P.IVA e non ne sceglie uno a caso', () => {
    expect(counterpartOf(riba)).toBe('2 fornitori (3 fatture)')
    expect(pivaOf(riba)).toBe('')
    expect(causaleOf(riba)).toBe('Fatt. R1/0003572 (ARCO SPEDIZIONI SPA); R1/0003573 (ARCO SPEDIZIONI SPA); 99 (ALFATECNO S.R.L.)')
    expect(invoicesTotalOf(riba)).toBe(6892.19)
  })
  it('fatture a ricevuta bancaria: la RiBa si legge nel tipo movimento e nella causale', () => {
    const r = (n: string, sup: string, vat: string, amt: number, method: string | null) => ({ ...pay(n, sup, vat, amt), payment_method: method })
    const tutte = mv({ amount: -5866.19, description: 'EFFETTI RITIRATI', payables: [r('92', 'MARCO', '06151980486', 2866, 'riba_30'), r('119', 'ALFATECNO S.R.L.', '03916460482', 3000.19, 'riba_60')] })
    expect(ribaCountOf(tutte)).toBe(2)
    expect(tipoMovimentoOf(tutte)).toBe('Pagamento fornitore (RiBa)')
    expect(causaleOf(tutte)).toBe('RiBa · Fatt. 92 (MARCO); 119 (ALFATECNO S.R.L.)')
    expect(buildRow(tutte, (x) => x)['Tipo movimento']).toBe('Pagamento fornitore (RiBa)')
    const miste = mv({ amount: -466.95, description: 'x', payables: [r('60828', 'DX SRL', '11111111111', 155.65, 'riba'), r('65166', 'DX SRL', '11111111111', 311.3, 'bonifico_ordinario')] })
    expect(tipoMovimentoOf(miste)).toBe('Pagamento fornitore (RiBa e altro)')
    expect(causaleOf(miste)).toBe('Fatt. 60828 · RiBa; 65166')
    const bonifico = mv({ amount: -100, description: 'x', payables: [r('1', 'DX SRL', '11111111111', 100, 'bonifico_ordinario')] })
    expect(isRiba(bonifico.payables[0])).toBe(false)
    expect(tipoMovimentoOf(bonifico)).toBe('Pagamento fornitore')
    expect(causaleOf(bonifico)).toBe('Fatt. 1')
  })
  it('un solo fornitore con più fatture: nome, P.IVA e tutti i numeri', () => {
    const m = mv({ amount: -466.95, description: 'Bonifico *DX SRL SALDO FATTURA 60828-65166', payables: [pay('60828', 'DX SRL', '11111111111', 155.65), pay('65166', 'DX SRL', '11111111111', 311.3)] })
    expect(counterpartOf(m)).toBe('DX SRL')
    expect(pivaOf(m)).toBe('11111111111')
    expect(causaleOf(m)).toBe('Fatt. 60828; 65166')
    expect(invoicesTotalOf(m)).toBe(466.95)
  })
  it('F24 agganciato: titolo come contropartita, codice tributo e periodo in causale', () => {
    const m = mv({ amount: -9165, description: 'Imposte e Tasse:Delega Unificata(C', fiscal_deadlines: [{ title: 'IRES/IRAP 2026 + saldo 2025 — Rata 2/5', f24_code: '2001/3812/3800', tax_period: '2026', deadline_type: 'irap' }] })
    expect(counterpartOf(m)).toBe('IRES/IRAP 2026 + saldo 2025 — Rata 2/5')
    expect(causaleOf(m)).toBe('IRES/IRAP 2026 + saldo 2025 — Rata 2/5 · cod. 2001/3812/3800 · periodo 2026')
  })
  it('senza agganci legge il beneficiario dalla causale (bonifico con asterisco e SDD a favore)', () => {
    expect(counterpartOf(mv({ amount: -39445.9, description: 'Bonifico tramite Internet Banking *WOLF GROUP S.R.L CF-218-NC68 ID.BON:0845700003207890480546302800IT' }))).toBe('WOLF GROUP S.R.L')
    expect(counterpartOf(mv({ amount: -601.79, description: 'Causale: ADDEBITO DIRETTO - Descrizione: ADDEBITO SDD N. 648302229 A FAVORE NEXI PAYMENTS SPA CODICE MANDATO C' }))).toBe('NEXI PAYMENTS SPA')
  })
  it('senza niente resta vuota, non «—» nell\'Excel', () => {
    expect(counterpartOf(mv({ amount: 125.44, description: 'Causale: INCASSO TRAMITE P.O.S. - Descrizione: ACCREDITO POS - COD.SIA:6181087-00009' }))).toBe('')
  })
})

describe('entrate senza etichetta e outlet dalla nota', () => {
  it('bonifico di un cliente privato per un acquisto → incasso cliente, con l ordinante come contropartita', () => {
    const m = mv({ amount: 82, description: 'Causale: BONIFICO PER ORDINE/CONTO - Descrizione: FILIALE DISPONENTE 00560 BON. IST. 0845700003206403480546305463IT DEL 06.08.26 ORD: SCANU SABRINA BIC: ICRAITRRCP0 INF:RI: Acquisto merce vicolo Scanu Sabrina' })
    expect(classifyMovement(m)).toBe('incasso_cliente')
    expect(counterpartOf(m)).toBe('SCANU SABRINA')
  })
  it('bonifico in entrata di rimborso o restituzione → rimborso; l etichetta rimborsi_fornitori vale anche senza parola in causale', () => {
    expect(classifyMovement(mv({ amount: 6.2, description: 'BON. SEPA 1101262380309856 DEL 27.08.26 ORD: BRT SPA BIC: UNCRITMMXXX INF:EE: 262370017580629 RI: LIQUIDAZIONE TRANSATTIVA: Anomalia 116/1944' }))).toBe('rimborso')
    expect(classifyMovement(mv({ amount: 450, description: 'BON. SEPA 0306926532128407484017740177IT DEL 27.08.26 ORD: MIAN SRL BIC: BCITITMMXXX INF:EE: 62333012C', category: 'rimborsi_fornitori' }))).toBe('rimborso')
    expect(classifyMovement(mv({ amount: 60, description: 'BON. SEPA X DEL 26.08.26 ORD: ROSSETI VERONICA BIC: WIDIITMMXXX IND:VIA X INF:RI: acquisto top piu Panta palazzo vicolo', category: 'incassi_clienti' }))).toBe('incasso_cliente')
  })
  it('un bonifico in entrata senza indizi resta da chiarire; le uscite non diventano mai incasso', () => {
    expect(classifyMovement(mv({ amount: 100, description: 'BON. SEPA 123 DEL 01.08.26 ORD: ROSSI MARIO BIC: X INF:RI: ' }))).toBe('da_chiarire')
    expect(classifyMovement(mv({ amount: -100, description: 'BONIFICO *ROSSI MARIO acquisto merce' }))).toBe('da_chiarire')
  })
  it('outletCodeFromNote legge la convenzione "Outlet: CODICE · …"', () => {
    expect(outletCodeFromNote('Outlet: BRB · corrispettivi Barberino agosto 2026')).toBe('BRB')
    expect(outletCodeFromNote('outlet: plm')).toBe('PLM')
    expect(outletCodeFromNote('corrispettivi Barberino')).toBeNull()
    expect(outletCodeFromNote(null)).toBeNull()
  })
})

describe('buildRow e riepilogo', () => {
  it('riga export: IBAN in chiaro, tipo movimento, conteggio e totale fatture', () => {
    const row = buildRow({
      ...mv({ amount: -466.95, description: 'Bonifico *DX SRL SALDO FATTURA 60828-65166', category: null, payables: [pay('60828', 'DX SRL', '11111111111', 155.65), pay('65166', 'DX SRL', '11111111111', 311.3)] }),
      transaction_date: '2026-08-07', posting_date: '2026-08-08', currency: null,
      bank_accounts: { bank_name: 'BCC Valdarno', account_name: 'IT37H0845705463000000017334', iban: 'IT37H0845705463000000017334' },
    }, (d) => d)
    expect(row['Data operazione']).toBe('2026-08-07')
    expect(row['Data contabile']).toBe('2026-08-08')
    expect(row.IBAN).toBe('IT37H0845705463000000017334')
    expect(row['Tipo movimento']).toBe('Pagamento fornitore')
    expect(row['N. fatture']).toBe(2)
    expect(row['Totale fatture']).toBe(466.95)
    expect(row.Valuta).toBe('EUR')
    expect(row.Tipo).toBe('Uscita')
    expect(row.Importo).toBe(466.95)
  })
  it('riga export: la contropartita passata dalla pagina (outlet per POS e versamenti) vince su quella della banca', () => {
    const base = { ...mv({ amount: 760, description: 'VERS. GDO DATA PR: 03-08-26 DATA DT: 01-08-26 VICOLO NEW ZAGO SRL CC PALMANOVA PALMANOVA', counterpart_name: 'VICOLO NEW ZAGO SRL' }), transaction_date: '2026-08-03', currency: null }
    expect(buildRow(base, (d) => d, 'PLM · Palmanova, Contanti').Contropartita).toBe('PLM · Palmanova, Contanti')
    expect(buildRow(base, (d) => d, '').Contropartita).toBe(buildRow(base, (d) => d).Contropartita)
  })
  it('riepilogo per tipo: entrate e uscite separate, ordine fisso', () => {
    const s = summarizeByKind([
      mv({ amount: 100, description: 'Incassi PagoBancomat 30.08.26 - 618108700003 VICOLO' }),
      mv({ amount: 50, description: 'Incassi PagoBancomat 30.08.26 - 618108700003 VICOLO' }),
      mv({ amount: -7, description: 'Causale: CANONE RAPPORTO PACKAGE' }),
    ])
    expect(s).toEqual([
      { kind: 'pos', label: 'Incasso POS', n: 2, entrate: 150, uscite: 0 },
      { kind: 'spese_banca', label: 'Spese e commissioni bancarie', n: 1, entrate: 0, uscite: 7 },
    ])
  })
})
