import { describe, expect, it } from 'vitest';
import { applicaServizi, aperturaConPulizie, consegneDelPeriodo, pulizieDelGiorno, scaricoDelGiorno, type ServiziNegozio } from './serviziNegozio';
import type { GiornoPiano } from './turni';

// Valmontone (Patrizio, 26/11/2026): scarico il martedì 10-12 con due persone, pulizie lunedì e venerdì 9-10
const VALMONTONE: ServiziNegozio = {
  ricorrenti: [
    { tipo: 'scarico', giorno: 2, dalle: '10:00', alle: '12:00', persone: 2 },
    { tipo: 'pulizie', giorno: 1, dalle: '09:00', alle: '10:00', persone: 1 },
    { tipo: 'pulizie', giorno: 5, dalle: '09:00', alle: '10:00', persone: 1 },
  ],
  consegne: [
    { data: '2026-12-08', dalle: null, alle: null, persone: null, annullata: true, nota: 'Immacolata' },
    { data: '2026-12-16', dalle: '14:00', alle: '15:30', persone: null, annullata: false, nota: 'spostata' },
  ],
};

// Un feriale 10-20 come lo lascia fabbisognoDaTraffico: una persona la prima e l'ultima ora, due nel resto
const feriale = (data: string): GiornoPiano => {
  const minimo = [1, 1, ...Array(16).fill(2), 1, 1];
  return { data, giorno: 2, chiuso: false, apre: 600, chiude: 1200, fabbisogno: [...minimo], minimo: [...minimo], esatto: [1, 1, 1.4, 1.4, ...Array(14).fill(2), 1, 1], esigenza: [...minimo], nota: null, speciale: false };
};

describe('scarico merce', () => {
  it('martedì alla consegna abituale: due persone dall\'apertura per due ore', () => {
    const g = applicaServizi(feriale('2026-12-01'), VALMONTONE);
    expect(g.scarico).toEqual({ dalle: 600, alle: 720, persone: 2 });
    expect(g.minimo!.slice(0, 4)).toEqual([2, 2, 2, 2]);
    expect(g.fabbisogno.slice(0, 4)).toEqual([2, 2, 2, 2]);
    expect(g.esatto!.slice(0, 4)).toEqual([2, 2, 2, 2]);
    // fuori dallo scarico niente cambia
    expect(g.minimo!.slice(4)).toEqual(feriale('2026-12-01').minimo!.slice(4));
  });

  it('se le persone ci sono già non si aggiunge niente', () => {
    const base = feriale('2026-12-01');
    const tre = { ...base, fabbisogno: base.fabbisogno.map(() => 3) };
    expect(applicaServizi(tre, VALMONTONE).fabbisogno.slice(0, 4)).toEqual([3, 3, 3, 3]);
  });

  it('la consegna annullata nel calendario non chiede nessuno', () => {
    expect(scaricoDelGiorno('2026-12-08', VALMONTONE)).toBeNull();
    const g = applicaServizi(feriale('2026-12-08'), VALMONTONE);
    expect(g.scarico).toBeUndefined();
    expect(g.minimo!.slice(0, 2)).toEqual([1, 1]);
  });

  it('consegna spostata a un altro giorno e ora: persone dalla consegna abituale', () => {
    expect(scaricoDelGiorno('2026-12-16', VALMONTONE)).toMatchObject({ dalle: 840, alle: 930, persone: 2 });
    const g = applicaServizi({ ...feriale('2026-12-16'), giorno: 3 }, VALMONTONE);
    // 14:00-15:30 = mezz'ore 8, 9, 10: erano già 2, restano 2
    expect(g.scarico).toEqual({ dalle: 840, alle: 930, persone: 2 });
  });

  it('nessuna regola nella chiusura di metà giornata', () => {
    const g = applicaServizi({ ...feriale('2026-12-01'), chiusura: { dalle: 630, alle: 690 }, minimo: feriale('2026-12-01').minimo!.map((x, i) => (i === 1 || i === 2 ? 0 : x)) }, VALMONTONE);
    expect(g.minimo!.slice(0, 4)).toEqual([2, 0, 0, 2]);
  });

  it('idempotente: due passaggi danno lo stesso giorno', () => {
    const una = applicaServizi(feriale('2026-12-01'), VALMONTONE);
    expect(applicaServizi(una, VALMONTONE)).toBe(una);
  });
});

