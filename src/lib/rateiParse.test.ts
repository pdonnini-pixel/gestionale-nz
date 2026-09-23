import { describe, it, expect } from 'vitest';
import type { PdfItem } from './pdfText';
import {
  parseRatei, parseRateoNum, oreSettimanaliDaRateo, oreGiornataDaRateo,
  abbinaDipendente, normNome, isTabulatoRatei, type DipendenteRif,
  eAChiamata,
} from './rateiParse';

// Il repository è pubblico: i nomi qui sono inventati. La GEOMETRIA invece
// è quella vera del tabulato Paghe Infinity (coordinate prese dal documento
// di agosto 2026), perché è l'unica cosa che il lettore deve indovinare.
const it_ = (x: number, y: number, str: string, w?: number): PdfItem => ({ str, x, y, w });

// Coordinate di DISPLAY (pagina ruotata gia' raddrizzata): y cresce verso il
// basso. Sono le posizioni vere del tabulato di agosto 2026.
function intestazione(): PdfItem[] {
  return [
    it_(21.3, 36.7, 'Situazione ratei di ferie e permessi - Quantita'),
    it_(21, 55.7, 'Periodo di elaborazione:'), it_(146.7, 55.7, 'Agosto 2026'),
    it_(22, 81, 'Azienda:'), it_(94.5, 81, '071041 NUOVA AZIENDA SRL'),
    it_(81.4, 155.3, 'Rateo'), it_(174.6, 155.3, 'ESERCIZIO PRECEDENTE'),
    it_(361, 155.3, 'ESERCIZIO IN CORSO'), it_(539.3, 155.3, 'TOTALI'),
    it_(24, 162.4, 'Dipendente'), it_(80.9, 162.4, 'annuo'),
    it_(62, 168.5, 'TP'), it_(108, 168.5, 'CH'),
    it_(139.4, 168.5, 'Residuo'), it_(205.1, 168.5, 'Goduto'), it_(272.6, 168.5, 'Saldo'),
    it_(326, 168.5, 'Maturato'), it_(385.4, 168.5, 'Goduto'), it_(443.7, 168.5, 'Saldo'),
    it_(495.8, 168.5, 'Residuo'), it_(546.9, 168.5, 'Spett.'), it_(585.2, 168.5, 'Da fruire'),
    it_(636.8, 168.5, 'Non inden.'), it_(688.3, 168.5, 'Da god.'),
    it_(32.8, 170.3, 'Rateo'), it_(542.9, 174.3, 'Maturab'),
  ];
}

/**
 * Un blocco persona. Il rateo annuo e i mesi arrivano in un item solo
 * ("173,00 12"), come fa davvero pdfjs: serve a provare lo spezzettamento.
 */
function blocco(y: number, testa: string, voci: { voce: string; annuo: string; vals: [number, string][] }[]): PdfItem[] {
  const out: PdfItem[] = [it_(22, y, testa, 135.6)];
  let yy = y + 7.8;
  for (const v of voci) {
    const annuoMesi = `${v.annuo} 12`;
    out.push(it_(21.6, yy, v.voce), it_(64.2, yy, 'H'), it_(90.1, yy, annuoMesi, 2.94 * annuoMesi.length));
    for (const [x, s] of v.vals) out.push(it_(x, yy, s, 2.94 * s.length));
    yy += 9;
  }
  return out;
}

describe('parseRateoNum', () => {
  it('legge il formato italiano del tabulato', () => {
    expect(parseRateoNum('173,00')).toBe(173);
    expect(parseRateoNum('1.114,52147')).toBeCloseTo(1114.52147, 5);
    expect(parseRateoNum('-2,18750')).toBeCloseTo(-2.1875, 5);
    expect(parseRateoNum('12')).toBe(12);
  });
  it('rifiuta quello che non è un numero', () => {
    expect(parseRateoNum('F01')).toBeNull();
    expect(parseRateoNum('10/06/2024')).toBeNull();
    expect(parseRateoNum('H')).toBeNull();
  });
});

