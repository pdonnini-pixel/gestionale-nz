import { describe, it, expect } from 'vitest';
import {
  blackFriday, tipoDelGiorno, storicoTraffico, trafficoAtteso, fabbisognoDaTraffico, sogliaDelGiorno, assegnaWeekendLiberi,
  personeMinime, pianificaMese, proponiPianoSettimana, dueTurniInveceDiTre, attesoDelleDate, spostaEAllunga, usaOreResidue, proponiFerie, suggerisciFinestre, oreGiornata, oreFerieGiorno, giorniLavorativiSettimana, type RigaTraffico,
} from './pianoMensile';
import { type Turno, type PersonaTurni, type RegoleTurni, oreScoperte, mezzOreVuote, spostaUnGiorno, proponiSettimana, pausaPer, REGOLE_DEFAULT, costruisciGiorni, giorniDellaSettimana, lunediDi, personeInPiu, lavoroMassimoGiorno, oreLavorate, coperturaLorda, copertura } from './turni';

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
    // con la collega in più le ore scoperte non crescono (nella rotazione: in «nessun
    // sabato né domenica liberi» i turni si spostano nel weekend dall'11/11/2026)
    const conRot = pianificaMese({ mese, giorni, persone: conTrasferta, regola: 'sabato_o_domenica', storicoWeekend: new Map(), atteso });
    const copertoRot = pianificaMese({ mese, giorni, persone: conTrasferta, regola: 'sabato_o_domenica', storicoWeekend: new Map(), atteso, fissi });
    expect(copertoRot.oreScoperte).toBeLessThanOrEqual(conRot.oreScoperte);
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

  it('non propone ore oltre il contratto della settimana (Patrizio, 10/11/2026, domenica 20/12)', () => {
    const date = date30();
    const giorni = costruisciGiorni(date, orari, [], []);
    const atteso = new Map(date.map((d) => [d, Array.from({ length: 24 }, (_, h) => (d === '2026-11-27' ? (h >= 15 ? 80 : 30) : 10))]));
    // la settimana del Black Friday (23-29/11) e' gia' piena: il 27 non si propone anche se ha piu' traffico
    const piena = (d: string) => (d >= '2026-11-23' && d <= '2026-11-29' ? 0 : d >= '2026-11-16' && d <= '2026-11-22' ? 5.2 : 3);
    const f = suggerisciFinestre({ giorni, atteso, turni: [], possibile: () => true, ore: 18.8, oreSettimana: piena });
    expect(f.length).toBeGreaterThan(0);
    // solo nella settimana 16-22, l'unica con almeno 4 ore, e mai oltre le 5 ore che restano
    expect(f.every((x) => x.data >= '2026-11-16' && x.data <= '2026-11-22')).toBe(true);
    expect(f.every((x) => x.ore <= 5)).toBe(true);
    // nessuna settimana con almeno 4 ore: nessuna proposta
    expect(suggerisciFinestre({ giorni, atteso, turni: [], possibile: () => true, ore: 18.8, oreSettimana: () => 3.5 })).toHaveLength(0);
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

describe('le ore libere vanno dove manca qualcuno (Brugnato, 30/10/2026)', () => {
  it('nelle settimane intere nessuno resta con ore ferme mentre c\'è una persona sola', () => {
    const mese = '2026-11';
    const tutte = Array.from({ length: 42 }, (_, i) => new Date(Date.UTC(2026, 9, 26 + i)).toISOString().slice(0, 10));
    const giorni = costruisciGiorni(tutte, orari, [], []);
    const atteso = new Map(tutte.map((d) => {
      const gs = new Date(`${d}T00:00:00Z`).getUTCDay();
      const ore = gs === 6 || gs === 0 ? [12, 30, 45, 32, 60, 109, 133, 90, 40, 10] : [5, 10, 12, 9, 11, 14, 16, 12, 6, 3];
      return [d, Array.from({ length: 24 }, (_, h) => (h >= 10 && h < 20 ? ore[h - 10] : 0))];
    }));
    const persone = [40, 30, 30].map((ore, i) => ({ id: `p${i}`, oreSettimana: ore, nonDisponibile: new Set<string>(), oreFerie: new Map<string, number>() }));
    const e = pianificaMese({ mese, giorni, persone, regola: 'nessuno', storicoWeekend: new Map(), atteso, regole: REGOLE_DEFAULT });
    for (const lun of ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']) {
      const sett = giorniDellaSettimana(lun);
      const unaSola = giorni.filter((g) => sett.includes(g.data)).some((g) => copertura(g, e.turni).some((c, i, a) => i >= 2 && i < a.length - 2 && c < 2));
      if (!unaSola) continue;
      for (const p of persone) {
        const lavorate = e.turni.filter((t) => t.employeeId === p.id && sett.includes(t.data)).reduce((a, t) => a + oreLavorate(t), 0);
        expect(p.oreSettimana - lavorate, `${p.id} ${lun}`).toBeLessThanOrEqual(1);
      }
    }
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
  it('mercoledì 4/11 con due persone in ferie il negozio resta coperto tutto il giorno', () => {
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
    // «nessun sabato né domenica liberi» (Patrizio, 11/11/2026): chi puo' lavorare
    // ha un turno ogni sabato e ogni domenica del mese
    for (const g of giorni.filter((x) => x.data.startsWith(mese) && !x.chiuso && [0, 6].includes(new Date(`${x.data}T00:00:00Z`).getUTCDay()))) {
      for (const q of persone.filter((x) => !x.nonDisponibile.has(g.data))) {
        expect(e.turni.some((t) => t.employeeId === q.id && t.data === g.data), `${q.id} ${g.data}`).toBe(true);
      }
    }
    // e spostando i turni nel weekend il negozio non resta mai vuoto
    expect(giorni.filter((g) => g.data.startsWith(mese) && !g.chiuso).every((g) => copertura(g, e.turni).every((c) => c >= 1))).toBe(true);
  });
});

describe('le fasce salvate comandano (Patrizio, 30/10/2026)', () => {
  const tutte = Array.from({ length: 42 }, (_, i) => new Date(Date.UTC(2026, 9, 26 + i)).toISOString().slice(0, 10));
  const atteso = new Map(tutte.map((d) => [d, Array.from({ length: 24 }, (_, h) => (h >= 10 && h < 20 ? 10 : 0))]));
  const fasce = (origine: string) => [1, 2, 3, 4, 5, 6, 7].flatMap((g) => [
    { giorno: g, dalle: '10:00', alle: '12:00', persone: 1, origine },
    { giorno: g, dalle: '12:00', alle: '18:00', persone: 2, origine },
    { giorno: g, dalle: '18:00', alle: '20:00', persone: 1, origine }]);
  it('una persona 10-12 e 18-20, due 12-18; le fasce stimate no', () => {
    const [g] = fabbisognoDaTraffico(costruisciGiorni(['2026-11-03'], orari, fasce('manuale'), []), atteso, REGOLE_DEFAULT, new Map([['2026-11-03', 4]]));
    expect(g.fabbisogno).toEqual([1, 1, 1, 1, ...Array(12).fill(2), 1, 1, 1, 1]);
    const [s] = fabbisognoDaTraffico(costruisciGiorni(['2026-11-03'], orari, fasce('stima'), []), atteso, REGOLE_DEFAULT, new Map([['2026-11-03', 4]]));
    expect(s.fabbisogno).toEqual([1, 1, ...Array(16).fill(2), 1, 1]);
  });
  it('nei feriali tranquilli bastano due turni sovrapposti', () => {
    const giorni = costruisciGiorni(tutte, orari, fasce('manuale'), []);
    // 16 ore di presenza al giorno: le ore ci sono (ognuno puo' fare turni lunghi)
    const persone = [40, 40, 30].map((ore, i) => ({ id: `p${i}`, oreSettimana: ore, nonDisponibile: new Set<string>(), oreFerie: new Map<string, number>() }));
    const e = pianificaMese({ mese: '2026-11', giorni, persone, regola: 'nessuno', storicoWeekend: new Map(), atteso, regole: REGOLE_DEFAULT });
    const feriali = tutte.filter((d) => d.startsWith('2026-11') && [1, 2, 3, 4, 5].includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
    const conTre = feriali.filter((d) => new Set(e.turni.filter((t) => t.data === d).map((t) => t.employeeId)).size >= 3);
    expect(conTre.length).toBeLessThanOrEqual(feriali.length / 2);
    for (const g of giorni.filter((x) => x.data.startsWith('2026-11'))) expect(copertura(g, e.turni).every((c) => c >= 1), g.data).toBe(true);
  });
});

describe('sposta un turno e allunga quello di una collega (Patrizio, 02/11/2026)', () => {
  it('Brugnato martedì 10/11: Buratta 12-20, una collega la mattina e una il pomeriggio', () => {
    const t = (e: string, i: string, f: string, p: number): Turno => ({ employeeId: e, data: '2026-11-10', inizio: i, fine: f, pausaMinuti: p });
    // il piano di prima: Rossini 10-14, Ruggeri 12-17, Buratta 13:30-20 con 4 ore libere
    const turni = [t('Rossini', '10:00', '14:00', 0), t('Ruggeri', '12:00', '17:00', 0), t('Buratta', '13:30', '20:00', 30),
      { ...t('Buratta', '13:30', '20:00', 30), data: '2026-11-11' }, { ...t('Rossini', '10:00', '16:00', 0), data: '2026-11-11' }];
    const fab = [1, 1, 1, 1, ...Array(12).fill(2), 1, 1, 1, 1];
    const g = { data: '2026-11-10', giorno: 2, chiuso: false, apre: 600, chiude: 1200, fabbisogno: fab, esatto: fab, minimo: fab, nota: null, speciale: false };
    const persone = [{ id: 'Buratta', ore: 13.5, nonDisponibile: new Set<string>() }, { id: 'Rossini', ore: 10, nonDisponibile: new Set<string>() }, { id: 'Ruggeri', ore: 5, nonDisponibile: new Set<string>() }];
    expect(oreScoperte([g], turni)).toBeGreaterThan(0);
    const dopo = spostaEAllunga([g], turni, persone);
    expect(oreScoperte([g], dopo)).toBe(0);
    expect(copertura(g, dopo).every((c) => c >= 1)).toBe(true);
    // nessuno oltre il contratto
    for (const p of persone) expect(dopo.filter((x) => x.employeeId === p.id).reduce((a, x) => a + oreLavorate(x), 0)).toBeLessThanOrEqual(p.ore + 1e-9);
  });
});

describe('la proposta settimanale non lascia mai il negozio vuoto (Roma Soratte, 11/11/2026)', () => {
  // Il caso misurato l'11/11/2026: Roma Soratte, settimana 16-22/11/2026, traffico MODA
  // di Valmontone di novembre 2025 (negozio di riferimento), fasce salvate da Patrizio,
  // quattro persone senza vincoli da 40, 30, 30 e 30 ore. La proposta metteva tutte e
  // quattro in turno da 4 ore dal lunedi' al giovedi', ognuna arrivava a 6 giorni di
  // lavoro e il venerdi' dalle 17 alle 20 non c'era nessuno, con 10 ore di contratto libere.
  const regole: RegoleTurni = { ...REGOLE_DEFAULT, sogliaFeriali: 25, sogliaWeekend: 35, duePersone: false };
  const LUN = '2026-11-16';
  const settimana = giorniDellaSettimana(LUN);
  const feriali = [['10:00', '12:00', 1], ['12:00', '18:00', 2], ['18:00', '20:00', 1]] as const;
  const weekend = [['10:00', '11:00', 1], ['11:00', '19:00', 2], ['19:00', '20:00', 1]] as const;
  const fasce = [1, 2, 3, 4, 5, 6, 7].flatMap((g) => (g >= 6 ? weekend : feriali).map(([dalle, alle, persone]) => ({ giorno: g, dalle, alle, persone, origine: 'manuale' })));
  // ingressi medi per ora dalle 10 alle 19, Valmontone, novembre 2025 (outlet_traffic_hourly)
  const moda: Record<string, number[]> = {
    feriale: [7.31, 18, 20.5, 16.5, 20.88, 19.44, 16.75, 15.69, 12.31, 5.44],
    venerdi: [7.67, 18.67, 16.33, 15, 23.67, 20, 24, 18.33, 18, 12],
    sabato: [18.33, 53.33, 61.67, 56, 76.67, 69.67, 99.33, 103, 67.33, 28],
    domenica: [25.5, 96.75, 108.75, 75.25, 107.5, 113.25, 164, 182, 132.25, 46.5],
  };
  const righe: RigaTraffico[] = date('2025-11-03', 21).flatMap((d) => moda[tipoDelGiorno(d).tipo].map((ingressi, i) => ({ data: d, ora: 10 + i, ingressi })));
  const { atteso } = attesoDelleDate(storicoTraffico(righe), settimana);
  const persone: PersonaTurni[] = [['p1', 40], ['p2', 30], ['p3', 30], ['p4', 30]].map(([id, ore]) => ({ id: id as string, ore: ore as number, nonDisponibile: new Set<string>() }));
  const giorni = fabbisognoDaTraffico(
    costruisciGiorni(settimana, orari, fasce, [], [], '2026-11-05'), atteso, regole, new Map(settimana.map((d) => [d, persone.length])),
  );
  const t = (employeeId: string, giorno: number, inizio: string, fine: string, pausaMinuti = 0): Turno => ({ employeeId, data: settimana[giorno], inizio, fine, pausaMinuti });
  // la proposta di prima, cosi' come usciva
  const prima: Turno[] = [
    t('p1', 0, '16:00', '20:00'), t('p2', 0, '14:00', '18:00'), t('p3', 0, '10:00', '14:00'), t('p4', 0, '12:00', '16:00'),
    t('p1', 1, '14:00', '18:00'), t('p2', 1, '16:00', '20:00'), t('p3', 1, '10:00', '14:00'), t('p4', 1, '12:00', '16:00'),
    t('p1', 2, '16:00', '20:00'), t('p2', 2, '10:00', '14:00'), t('p3', 2, '12:00', '16:00'), t('p4', 2, '14:00', '18:00'),
    t('p1', 3, '14:00', '18:00'), t('p2', 3, '12:00', '16:00'), t('p3', 3, '16:00', '20:00'), t('p4', 3, '10:00', '14:00'),
    t('p3', 4, '10:00', '17:00', 30), t('p4', 4, '12:00', '17:00'),
    t('p1', 5, '11:00', '19:00', 30), t('p2', 5, '14:00', '18:00'), t('p4', 5, '10:00', '20:00', 60),
    t('p1', 6, '10:00', '20:00', 60), t('p2', 6, '11:00', '19:00', 30), t('p3', 6, '11:00', '19:00', 30),
  ];
  const regoleRispettate = (turni: Turno[]) => {
    for (const p of persone) {
      const suoi = turni.filter((x) => x.employeeId === p.id);
      expect(suoi.reduce((a, x) => a + oreLavorate(x), 0), `ore di ${p.id}`).toBeLessThanOrEqual(p.ore + 1e-9);
      expect(new Set(suoi.map((x) => x.data)).size, `un turno al giorno, ${p.id}`).toBe(suoi.length);
      expect(suoi.length, `giorni di ${p.id}`).toBeLessThanOrEqual(regole.giorniLavoroMax);
      for (const x of suoi) {
        expect(oreLavorate(x), `${p.id} ${x.data}`).toBeGreaterThanOrEqual(regole.turnoMinOre);
        expect(oreLavorate(x), `${p.id} ${x.data}`).toBeLessThanOrEqual(regole.turnoMaxOre);
        expect(x.pausaMinuti, `pausa ${p.id} ${x.data}`).toBe(pausaPer(oreLavorate(x) * 60, regole));
        expect(x.inizio >= '10:00' && x.fine <= '20:00', `${p.id} ${x.data} ${x.inizio}-${x.fine}`).toBe(true);
      }
    }
  };

  it('il caso di partenza: venerdì vuoto dalle 17 alle 20 con ore di contratto libere', () => {
    expect(mezzOreVuote(giorni, prima)).toBe(6);
    expect(oreScoperte(giorni, prima)).toBe(7);
    expect(prima.reduce((a, x) => a + oreLavorate(x), 0)).toBe(120);
  });

  it('proponiSettimana: nessuna mezz\'ora senza nessuno e nessuna fascia scoperta', () => {
    const e = proponiSettimana({ giorni, persone, regole });
    expect(mezzOreVuote(giorni, e.turni)).toBe(0);
    expect(e.scoperture).toEqual([]);
    regoleRispettate(e.turni);
  });

  it('proponiPianoSettimana (il pulsante «Proponi i turni»): tutto coperto, due persone ogni giorno, regole rispettate', () => {
    const e = proponiPianoSettimana({ giorni, persone, regole });
    expect(mezzOreVuote(giorni, e.turni)).toBe(0);
    expect(e.scoperture).toEqual([]);
    for (const g of giorni) expect(new Set(e.turni.filter((x) => x.data === g.data).map((x) => x.employeeId)).size, g.data).toBeGreaterThanOrEqual(2);
    regoleRispettate(e.turni);
  });

  it('spostaUnGiorno: chi ha finito i giorni di lavoro porta un turno nel giorno scoperto', () => {
    const dopo = spostaUnGiorno(giorni, prima, [], persone, regole);
    expect(mezzOreVuote(giorni, dopo)).toBe(0);
    expect(oreScoperte(giorni, dopo)).toBeLessThan(7);
    regoleRispettate(dopo);
  });

  it('un turno fisso non si tocca e resta dopo la copertura', () => {
    const fisso = t('p1', 4, '10:00', '14:00');
    const e = proponiPianoSettimana({ giorni, persone, regole, fissi: [fisso] });
    expect(e.turni.some((x) => x.employeeId === 'p1' && x.data === fisso.data)).toBe(false);
    expect(mezzOreVuote(giorni, [...e.turni, fisso])).toBe(0);
    regoleRispettate([...e.turni, fisso]);
  });

  it('con una persona in meno il venerdì la settimana resta senza mezz\'ore vuote', () => {
    const conAssenza = persone.map((p) => (p.id === 'p1' ? { ...p, nonDisponibile: new Set([settimana[4]]) } : p));
    const e = proponiPianoSettimana({ giorni, persone: conAssenza, regole });
    expect(mezzOreVuote(giorni, e.turni)).toBe(0);
    expect(e.turni.some((x) => x.employeeId === 'p1' && x.data === settimana[4])).toBe(false);
    regoleRispettate(e.turni);
  });

  it('il piano del mese (nessun sabato né domenica liberi) copre la stessa settimana e tiene due persone il venerdì pomeriggio', () => {
    const tutte = date('2026-10-26', 42);
    const righeMese = attesoDelleDate(storicoTraffico(righe), tutte).atteso;
    const giorniMese = costruisciGiorni(tutte, orari, fasce, [], [], '2026-11-05');
    const e = pianificaMese({
      mese: '2026-11', giorni: giorniMese, regola: 'nessuno', storicoWeekend: new Map(), atteso: righeMese, regole,
      persone: persone.map((p) => ({ id: p.id, oreSettimana: p.ore, nonDisponibile: new Set<string>(), oreFerie: new Map<string, number>() })),
    });
    const sett = e.giorni.filter((g) => settimana.includes(g.data));
    const turni = e.turni.filter((x) => settimana.includes(x.data));
    expect(mezzOreVuote(sett, turni)).toBe(0);
    const ven = sett.find((g) => g.data === settimana[4])!;
    // dalle 12 alle 18 le fasce chiedono due persone
    expect(coperturaLorda(ven, turni).slice(4, 16).every((c) => c >= 2)).toBe(true);
    regoleRispettate(turni);
  });
});

describe('due turni uniti: la pausa segue le ore lavorate', () => {
  it('una presenza di 8 ore e mezza non resta con un\'ora di pausa su 7 ore e mezza', () => {
    const regole: RegoleTurni = { ...REGOLE_DEFAULT, duePersone: false };
    const giorno = '2026-11-17';
    const g = costruisciGiorni([giorno], orari, [{ giorno: 2, dalle: '10:00', alle: '20:00', persone: 1 }], []);
    const turni: Turno[] = [
      { employeeId: 'a', data: giorno, inizio: '10:00', fine: '14:00', pausaMinuti: 0 },
      { employeeId: 'b', data: giorno, inizio: '14:00', fine: '18:30', pausaMinuti: 0 },
      { employeeId: 'c', data: giorno, inizio: '12:00', fine: '20:00', pausaMinuti: 30 },
    ];
    const persone: PersonaTurni[] = ['a', 'b', 'c'].map((id) => ({ id, ore: 40, nonDisponibile: new Set<string>() }));
    const dopo = dueTurniInveceDiTre(g, turni, persone, regole);
    for (const x of dopo) expect(x.pausaMinuti, `${x.employeeId} ${x.inizio}-${x.fine}`).toBe(pausaPer(oreLavorate(x) * 60, regole));
    expect(mezzOreVuote(g, dopo)).toBe(0);
  });
});
