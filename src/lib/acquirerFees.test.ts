import { describe, it, expect } from 'vitest';
import { parseAmexStatement, parseNexiStatement, tipoEstratto, importoIt, totaliPerOutlet, nomeDocumento, funzioneArchivio, type CommissioneRiga } from './acquirerFees';

// Righe prese dagli estratti conto veri di New Zago (agosto e luglio 2026),
// ridotte ma non riscritte: i numeri sono quelli dei documenti.

const AMEX_AGOSTO = [
  'Estratto Conto Commissioni',
  'Codice Società: 7373035252',
  'Estratto Conto n. 26DY48D di Agosto 2026',
  'Riepilogo Operazioni',
  'Codice AX N. 7373035260 VICOLO FOIANO DELLA CHIANA AR',
  'Data Descrizione Operazione Riferimento n°Operazioni Lordo Commissione Netto',
  '01.08.26 Abi 08457 - Operazione Elettronica 25214614985935560 2 179,20 -2,69 176,51',
  'Totale trasmissione ABI 08457 al 31/08/2026 2 179,20 -2,69 176,51',
  '02.08.26 Abi 01030 - Operazione Elettronica 25215614954795612 1 52,50 -0,79 51,71',
  '05.08.26 Abi 01030 - Operazione Elettronica 25218614950939219 1 41,90 -0,63 41,27',
  'TOTALE PUNTO VENDITA EURO 273,60 -4,11 269,49',
  'Codice AX N. 7377153036 VICOLO BARBERINO DI MUGELLO FI',
  '02.08.26 Abi 01030 - Operazione Elettronica 25215614954801657 2 275,40 -4,13 271,27',
  '06.08.26 Abi 01030 - Operazione Elettronica 25219614962530717 1 80,40 -1,21 79,19',
  'TOTALE PUNTO VENDITA EURO 355,80 -5,34 350,46',
  'TOTALE EURO 629,40 -9,45 619,95',
  'Data Addebiti non riferiti a specifiche Operazioni',
  "31.08.26 Bollo su estratto conto - Art. 13 comma 2, tariffa allegato A al DPR 642/72 come modificato dall'Art. 6 D:L: 30/12/95 n.565 -2,00",
  'TOTALE ESTRATTO CONTO EURO -11,45',
];

const NEXI_LORDO = [
  'NEW ZAGO S.R.L. VIA IX FEBBRAIO 7 50129 FI FIRENZE',
  'PROSPETTO RIEPILOGATIVO COMPLESSIVO',
  'Totale Negoziato Totale Accrediti Giornalieri Totale Addebito 77.033,20 77.033,20 601,79',
  'ESTRATTO CONTO DEL 31.07.2026',
  'CODICE FISCALE O PARTITA IVA 07362100484',
  'VICOLO - punto vendita cod. LN0004777495',
  'VIA FERRARI ENZO 5, FOIANO DELLA CHIANA - 52045 AR ITA',
  'BANCA MONTE DEI PASCHI DI SIENA S.P.A. - ABI 01030',
  'TOTALE NEGOZIATO Payment Contract PC0001000583 : al lordo',
  'Negoziato Transazioni da carte Internazionali e APM 56.080,40',
  'Negoziato transazioni da BANCOMAT 20.952,80',
  'TOTALE NEGOZIATO 77.033,20',
  'TOTALE ACCREDITI 77.033,20',
  'Commissioni sul Transato 597,29',
  'Commissione di Acquiring in Euro* 2,50',
  'Imposta di Bollo 2,00',
  'TOTALE ADDEBITI - ABI: 01030 - CAB: 38020 - C/C: 000000621460 601,79',
];

