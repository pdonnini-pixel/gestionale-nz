// Test del lettore del report MODA «Conversion Rate». Numeri e negozi inventati:
// il repository e' pubblico. Le posizioni delle colonne sono quelle del PDF vero
// (Crystal Reports stampato con «Microsoft: Print To PDF»).
import { describe, it, expect } from 'vitest';
import {
  leggiReportModa, totaliCheNonTornano, giornoIncompleto, abbinaNegozio, confrontaGiorni,
  giorniMancanti, numeroIt, periodoLeggibile, meseLeggibile,
} from './trafficoModa';
import type { PdfItem } from './pdfText';

// Bordi destri delle colonne nel PDF vero: C.R. % 312, N.P. 348, Scontr 384, Qta 420, Teorico 468, Reale 522
const COL = { cr: 312, np: 348, sc: 384, qta: 420, teo: 468, reale: 522, upt: 624 };
const num = (s: string, destra: number, y: number): PdfItem => ({ str: s, x: destra - s.length * 4.5, y, w: s.length * 4.5 });
const txt = (s: string, x: number, y: number): PdfItem => ({ str: s, x, y, w: s.length * 4.5 });

function intestazione(y: number, stampa = '05/11/2026', dal = '01/11/2026', al = '02/11/2026'): PdfItem[] {
  return [
    txt('Data Stampa', 54, y), txt(stampa, 144, y), txt('09.12.30', 216, y), txt('Moda - SYS-DAT Verona srl', 676, y + 1),
    txt('Statistica Situazione Vendite con Conversion Rate', 54, y - 18),
    txt('Filtro', 54, y - 46), txt('su Data :', 87, y - 46), txt(`da ${dal}`, 135, y - 46), txt(`fino a ${al}`, 202, y - 46),
    txt('Importi', 54, y - 88), txt('Vendite SENZA Iva.', 92, y - 88),
    txt('(sono ESCLUSE', 54, y - 114), txt('Vendite libere,', 121, y - 114), txt('Buoni e Acconti)', 198, y - 114),
    ...colonne(y - 150),
  ];
}
function colonne(y: number): PdfItem[] {
  return [
    txt('C.R.', 285, y), txt('N.P.', 324, y), txt('Scontr', 354, y), txt('Qta', 397, y),
    txt('Codice', 48, y - 18), txt('Descrizione', 138, y - 18),
    { str: 'N.', x: 339, y: y - 18, w: 9 }, { str: 'N.', x: 375, y: y - 18, w: 9 },
    { str: 'Vend', x: 398, y: y - 18, w: 22 }, { str: 'Teorico', x: 435, y: y - 18, w: 33 }, { str: 'Reale', x: 498, y: y - 18, w: 24 },
  ];
}
/** Un'ora con vendite: C.R., ingressi, scontrini, pezzi, valori */
const ora = (h: string, y: number, ingressi: number, scontrini: number): PdfItem[] => [
  txt(h, 72, y), num('12,50', COL.cr, y), num(String(ingressi), COL.np, y), num(String(scontrini), COL.sc, y),
  num('3', COL.qta, y), num('1.234,56', COL.teo, y), num('987,65', COL.reale, y), num('2,00', COL.upt, y),
];
/** Un'ora con ingressi e senza vendite: solo N.P. e UPT 0,00 */
const oraVuota = (h: string, y: number, ingressi: number): PdfItem[] => [txt(h, 72, y), num(String(ingressi), COL.np, y), num('0,00', COL.upt, y)];
/** Un reso: scontrino senza ingressi */
const oraReso = (h: string, y: number): PdfItem[] => [txt(h, 72, y), num('1', COL.sc, y), num('0,00', COL.upt, y)];
const totale = (y: number, ingressi: number, scontrini: number): PdfItem[] => [
  num('9,00', COL.cr, y), num(String(ingressi), COL.np, y), num(String(scontrini), COL.sc, y), num('10', COL.qta, y), num('5.000,00', COL.teo, y),
];

