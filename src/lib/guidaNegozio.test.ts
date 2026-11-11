import { describe, expect, it } from 'vitest';
import {
  cosaMancaAllaGuida, eLunedi, etichettaRuoloGuida, guidaIncompleta,
  lunediScopertiDaAssenze, lunediSenzaGuida, ruoloGuida,
} from './guidaNegozio';

const RESP = 'resp';
const VICE = 'vice';
const ALTRA = 'altra';

// Novembre 2026: lunedi' 2, 9, 16, 23, 30.
const settimana = (lunedi: number): string[] =>
  Array.from({ length: 7 }, (_, i) => `2026-11-${String(lunedi + i).padStart(2, '0')}`);
const novembre = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);

describe('eLunedi', () => {
  it('riconosce i lunedì', () => {
    expect(eLunedi('2026-11-16')).toBe(true);
    expect(eLunedi('2026-11-09')).toBe(true);
    expect(eLunedi('2027-01-04')).toBe(true);
  });
  it('gli altri giorni no', () => {
    expect(eLunedi('2026-11-15')).toBe(false); // domenica
    expect(eLunedi('2026-11-17')).toBe(false); // martedì
  });
  it('una data scritta male non è un lunedì', () => {
    expect(eLunedi('')).toBe(false);
    expect(eLunedi('16/11/2026')).toBe(false);
    expect(eLunedi('2026-02-31')).toBe(false);
    expect(eLunedi('2026-11-16T10:00:00')).toBe(false);
  });
});

describe('ruoloGuida ed etichetta', () => {
  it('dice chi è responsabile, chi vice e chi nessuna delle due', () => {
    expect(ruoloGuida(RESP, RESP, VICE)).toBe('responsabile');
    expect(ruoloGuida(VICE, RESP, VICE)).toBe('vice');
    expect(ruoloGuida(ALTRA, RESP, VICE)).toBeNull();
    expect(ruoloGuida(null, RESP, VICE)).toBeNull();
    expect(ruoloGuida(ALTRA, null, undefined)).toBeNull();
  });
  it('se per errore è tutte e due, vale responsabile', () => {
    expect(ruoloGuida(RESP, RESP, RESP)).toBe('responsabile');
  });
  it('etichette', () => {
    expect(etichettaRuoloGuida('responsabile')).toBe('Responsabile');
    expect(etichettaRuoloGuida('vice')).toBe('Vice responsabile');
    expect(etichettaRuoloGuida(null)).toBeNull();
  });
});

describe('guidaIncompleta', () => {
  it('completa solo con due persone diverse', () => {
    expect(guidaIncompleta(RESP, VICE)).toBe(false);
    expect(guidaIncompleta(RESP, null)).toBe(true);
    expect(guidaIncompleta(null, VICE)).toBe(true);
    expect(guidaIncompleta(undefined, undefined)).toBe(true);
    expect(guidaIncompleta('', VICE)).toBe(true);
    expect(guidaIncompleta(RESP, RESP)).toBe(true);
  });
  it('dice cosa manca', () => {
    expect(cosaMancaAllaGuida(RESP, VICE)).toBeNull();
    expect(cosaMancaAllaGuida(RESP, null)).toBe('Manca il vice responsabile');
    expect(cosaMancaAllaGuida(null, VICE)).toBe('Manca la responsabile');
    expect(cosaMancaAllaGuida(null, null)).toBe('Mancano la responsabile e il vice responsabile');
    expect(cosaMancaAllaGuida(RESP, RESP)).toBe('Responsabile e vice sono la stessa persona');
  });
});

