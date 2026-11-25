// Test dei calcoli di «Vendite e ingressi». Numeri inventati: il repository e'
// pubblico. Le formule sono quelle del report MODA, verificate sui totali veri.
import { describe, it, expect } from 'vitest';
import {
  leggiReportVI, somma, derivate, scomponi, scartoCassa, mesePrima, meseAnnoPrima, ultimoGiorno, giorniDel,
  mappaOre, oreAperte, variazione, spostaGiorni, giorniAnnoPrima, confrontoCassa, scartoDi, type GiornoVI,
} from './venditeIngressi';

const g = (data: string, ingressi: number, scontrini: number, imp?: [number, number, number, number], outletId = 'a'): GiornoVI => ({
  outletId, data, ingressi, scontrini,
  pezzi: imp?.[0] ?? 0, teorico: imp?.[1] ?? 0, reale: imp?.[2] ?? 0, costo: imp?.[3] ?? 0, importi: !!imp,
});

describe('lettura della funzione', () => {
  it('trasforma il jsonb in tipi', () => {
    const r = leggiReportVI({
      mese: '2026-10', solo_suoi: true,
      negozi: [{ id: 'a', nome: 'Alfa' }], mesi: ['2026-10', '2026-09'],
      giorni: [['a', '2026-10-01', 100, 10, 20, 2000, 1000, 400, true]],
      ore: [['a', 4, 10, 30, 3, 300]],
      cassa: [['a', 1010.5, 1]],
    });
    expect(r.soloSuoi).toBe(true);
    expect(r.giorni[0]).toEqual({ outletId: 'a', data: '2026-10-01', ingressi: 100, scontrini: 10, pezzi: 20, teorico: 2000, reale: 1000, costo: 400, importi: true });
    expect(r.ore[0]).toEqual({ outletId: 'a', giornoSett: 4, ora: 10, ingressi: 30, scontrini: 3, reale: 300 });
    expect(r.cassa.get('a')).toBe(1010.5);
  });
  it('regge una risposta vuota', () => {
    const r = leggiReportVI(null);
    expect(r.giorni).toEqual([]);
    expect(r.cassa.size).toBe(0);
  });
});

describe('misure del report MODA', () => {
  it('conversione, sconto, prezzo medio, pezzi per scontrino, ricarichi e resa', () => {
    // 1.000 ingressi, 100 scontrini, 180 pezzi, 15.000 a listino, 8.000 incassati, 3.000 di costo
    const d = derivate(somma([g('2026-10-01', 600, 60, [100, 9000, 5000, 1800]), g('2026-10-02', 400, 40, [80, 6000, 3000, 1200])]));
    expect(d.conversione).toBeCloseTo(10);
    expect(d.scontrinoMedio).toBeCloseTo(80);
    expect(d.pezziPerScontrino).toBeCloseTo(1.8);
    expect(d.prezzoMedio).toBeCloseTo(8000 / 180);
    expect(d.sconto).toBeCloseTo((1 - 8000 / 15000) * 100);
    expect(d.resa).toBeCloseTo(5000);
    expect(d.resaPct).toBeCloseTo(62.5);
    expect(d.ricaricoTeorico).toBeCloseTo(5);
    expect(d.ricaricoReale).toBeCloseTo(8000 / 3000);
  });
  it('senza importi: solo conversione, il resto non si inventa', () => {
    const m = somma([g('2026-10-01', 200, 16)]);
    expect(m.importiCompleti).toBe(false);
    const d = derivate(m);
    expect(d.conversione).toBeCloseTo(8);
    expect(d.scontrinoMedio).toBeNull();
    expect(d.resa).toBeNull();
  });
  it('importi a meta\': gli euro si calcolano sui soli giorni che li hanno', () => {
    const m = somma([g('2026-10-01', 100, 10, [20, 2000, 1000, 400]), g('2026-10-02', 100, 30)]);
    expect(m.importiCompleti).toBe(false);
    expect(m.scontrini).toBe(40);
    expect(m.scontriniConImporti).toBe(10);
    expect(derivate(m).scontrinoMedio).toBeCloseTo(100);
  });
  it('variazione', () => {
    expect(variazione(110, 100)).toBeCloseTo(10);
    expect(variazione(5, 0)).toBeNull();
    expect(variazione(null, 3)).toBeNull();
  });
});