function reportDiProva(): PdfItem[][] {
  const p1: PdfItem[] = [
    ...intestazione(546),
    txt('ALFA', 48, 356), txt('Alfa Village', 138, 356),
    txt('01/11/2026', 60, 342), txt('Domenica', 138, 342),
    ...ora('1000', 326, 10, 2), ...oraVuota('1100', 316, 7), ...ora('1200', 306, 1234, 5), ...oraReso('2000', 296),
    ...totale(280, 1251, 8),
  ];
  // salto pagina a meta' del secondo giorno: l'intestazione delle colonne si ripete
  const p2: PdfItem[] = [
    ...colonne(562),
    txt('02/11/2026', 60, 528), txt('Lunedi', 138, 528),
    ...ora('1000', 512, 4, 1), ...oraVuota('1100', 502, 3),
    ...totale(486, 7, 1),
    ...totale(470, 1258, 9), // totale del negozio
    txt('BETA', 48, 450), txt('Beta 5 Terre', 138, 450),
    txt('01/11/2026', 60, 436), txt('Domenica', 138, 436),
    ...ora('1500', 420, 20, 4),
    ...totale(404, 21, 4), // non torna: 20 nelle ore, 21 nel totale
    txt('Pag.', 768, 23), num('2', 798, 23),
  ];
  return [p1, p2];
}

describe('report MODA Conversion Rate', () => {
  it('legge negozi, giorni e ore per posizione delle colonne', () => {
    const r = leggiReportModa(reportDiProva());
    expect(r.stampa).toEqual({ data: '2026-11-05', ora: '09:12' });
    expect(r.dal).toBe('2026-11-01');
    expect(r.al).toBe('2026-11-02');
    expect(r.impostazioniStandard).toBe(true);
    expect(r.negozi.map((n) => [n.codice, n.descrizione])).toEqual([['ALFA', 'Alfa Village'], ['BETA', 'Beta 5 Terre']]);
    const alfa = r.negozi[0];
    expect(alfa.giorni.map((g) => g.data)).toEqual(['2026-11-01', '2026-11-02']);
    expect(alfa.giorni[0].ore).toEqual([
      { ora: 10, ingressi: 10, scontrini: 2 },
      { ora: 11, ingressi: 7, scontrini: 0 },
      { ora: 12, ingressi: 1234, scontrini: 5 },
      // il reso: lo scontrino non e' un ingresso
      { ora: 20, ingressi: 0, scontrini: 1 },
    ]);
    expect(alfa.giorni[0].totale).toEqual({ ingressi: 1251, scontrini: 8 });
    // il totale del negozio non diventa il totale del secondo giorno
    expect(alfa.giorni[1].totale).toEqual({ ingressi: 7, scontrini: 1 });
  });

  it('segnala i giorni in cui la somma delle ore non torna con il totale', () => {
    const r = leggiReportModa(reportDiProva());
    expect(totaliCheNonTornano(r)).toEqual([{ codice: 'BETA', data: '2026-11-01', ore: 20, totale: 21 }]);
  });

  it('riconosce impostazioni diverse dal solito', () => {
    const pagine = reportDiProva();
    pagine[0] = pagine[0].filter((i) => !/SENZA Iva/.test(i.str));
    expect(leggiReportModa(pagine).impostazioniStandard).toBe(false);
  });

  it('il giorno di stampa non e\' finito e non si carica', () => {
    const r = leggiReportModa(reportDiProva());
    expect(giornoIncompleto(r)).toBeNull();
    expect(giornoIncompleto({ ...r, stampa: { data: '2026-11-02', ora: '16:01' } })).toBe('2026-11-02');
  });

  it('rifiuta un PDF che non e\' il report', () => {
    expect(() => leggiReportModa([[txt('Fattura n. 12', 54, 500)]])).toThrow(/Conversion Rate/);
  });

  it('numeri all\'italiana', () => {
    expect(numeroIt('1.481,96')).toBe(1481.96);
    expect(numeroIt('1.234')).toBe(1234);
    expect(numeroIt('7')).toBe(7);
  });
});

