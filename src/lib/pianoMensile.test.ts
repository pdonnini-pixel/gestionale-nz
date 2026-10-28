import { describe, it, expect } from 'vitest';
import {
  blackFriday, tipoDelGiorno, storicoTraffico, trafficoAtteso, fabbisognoDaTraffico, assegnaWeekendLiberi,
  personeMinime, pianificaMese, usaOreResidue, proponiFerie, suggerisciFinestre, oreGiornata, oreFerieGiorno, giorniLavorativiSettimana, type RigaTraffico,
} from './pianoMensile';
import { REGOLE_DEFAULT, costruisciGiorni, giorniDellaSettimana, lunediDi, lavoroMassimoGiorno, oreLavorate } from './turni';

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
    // sabato e domenica servono 2 persone: con il turno massimo di 10 ore una
    // persona copre tutta la giornata (9 lavorate + 1 di pausa in 10 ore)
    expect(personeMinime(giorni.find((g) => g.data === '2026-11-07')!)).toBe(2);
    // con turni da 8 ore servivano 2 che aprono e 2 che chiudono
    expect(personeMinime(giorni.find((g) => g.data === '2026-11-07')!, { ...REGOLE_DEFAULT, turnoMaxOre: 8 })).toBe(4);
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
    expect(lib.get('2026-11-07')![0]).toBe('e');
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
    expect(e.turni.every((t) => oreLavorate(t) <= 10)).toBe(true);
  });
  it('ore necessarie sull\'organico pieno: togliere una settimana di ferie riduce le ore scoperte', () => {
    const ferie = new Map(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map((d) => [d, 40 / 6]));
    const conFerie = persone.map((p, i) => (i === 0 ? { ...p, oreFerie: ferie, nonDisponibile: new Set(ferie.keys()) } : p));
    const a = pianificaMese({ mese, giorni, persone: conFerie, regola: 'nessuno', storicoWeekend: new Map(), atteso });
    const b = pianificaMese({ mese, giorni, persone, regola: 'nessuno', storicoWeekend: new Map(), atteso });
    expect(b.oreScoperte).toBeLessThan(a.oreScoperte);
    // le necessarie non dipendono dalle ferie; le disponibili si'
    a.settimane.forEach((w, i) => expect(w.necessarie).toBeCloseTo(b.settimane[i].necessarie, 6));
    const w9 = a.settimane.find((w) => w.lunedi === '2026-11-09')!;
    expect(w9.ferie).toBeCloseTo(5 * 40 / 6, 6);
    expect(w9.disponibili).toBeCloseTo(w9.contratto - w9.ferie, 6);
    // il totale del mese e' la somma delle settimane
    expect(a.oreScoperte).toBeCloseTo(a.settimane.reduce((x, w) => x + w.scoperte, 0), 6);
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
  it('simulazione: fabbisogno fisso, ore ipotetiche e straordinari ammessi', () => {
    // fabbisogno di «Orari e fabbisogno»: 2 persone tutto il giorno = 140 ore a settimana
    const fasce = [1, 2, 3, 4, 5, 6, 7].map((g) => ({ giorno: g, dalle: '10:00', alle: '20:00', persone: 2 }));
    const gFissi = costruisciGiorni(tutte, orari, fasce, []);
    const tre = (ore: number) => [0, 1, 2].map((i) => ({ id: `s${i}`, oreSettimana: ore, nonDisponibile: new Set<string>(), oreFerie: new Map<string, number>() }));
    const base = { mese, giorni: gFissi, regola: 'nessuno' as const, storicoWeekend: new Map(), atteso, fabbisognoFisso: true };
    const a30 = pianificaMese({ ...base, persone: tre(30) });
    const a40 = pianificaMese({ ...base, persone: tre(40) });
    // il fabbisogno non si adatta alle ore: con meno ore restano più buchi
    expect(a40.oreScoperte).toBeLessThan(a30.oreScoperte);
    expect(a30.persone.s0.straordinario).toBe(0);
    const conStraord = pianificaMese({ ...base, persone: tre(30), straordinariSettimana: 6 });
    expect(conStraord.oreScoperte).toBeLessThan(a30.oreScoperte);
    const extra = Object.values(conStraord.persone).reduce((s, p) => s + p.straordinario, 0);
    expect(extra).toBeGreaterThan(0);
    // mai oltre il tetto: 6 ore a settimana per persona, proporzionate ai giorni del mese
    for (const p of Object.values(conStraord.persone)) expect(p.straordinario).toBeLessThanOrEqual(6 * 30 / 7 + 1e-6);
  });
  it('turno minimo di 4 ore anche per la riserva e per gli straordinari', () => {
    const fasce = [1, 2, 3, 4, 5, 6, 7].map((g) => ({ giorno: g, dalle: '10:00', alle: '20:00', persone: 2 }));
    const gFissi = costruisciGiorni(tutte, orari, fasce, []);
    const persone = [
      ...[0, 1].map((i) => ({ id: `s${i}`, oreSettimana: 30, nonDisponibile: new Set<string>(), oreFerie: new Map<string, number>() })),
      { id: 'r', oreSettimana: null, nonDisponibile: new Set<string>(), oreFerie: new Map<string, number>() },
    ];
    const e = pianificaMese({
      mese, giorni: gFissi, persone, regola: 'nessuno', storicoWeekend: new Map(), atteso, fabbisognoFisso: true, straordinariSettimana: 5,
    });
    expect(e.turni.length).toBeGreaterThan(0);
    expect(e.turni.every((t) => oreLavorate(t) >= 4 - 1e-9)).toBe(true);
  });
  it('straordinari per persona: chi non è disponibile non ne fa', () => {
    const fasce = [1, 2, 3, 4, 5, 6, 7].map((g) => ({ giorno: g, dalle: '10:00', alle: '20:00', persone: 2 }));
    const gFissi = costruisciGiorni(tutte, orari, fasce, []);
    const persone = [0, 1, 2].map((i) => ({ id: `s${i}`, oreSettimana: 30, nonDisponibile: new Set<string>(), oreFerie: new Map<string, number>() }));
    const e = pianificaMese({
      mese, giorni: gFissi, persone, regola: 'nessuno', storicoWeekend: new Map(), atteso, fabbisognoFisso: true,
      straordinariPersona: new Map([['s0', 8], ['s1', 0], ['s2', 0]]),
    });
    expect(e.persone.s0.straordinario).toBeGreaterThan(0);
    expect(e.persone.s1.straordinario).toBe(0);
    expect(e.persone.s2.straordinario).toBe(0);
  });
  it('una persona nuova (id inventato) entra nel piano dal giorno indicato', () => {
    const fasce = [1, 2, 3, 4, 5, 6, 7].map((g) => ({ giorno: g, dalle: '10:00', alle: '20:00', persone: 2 }));
    const gFissi = costruisciGiorni(tutte, orari, fasce, []);
    const due = [0, 1].map((i) => ({ id: `s${i}`, oreSettimana: 40, nonDisponibile: new Set<string>(), oreFerie: new Map<string, number>() }));
    const nuova = { id: 'nuova-1', oreSettimana: 30, nonDisponibile: new Set(tutte.filter((d) => d < '2026-11-16')), oreFerie: new Map<string, number>() };
    const base = { mese, giorni: gFissi, regola: 'nessuno' as const, storicoWeekend: new Map(), atteso, fabbisognoFisso: true };
    const senza = pianificaMese({ ...base, persone: due });
    const con = pianificaMese({ ...base, persone: [...due, nuova] });
    expect(con.oreScoperte).toBeLessThan(senza.oreScoperte);
    const suoi = con.turni.filter((t) => t.employeeId === 'nuova-1');
    expect(suoi.length).toBeGreaterThan(0);
    expect(suoi.every((t) => t.data >= '2026-11-16')).toBe(true);
  });
});