describe('lunediSenzaGuida', () => {
  it('lunedì con la responsabile in turno: a posto', () => {
    expect(lunediSenzaGuida({
      date: settimana(16), responsabileId: RESP, viceId: VICE,
      turni: [{ employeeId: RESP, data: '2026-11-16' }],
    })).toEqual([]);
  });
  it('lunedì con la sola vice in turno: a posto', () => {
    expect(lunediSenzaGuida({
      date: settimana(16), responsabileId: RESP, viceId: VICE,
      turni: [{ employeeId: VICE, data: '2026-11-16' }, { employeeId: ALTRA, data: '2026-11-16' }],
    })).toEqual([]);
  });
  it('lunedì in cui lavorano solo le altre: segnalato', () => {
    expect(lunediSenzaGuida({
      date: settimana(16), responsabileId: RESP, viceId: VICE,
      turni: [
        { employeeId: ALTRA, data: '2026-11-16' },
        { employeeId: RESP, data: '2026-11-17' },
        { employeeId: VICE, data: '2026-11-18' },
      ],
    })).toEqual(['2026-11-16']);
  });
  it('lunedì senza nessun turno: segnalato', () => {
    expect(lunediSenzaGuida({ date: settimana(16), responsabileId: RESP, viceId: VICE, turni: [] }))
      .toEqual(['2026-11-16']);
  });
  it('un mese intero: solo i lunedì scoperti, in ordine', () => {
    expect(lunediSenzaGuida({
      date: [...novembre].reverse(), responsabileId: RESP, viceId: VICE,
      turni: [
        { employeeId: RESP, data: '2026-11-02' },
        { employeeId: VICE, data: '2026-11-16' },
        { employeeId: RESP, data: '2026-11-30' },
        { employeeId: VICE, data: '2026-11-30' },
        // turni di altri giorni non coprono il lunedì
        { employeeId: RESP, data: '2026-11-10' },
        { employeeId: VICE, data: '2026-11-22' },
      ],
    })).toEqual(['2026-11-09', '2026-11-23']);
  });
  it('il lunedì chiuso non si segnala', () => {
    expect(lunediSenzaGuida({
      date: novembre, responsabileId: RESP, viceId: VICE, turni: [],
      chiusi: ['2026-11-09', '2026-11-23'],
    })).toEqual(['2026-11-02', '2026-11-16', '2026-11-30']);
  });
  it('le date ripetute contano una volta', () => {
    expect(lunediSenzaGuida({
      date: ['2026-11-16', '2026-11-16', '2026-11-17'], responsabileId: RESP, viceId: VICE, turni: [],
    })).toEqual(['2026-11-16']);
  });
  it('se manca una delle due figure la regola non si applica', () => {
    expect(lunediSenzaGuida({ date: novembre, responsabileId: RESP, viceId: null, turni: [] })).toEqual([]);
    expect(lunediSenzaGuida({ date: novembre, responsabileId: null, viceId: VICE, turni: [] })).toEqual([]);
    expect(lunediSenzaGuida({ date: novembre, responsabileId: undefined, viceId: undefined, turni: [] })).toEqual([]);
    expect(lunediSenzaGuida({ date: novembre, responsabileId: RESP, viceId: RESP, turni: [] })).toEqual([]);
  });
  it('senza lunedì fra le date non segnala niente', () => {
    expect(lunediSenzaGuida({
      date: ['2026-11-17', '2026-11-18', '2026-11-22'], responsabileId: RESP, viceId: VICE, turni: [],
    })).toEqual([]);
  });
  it('non cambia gli argomenti', () => {
    const date = ['2026-11-23', '2026-11-16'];
    const turni = [{ employeeId: ALTRA, data: '2026-11-16' }];
    lunediSenzaGuida({ date, responsabileId: RESP, viceId: VICE, turni });
    expect(date).toEqual(['2026-11-23', '2026-11-16']);
    expect(turni).toEqual([{ employeeId: ALTRA, data: '2026-11-16' }]);
  });
});

describe('lunediScopertiDaAssenze', () => {
  it('assenti tutte e due lo stesso lunedì: segnalato', () => {
    expect(lunediScopertiDaAssenze({
      date: novembre, responsabileId: RESP, viceId: VICE,
      assenze: [
        { employeeId: RESP, data: '2026-11-16' },
        { employeeId: VICE, data: '2026-11-16' },
      ],
    })).toEqual(['2026-11-16']);
  });
  it('assente una sola: a posto', () => {
    expect(lunediScopertiDaAssenze({
      date: novembre, responsabileId: RESP, viceId: VICE,
      assenze: [
        { employeeId: RESP, data: '2026-11-16' },
        { employeeId: VICE, data: '2026-11-23' },
        { employeeId: ALTRA, data: '2026-11-16' },
      ],
    })).toEqual([]);
  });
  it('assenti insieme ma non di lunedì: a posto', () => {
    expect(lunediScopertiDaAssenze({
      date: novembre, responsabileId: RESP, viceId: VICE,
      assenze: [
        { employeeId: RESP, data: '2026-11-17' },
        { employeeId: VICE, data: '2026-11-17' },
      ],
    })).toEqual([]);
  });
  it('due settimane di assenza in comune: tutti i lunedì dentro', () => {
    const giorni = [...settimana(9), ...settimana(16)];
    expect(lunediScopertiDaAssenze({
      date: novembre, responsabileId: RESP, viceId: VICE,
      assenze: [
        ...giorni.map((data) => ({ employeeId: RESP, data })),
        ...giorni.slice(3).map((data) => ({ employeeId: VICE, data })),
      ],
    })).toEqual(['2026-11-16']);
  });
  it('lunedì chiuso o fuori dalle date guardate: non segnalato', () => {
    const assenze = [
      { employeeId: RESP, data: '2026-11-16' }, { employeeId: VICE, data: '2026-11-16' },
      { employeeId: RESP, data: '2026-11-23' }, { employeeId: VICE, data: '2026-11-23' },
    ];
    expect(lunediScopertiDaAssenze({
      date: settimana(16), responsabileId: RESP, viceId: VICE, assenze,
    })).toEqual(['2026-11-16']);
    expect(lunediScopertiDaAssenze({
      date: novembre, responsabileId: RESP, viceId: VICE, assenze, chiusi: ['2026-11-16'],
    })).toEqual(['2026-11-23']);
  });
  it('se manca una delle due figure la regola non si applica', () => {
    const assenze = [{ employeeId: RESP, data: '2026-11-16' }];
    expect(lunediScopertiDaAssenze({ date: novembre, responsabileId: RESP, viceId: null, assenze })).toEqual([]);
    expect(lunediScopertiDaAssenze({ date: novembre, responsabileId: null, viceId: VICE, assenze })).toEqual([]);
  });
});