describe('negozio del gestionale', () => {
  const negozi = [
    { id: 'a', name: 'ALFA', code: 'ALF' },
    { id: 'b', name: 'BETA', code: 'BET' },
    { id: 'g', name: 'GAMMA CENTRO', code: 'GAM' },
    { id: 's', name: 'SEDE / MAGAZZINO', code: 'SED' },
  ];
  it('per codice o per una parola del nome', () => {
    expect(abbinaNegozio('BET', 'qualunque', negozi)?.id).toBe('b');
    expect(abbinaNegozio('ALFA', 'Alfa Village', negozi)?.id).toBe('a');
    expect(abbinaNegozio('BE5', 'Beta 5 Terre', negozi)?.id).toBe('b');
    expect(abbinaNegozio('GC1', 'Gamma - Centro', negozi)?.id).toBe('g');
  });
  it('nessuno o piu\' di uno: lo sceglie chi carica', () => {
    expect(abbinaNegozio('ZZZ', 'Omega', negozi)).toBeNull();
    expect(abbinaNegozio('X', 'Alfa Beta', negozi)).toBeNull();
  });
});

describe('confronto con il database', () => {
  const giorno = { data: '2026-11-01', ore: [{ ora: 10, ingressi: 5, scontrini: 1 }, { ora: 11, ingressi: 3, scontrini: 0 }], totale: null };
  it('nuovo, uguale, diverso', () => {
    const [nuovo] = confrontaGiorni([{ outletId: 'a', giorno }], []);
    expect(nuovo.stato).toBe('nuovo');
    expect(nuovo.righe).toHaveLength(2);
    const db = [
      { outlet_id: 'a', data: '2026-11-01', ora: 10, ingressi: 5, scontrini: 1 },
      { outlet_id: 'a', data: '2026-11-01', ora: 11, ingressi: 3, scontrini: 0 },
    ];
    expect(confrontaGiorni([{ outletId: 'a', giorno }], db)[0].stato).toBe('uguale');
    const diverso = confrontaGiorni([{ outletId: 'a', giorno }], [{ ...db[0], ingressi: 6 }, db[1]])[0];
    expect(diverso.stato).toBe('diverso');
    expect([diverso.ingressiDb, diverso.ingressiFile]).toEqual([9, 8]);
    // un'ora che nel database non c'e' e' un cambiamento
    expect(confrontaGiorni([{ outletId: 'a', giorno }], [db[0]])[0].stato).toBe('diverso');
  });
});

describe('testi', () => {
  it('giorni mancanti in intervalli', () => {
    const presenti = new Set(['2026-09-01', '2026-09-02', '2026-09-04', '2026-09-08']);
    expect(giorniMancanti('2026-09', presenti, '2026-09-10')).toBe('3, 5-7, 9-10');
    expect(giorniMancanti('2026-09', new Set(), '2026-08-31')).toBe('');
  });
  it('periodo e mese', () => {
    expect(periodoLeggibile('2026-10-01', '2026-10-28')).toBe('dal 01/10/2026 al 28/10/2026');
    expect(periodoLeggibile('2026-10-01', '2026-10-01')).toBe('il 01/10/2026');
    expect(meseLeggibile('2026-10')).toBe('ottobre 2026');
  });
});