describe('le ore di contratto che avanzano', () => {
  const sett = giorniDellaSettimana('2026-11-09');
  const giorni = costruisciGiorni(sett, orari, [], []);
  const atteso = new Map(sett.map((d) => [d, Array.from({ length: 24 }, (_, h) => (h >= 15 && h < 18 ? 50 : 10))]));
  it('allunga i turni dove entra più gente, entro il turno massimo, fino alle ore di contratto', () => {
    const turni = [0, 1, 2, 3].map((i) => ({ employeeId: 'a', data: sett[i], inizio: '10:00', fine: '14:00', pausaMinuti: 0 }));
    const persone = [{ id: 'a', ore: 30, nonDisponibile: new Set<string>() }];
    const out = usaOreResidue(giorni, turni, persone, atteso);
    const ore = out.reduce((s, t) => s + oreLavorate(t), 0);
    expect(ore).toBeGreaterThan(16);
    expect(ore).toBeLessThanOrEqual(30 + 1e-9);
    expect(out.every((t) => oreLavorate(t) <= 10 + 1e-9 && oreLavorate(t) >= 4 - 1e-9)).toBe(true);
    // si allunga verso il pomeriggio, dove il traffico e' alto
    expect(out.some((t) => t.fine >= '17:00')).toBe(true);
  });
  it('non usa i giorni in cui la persona non può lavorare', () => {
    const persone = [{ id: 'a', ore: 16, nonDisponibile: new Set(sett.slice(0, 5)) }];
    const out = usaOreResidue(giorni, [], persone, atteso);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((t) => !sett.slice(0, 5).includes(t.data))).toBe(true);
  });
  it('quello che resta diventa una proposta di ferie: giornate intere e un permesso a ore', () => {
    const date = date30();
    const p = proponiFerie({ ore: 14, oreSettimana: 30, date, possibile: () => true });
    // 30 ore su 6 giorni: una giornata vale 5 ore (regola a giornata, 21/10/2026)
    expect(p.filter((x) => x.tipo === 'giornata').map((x) => x.ore)).toEqual([5, 5]);
    expect(p.find((x) => x.tipo === 'ore')).toMatchObject({ voce: 'F02', ore: 4 });
    expect(p.every((x) => new Date(`${x.data}T00:00:00Z`).getUTCDay() >= 1 && new Date(`${x.data}T00:00:00Z`).getUTCDay() <= 5)).toBe(true);
    // distribuite su settimane diverse
    expect(new Set(p.map((x) => lunediDi(x.data))).size).toBe(3);
    expect(proponiFerie({ ore: 0.2, oreSettimana: 30, date, possibile: () => true })).toEqual([]);
  });
});
describe('ore di contratto a giornata', () => {
  it('novembre 2026: 26 giorni lavorativi, 40 ore = 173,3; una giornata di ferie proposta vale 6,67', () => {
    expect(oreGiornata(40)).toBeCloseTo(6.667, 2);
    // le ferie approvate valgono le ore del piano ferie; solo se mancano, /6
    expect(oreFerieGiorno('giornata', 8, 40)).toBe(8);
    expect(oreFerieGiorno('giornata', 0, 40)).toBeCloseTo(6.667, 2);
    expect(oreFerieGiorno('mezza_giornata', 0, 40)).toBeCloseTo(3.333, 2);
    expect(oreFerieGiorno('ore', 2, 40)).toBe(2);
    const settimane = [...new Set(date30().map(lunediDi))];
    const nelMese = (d: string) => d.startsWith('2026-11');
    const giorni = settimane.reduce((a, l) => {
      const date = giorniDellaSettimana(l);
      return a + giorniLavorativiSettimana(date, nelMese, date.every(nelMese));
    }, 0);
    expect(giorni).toBe(26);
    expect(giorni * oreGiornata(40)).toBeCloseTo(173.33, 1);
  });
});
function date30() { return Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`); }

describe('dove mettere le ore che avanzano', () => {
  it('propone il giorno e le ore con più ingressi per persona (es. Black Friday pomeriggio)', () => {
    const date = date30();
    const giorni = costruisciGiorni(date, orari, [], []);
    const atteso = new Map(date.map((d) => [d, Array.from({ length: 24 }, (_, h) => (d === '2026-11-27' ? (h >= 15 ? 80 : 30) : 10))]));
    // il 27 c'e' gia' una persona la mattina
    const turni = [{ employeeId: 'x', data: '2026-11-27', inizio: '10:00', fine: '15:00', pausaMinuti: 0 }];
    const f = suggerisciFinestre({ giorni, atteso, turni, possibile: (d) => d !== '2026-11-03', ore: 5.7 });
    expect(f).toHaveLength(3);
    expect(f[0]).toMatchObject({ data: '2026-11-27', ore: 5.5, fine: '20:00' });
    expect(f.every((x) => x.data !== '2026-11-03')).toBe(true);
    // poche ore: il turno resta di almeno 4 ore
    expect(suggerisciFinestre({ giorni, atteso, turni, possibile: () => true, ore: 2.9 })[0].ore).toBe(4);
  });
});

describe('turno massimo di 10 ore (Patrizio, 28/10/2026)', () => {
  it('la pausa sta dentro l\'orario: 9 ore lavorate se il negozio apre 10 ore, 10 se ne apre 11', () => {
    expect(lavoroMassimoGiorno({ apre: 600, chiude: 1200 })).toBe(540);
    expect(lavoroMassimoGiorno({ apre: 600, chiude: 1260 })).toBe(600);
    expect(lavoroMassimoGiorno({ apre: 600, chiude: 1080 })).toBe(450);
  });
});
