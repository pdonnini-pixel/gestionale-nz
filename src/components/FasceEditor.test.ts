import { describe, it, expect } from 'vitest';
import { pezziGiornata } from './FasceEditor';

describe('pezziGiornata: la barra della giornata con i buchi', () => {
  it('fasce che coprono tutta la giornata: nessun buco', () => {
    const p = pezziGiornata([{ dalle: '10:00', alle: '10:30', persone: 1 }, { dalle: '10:30', alle: '11:00', persone: 2 }, { dalle: '11:00', alle: '19:00', persone: 4 }, { dalle: '19:00', alle: '20:00', persone: 1 }], '10:00', '20:00');
    expect(p.map((x) => x.persone)).toEqual([1, 2, 4, 1]);
    expect(p.reduce((s, x) => s + x.a - x.da, 0)).toBe(600);
  });
  it('un pezzo di orario senza fascia è un buco, in mezzo o in fondo', () => {
    const p = pezziGiornata([{ dalle: '10:00', alle: '12:00', persone: 1 }, { dalle: '14:00', alle: '18:00', persone: 2 }], '10:00', '20:00');
    expect(p.map((x) => x.persone)).toEqual([1, null, 2, null]);
  });
  it('fasce fuori dall\'orario si tagliano; orario non valido o fasce rovesciate non danno pezzi', () => {
    expect(pezziGiornata([{ dalle: '09:00', alle: '21:00', persone: 3 }], '10:00', '20:00')).toEqual([{ da: 600, a: 1200, persone: 3 }]);
    expect(pezziGiornata([{ dalle: '12:00', alle: '11:00', persone: 3 }], '10:00', '20:00')).toEqual([{ da: 600, a: 1200, persone: null }]);
    expect(pezziGiornata([], '', '20:00')).toEqual([]);
  });
});