describe('orario settimanale dedotto dal rateo', () => {
  it('ricava le ore dai ratei veri del documento', () => {
    expect(oreSettimanaliDaRateo(173.0)).toBe(40);
    expect(oreSettimanaliDaRateo(151.37)).toBe(35);
    expect(oreSettimanaliDaRateo(129.75)).toBe(30);
    expect(oreSettimanaliDaRateo(34.6)).toBe(8);
    expect(oreSettimanaliDaRateo(null)).toBeNull();
    expect(oreSettimanaliDaRateo(0)).toBeNull();
  });
  it('la giornata piena è un quinto della settimana', () => {
    expect(oreGiornataDaRateo(173.0)).toBe(8);
    expect(oreGiornataDaRateo(129.75)).toBe(6);
  });
});

describe('parseRatei', () => {
  const persona = blocco(187.9, '0000003 ROSSI MARIA Ass. 10/06/2024', [
    {
      voce: 'F01 Ferie', annuo: '173,00',
      vals: [[159.5, '65,91666'], [224.2, '65,91666'], [339.4, '115,33333'], [400.6, '54,08334'],
             [454.2, '61,24999'], [512.2, '61,24999'], [551.4, '57,66667'], [595, '118,91666'], [659.4, '65,91666']],
    },
    {
      voce: 'F02 Perm.Ex-Fs', annuo: '32,00',
      vals: [[159.5, '42,66666'], [224.2, '11,00000'], [288.6, '31,66666'], [342.6, '21,33333'],
             [454.2, '21,33333'], [512.2, '52,99999'], [551.4, '10,66667'], [598.2, '63,66666']],
    },
    {
      voce: 'F03 Permessi', annuo: '28,00',
      vals: [[345.7, '7,00000'], [457.3, '7,00000'], [515.3, '7,00000'], [554.5, '9,33333'], [598.2, '16,33333']],
    },
  ]);

  // Blocco finale del documento: i totali dell'azienda, voce per voce.
  const totali = [
    it_(22, 300, 'Totali ditta'),
    it_(21.6, 309, 'F01 Ferie'), it_(64.2, 309, 'H'),
    it_(159.5, 309, '65,91666'), it_(224.2, 309, '65,91666'), it_(339.4, 309, '115,33333'),
    it_(400.6, 309, '54,08334'), it_(454.2, 309, '61,24999'),
    it_(512.2, 309, '61,24999'), it_(551.4, 309, '57,66667'), it_(595, 309, '118,91666'),
  ];

  it('legge intestazione, persona e tre voci', () => {
    const r = parseRatei([[...intestazione(), ...persona]]);
    expect(r.aziendaCodice).toBe('071041');
    expect(r.aziendaNome).toBe('NUOVA AZIENDA SRL');
    expect(r.periodo).toEqual({ anno: 2026, mese: 8 });
    expect(r.righe).toHaveLength(3);

    const ferie = r.righe.find((x) => x.voce === 'F01')!;
    expect(ferie.nominativo).toBe('ROSSI MARIA');
    expect(ferie.matricola).toBe('0000003');
    expect(ferie.dataAssunzione).toBe('2024-06-10');
    expect(ferie.dataCessazione).toBeNull();
    expect(ferie.rateoAnnuo).toBe(173);
    expect(ferie.mesi).toBe(12);
    expect(ferie.residuoPrec).toBeCloseTo(65.91666, 5);
    expect(ferie.godutoPrec).toBeCloseTo(65.91666, 5);
    expect(ferie.saldoPrec).toBeNull();          // colonna vuota = zero
    expect(ferie.maturato).toBeCloseTo(115.33333, 5);
    expect(ferie.goduto).toBeCloseTo(54.08334, 5);
    expect(ferie.saldoCorso).toBeCloseTo(61.24999, 5);
    expect(ferie.residuo).toBeCloseTo(61.24999, 5);
    expect(ferie.daMaturare).toBeCloseTo(57.66667, 5);
    expect(ferie.daFruire).toBeCloseTo(118.91666, 5);
    expect(ferie.nonIndennizzabile).toBeCloseTo(65.91666, 5);

    const exFestivita = r.righe.find((x) => x.voce === 'F02')!;
    expect(exFestivita.saldoPrec).toBeCloseTo(31.66666, 5);
    expect(exFestivita.residuo).toBeCloseTo(52.99999, 5);
    // La quadratura interna del documento deve tornare: residuo = somma dei saldi.
    expect((exFestivita.saldoPrec ?? 0) + (exFestivita.saldoCorso ?? 0)).toBeCloseTo(exFestivita.residuo!, 4);
  });

  it('legge la cessazione quando c è', () => {
    const cess = blocco(187.9, '0000050 BIANCHI ANNA Ass. 16/08/2025 Cess. 30/06/2026', [
      { voce: 'F01 Ferie', annuo: '155,70', vals: [[659.4, '12,88333']] },
    ]);
    const r = parseRatei([[...intestazione(), ...cess]]);
    expect(r.righe[0].dataCessazione).toBe('2026-06-30');
    expect(r.righe[0].residuo).toBeNull();
  });

  it('non perde la persona quando il blocco è spezzato dal salto pagina', () => {
    // Testa in fondo a una pagina, voce in cima a quella dopo.
    const testa = [it_(22, 560, '0000009 VERDI LUCA Ass. 01/02/2025', 135.6)];
    const coda = [
      it_(21.6, 187.9, 'F01 Ferie'), it_(64.2, 187.9, 'H'),
      it_(90.1, 187.9, '129,75 12', 26.45),
      it_(339.4, 187.9, '86,50000', 23.8), it_(512.2, 187.9, '86,50000', 23.8),
    ];
    const r = parseRatei([[...intestazione(), ...testa], [...intestazione(), ...coda]]);
    expect(r.righe).toHaveLength(1);
    expect(r.righe[0].nominativo).toBe('VERDI LUCA');
    expect(r.righe[0].residuo).toBeCloseTo(86.5, 2);
  });

  it('quadra con i totali ditta e lo dichiara', () => {
    const r = parseRatei([[...intestazione(), ...persona, ...totali]]);
    const q = r.quadratura.find((x) => x.voce === 'F01' && x.campo === 'residuo')!;
    expect(q.dichiarato).toBeCloseTo(61.24999, 5);
    expect(q.somma).toBeCloseTo(61.25, 2);
    expect(Math.abs(q.scarto)).toBeLessThan(0.02);
    expect(r.quadraturaOk).toBe(true);
  });

  it('segnala quando la somma non torna con i totali ditta', () => {
    const totaliSbagliati = totali.map((i) =>
      i.x === 512.2 && i.str === '61,24999' ? it_(512.2, i.y, '999,99999', 23.8) : i);
    const r = parseRatei([[...intestazione(), ...persona, ...totaliSbagliati]]);
    expect(r.quadraturaOk).toBe(false);
    expect(r.avvisi.join(' ')).toMatch(/non coincide con il totale ditta/);
  });

  it('avvisa se manca il blocco dei totali', () => {
    const r = parseRatei([[...intestazione(), ...persona]]);
    expect(r.quadraturaOk).toBe(false);
    expect(r.avvisi.join(' ')).toMatch(/Totali ditta/);
  });

  it('riconosce il documento giusto', () => {
    expect(isTabulatoRatei([intestazione()])).toBe(true);
    expect(isTabulatoRatei([[it_(10, 10, 'Elenco netti per dipendente')]])).toBe(false);
  });
});

