import { describe, it, expect } from 'vitest';
import {
  oreGiornata, oreDelGiorno, giornateDaOre, totaliPerVoce, verificaRichiesta,
  grigliaDelMese, eDomenica, festivitaItaliane, etichettaFestivita,
  formattaOre, formattaGiornate, formattaData, perMese, intervalli,
  type GiornoRichiesto, type DisponibilitaVoce,
} from './ferieRichiesta';

// Una persona a 30 ore settimanali: giornata da 6 ore.
const disp = (over: Partial<DisponibilitaVoce> = {}): DisponibilitaVoce => ({
  voce: 'F01',
  residuo: 48,
  da_fruire: 72,
  ore_in_attesa: 0,
  ore_approvate: 0,
  ore_in_bozza: 0,
  residuo_disponibile: 48,
  da_fruire_disponibile: 72,
  saldo_alla_data: '2026-08-31',
  ore_giornata_dedotte: 6,
  ore_settimanali_dedotte: 30,
  ...over,
});

const giorno = (data: string, over: Partial<GiornoRichiesto> = {}): GiornoRichiesto => ({
  data, voce: 'F01', tipo: 'giornata', ore: 6, ...over,
});

describe('ore di una giornata', () => {
  // Gli argomenti sono ORE A SETTIMANA, e vanno divisi per cinque. Il caso
  // vero: Rosseti Veronica, 28 ore a settimana, giornata da 5,60. Scrivere
  // «una giornata vale 28,00 h» faceva mangiare cinque giorni di ferie a
  // ogni giorno chiesto.
  it('divide per cinque l\'orario che risulta dalle paghe', () => {
    expect(oreGiornata(28, 40)).toEqual({ ore: 5.6, fonte: 'paghe' });
    expect(oreGiornata(40, 40)).toEqual({ ore: 8, fonte: 'paghe' });
    expect(oreGiornata(30, 40)).toEqual({ ore: 6, fonte: 'paghe' });
  });

  it('una giornata non è mai l\'orario settimanale', () => {
    for (const settimanali of [8, 20, 24, 28, 30, 35, 40]) {
      const { ore } = oreGiornata(settimanali, null);
      expect(ore).toBeLessThan(settimanali);
      expect(ore).toBe(Math.round((settimanali / 5) * 100) / 100);
    }
  });

  it('ripiega sull\'anagrafica, sempre diviso cinque', () => {
    expect(oreGiornata(null, 35)).toEqual({ ore: 7, fonte: 'anagrafica' });
  });

  it('dichiara il ripiego quando non sa niente', () => {
    expect(oreGiornata(null, null)).toEqual({ ore: 8, fonte: 'ripiego' });
  });
});

describe('ore del singolo giorno', () => {
  it('giornata intera', () => expect(oreDelGiorno('giornata', 6)).toBe(6));
  it('mezza giornata', () => expect(oreDelGiorno('mezza_giornata', 7)).toBe(3.5));
  it('permesso a ore', () => expect(oreDelGiorno('ore', 6, 2.5)).toBe(2.5));
  it('permesso a ore senza valore vale zero, non la giornata', () => {
    expect(oreDelGiorno('ore', 6, null)).toBe(0);
  });
  it('non accetta ore negative', () => expect(oreDelGiorno('ore', 6, -3)).toBe(0));
});

describe('conversioni e totali', () => {
  it('da ore a giornate', () => expect(giornateDaOre(15, 6)).toBe(2.5));
  it('somma per voce', () => {
    const t = totaliPerVoce([
      giorno('2026-10-01'),
      giorno('2026-10-02', { voce: 'F03', tipo: 'ore', ore: 2 }),
      giorno('2026-10-05'),
    ]);
    expect(t).toEqual({ F01: 12, F02: 0, F03: 2 });
  });
});