// ── Importi e PDF di un negozio solo (migration 464) ────────────────────────
// Bordi destri veri del PDF MODA: C.R. 312, N.P. 348, Scontr 384, Qta 420,
// Teorico 468, Reale 522, Scon 552, Prz.Medi 594, UPT 624, V.Acq 678,
// Ricarichi 708 e 738, Resa 798. Prz.Medi e UPT hanno l'etichetta solo nella
// prima riga d'intestazione.
const lab = (s: string, destra: number, y: number): PdfItem => ({ str: s, x: destra - s.length * 4.5, y, w: s.length * 4.5 });
function intestazioneCompleta(y: number, filtro: PdfItem[], raggr = 'Giorno , Ora'): PdfItem[] {
  return [
    txt('Data Stampa', 54, y), txt('05/11/2026', 144, y), txt('09.12.30', 216, y),
    txt('Statistica Situazione Vendite con Conversion Rate', 54, y - 18),
    txt('Raggruppamenti :', 54, y - 30), txt(raggr, 140, y - 30),
    txt('Filtro', 54, y - 40), txt('su Data :', 87, y - 40), txt('da 01/11/2026', 135, y - 40), txt('fino a 02/11/2026', 202, y - 40),
    ...filtro,
    txt('Importi', 54, y - 88), txt('Vendite SENZA Iva.', 92, y - 88),
    txt('(sono ESCLUSE', 54, y - 114), txt('Vendite libere,', 121, y - 114), txt('Buoni e Acconti)', 198, y - 114),
    // prima riga d'intestazione
    lab('C.R.', 303, y - 150), lab('N.P.', 342, y - 150), lab('Scontr', 383, y - 150), lab('Qta', 413, y - 150),
    lab('Valore Vendite', 505, y - 150), lab('Scon', 550, y - 150), lab('Prz.Medi', 595, y - 150), lab('UPT', 624, y - 150),
    lab('V.Acq', 667, y - 150), lab('Ricarichi', 730, y - 150), lab('Resa', 785, y - 150),
    // seconda riga
    txt('Codice', 48, y - 168), txt('Descrizione', 138, y - 168), lab('%', 312, y - 167),
    lab('N.', 348, y - 168), lab('N.', 384, y - 168), lab('Vend', 420, y - 168), lab('Teorico', 468, y - 168), lab('Reale', 522, y - 168),
    lab('%', 552, y - 167), lab('Importo', 678, y - 168), lab('Teo', 708, y - 168), lab('Rea', 738, y - 168), lab('Importo', 798, y - 168),
  ];
}
/** Un'ora con tutte le colonne: C.R., N.P., Scontr, Qta, Teorico, Reale, Scon, Prz.Medi, UPT, V.Acq, Ric Teo, Ric Rea, Resa */
const oraPiena = (h: string, y: number, v: string[]): PdfItem[] => [
  txt(h, 72, y), ...[312, 348, 384, 420, 468, 522, 552, 594, 624, 678, 708, 738, 798].map((d, i) => lab(v[i], d, y)),
];
const filtroBarb = (y: number) => [txt('Filtro', 54, y - 50), txt('su Negozio', 87, y - 50), txt(':', 140, y - 50), txt('ALFA - Alfa Village', 150, y - 50)];