describe('pulizie prima dell\'apertura', () => {
  it('lunedì il giorno comincia alle 9 con una persona, la vendita resta alle 10', () => {
    const g = applicaServizi({ ...feriale('2026-11-30'), giorno: 1 }, VALMONTONE);
    expect(g.apre).toBe(540);
    expect(g.apreVendita).toBe(600);
    expect(g.pulizie).toEqual({ dalle: 540, alle: 600, persone: 1 });
    expect(g.fabbisogno.length).toBe(22);
    expect(g.fabbisogno.slice(0, 3)).toEqual([1, 1, 1]);
    expect(g.minimo!.slice(0, 2)).toEqual([1, 1]);
    // le pulizie non sono traffico: niente ore sotto MODA
    expect(g.esatto!.slice(0, 2)).toEqual([0, 0]);
    // la regola delle due persone resta misurata sull'apertura vera: dalle 11 due persone
    expect(g.minimo!.slice(2, 6)).toEqual([1, 1, 2, 2]);
  });

  it('martedì niente pulizie', () => {
    expect(pulizieDelGiorno('2026-12-01', VALMONTONE)).toBeNull();
    expect(applicaServizi(feriale('2026-12-01'), VALMONTONE).apre).toBe(600);
  });

  it('il turno si può mettere dalle pulizie', () => {
    expect(aperturaConPulizie('2026-12-04', 600, VALMONTONE)).toBe(540);
    expect(aperturaConPulizie('2026-12-03', 600, VALMONTONE)).toBe(600);
  });

  it('senza servizi tutto come prima', () => {
    const g = feriale('2026-11-30');
    expect(applicaServizi(g, null)).toBe(g);
  });
});

describe('calendario', () => {
  it('le consegne del periodo: abituali, annullate e spostate', () => {
    const el = consegneDelPeriodo('2026-12-01', '2026-12-16', VALMONTONE);
    expect(el.map((x) => [x.data, x.abituale, !!x.finestra])).toEqual([
      ['2026-12-01', true, true],
      ['2026-12-08', false, false],
      ['2026-12-15', true, true],
      ['2026-12-16', false, true],
    ]);
  });
});

// Il motore vero (pianificaMese): martedì con lo scarico coperto da due persone, lunedì e venerdì un turno dalle 9
import { pianificaMese } from './pianoMensile';
import { costruisciGiorni, REGOLE_DEFAULT, hhmm } from './turni';