describe('verifica della richiesta', () => {
  it('senza giorni non si manda', () => {
    const a = verificaRichiesta([], [disp()], 6);
    expect(a[0].gravita).toBe('blocco');
  });

  it('passa liscia quando le ore bastano', () => {
    const a = verificaRichiesta([giorno('2026-10-05'), giorno('2026-10-06')], [disp()], 6);
    expect(a.filter((x) => x.gravita !== 'nota')).toHaveLength(0);
  });

  it('blocca oltre quello che maturerà entro fine anno', () => {
    const giorni = Array.from({ length: 13 }, (_, i) => giorno(`2026-10-${String(i + 5).padStart(2, '0')}`));
    const a = verificaRichiesta(giorni, [disp()], 6);
    expect(a.some((x) => x.gravita === 'blocco' && /entro fine anno/.test(x.testo))).toBe(true);
  });

  it('avvisa, senza bloccare, se supera solo il disponibile di oggi', () => {
    // 54 ore chieste: più delle 48 di oggi, meno delle 72 di fine anno.
    const giorni = Array.from({ length: 9 }, (_, i) => giorno(`2026-10-${String(i + 5).padStart(2, '0')}`));
    const a = verificaRichiesta(giorni, [disp()], 6);
    expect(a.some((x) => x.gravita === 'blocco')).toBe(false);
    expect(a.some((x) => x.gravita === 'attenzione' && /disponibili oggi/.test(x.testo))).toBe(true);
  });

  it('blocca più di una giornata intera nello stesso giorno', () => {
    const a = verificaRichiesta([
      giorno('2026-10-05', { tipo: 'mezza_giornata', ore: 3 }),
      giorno('2026-10-05', { voce: 'F03', tipo: 'ore', ore: 4 }),
    ], [disp(), disp({ voce: 'F03', residuo: 20, da_fruire: 20, residuo_disponibile: 20, da_fruire_disponibile: 20 })], 6);
    expect(a.some((x) => x.gravita === 'blocco' && /giornata intera/.test(x.testo))).toBe(true);
  });

  it('dice, senza drammi, che i giorni prima del tabulato sono già contati', () => {
    const a = verificaRichiesta([giorno('2026-08-10')], [disp()], 6);
    expect(a.some((x) => x.gravita === 'nota' && /già contati/.test(x.testo))).toBe(true);
  });

  it('segnala le ferie chieste di domenica o in una festività', () => {
    const a = verificaRichiesta([giorno('2026-12-25')], [disp()], 6);
    expect(a.some((x) => x.gravita === 'attenzione' && /Natale/.test(x.testo))).toBe(true);
  });

  it('il saldo già impegnato da altre richieste entra nel conto', () => {
    // 40 ore già in attesa: ne restano 8 oggi e 32 a fine anno.
    const d = disp({ ore_in_attesa: 40, residuo_disponibile: 8, da_fruire_disponibile: 32 });
    const giorni = Array.from({ length: 6 }, (_, i) => giorno(`2026-10-${String(i + 5).padStart(2, '0')}`));
    const a = verificaRichiesta(giorni, [d], 6);
    expect(a.some((x) => x.gravita === 'blocco')).toBe(true);
  });
});

describe('calendario', () => {
  it('ottobre 2026 comincia di giovedì e ha 31 giorni', () => {
    const { giorni, offset } = grigliaDelMese(2026, 10);
    expect(giorni).toHaveLength(31);
    expect(offset).toBe(3);                 // lunedì = 0, giovedì = 3
    expect(giorni[0]).toBe('2026-10-01');
  });

  it('febbraio 2028 è bisestile', () => {
    expect(grigliaDelMese(2028, 2).giorni).toHaveLength(29);
  });

  it('riconosce la domenica', () => {
    expect(eDomenica('2026-10-04')).toBe(true);
    expect(eDomenica('2026-10-05')).toBe(false);
  });

  it('calcola la Pasqua', () => {
    // Pasqua 2026: 5 aprile. Pasqua 2027: 28 marzo.
    expect(festivitaItaliane(2026)['2026-04-05']).toBe('Pasqua');
    expect(festivitaItaliane(2026)['2026-04-06']).toBe('Lunedì dell\'Angelo');
    expect(festivitaItaliane(2027)['2027-03-28']).toBe('Pasqua');
  });

  it('conosce le festività fisse e tace sul resto', () => {
    expect(etichettaFestivita('2026-08-15')).toBe('Ferragosto');
    expect(etichettaFestivita('2026-10-07')).toBeNull();
  });
});

describe('formati', () => {
  it('ore con due decimali', () => expect(formattaOre(7.5)).toBe('7,50 h'));
  it('ore mancanti', () => expect(formattaOre(null)).toBe('—'));
  it('giornate arrotondate alla mezza', () => expect(formattaGiornate(15, 6)).toBe('2,5 giorni'));
  it('una giornata sola è al singolare', () => expect(formattaGiornate(6, 6)).toBe('1 giorno'));
  it('data all\'italiana', () => expect(formattaData('2026-10-05')).toBe('05/10/2026'));
});

describe('raggruppamenti per il modulo', () => {
  it('raggruppa per mese in ordine', () => {
    const m = perMese([giorno('2026-11-02'), giorno('2026-10-05'), giorno('2026-10-06')]);
    expect(m.map((x) => x.etichetta)).toEqual(['Ottobre 2026', 'Novembre 2026']);
    expect(m[0].giorni).toHaveLength(2);
  });

  it('unisce i giorni consecutivi in un intervallo', () => {
    const i = intervalli([giorno('2026-10-05'), giorno('2026-10-06'), giorno('2026-10-07')]);
    expect(i).toHaveLength(1);
    expect(i[0]).toMatchObject({ dal: '2026-10-05', al: '2026-10-07', giorni: 3, ore: 18 });
  });

  it('spezza quando cambia la voce', () => {
    const i = intervalli([
      giorno('2026-10-05'),
      giorno('2026-10-06', { voce: 'F03', tipo: 'ore', ore: 2 }),
      giorno('2026-10-07'),
    ]);
    expect(i).toHaveLength(3);
  });

  it('spezza quando salta un giorno', () => {
    const i = intervalli([giorno('2026-10-05'), giorno('2026-10-08')]);
    expect(i.map((x) => x.giorni)).toEqual([1, 1]);
  });
});