describe('report MODA con gli importi', () => {
  const pdf = (): PdfItem[][] => [[
    ...intestazioneCompleta(546, filtroBarb(546)),
    txt('01/11/2026', 60, 357), txt('Domenica', 138, 357),
    ...oraPiena('1300', 341, ['11,11', '9', '1', '1', '97,13', '68,03', '29,96', '68,03', '1,00', '22,88', '4,25', '2,97', '45,15']),
    // UPT 3,56 non deve finire nel costo d'acquisto (366,30)
    ...oraPiena('1500', 331, ['23,08', '39', '9', '32', '1.367,09', '391,92', '71,33', '12,25', '3,56', '366,30', '3,73', '1,07', '25,62']),
    txt('1600', 72, 321), lab('13', 348, 321), lab('0,00', 624, 321),
    ...[312, 348, 384, 420, 468, 522].map((d, i) => lab(['20,41', '49', '10', '33', '1.464,22', '459,95'][i], d, 305)),
  ]];

  it('legge il negozio dall\'intestazione nei PDF di un negozio solo', () => {
    const r = leggiReportModa(pdf());
    expect(r.raggruppamento).toBe('Giorno, Ora');
    expect(r.negozi.map((n) => [n.codice, n.descrizione])).toEqual([['ALFA', 'Alfa Village']]);
    expect(r.importi).toBe(true);
  });

  it('legge pezzi, teorico, reale e costo per posizione, senza confondere UPT con il costo', () => {
    const [g] = leggiReportModa(pdf()).negozi[0].giorni;
    expect(g.ore[0]).toEqual({ ora: 13, ingressi: 9, scontrini: 1, importi: { pezzi: 1, teorico: 97.13, reale: 68.03, costo: 22.88 } });
    expect(g.ore[1].importi).toEqual({ pezzi: 32, teorico: 1367.09, reale: 391.92, costo: 366.3 });
    // ora con sole persone entrate: importi a zero, non mancanti
    expect(g.ore[2]).toEqual({ ora: 16, ingressi: 13, scontrini: 0, importi: { pezzi: 0, teorico: 0, reale: 0, costo: 0 } });
  });

  it('rifiuta il report per giorno, che non ha le ore', () => {
    expect(() => leggiReportModa([intestazioneCompleta(546, [], 'Negozio , Mese , Giorno')])).toThrow(/report per giorno/);
  });
});

describe('confronto con gli importi', () => {
  const imp = { pezzi: 3, teorico: 100, reale: 60, costo: 20 };
  const giorno = { data: '2026-11-01', ore: [{ ora: 10, ingressi: 5, scontrini: 1, importi: imp }], totale: null };
  const base = { outlet_id: 'a', data: '2026-11-01', ora: 10, ingressi: 5, scontrini: 1 };

  it('il database ha solo ingressi e scontrini: il file li completa senza chiedere', () => {
    const [e] = confrontaGiorni([{ outletId: 'a', giorno }], [{ ...base, pezzi: null, valore_teorico: null, vendite: 0, costo_acquisto: null }]);
    expect(e.stato).toBe('completa');
    expect(e.righe[0]).toMatchObject({ pezzi: 3, valore_teorico: 100, vendite: 60, costo_acquisto: 20 });
  });

  it('ricaricare lo stesso file e\' uguale: niente si somma', () => {
    const [e] = confrontaGiorni([{ outletId: 'a', giorno }], [{ ...base, pezzi: 3, valore_teorico: 100, vendite: 60, costo_acquisto: 20 }]);
    expect(e.stato).toBe('uguale');
  });

  it('importi diversi da quelli gia\' caricati: si chiede conferma', () => {
    const [e] = confrontaGiorni([{ outletId: 'a', giorno }], [{ ...base, pezzi: 3, valore_teorico: 100, vendite: 59.5, costo_acquisto: 20 }]);
    expect(e.stato).toBe('diverso');
  });

  it('un\'ora nel database che il file non ha si toglie, dopo la conferma', () => {
    const [e] = confrontaGiorni([{ outletId: 'a', giorno }], [
      { ...base, pezzi: 3, valore_teorico: 100, vendite: 60, costo_acquisto: 20 },
      { ...base, ora: 19, ingressi: 2, scontrini: 0 },
    ]);
    expect(e.stato).toBe('diverso');
    expect(e.oreDaTogliere).toEqual([19]);
  });

  it('un file senza importi non tocca quelli gia\' caricati', () => {
    const senza = { data: '2026-11-01', ore: [{ ora: 10, ingressi: 5, scontrini: 1 }], totale: null };
    const [e] = confrontaGiorni([{ outletId: 'a', giorno: senza }], [{ ...base, pezzi: 3, valore_teorico: 100, vendite: 60, costo_acquisto: 20 }]);
    expect(e.stato).toBe('uguale');
    expect(e.righe[0].valore_teorico).toBeUndefined();
  });
});