describe('il piano del mese con i servizi', () => {
  const orari = [1, 2, 3, 4, 5, 6, 7].map((g) => ({ giorno: g, chiuso: false, apre: '10:00', chiude: g >= 6 ? '21:00' : '20:00' }));
  const tutte = Array.from({ length: 35 }, (_, i) => { const d = new Date('2026-11-30T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); });
  const giorni = costruisciGiorni(tutte, orari, [], []);
  // traffico basso la mattina: MODA da solo chiederebbe una persona alle 10
  const atteso = new Map(tutte.map((d) => [d, Array.from({ length: 24 }, (_, h) => (h === 10 ? 20 : h > 10 && h < 21 ? 40 : 0))]));
  const persone = [36, 30, 25, 35, 30].map((ore, i) => ({ id: `p${i}`, oreSettimana: ore, nonDisponibile: new Set<string>(), oreFerie: new Map<string, number>() }));
  const regole = { ...REGOLE_DEFAULT, pausaMinuti: 30, pausaLungaMinuti: 30, servizi: VALMONTONE };

  it('martedì due persone dalle 10 alle 12, lunedì e venerdì qualcuno dalle 9', () => {
    const e = pianificaMese({ mese: '2026-12', giorni, persone, regola: 'nessuno', storicoWeekend: new Map(), atteso, regole });
    for (const mar of ['2026-12-01', '2026-12-15', '2026-12-22', '2026-12-29']) {
      const n = (s: number) => e.turni.filter((x) => x.data === mar && x.inizio <= hhmm(s) && x.fine >= hhmm(s + 30)).length;
      for (const s of [600, 630, 660, 690]) expect(n(s), `${mar} ${hhmm(s)}`).toBeGreaterThanOrEqual(2);
    }
    for (const d of ['2026-12-04', '2026-12-07', '2026-12-11', '2026-12-14']) {
      expect(e.turni.some((x) => x.data === d && x.inizio === '09:00')).toBe(true);
    }
    // l'8/12 la consegna è annullata: nessun obbligo, e nessun turno prima delle 10 il martedì
    expect(e.turni.some((x) => x.inizio < '10:00' && new Date(`${x.data}T00:00:00Z`).getUTCDay() === 2)).toBe(false);
  }, 60_000);
});

// Persone dedicate e tetto di persone nella giornata (Patrizio, 26/11/2026, migration 475).
// Caso di Roma Soratte: martedì 2 persone dalle 10 alle 18 (scarico 10-12 + fasce), Tania (p0)
// non riposa mai il martedì, Maria (p2) è dedicata allo scarico, al massimo 2 persone nella giornata.
describe('persone dedicate e tetto della giornata', () => {
  const orari = [1, 2, 3, 4, 5, 6, 7].map((g) => ({ giorno: g, chiuso: false, apre: '10:00', chiude: g >= 6 ? '21:00' : '20:00' }));
  const fasce = [2].flatMap((g) => [
    { giorno: g, dalle: '10:00', alle: '12:00', persone: 1, origine: 'manuale' },
    { giorno: g, dalle: '12:00', alle: '18:00', persone: 2, origine: 'manuale' },
    { giorno: g, dalle: '18:00', alle: '20:00', persone: 1, origine: 'manuale' },
  ]);
  const tutte = Array.from({ length: 35 }, (_, i) => { const d = new Date('2026-11-30T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); });
  const giorni = costruisciGiorni(tutte, orari, fasce, []);
  const atteso = new Map(tutte.map((d) => [d, Array.from({ length: 24 }, (_, h) => (h >= 10 && h < 21 ? 30 : 0))]));
  const persone = [40, 30, 30, 30].map((ore, i) => ({ id: `p${i}`, oreSettimana: ore, nonDisponibile: new Set<string>(), oreFerie: new Map<string, number>() }));
  const servizi: ServiziNegozio = {
    ricorrenti: [{ tipo: 'scarico', giorno: 2, dalle: '10:00', alle: '12:00', persone: 2, dedicate: ['p2'] }],
    consegne: [],
    tetto: { persone: 2, giorni: [2] },
  };
  const regole = { ...REGOLE_DEFAULT, pausaMinuti: 30, pausaLungaMinuti: 30, duePersone: false, servizi };
  const nuove = { riposi: { mai: new Map([['p0', [2]]]) } };
  const martedi = ['2026-12-01', '2026-12-15', '2026-12-22', '2026-12-29'];

  it('Tania c\'è, la dedicata fa lo scarico, al massimo due persone e una sola volta il peso di Tania', () => {
    const e = pianificaMese({ mese: '2026-12', giorni, persone, regola: 'nessuno', storicoWeekend: new Map(), atteso, regole, nuove });
    let conDedicata = 0;
    for (const mar of martedi) {
      const t = e.turni.filter((x) => x.data === mar);
      const chi = new Set(t.map((x) => x.employeeId));
      expect(chi.has('p0'), `${mar} Tania`).toBe(true);
      expect(chi.size, `${mar} persone diverse: ${t.map((x) => `${x.employeeId} ${x.inizio}-${x.fine}`).join(', ')}`).toBeLessThanOrEqual(2);
      if (t.some((x) => x.employeeId === 'p2' && x.inizio <= '10:00')) conDedicata += 1;
      // due persone dalle 10 alle 12 per lo scarico
      for (const s of [600, 630, 660, 690]) expect(t.filter((x) => x.inizio <= hhmm(s) && x.fine >= hhmm(s + 30)).length).toBeGreaterThanOrEqual(2);
    }
    // la dedicata c'è almeno nella maggior parte dei martedì (le ore della settimana possono non bastare)
    expect(conDedicata).toBeGreaterThanOrEqual(3);
  }, 90_000);
});

describe('dove vale il tetto della giornata', () => {
  const conTetto: ServiziNegozio = { ricorrenti: [], consegne: [], tetto: { persone: 2, giorni: [1, 2, 3, 4, 5, 6, 7] } };
  it('vale in un feriale normale', () => {
    expect(applicaServizi(feriale('2026-12-01'), conTetto).tettoPersone).toBe(2);
  });
  it('non vale nei giorni caldi, con tutte al lavoro, negli eventi, nel lunedì a due e nei festivi', () => {
    expect(applicaServizi({ ...feriale('2026-12-01'), caldo: true }, conTetto).tettoPersone).toBeUndefined();
    expect(applicaServizi({ ...feriale('2026-12-01'), tutti: true }, conTetto).tettoPersone).toBeUndefined();
    expect(applicaServizi({ ...feriale('2026-12-01'), evento: 'Black Friday' }, conTetto).tettoPersone).toBeUndefined();
    expect(applicaServizi({ ...feriale('2026-11-30'), giorno: 1, lunediDue: true }, conTetto).tettoPersone).toBeUndefined();
    expect(applicaServizi(feriale('2026-12-08'), conTetto).tettoPersone).toBeUndefined();
  });
  it('non vale nei giorni non scelti', () => {
    expect(applicaServizi(feriale('2026-12-01'), { ...conTetto, tetto: { persone: 2, giorni: [3] } }).tettoPersone).toBeUndefined();
  });
});