const NEXI_NETTO = [
  'PROSPETTO RIEPILOGATIVO COMPLESSIVO',
  'ESTRATTO CONTO DEL 31.07.2026',
  'VICOLO - punto vendita cod. LN0005475974',
  'PALMANOVA OUTLET VILLAGE STRADA PROVINCIALE 126 K, AIELLO DEL FRIULI - 33041 UD ITA',
  'TOTALE NEGOZIATO Payment Contract PC0001392693 : al netto',
  'Negoziato Transazioni da carte Internazionali e APM 45.668,91',
  'Negoziato transazioni da BANCOMAT 10.516,13',
  'TOTALE NEGOZIATO 56.185,04',
  'TOTALE ACCREDITI 55.711,37',
  'Commissioni sul transato BANCOMAT 61,87',
  'Commissioni sul transato INTERNAZ. E APM 411,80',
  'ALTRE VOCI DI COSTO - Rif. 1401563552499 Addebito in C/C 4,50',
  'Commissione di Acquiring in Euro* 2,50',
  'Imposta di Bollo 2,00',
  'TOTALE ADDEBITI - ABI: 01030 - CAB: 38020 - C/C: 000000621460 4,50',
];

describe('importoIt', () => {
  it('legge il formato italiano', () => {
    expect(importoIt('1.456,95')).toBe(1456.95);
    expect(importoIt('-2,69')).toBe(-2.69);
    expect(importoIt('77.033,20')).toBe(77033.2);
  });
});

describe('tipoEstratto', () => {
  it('distingue Amex da Nexi', () => {
    expect(tipoEstratto(AMEX_AGOSTO)).toBe('amex');
    expect(tipoEstratto(NEXI_LORDO)).toBe('nexi');
    expect(tipoEstratto(['documento qualsiasi'])).toBeNull();
  });
});

describe('parseAmexStatement', () => {
  const st = parseAmexStatement(AMEX_AGOSTO)!;

  it('legge numero e periodo', () => {
    expect(st.numero).toBe('26DY48D');
    expect(st.anno).toBe(2026);
    expect(st.mese).toBe(8);
  });

  it('raggruppa le operazioni per codice AX', () => {
    expect(st.puntiVendita).toHaveLength(2);
    const foiano = st.puntiVendita.find(p => p.merchant_code === '7373035260')!;
    expect(foiano.lordo).toBe(273.6);          // 179,20 + 52,50 + 41,90
    expect(foiano.commissioni).toBe(4.11);     // 2,69 + 0,79 + 0,63
    expect(foiano.operazioni).toBe(4);
    const barberino = st.puntiVendita.find(p => p.merchant_code === '7377153036')!;
    expect(barberino.lordo).toBe(355.8);
    expect(barberino.commissioni).toBe(5.34);
  });

  it('non conta le righe di totale come operazioni', () => {
    const somma = st.puntiVendita.reduce((s, p) => s + p.lordo, 0);
    expect(Math.round(somma * 100) / 100).toBe(st.lordoTotale);
  });

  it('legge bollo e totale addebitato', () => {
    expect(st.bollo).toBe(2);
    expect(st.commissioniTotali).toBe(9.45);
    expect(st.totaleAddebitato).toBe(11.45);   // 9,45 + 2,00 di bollo
  });
});

describe('parseNexiStatement', () => {
  it('legge il regime al lordo: accredito pieno e commissione addebitata a parte', () => {
    const st = parseNexiStatement(NEXI_LORDO)!;
    expect(st.merchant_code).toBe('LN0004777495');
    expect(st.payment_contract).toBe('PC0001000583');
    expect(st.settlement_mode).toBe('lordo');
    expect(st.anno).toBe(2026);
    expect(st.mese).toBe(7);
    expect(st.negoziato).toBe(77033.2);
    expect(st.accrediti).toBe(77033.2);
    expect(st.commissioni).toBe(597.29);
    expect(st.totaleAddebitato).toBe(601.79);  // 597,29 + 2,50 + 2,00
  });

  it('legge il regime al netto e somma le commissioni dei due circuiti', () => {
    const st = parseNexiStatement(NEXI_NETTO)!;
    expect(st.merchant_code).toBe('LN0005475974');
    expect(st.settlement_mode).toBe('netto');
    expect(st.commissioni).toBe(473.67);       // 61,87 bancomat + 411,80 internazionali
    expect(st.negoziato - st.accrediti).toBeCloseTo(473.67, 2);
    expect(st.totaleAddebitato).toBe(4.5);     // in banca passa solo il fisso
  });

  it('ricava la commissione dalla differenza se le righe non si leggono', () => {
    const senzaRighe = NEXI_NETTO.filter(r => !/Commissioni sul transato/i.test(r));
    const st = parseNexiStatement(senzaRighe)!;
    expect(st.commissioni).toBe(473.67);
  });

  it('non inventa niente su un documento che non e\' un estratto', () => {
    expect(parseNexiStatement(['pagina bianca'])).toBeNull();
    expect(parseAmexStatement(['pagina bianca'])).toBeNull();
  });
});

