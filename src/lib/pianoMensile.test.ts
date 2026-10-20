import { describe, it, expect } from 'vitest';
import {
  blackFriday, tipoDelGiorno, storicoTraffico, trafficoAtteso, fabbisognoDaTraffico, assegnaWeekendLiberi,
  personeMinime, pianificaMese, type RigaTraffico,
} from './pianoMensile';
import { costruisciGiorni, giorniDellaSettimana, lunediDi, oreLavorate } from './turni';

const orari = [1, 2, 3, 4, 5, 6, 7].map((g) => ({ giorno: g, chiuso: false, apre: '10:00', chiude: '20:00' }));
const date = (dal: string, n: number) => Array.from({ length: n }, (_, i) => {
  const d = new Date(`${dal}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10);
});

describe('tipo di giorno dal calendario', () => {
  it('Black Friday: ultimo venerdì di novembre', () => {
    expect(blackFriday(2025)).toBe('2025-11-28');
    expect(blackFriday(2026)).toBe('2026-11-27');
  });
  it('i giorni speciali si riconoscono da soli anno per anno', () => {
    expect(tipoDelGiorno('2026-11-27').tipo).toBe('black_friday');
    expect(tipoDelGiorno('2026-11-28').tipo).toBe('bf_weekend');
    expect(tipoDelGiorno('2026-11-29').tipo).toBe('bf_weekend');
    expect(tipoDelGiorno('2026-12-08')).toEqual({ tipo: 'festivo', nome: 'Immacolata' }); // martedì
    expect(tipoDelGiorno('2026-12-07').tipo).toBe('feriale'); // il ponte non ha storia: resta un lunedì
    expect(tipoDelGiorno('2026-12-24').tipo).toBe('vigilia');
    expect(tipoDelGiorno('2026-12-22').tipo).toBe('natale_feriale');
    expect(tipoDelGiorno('2026-12-26').tipo).toBe('festivo'); // Santo Stefano di sabato
    expect(tipoDelGiorno('2026-11-06').tipo).toBe('venerdi');
    expect(tipoDelGiorno('2026-11-01').tipo).toBe('domenica'); // Ognissanti di domenica
  });
});

describe('traffico atteso dalla storia', () => {
  // Novembre 2025: feriali 10 ingressi l'ora, sabati 40, Black Friday 80.
  const righe: RigaTraffico[] = date('2025-11-01', 30).flatMap((d) => {
    const t = tipoDelGiorno(d).tipo;
    const v = t === 'black_friday' ? 80 : t === 'sabato' || t === 'bf_weekend' ? 40 : t === 'domenica' ? 50 : 10;
    return [10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map((ora) => ({ data: d, ora, ingressi: v }));
  });
  const st = storicoTraffico(righe);
  it('stesso tipo e stesso mese', () => {
    expect(trafficoAtteso(st, '2026-11-14')!.ore[12]).toBe(40);
    expect(trafficoAtteso(st, '2026-11-27')!.ore[12]).toBe(80); // il Black Friday vale il suo, non un sabato
  });
  it('senza storia del mese usa tutta la storia del tipo', () => {
    expect(trafficoAtteso(st, '2027-03-13')!.ore[12]).toBe(40);
  });
  it('un negozio senza storia non ha traffico', () => {
    expect(trafficoAtteso(storicoTraffico([]), '2026-11-14')).toBeNull();
  });
});

describe('fabbisogno dal traffico, senza obiettivi', () => {
  const sett = giorniDellaSettimana('2026-11-09');
  const giorni = costruisciGiorni(sett, orari, [], []);
  const atteso = new Map(sett.map((d) => [d, Array.from({ length: 24 }, (_, h) => (h >= 10 && h < 20 ? (giorniDellaSettimana('2026-11-09').indexOf(d) >= 5 ? 40 : 10) * (h >= 15 && h < 18 ? 2 : 1) : 0))]));
  const maxP = new Map(sett.map((d) => [d, 4]));
  it('usa le ore che ci sono, almeno una persona, di più dove c\'è più gente', () => {
    const f = fabbisognoDaTraffico(giorni, atteso, 120, maxP);
    const ore = f.reduce((s, g) => s + g.fabbisogno.reduce((a, b) => a + b, 0) / 2, 0);
    expect(ore).toBeLessThanOrEqual(120);
    expect(ore).toBeGreaterThan(100);
    for (const g of f) expect(Math.min(...g.fabbisogno)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...f[5].fabbisogno)).toBeGreaterThan(Math.max(...f[0].fabbisogno)); // sabato > lunedì
    expect(Math.max(...f[5].fabbisogno)).toBeLessThanOrEqual(4);
  });
});

describe('sabati e domeniche liberi a rotazione', () => {
  const mese = date('2026-11-01', 30);
  const fasce = [6, 7].map((g) => ({ giorno: g, dalle: '10:00', alle: '20:00', persone: 2 }))
    .concat([1, 2, 3, 4, 5].map((g) => ({ giorno: g, dalle: '10:00', alle: '20:00', persone: 1 })));
  const giorni = costruisciGiorni(mese, orari, fasce, []);
  const persone = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, disponibile: () => true }));
  it('equo: uno a testa nel mese, quando possibile', () => {
    // sabato e domenica servono 4 persone (2 aprono, 2 chiudono): con 5 ne avanza una al giorno
    expect(personeMinime(giorni.find((g) => g.data === '2026-11-07')!)).toBe(4);
    const lib = assegnaWeekendLiberi({ giorni, persone, regola: 'sabato_o_domenica', storico: new Map() });
    const conta = new Map<string, number>();
    for (const ids of lib.values()) for (const id of ids) conta.set(id, (conta.get(id) ?? 0) + 1);
    expect(persone.every((p) => conta.get(p.id) === 1)).toBe(true);
    for (const lun of new Set(mese.map(lunediDi))) {
      const [sab, dom] = giorniDellaSettimana(lun).slice(5);
      const due = (lib.get(sab) ?? []).filter((id) => (lib.get(dom) ?? []).includes(id));
      expect(due).toEqual([]);
    }
  });
  it('solo sabati, solo domeniche, nessuno', () => {
    const sab = assegnaWeekendLiberi({ giorni, persone, regola: 'solo_sabati', storico: new Map() });
    expect([...sab.keys()].every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 6)).toBe(true);
    const dom = assegnaWeekendLiberi({ giorni, persone, regola: 'solo_domeniche', storico: new Map() });
    expect([...dom.keys()].every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0)).toBe(true);
    expect(assegnaWeekendLiberi({ giorni, persone, regola: 'nessuno', storico: new Map() }).size).toBe(0);
  });
  it('lo storico conta: chi ne ha avuti meno parte avanti', () => {
    const lib = assegnaWeekendLiberi({ giorni, persone, regola: 'solo_sabati', storico: new Map([['a', 5], ['b', 5], ['c', 5], ['d', 5]]) });
    expect(lib.get('2026-11-07')).toEqual(['e']);
  });
  it('nei giorni degli eventi nessun libero', () => {
    const lib = assegnaWeekendLiberi({ giorni, persone, regola: 'sabato_o_domenica', storico: new Map(), senzaLiberi: new Set(['2026-11-28', '2026-11-29']) });
    expect(lib.has('2026-11-28') || lib.has('2026-11-29')).toBe(false);
  });
});

describe('il piano del mese', () => {
  const mese = '2026-11';
  const tutte = date('2026-10-26', 42);
  const giorni = costruisciGiorni(tutte, orari, [], []);
  const atteso = new Map(tutte.map((d) => {
    const t = tipoDelGiorno(d).tipo;
    const v = t === 'sabato' || t === 'domenica' || t === 'bf_weekend' ? 40 : t === 'black_friday' ? 60 : 10;
    return [d, Array.from({ length: 24 }, (_, h) => (h >= 10 && h < 20 ? v : 0))];
  }));
  const persone = [40, 36, 30, 30, 25].map((ore, i) => ({ id: `p${i}`, oreSettimana: ore, nonDisponibile: new Set<string>(), oreFerie: new Map<string, number>() }));
  it('pianifica solo i giorni del mese, rispetta i liberi e le ore', () => {
    const e = pianificaMese({ mese, giorni, persone, regola: 'sabato_o_domenica', storicoWeekend: new Map(), atteso });
    expect(e.turni.every((t) => t.data.startsWith('2026-11'))).toBe(true);
    for (const [d, ids] of e.weekendLiberi) for (const id of ids) expect(e.turni.some((t) => t.data === d && t.employeeId === id)).toBe(false);
    for (const p of persone) {
      expect(e.persone[p.id].pianificate).toBeLessThanOrEqual(e.persone[p.id].contratto + 1e-6);
      expect(e.persone[p.id].weekendLiberi).toBe(1);
    }
    expect(e.turni.every((t) => oreLavorate(t) <= 8)).toBe(true);
  });
  it('la riserva a chiamata copre i buchi, il contratto no', () => {
    const poche = persone.slice(0, 2);
    const riserva = { id: 'r', oreSettimana: null, nonDisponibile: new Set<string>(), oreFerie: new Map<string, number>() };
    const senza = pianificaMese({ mese, giorni, persone: poche, regola: 'nessuno', storicoWeekend: new Map(), atteso });
    const con = pianificaMese({ mese, giorni, persone: [...poche, riserva], regola: 'nessuno', storicoWeekend: new Map(), atteso });
    expect(con.oreRiserva).toBeGreaterThan(0);
    expect(con.oreScoperte).toBeLessThan(senza.oreScoperte);
    for (const p of poche) expect(con.persone[p.id].straordinario).toBe(0);
  });
});
