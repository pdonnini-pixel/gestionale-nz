import { describe, it, expect } from 'vitest';
import {
  oreGiornata, oreDelGiorno, giornateDaOre, totaliPerVoce, verificaRichiesta,
  giornateInParole, oreInParole,
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

  it('blocca oltre il totale che risulterà a fine anno', () => {
    const giorni = Array.from({ length: 13 }, (_, i) => giorno(`2026-10-${String(i + 5).padStart(2, '0')}`));
    const a = verificaRichiesta(giorni, [disp()], 6);
    const blocco = a.find((x) => x.gravita === 'blocco' && x.voce === 'F01');
    expect(blocco).toBeTruthy();
    expect(blocco!.testo).toMatch(/tutto l'anno maturato/);
  });

  // Le ferie NON scadono (Francesca Signorini, studio paghe, 23/09/2026).
  // Il messaggio non deve quindi parlare di scadenze o di fine anno come
  // termine ultimo: era «entro fine anno», e faceva credere il contrario.
  it('non fa credere che le ferie scadano a fine anno', () => {
    const giorni = Array.from({ length: 13 }, (_, i) => giorno(`2026-10-${String(i + 5).padStart(2, '0')}`));
    const a = verificaRichiesta(giorni, [disp()], 6);
    for (const avviso of a) {
      expect(avviso.testo).not.toMatch(/entro fine anno|scadono|scadenza/i);
    }
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


// Come si dicono i saldi a chi li deve usare. Il ragionamento di una
// commessa e' «una giornata, mezza giornata, o due ore di permesso»: le ore
// con la virgola sono l'unita' con cui il gestionale fa i conti, non quella
// con cui si parla alle persone.
describe('giornateInParole', () => {
  it.each([
    [48, 6, '8 giornate'],
    [8.65, 1.6, '5 giornate'],       // Falchi: 5,4 giornate, la mezza non ce l'ha
    [9.0, 1.6, '5 giornate e mezza'], // 5,625: la mezza c'e'
    [6, 6, '1 giornata'],
    [3, 6, 'mezza giornata'],
    [1, 6, 'meno di mezza giornata'],
    [0, 6, 'nessuna'],
  ])('%s ore con giornata da %s fanno «%s»', (ore, giornata, atteso) => {
    expect(giornateInParole(ore, giornata)).toBe(atteso);
  });

  it('non arrotonda mai per eccesso', () => {
    // Su sette orari veri: le giornate dette non superano mai quelle vere.
    for (const oreSettimanali of [8, 18, 20, 24, 25, 30, 40]) {
      const giornata = oreSettimanali / 5;
      for (const ore of [1.3, 4.9, 8.65, 17.4, 52.2]) {
        const detto = giornateInParole(ore, giornata);
        const numero = detto.startsWith('meno') || detto === 'nessuna'
          ? 0
          : parseFloat(detto.replace(/[^0-9]/g, '') || '0') + (/e mezza/.test(detto) ? 0.5 : 0);
        const vere = ore / giornata;
        expect(numero).toBeLessThanOrEqual(vere + 1e-9);
      }
    }
  });

  it('un saldo negativo non diventa zero in silenzio', () => {
    expect(giornateInParole(-4.18, 6)).toMatch(/in anticipo/);
  });

  it('senza saldo non inventa niente', () => {
    expect(giornateInParole(null, 6)).toBe('—');
    expect(giornateInParole(10, 0)).toBe('—');
  });
});

// Le ore si dicono in ore, con i decimali, come il tabulato delle paghe.
// I minuti erano un errore: «33 minuti» non si ritrova sul documento che la
// persona puo' avere in mano, «0,55 ore» si'.
describe('oreInParole', () => {
  it.each([
    [0.55, '0,55 ore'],      // Rosseti, ferie residue sul tabulato di agosto
    [11.2, '11,20 ore'],     // Rosseti, permessi
    [8.65, '8,65 ore'],      // Falchi, ferie
    [1.6, '1,60 ore'],
    [2, '2,00 ore'],
    [1, '1 ora'],
    [0, 'nessuna'],
  ])('%s si legge «%s»', (ore, atteso) => {
    expect(oreInParole(ore)).toBe(atteso);
  });

  it('non parla mai di minuti', () => {
    for (const ore of [0.55, 1.6, 7.25, 0.75, 13.33]) {
      expect(oreInParole(ore)).not.toMatch(/minut/i);
    }
  });

  it('un saldo negativo si vede, non diventa zero', () => {
    expect(oreInParole(-4.19)).toMatch(/in anticipo/);
    expect(oreInParole(-4.19)).toMatch(/-4,19/);
  });
});

