import { describe, it, expect } from 'vitest';
import {
  blackFriday, tipoDelGiorno, storicoTraffico, trafficoAtteso, fabbisognoDaTraffico, sogliaDelGiorno, assegnaWeekendLiberi,
  personeMinime, pianificaMese, usaOreResidue, proponiFerie, suggerisciFinestre, oreGiornata, oreFerieGiorno, giorniLavorativiSettimana, type RigaTraffico,
} from './pianoMensile';
import { REGOLE_DEFAULT, costruisciGiorni, giorniDellaSettimana, lunediDi, personeInPiu, lavoroMassimoGiorno, oreLavorate, coperturaLorda, copertura } from './turni';

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

describe('fabbisogno dal traffico: ingressi diviso la soglia', () => {
  const sett = giorniDellaSettimana('2026-11-09');
  const giorni = costruisciGiorni(sett, orari, [], []);
  const atteso = new Map(sett.map((d) => [d, Array.from({ length: 24 }, (_, h) => (h >= 10 && h < 20 ? (giorniDellaSettimana('2026-11-09').indexOf(d) >= 5 ? 40 : 10) * (h >= 15 && h < 18 ? 2 : 1) : 0))]));
  const maxP = new Map(sett.map((d) => [d, 4]));
  // il solo traffico, senza la regola delle due persone
  const soloTraffico = { ...REGOLE_DEFAULT, duePersone: false };
  it('ingressi / 25, almeno una persona, al massimo le persone che ci sono', () => {
    const f = fabbisognoDaTraffico(giorni, atteso, soloTraffico, maxP);
    expect(f[0].fabbisogno.every((x) => x === 1)).toBe(true); // lunedì: 10 o 20 ingressi, una persona
    expect(f[5].esatto![0]).toBeCloseTo(40 / 25); // sabato alle 10: 1,6 persone
    expect(f[5].fabbisogno[0]).toBe(2);
    expect(f[5].esatto![10]).toBeCloseTo(80 / 25); // alle 15: 3,2
    for (const g of f) expect(Math.max(...g.fabbisogno)).toBeLessThanOrEqual(4);
  });
  it('soglie diverse per feriali e weekend', () => {
    const regole = { ...REGOLE_DEFAULT, sogliaFeriali: 5, sogliaWeekend: 40 };
    expect(sogliaDelGiorno('2026-11-09', regole)).toBe(5);
    expect(sogliaDelGiorno('2026-11-14', regole)).toBe(40);
    expect(sogliaDelGiorno('2026-12-08', regole)).toBe(40); // festivo infrasettimanale
    const f = fabbisognoDaTraffico(giorni, atteso, regole, maxP);
    expect(f[0].esatto![0]).toBeCloseTo(2); // 10 ingressi / 5
    expect(f[5].esatto![0]).toBeCloseTo(1); // 40 / 40
  });
  it('la domenica 1/11 di Barberino: pranzo e sera più leggeri, il tetto vale sulle persone che ci sono', () => {
    const d = '2026-11-01';
    const ore = Array(24).fill(0); [30, 93, 89, 75, 85, 102, 126, 101, 49, 15].forEach((v, i) => { ore[10 + i] = v; });
    const g = fabbisognoDaTraffico(costruisciGiorni([d], orari, [], []), new Map([[d, ore]]), soloTraffico, new Map([[d, 4]]))[0];
    expect(g.esatto![6]).toBeCloseTo(3); // alle 13: 75 / 25
    expect(g.esatto![16]).toBeCloseTo(49 / 25); // alle 18: 2 persone
    expect(g.esatto![12]).toBe(4); // alle 16 ne servirebbero 5: tetto 4
    expect(g.esigenza![12]).toBe(5);
    expect(g.fabbisogno[18]).toBe(1); // alle 19: 15 ingressi, una persona
  });
  it('due persone salvo la prima e l\'ultima ora (Patrizio, 30/10/2026)', () => {
    const f = fabbisognoDaTraffico(giorni, atteso, REGOLE_DEFAULT, maxP);
    // lunedì 10-20 con 10 ingressi l'ora: una persona dalle 10 alle 11 e dalle 19 alle 20, due nel resto
    expect(f[0].fabbisogno).toEqual([1, 1, ...Array(16).fill(2), 1, 1]);
    expect(f[0].esatto![2]).toBe(2);
    // dove il traffico chiede di più vale il traffico
    expect(f[5].esatto![10]).toBeCloseTo(80 / 25);
    // con una persona sola in forza resta una
    const uno = fabbisognoDaTraffico(giorni, atteso, REGOLE_DEFAULT, new Map(sett.map((d) => [d, 1])));
    expect(uno[0].fabbisogno.every((x) => x === 1)).toBe(true);
  });
  it('le persone in più di giorni speciali ed eventi si sommano a MODA', () => {
    const extra = personeInPiu(sett, [{ data: sett[0], persone_extra: 1 }],
      [{ nome: 'Saldi', data_dal: sett[0], data_al: sett[1], outlet_ids: null, persone_extra: 2, blocca_ferie: false, straordinari: false }]);
    expect(extra.get(sett[0])).toBe(3);
    expect(extra.get(sett[1])).toBe(2);
    expect(extra.get(sett[2])).toBe(0);
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
    // feriali pieni (60 ingressi, 2,4 persone): una settimana di ferie lascia buchi
    const pieno = new Map([...atteso].map(([d, o]) => [d, o.map((v) => (v === 10 ? 60 : v))]));
    const a = pianificaMese({ mese, giorni, persone: conFerie, regola: 'nessuno', storicoWeekend: new Map(), atteso: pieno });
    const b = pianificaMese({ mese, giorni, persone, regola: 'nessuno', storicoWeekend: new Map(), atteso: pieno });
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
  it('settimana intera anche a cavallo dei mesi: le ore di ottobre si tolgono dalle 40', () => {
    const una = [{ id: 'p0', oreSettimana: 40, nonDisponibile: new Set<string>(), oreFerie: new Map<string, number>() }];
    const libero = pianificaMese({ mese, giorni, persone: una, regola: 'nessuno', storicoWeekend: new Map(), atteso });
    // ottobre senza turni: domenica 1/11 prenderebbe la sua parte secondo il traffico
    // (40 x 4 / 13 = 12,3 ore), ma un giorno solo regge un turno: al massimo 9 ore
    // lavorate in un negozio aperto 10 ore. Il resto resta a ottobre.
    expect(libero.settimane[0].contratto).toBe(9);
    expect(libero.persone.p0.settimane?.['2026-10-26']).toBe(9);
    const ottobre = new Map([['p0', new Map(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'].map((d) => [d, 9]))]]);
    const e = pianificaMese({ mese, giorni, persone: una, regola: 'nessuno', storicoWeekend: new Map(), atteso, oreFuoriMese: ottobre });
    expect(e.settimane[0].contratto).toBe(4);
    // le settimane intere restano a 40
    expect(e.settimane[1].contratto).toBe(40);
  });
  it('accordi della scheda: i turni stanno nella fascia della persona e mai nei giorni esclusi', () => {
    // p0 lavora solo dalle 14 alle 20; p1 mai il martedi'
    const fasce = new Map(tutte.map((d) => [d, { dalle: 14 * 60, alle: 20 * 60 }]));
    const conAccordi = persone.map((p, i) => (i === 0 ? { ...p, fasce }
      : i === 1 ? { ...p, nonDisponibile: new Set(tutte.filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 2)) } : p));
    const e = pianificaMese({ mese, giorni, persone: conAccordi, regola: 'nessuno', storicoWeekend: new Map(), atteso });
    const p0 = e.turni.filter((t) => t.employeeId === 'p0');
    expect(p0.length).toBeGreaterThan(0);
    expect(p0.every((t) => t.inizio >= '14:00' && t.fine <= '20:00' && oreLavorate(t) >= 4)).toBe(true);
    expect(e.turni.some((t) => t.employeeId === 'p1' && new Date(`${t.data}T00:00:00Z`).getUTCDay() === 2)).toBe(false);
  });
  it('trasferte: tolgono ore come lavoro fuori dal negozio e, se coprono il negozio, contano come presenza', () => {
    const conTrasferta = persone.map((p, i) => (i === 0
      ? { ...p, oreTrasferta: new Map([['2026-11-04', 8]]), nonDisponibile: new Set(['2026-11-04']) } : p));
    const senza = pianificaMese({ mese, giorni, persone, regola: 'nessuno', storicoWeekend: new Map(), atteso });
    const con = pianificaMese({ mese, giorni, persone: conTrasferta, regola: 'nessuno', storicoWeekend: new Map(), atteso });
    expect(con.persone.p0.trasferte).toBe(8);
    expect(con.persone.p0.contratto).toBeCloseTo(senza.persone.p0.contratto - 8, 5);
    expect(con.turni.some((t) => t.employeeId === 'p0' && t.data === '2026-11-04')).toBe(false);
    // una referente di un altro negozio copre qui il 4/11 dalle 10 alle 19
    const fissi = [{ employeeId: 'ext', data: '2026-11-04', inizio: '10:00', fine: '19:00', pausaMinuti: 60 }];
    const coperto = pianificaMese({ mese, giorni, persone: conTrasferta, regola: 'nessuno', storicoWeekend: new Map(), atteso, fissi });
    expect(coperto.turni.some((t) => t.employeeId === 'ext')).toBe(false);
    expect(coperto.oreScoperte).toBeLessThanOrEqual(con.oreScoperte);
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

describe('mai un giorno con una persona sola (Patrizio, 28/10/2026)', () => {
  it('ogni giorno aperto ha almeno due persone diverse quando ce ne sono', () => {
    const mese = '2026-11';
    const tutte = Array.from({ length: 42 }, (_, i) => { const d = new Date(Date.UTC(2026, 9, 26 + i)); return d.toISOString().slice(0, 10); });
    const orari = [1, 2, 3, 4, 5, 6, 7].map((g) => ({ giorno: g, chiuso: false, apre: '10:00', chiude: '20:00' }));
    const giorni = costruisciGiorni(tutte, orari, [], []);
    // giovedi' quasi senza traffico: il motore tenderebbe a metterci una persona sola
    const atteso = new Map(tutte.map((d) => {
      const gs = new Date(`${d}T00:00:00Z`).getUTCDay();
      const v = gs === 4 ? 1 : gs === 0 || gs === 6 ? 60 : 8;
      return [d, Array.from({ length: 24 }, (_, h) => (h >= 10 && h < 20 ? v : 0))];
    }));
    // tre persone (40, 30, 20 ore): senza la regola le domeniche restavano a una persona sola,
    // perche' gli altri avevano gia' tutti i giorni o le ore in turni da 4 ore
    const persone = [40, 30, 20].map((ore, i) => ({ id: `p${i}`, oreSettimana: ore, nonDisponibile: new Set<string>(), oreFerie: new Map<string, number>() }));
    const e = pianificaMese({ mese, giorni, persone, regola: 'nessuno', storicoWeekend: new Map(), atteso });
    for (const d of tutte.filter((x) => x.startsWith(mese))) {
      expect(new Set(e.turni.filter((t) => t.data === d).map((t) => t.employeeId)).size, d).toBeGreaterThanOrEqual(2);
    }
    expect(e.turni.every((t) => oreLavorate(t) >= 4 - 1e-9)).toBe(true);
  });
});

describe('il negozio non resta mai scoperto (Patrizio, 30/10/2026)', () => {
  // Barberino, novembre 2026: per dare due persone a un giorno il motore spostava
  // un turno da un altro giorno e riparava solo quello, lasciando il lunedi' 2/11
  // scoperto dalle 18 alle 20. Ogni mezz'ora di apertura deve avere qualcuno.
  it('con ferie sparse, ogni mezz\'ora di novembre ha almeno una persona', () => {
    const mese = '2026-11';
    const tutte = Array.from({ length: 42 }, (_, i) => new Date(Date.UTC(2026, 9, 26 + i)).toISOString().slice(0, 10));
    const giorni = costruisciGiorni(tutte, orari, [], []);
    const atteso = new Map(tutte.map((d) => {
      const gs = new Date(`${d}T00:00:00Z`).getUTCDay();
      // ingressi attesi di Barberino dalle 10 alle 19 (MODA, settembre-ottobre)
      const ore = gs === 6 ? [15, 53, 57, 45, 49, 79, 85, 55, 40, 14] : gs === 0 ? [30, 93, 89, 75, 85, 102, 126, 101, 49, 15]
        : gs === 5 ? [8, 11, 16, 9, 13, 14, 11, 14, 5, 3] : [6, 13, 12, 9, 11, 12, 11, 10, 6, 3];
      return [d, Array.from({ length: 24 }, (_, h) => (h >= 10 && h < 20 ? ore[h - 10] : 0))];
    }));
    const p = (id: string, ore: number, ferie: [string, number][]) => ({ id, oreSettimana: ore, nonDisponibile: new Set(ferie.map(([d]) => d)), oreFerie: new Map(ferie) });
    const persone = [
      p('a', 35, [['2026-11-04', 7]]),
      p('b', 40, ['11', '12', '13', '14', '15'].map((d) => [`2026-11-${d}`, 8] as [string, number])),
      p('c', 20, [['2026-11-07', 6], ['2026-11-08', 6]]),
      p('d', 35, [['2026-11-04', 7]]),
    ];
    const e = pianificaMese({ mese, giorni, persone, regola: 'nessuno', storicoWeekend: new Map(), atteso, regole: REGOLE_DEFAULT });
    for (const g of giorni.filter((x) => x.data.startsWith(mese))) {
      expect(coperturaLorda(g, e.turni).every((x) => x > 0), g.data).toBe(true);
    }
  });
  it('anche durante le pause: mercoledì 4/11 con due persone in ferie chi resta va a pranzo coperta', () => {
    const mese = '2026-11';
    const tutte = Array.from({ length: 42 }, (_, i) => new Date(Date.UTC(2026, 9, 26 + i)).toISOString().slice(0, 10));
    const giorni = costruisciGiorni(tutte, orari, [], []);
    const atteso = new Map(tutte.map((d) => {
      const gs = new Date(`${d}T00:00:00Z`).getUTCDay();
      const ore = gs === 6 ? [15, 53, 57, 45, 49, 79, 85, 55, 40, 14] : gs === 0 ? [30, 93, 89, 75, 85, 102, 126, 101, 49, 15]
        : gs === 5 ? [8, 11, 16, 9, 13, 14, 11, 14, 5, 3] : [6, 13, 12, 9, 11, 12, 11, 10, 6, 3];
      return [d, Array.from({ length: 24 }, (_, h) => (h >= 10 && h < 20 ? ore[h - 10] : 0))];
    }));
    const p = (id: string, ore: number, ferie: [string, number][]) => ({ id, oreSettimana: ore, nonDisponibile: new Set(ferie.map(([d]) => d)), oreFerie: new Map(ferie) });
    const persone = [p('a', 35, [['2026-11-04', 7]]), p('b', 40, []), p('c', 20, [['2026-11-07', 6], ['2026-11-08', 6]]), p('d', 35, [['2026-11-04', 7]])];
    const args = { mese, giorni, persone, storicoWeekend: new Map<string, number>(), atteso, regole: REGOLE_DEFAULT };
    const e = pianificaMese({ ...args, regola: 'nessuno' });
    const mer = giorni.find((g) => g.data === '2026-11-04')!;
    expect(copertura(mer, e.turni).every((x) => x > 0)).toBe(true);
    // «nessun sabato né domenica liberi» non viene mai peggio delle rotazioni:
    // prima meno mezz'ore vuote, a parità meno ore scoperte
    const vuote = (x: typeof e) => giorni.filter((g) => g.data.startsWith(mese)).reduce((a, g) => a + copertura(g, x.turni).filter((c) => c < 1).length, 0);
    for (const regola of ['solo_sabati', 'solo_domeniche', 'sabato_o_domenica'] as const) {
      const r = pianificaMese({ ...args, regola });
      expect(vuote(e)).toBeLessThanOrEqual(vuote(r));
      if (vuote(e) === vuote(r)) expect(e.oreScoperte).toBeLessThanOrEqual(r.oreScoperte + 1e-9);
    }
  });
});