describe('abbinaDipendente', () => {
  const dipendenti: DipendenteRif[] = [
    { id: 'a', matricola: '0000003', nome: 'MARIA', cognome: 'ROSSI', dataAssunzione: '2024-06-10', isActive: true },
    { id: 'b', matricola: '0000095', nome: 'ANNA', cognome: 'BIANCHI', dataAssunzione: '2026-07-27', isActive: true },
    { id: 'c', matricola: '0000030', nome: 'LUCA', cognome: 'VERDI', dataAssunzione: '2025-02-01', isActive: true },
    { id: 'd', matricola: '0000031', nome: 'LUCA', cognome: 'VERDI', dataAssunzione: '2023-05-04', isActive: false },
  ];

  it('nome e matricola coincidono: abbinamento sicuro', () => {
    const m = abbinaDipendente({ nominativo: 'ROSSI MARIA', matricola: '0000003', dataAssunzione: '2024-06-10' }, dipendenti);
    expect(m.employeeId).toBe('a');
    expect(m.metodo).toBe('matricola_e_nome');
    expect(m.daConfermare).toBe(false);
  });

  it('matricola diversa ma stessa data di assunzione: abbina lo stesso', () => {
    // Il caso vero di agosto 2026: cinque persone su quaranta.
    const m = abbinaDipendente({ nominativo: 'BIANCHI ANNA', matricola: '0000097', dataAssunzione: '2026-07-27' }, dipendenti);
    expect(m.employeeId).toBe('b');
    expect(m.metodo).toBe('nome_e_assunzione');
    expect(m.daConfermare).toBe(false);
    expect(m.nota).toMatch(/matricola/);
  });

  it('solo il nome coincide: propone ma chiede conferma', () => {
    const m = abbinaDipendente({ nominativo: 'ROSSI MARIA', matricola: '0000999', dataAssunzione: '2024-01-01' }, dipendenti);
    expect(m.employeeId).toBe('a');
    expect(m.metodo).toBe('nome');
    expect(m.daConfermare).toBe(true);
  });

  it('omonimia: sceglie per data di assunzione e chiede conferma', () => {
    const m = abbinaDipendente({ nominativo: 'VERDI LUCA', matricola: '0000030', dataAssunzione: '2025-02-01' }, dipendenti);
    expect(m.employeeId).toBe('c');
    expect(m.daConfermare).toBe(true);
  });

  it('omonimia con una sola persona in forza: propone quella, da confermare', () => {
    // Il caso vero di agosto 2026: in anagrafica la stessa persona compare
    // due volte, una attiva e una no.
    const conDoppione: DipendenteRif[] = [
      ...dipendenti,
      { id: 'e', matricola: null, nome: 'ANNA', cognome: 'BIANCHI', dataAssunzione: null, isActive: false },
    ];
    const m = abbinaDipendente({ nominativo: 'BIANCHI ANNA', matricola: '0000097', dataAssunzione: null }, conDoppione);
    expect(m.employeeId).toBe('b');
    expect(m.daConfermare).toBe(true);
    expect(m.nota).toMatch(/una sola in forza/);
  });

  it('omonimia fra due persone entrambe in forza: non sceglie da solo', () => {
    const dueAttivi: DipendenteRif[] = dipendenti.map((d) =>
      d.id === 'd' ? { ...d, isActive: true } : d);
    const m = abbinaDipendente({ nominativo: 'VERDI LUCA', matricola: null, dataAssunzione: null }, dueAttivi);
    expect(m.employeeId).toBeNull();
    expect(m.nota).toMatch(/2 persone/);
  });

  it('persona non in anagrafica', () => {
    const m = abbinaDipendente({ nominativo: 'NERI GIULIA', matricola: '0000777', dataAssunzione: '2026-01-01' }, dipendenti);
    expect(m.employeeId).toBeNull();
    expect(m.metodo).toBeNull();
    expect(m.daConfermare).toBe(true);
  });

  it('normalizza accenti e apostrofi', () => {
    expect(normNome("D'ALESSANDRO  Nicolò")).toBe('DALESSANDRO NICOLO');
    expect(normNome('Busé Sara')).toBe('BUSE SARA');
  });
});

describe('contratto a chiamata', () => {
  // Il programma delle paghe fa maturare il rateo per intero, perché non
  // può stimare la maturazione: 168,00 ore come un tempo pieno. Dividerlo
  // per 4,325 darebbe 38,84 ore a settimana, che non sono le ore di
  // nessuno. (Studio paghe, 23/09/2026.)
  it('riconosce il contratto comunque sia scritto', () => {
    expect(eAChiamata('a_chiamata')).toBe(true);
    expect(eAChiamata('A CHIAMATA')).toBe(true);
    expect(eAChiamata('a chiamata')).toBe(true);
    expect(eAChiamata('determinato')).toBe(false);
    expect(eAChiamata('indeterminato')).toBe(false);
    expect(eAChiamata(null)).toBe(false);
    expect(eAChiamata(undefined)).toBe(false);
  });

  it('il rateo pieno darebbe un orario che non esiste', () => {
    // 168,00 è il rateo di Focardi sul tabulato di agosto: il conto
    // formale torna, ma il numero non descrive nessun orario vero.
    expect(oreSettimanaliDaRateo(168)).toBe(38.84);
  });
});