describe('totaliPerOutlet', () => {
  const riga = (o: string, m: number, fee: number, gross: number | null, mode: 'lordo' | 'netto'): CommissioneRiga => ({
    outlet_id: o, outlet_code: o, outlet_name: o, period_year: 2026, period_month: m,
    acquirer: 'nexi', merchant_code: 'LN1', payment_contract: null, settlement_mode: mode,
    source: 'documento', gross_amount: gross, fee_amount: fee, fixed_amount: 0, stamp_amount: 0,
    costo_totale: fee, aliquota_pct: null,
  });

  it('somma per outlet e mese e calcola l\'aliquota sul transato noto', () => {
    const t = totaliPerOutlet([
      riga('VDC', 7, 597.29, 77033.2, 'lordo'),
      riga('VDC', 6, 405.09, 54045.86, 'lordo'),
      riga('BRG', 7, 229.86, 29884.62, 'netto'),
    ]);
    expect(t[0].outlet_code).toBe('VDC');
    expect(t[0].totale).toBe(1002.38);
    expect(t[0].perMese[7]).toBe(597.29);
    expect(t[0].aliquota).toBeCloseTo(0.765, 2);
    expect(t[0].soloNetto).toBe(false);
    expect(t[1].soloNetto).toBe(true);
  });

  it('non calcola l\'aliquota se il transato non e\' noto', () => {
    const t = totaliPerOutlet([riga('VDC', 1, 695.79, null, 'lordo')]);
    expect(t[0].aliquota).toBeNull();
    expect(t[0].totale).toBe(695.79);
  });
});

describe('nomeDocumento e funzioneArchivio', () => {
  it('da' + "'" + ' al file un nome che dice chi, quando e di chi', () => {
    expect(nomeDocumento({ acquirer: 'nexi', anno: 2026, mese: 3, chi: 'VDC' })).toBe('nexi_VDC_2026-03.pdf');
    expect(nomeDocumento({ acquirer: 'amex', anno: 2025, mese: 12 })).toBe('amex_2025-12.pdf');
  });

  it('ripiega sul codice del punto vendita se la sigla non c\'e\'', () => {
    expect(nomeDocumento({ acquirer: 'nexi', anno: 2026, mese: 8, chi: 'LN0005475974' }))
      .toBe('nexi_LN0005475974_2026-08.pdf');
  });

  it('non lascia passare caratteri che romperebbero il path', () => {
    expect(nomeDocumento({ acquirer: 'nexi', anno: 2026, mese: 1, chi: 'V DC/../x' })).toBe('nexi_VDCx_2026-01.pdf');
  });

  it('distingue la funzione per punto vendita, cosi\' il ricarico sostituisce solo il suo', () => {
    expect(funzioneArchivio('nexi', 'VDC')).toBe('Commissioni di incasso · Nexi VDC');
    expect(funzioneArchivio('nexi', 'PLM')).not.toBe(funzioneArchivio('nexi', 'VDC'));
    expect(funzioneArchivio('amex')).toBe('Commissioni di incasso · Amex');
  });
});