describe('perche\' sono cambiate le vendite', () => {
  it('traffico, conversione e scontrino sommati danno la differenza esatta', () => {
    const prima = somma([g('2025-10-01', 1000, 80, [150, 12000, 6400, 2500])]); // scontrino 80
    const ora = somma([g('2026-10-01', 1100, 99, [180, 14000, 7920, 3000])]); // scontrino 80
    const s = scomponi(prima, ora)!;
    expect(s.base).toBe('vendite');
    expect(s.traffico + s.conversione + s.scontrino).toBeCloseTo(7920 - 6400);
    expect(s.traffico).toBeCloseTo(100 * 0.08 * 80);
    expect(s.scontrino).toBeCloseTo(0);
  });
  it('senza importi si scompongono gli scontrini', () => {
    const s = scomponi(somma([g('2025-10-01', 1000, 70)]), somma([g('2026-10-01', 900, 90)]))!;
    expect(s.base).toBe('scontrini');
    expect(s.traffico + s.conversione).toBeCloseTo(20);
    expect(s.traffico).toBeCloseTo(-7);
  });
  it('manca un periodo: niente scomposizione', () => {
    expect(scomponi(somma([]), somma([g('2026-10-01', 10, 1)]))).toBeNull();
  });
});

describe('periodi e quadratura', () => {
  it('mese prima e stesso mese dell\'anno prima', () => {
    expect(mesePrima('2026-01')).toBe('2025-12');
    expect(mesePrima('2026-10')).toBe('2026-09');
    expect(meseAnnoPrima('2026-10')).toBe('2025-10');
  });
  it('confronta solo i giorni che il mese in corso ha gia\'', () => {
    const giorni = [g('2026-11-01', 1, 0), g('2026-11-03', 1, 0), g('2025-11-02', 5, 1), g('2025-11-20', 9, 1), g('2025-11-02', 5, 1, undefined, 'b')];
    expect(ultimoGiorno(giorni, '2026-11')).toBe(3);
    expect(giorniDel(giorni, '2025-11', 3).map((x) => x.data)).toEqual(['2025-11-02', '2025-11-02']);
    expect(giorniDel(giorni, '2025-11', 31, new Set(['b']))).toHaveLength(1);
  });
  it('scarto con la cassa', () => {
    expect(scartoCassa(1000, 992, true)).toBeCloseTo(0.8);
    expect(scartoCassa(undefined, 992, true)).toBeNull();
    expect(scartoCassa(1000, 992, false)).toBeNull();
  });
  it('ore per giorno della settimana', () => {
    const ore = [
      { outletId: 'a', giornoSett: 6, ora: 15, ingressi: 50, scontrini: 3, reale: 0 },
      { outletId: 'b', giornoSett: 6, ora: 15, ingressi: 30, scontrini: 2, reale: 0 },
      { outletId: 'a', giornoSett: 6, ora: 9, ingressi: 0, scontrini: 1, reale: 0 },
      { outletId: 'a', giornoSett: 1, ora: 19, ingressi: 4, scontrini: 1, reale: 0 },
    ];
    expect(mappaOre(ore).get('6|15')).toEqual({ ingressi: 80, scontrini: 5 });
    expect(mappaOre(ore, new Set(['b'])).get('6|15')).toEqual({ ingressi: 30, scontrini: 2 });
    // le 9 hanno uno scontrino ma nessun ingresso: non allargano la mappa
    expect(oreAperte(ore)).toEqual([15, 16, 17, 18, 19]);
  });
});

describe('confronti alla pari (migration 465)', () => {
  it('l\'anno prima e\' lo stesso giorno della settimana, 52 settimane prima', () => {
    // 1-3/11/2026 domenica-martedi' contro 2-4/11/2025 domenica-martedi'
    expect(spostaGiorni('2026-11-01', -364)).toBe('2025-11-02');
    expect(new Date('2025-11-02T00:00:00Z').getUTCDay()).toBe(new Date('2026-11-01T00:00:00Z').getUTCDay());
    const tutti = [g('2025-11-01', 1142, 82), g('2025-11-02', 752, 49), g('2025-11-03', 86, 5), g('2025-11-04', 77, 7), g('2025-11-02', 9, 1, undefined, 'b')];
    const periodo = [g('2026-11-01', 618, 58), g('2026-11-02', 106, 7), g('2026-11-03', 38, 6)];
    expect(giorniAnnoPrima(tutti, periodo).map((x) => x.data)).toEqual(['2025-11-02', '2025-11-03', '2025-11-04']);
  });
  it('la cassa si confronta solo sui giorni che hanno tutti e due, stesso negozio', () => {
    const cassa = new Map([['a|2026-11-01', 5000], ['a|2026-11-02', 500], ['a|2026-11-20', 9000]]);
    const imp = (r: number): [number, number, number, number] => [1, r * 2, r, r / 3];
    // il 3 non ha la chiusura e il negozio b non ne ha nessuna: restano fuori da tutte e due le somme
    const c = confrontoCassa(cassa, [g('2026-11-01', 1, 1, imp(4960)), g('2026-11-02', 1, 1, imp(495)), g('2026-11-03', 1, 1, imp(450)), g('2026-11-01', 1, 1, imp(800), 'b')])!;
    expect(c).toEqual({ cassa: 5500, moda: 5455, giorni: 2, giorniModa: 4 });
    expect(scartoDi(c)).toBeCloseTo((45 / 5500) * 100);
    expect(confrontoCassa(cassa, [g('2026-11-05', 1, 1, imp(10))])).toBeNull();
  });
});
