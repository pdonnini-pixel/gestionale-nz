import { describe, it, expect } from 'vitest';
import { ultimoMeseConDati, ultimoAnnoConDati, ultimaData, etichettaMese, dataIt } from './periodoVuoto';

describe('periodoVuoto', () => {
  it('ultimoMeseConDati prende il mese più recente, anche a cavallo di anni', () => {
    const r = [{ year: 2025, month: 12 }, { year: 2026, month: 10 }, { year: 2026, month: 3 }];
    expect(ultimoMeseConDati(r)).toEqual({ year: 2026, month: 10 });
  });

  it('ultimoMeseConDati salta il mese a video e le righe non valide', () => {
    const r = [{ year: 2026, month: 10 }, { year: 2026, month: 9 }, { year: null, month: 11 }, { year: 2026, month: 13 }];
    expect(ultimoMeseConDati(r, { year: 2026, month: 10 })).toEqual({ year: 2026, month: 9 });
    expect(ultimoMeseConDati([])).toBeNull();
    expect(ultimoMeseConDati([{ year: 2026, month: 10 }], { year: 2026, month: 10 })).toBeNull();
  });

  it('ultimoAnnoConDati ignora l\'anno a video', () => {
    expect(ultimoAnnoConDati([2024, 2026, null, 2025], 2026)).toBe(2025);
    expect(ultimoAnnoConDati([2026], 2026)).toBeNull();
    expect(ultimoAnnoConDati([])).toBeNull();
  });

  it('ultimaData trova la più recente, anche solo prima di una data', () => {
    const d = ['2026-10-03', '2026-11-10T08:00:00', null, 'x', '2026-09-30'];
    expect(ultimaData(d)).toBe('2026-11-10');
    expect(ultimaData(d, '2026-10-17')).toBe('2026-10-03');
    expect(ultimaData([], '2026-10-17')).toBeNull();
  });

  it('etichette in italiano', () => {
    expect(etichettaMese({ year: 2026, month: 10 })).toBe('ottobre 2026');
    expect(dataIt('2026-10-31')).toBe('31/10/2026');
  });
});
