import { describe, it, expect } from 'vitest';
import {
  rispettaFasce,
  riassuntoOrari,
  REGOLE_DEFAULT, ritoccaScoperture, costruisciGiorni, proponiSettimana, giorniDellaSettimana, lunediDi, giornoIso, oreLavorate, pausaPer, pausaMinimaPerPresenza,
  scopertureDelGiorno, oreDaCoprire, minuti, copertura, presenzaGiusta, oreScoperte, oreSottoModa, eventiDelNegozio, type EventoNegozio, type OrarioGiornoTipo, type FasciaFabbisogno, type PersonaTurni, type Turno,
} from './turni';

const LUN = '2026-10-19';
const settimana = giorniDellaSettimana(LUN);

const orari: OrarioGiornoTipo[] = [1, 2, 3, 4, 5, 6, 7].map((g) => ({ giorno: g, chiuso: false, apre: '10:00', chiude: '20:00' }));
const fasce: FasciaFabbisogno[] = [1, 2, 3, 4, 5, 6, 7].map((g) => ({ giorno: g, dalle: '10:00', alle: '20:00', persone: 2 }));

const persona = (id: string, ore: number, nonDisponibile: string[] = []): PersonaTurni => ({ id, ore, nonDisponibile: new Set(nonDisponibile) });

describe('date', () => {
  it('lunedì e giorni della settimana', () => {
    expect(lunediDi('2026-10-22')).toBe(LUN);
    expect(lunediDi('2026-10-25')).toBe(LUN);
    expect(giornoIso('2026-10-25')).toBe(7);
    expect(settimana[6]).toBe('2026-10-25');
  });
  it('ore lavorate tolgono la pausa', () => {
    expect(oreLavorate({ inizio: '10:00', fine: '17:30', pausaMinuti: 30 })).toBe(7);
  });
});

describe('riassuntoOrari', () => {
  const g = (giorno: number, apre: string | null, chiude: string | null, chiuso = false) => ({ giorno, chiuso, apre, chiude });
  it('raggruppa i giorni uguali', () => {
    expect(riassuntoOrari([1, 2, 3, 4, 5].map((d) => g(d, '10:00:00', '20:00:00')).concat([g(6, '10:00', '21:00'), g(7, '10:00', '21:00')])))
      .toBe('Lun-Ven 10-20 · Sab-Dom 10-21');
    expect(riassuntoOrari([1, 2, 3, 4, 5, 6, 7].map((d) => g(d, '10:00', '20:00')))).toBe('Tutti i giorni 10-20');
    expect(riassuntoOrari([g(1, null, null, true), ...[2, 3, 4, 5, 6, 7].map((d) => g(d, '09:30', '19:30'))])).toBe('Lun chiuso · Mar-Dom 9:30-19:30');
  });
});

describe('costruisciGiorni', () => {
  it('fabbisogno per mezz’ora dalle fasce, giorno speciale chiuso o con persone in più', () => {
    const giorni = costruisciGiorni(settimana, orari, [
      ...fasce,
      { giorno: 6, dalle: '15:00', alle: '20:00', persone: 4 },
    ], [
      { data: '2026-10-25', chiuso: true, apre: null, chiude: null, persone_extra: 0 },
      { data: '2026-10-23', chiuso: false, apre: '10:00', chiude: '21:00', persone_extra: 1 },
    ]);
    expect(giorni[0].fabbisogno).toHaveLength(20);
    expect(giorni[0].fabbisogno.every((n) => n === 2)).toBe(true);
    const sab = giorni[5];
    expect(sab.fabbisogno[sab.fabbisogno.length - 1]).toBe(4);
    expect(sab.fabbisogno[0]).toBe(2);
    expect(giorni[6].chiuso).toBe(true);
    const ven = giorni[4];
    expect(ven.chiude).toBe(minuti('21:00'));
    expect(ven.fabbisogno[0]).toBe(3);
    // dalle 20 alle 21 la fascia tipo non c'è: restano solo le persone in più
    expect(ven.fabbisogno[ven.fabbisogno.length - 1]).toBe(1);
  });

  it('prima della data di apertura il negozio è chiuso', () => {
    const giorni = costruisciGiorni(settimana, orari, fasce, [], [], settimana[3]);
    expect(giorni.slice(0, 3).every((g) => g.chiuso && g.fabbisogno.length === 0)).toBe(true);
    expect(giorni[3].chiuso).toBe(false);
  });

  it('negozio senza orari: chiuso, niente da coprire', () => {
    const giorni = costruisciGiorni(settimana, [], fasce, []);
    expect(giorni.every((g) => g.chiuso)).toBe(true);
    expect(oreDaCoprire(giorni)).toBe(0);
  });
});

describe('proponiSettimana', () => {
  const giorni = costruisciGiorni(settimana, orari, fasce, []);

  it('non supera mai le ore di contratto, un turno al giorno, al massimo 6 giorni', () => {
    const persone = [persona('a', 40), persona('b', 36), persona('c', 30), persona('d', 30)];
    const esito = proponiSettimana({ giorni, persone });
    for (const p of persone) {
      const suoi = esito.turni.filter((t) => t.employeeId === p.id);
      expect(esito.ore[p.id].pianificate).toBeLessThanOrEqual(p.ore + 1e-9);
      expect(new Set(suoi.map((t) => t.data)).size).toBe(suoi.length);
      expect(suoi.length).toBeLessThanOrEqual(6);
      for (const t of suoi) {
        expect(oreLavorate(t)).toBeGreaterThanOrEqual(1);
        expect(oreLavorate(t)).toBeLessThanOrEqual(10);
        expect(t.inizio >= '10:00' && t.fine <= '20:00').toBe(true);
        expect(t.pausaMinuti).toBe(oreLavorate(t) >= 8 ? 60 : oreLavorate(t) >= 6 ? 30 : 0);
      }
    }
  });

  it('con abbastanza persone copre tutto il fabbisogno', () => {
    // 2 persone per 10 ore al giorno con turni da 8 ore piu' la pausa servono
    // 4 turni al giorno (2 che aprono, 2 che chiudono): 28 a settimana. Con 4
    // persone a 40 ore (24 turni al massimo) non si puo'; con 6 si'.
    const esito = proponiSettimana({ giorni, persone: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => persona(id, 40)) });
    expect(esito.scoperture).toEqual([]);
  });

  it('non mette ore dove non servono: le ore in piu\' restano per ferie e permessi', () => {
    const esito = proponiSettimana({ giorni, persone: ['a', 'b', 'c', 'd'].map((id) => persona(id, 40)) });
    // in piu' resta solo quello che un turno continuo non puo' evitare
    const inPiu = giorni.reduce((s, g) => s + copertura(g, esito.turni).reduce((a, c, i) => a + Math.max(0, c - g.fabbisogno[i]), 0) / 2, 0);
    expect(inPiu).toBeLessThanOrEqual(8);
    expect(Object.values(esito.ore).every((o) => o.pianificate <= 40)).toBe(true);
  });

  it('le ore in piu\' le perde prima chi ha piu\' ferie maturate', () => {
    const tutti = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ ...persona(id, 40), saldoOre: id === 'a' ? 120 : 10 }));
    const esito = proponiSettimana({ giorni, persone: tutti });
    expect(esito.scoperture).toEqual([]);
    const libere = (id: string) => esito.ore[id].contratto - esito.ore[id].pianificate;
    expect(libere('a')).toBeGreaterThanOrEqual(Math.max(...['b', 'c', 'd', 'e', 'f'].map(libere)));
  });

  it('con poche persone dice cosa resta scoperto, senza inventare', () => {
    const esito = proponiSettimana({ giorni, persone: [persona('a', 20)] });
    expect(esito.ore.a.pianificate).toBeLessThanOrEqual(20);
    expect(esito.scoperture.length).toBeGreaterThan(0);
    expect(esito.scoperture.every((s) => s.mancano >= 1)).toBe(true);
  });

  it('chi è in ferie quel giorno non lavora', () => {
    const esito = proponiSettimana({ giorni, persone: [persona('a', 40, ['2026-10-19', '2026-10-20']), persona('b', 40)] });
    expect(esito.turni.some((t) => t.employeeId === 'a' && (t.data === '2026-10-19' || t.data === '2026-10-20'))).toBe(false);
  });

  it('i turni fissi restano e contano nelle ore e nella copertura', () => {
    const fissi: Turno[] = [{ employeeId: 'a', data: '2026-10-19', inizio: '10:00', fine: '20:00', pausaMinuti: 60 }];
    const esito = proponiSettimana({ giorni, persone: [persona('a', 18), persona('b', 40), persona('c', 40), persona('d', 40)], fissi });
    expect(esito.turni.some((t) => t.employeeId === 'a' && t.data === '2026-10-19')).toBe(false);
    expect(esito.ore.a.pianificate).toBeLessThanOrEqual(18);
    expect(esito.ore.a.pianificate).toBeGreaterThanOrEqual(9);
  });

  it('senza fabbisogno non propone niente da coprire ma usa le ore di contratto', () => {
    const vuoti = costruisciGiorni(settimana, orari, [], []);
    const esito = proponiSettimana({ giorni: vuoti, persone: [persona('a', 20)] });
    expect(esito.scoperture).toEqual([]);
    expect(esito.ore.a.pianificate).toBe(20);
  });
});

describe('scopertureDelGiorno', () => {
  it('unisce le mezz’ore con lo stesso buco', () => {
    const [g] = costruisciGiorni([LUN], orari, fasce, []);
    const s = scopertureDelGiorno(g, [{ employeeId: 'a', data: LUN, inizio: '10:00', fine: '16:00', pausaMinuti: 0 }]);
    expect(s).toEqual([
      { data: LUN, dalle: '10:00', alle: '16:00', mancano: 1 },
      { data: LUN, dalle: '16:00', alle: '20:00', mancano: 2 },
    ]);
  });
});

describe('pausaPer', () => {
  it('30 minuti da 6 ore lavorate, un\'ora da 8, in aggiunta alle ore (Patrizio, 21/10/2026)', () => {
    expect(pausaPer(5.5 * 60)).toBe(0);
    expect(pausaPer(6 * 60)).toBe(30);
    expect(pausaPer(7.5 * 60)).toBe(30);
    expect(pausaPer(8 * 60)).toBe(60);
  });

  it('la pausa minima dalla presenza: 7 ore = 6 di lavoro e 30\', 9 ore = 8 e un\'ora', () => {
    expect(pausaMinimaPerPresenza(7 * 60)).toBe(30);
    expect(pausaMinimaPerPresenza(9 * 60)).toBe(60);
    expect(pausaMinimaPerPresenza(5 * 60)).toBe(0);
    // 8 ore e mezza di presenza: con 30' sarebbero 8 ore di lavoro (che vogliono un'ora), quindi un'ora e 7,5 di lavoro
    expect(pausaMinimaPerPresenza(8.5 * 60)).toBe(60);
  });

  it('un turno da 8 ore occupa 9 ore di negozio; se non ci sta si accorcia', () => {
    const giorno = (chiude: string) => costruisciGiorni(['2026-10-19'], [{ giorno: 1, chiuso: false, apre: '10:00', chiude }], [{ giorno: 1, dalle: '10:00', alle: chiude, persone: 1 }], []);
    // 10:00-19:00: 8 ore di lavoro + un'ora di pausa, ci sta giusto
    const pieno = proponiSettimana({ giorni: giorno('19:00'), persone: [persona('a', 8)] });
    expect(pieno.turni).toHaveLength(1);
    expect(oreLavorate(pieno.turni[0])).toBe(8);
    expect(pieno.turni[0]).toMatchObject({ inizio: '10:00', fine: '19:00', pausaMinuti: 60 });
    // 10:00-18:00: 8 ore con la pausa non stanno, 7,5 ore + 30 minuti si'
    const corto = proponiSettimana({ giorni: giorno('18:00'), persone: [persona('a', 8)] });
    expect(oreLavorate(corto.turni[0])).toBe(7.5);
    expect(corto.turni[0].pausaMinuti).toBe(30);
  });
});

describe('la pausa ha solo la durata, non un orario (Patrizio, 11/11/2026)', () => {
  const LUN = '2026-10-19';
  const giorno = (persone: number) => costruisciGiorni([LUN], [{ giorno: 1, chiuso: false, apre: '10:00', chiude: '20:00' }], [{ giorno: 1, dalle: '10:00', alle: '20:00', persone }], [])[0];

  it('chi ha il turno conta in negozio per tutto il turno: la pausa non scopre nessuna fascia', () => {
    const t = [{ employeeId: 'a', data: LUN, inizio: '10:00', fine: '20:00', pausaMinuti: 60 }];
    expect(copertura(giorno(1), t).every((c) => c === 1)).toBe(true);
    expect(scopertureDelGiorno(giorno(1), t)).toEqual([]);
  });

  it('la pausa conta solo nelle ore: 9 ore fra entrata e uscita sono 8 di lavoro', () => {
    expect(oreLavorate({ inizio: '10:00', fine: '19:00', pausaMinuti: 60 })).toBe(8);
    expect(oreLavorate({ inizio: '10:00', fine: '16:30', pausaMinuti: 30 })).toBe(6);
  });

  it('ore sotto MODA senza pause: mezza persona vale mezza', () => {
    const g = { ...giorno(2), esatto: Array.from({ length: 20 }, (_, i) => (i === 8 || i === 9 ? 2.4 : 2)) }; // 14-15 chiede 2,4 persone
    const t = [{ employeeId: 'a', data: LUN, inizio: '10:00', fine: '20:00', pausaMinuti: 60 }, { employeeId: 'b', data: LUN, inizio: '10:00', fine: '20:00', pausaMinuti: 60 }];
    expect(oreSottoModa([g], t)).toBeCloseTo(0.4); // 0,4 persone per un'ora, le pause non tolgono niente
    expect(oreScoperte([g], t)).toBe(0);
  });

  it('con 2 persone sempre la proposta copre tutto il giorno', () => {
    const date = giorniDellaSettimana('2026-10-19');
    const g7 = costruisciGiorni(date, [1, 2, 3, 4, 5, 6, 7].map((g) => ({ giorno: g, chiuso: false, apre: '10:00', chiude: '20:00' })),
      [1, 2, 3, 4, 5, 6, 7].map((g) => ({ giorno: g, dalle: '10:00', alle: '20:00', persone: 2 })), []);
    const esito = proponiSettimana({ giorni: g7, persone: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => persona(id, 40)) });
    expect(esito.scoperture).toEqual([]);
    for (const g of g7) expect(copertura(g, esito.turni).every((c) => c >= 2)).toBe(true);
  });
});

describe('turni lunghi nei giorni pieni (Franciacorta, 20/10/2026)', () => {
  it('con le stesse ore, il weekend si copre e i feriali non hanno ore in piu\' inutili', () => {
    const date = giorniDellaSettimana('2026-10-19');
    const orari = [1, 2, 3, 4, 5, 6, 7].map((g) => ({ giorno: g, chiuso: false, apre: '10:00', chiude: '20:00' }));
    const F = (g: number[], s: string) => s.split(',').flatMap((x) => { const [a, b, n] = x.split(' '); return g.map((d) => ({ giorno: d, dalle: a, alle: b, persone: +n })); });
    const fasce = [...F([1, 2, 3, 4], '10:00 12:00 1,12:00 17:00 2,17:00 20:00 1'), ...F([5], '10:00 11:00 1,11:00 18:00 2,18:00 20:00 1'),
      ...F([6], '10:00 11:00 2,11:00 12:00 3,12:00 15:00 2,15:00 18:00 4,18:00 19:00 2,19:00 20:00 1'),
      ...F([7], '10:00 11:00 2,11:00 14:00 3,14:00 18:00 4,18:00 19:00 3,19:00 20:00 1')];
    const giorni = costruisciGiorni(date, orari, fasce, []);
    // 152 ore di contratto contro 134 che servono: con i turni tutti uguali
    // restavano 10 ore e mezza scoperte nel weekend
    const persone = [36, 32, 34, 20, 30].map((ore, i) => persona(`p${i}`, ore));
    const esito = proponiSettimana({ giorni, persone });
    // con il ritocco finale (20/10/2026) non resta scoperto quasi niente: col turno
    // minimo di 4 ore (Patrizio, 20/10/2026) mezz'ora non si copre senza un pezzo corto
    expect(oreScoperte(giorni, esito.turni)).toBeLessThanOrEqual(0.5);
    for (const p of persone) expect(esito.ore[p.id].pianificate).toBeLessThanOrEqual(p.ore + 1e-9);
    // nessun turno sotto le 4 ore
    expect(esito.turni.every((t) => oreLavorate(t) >= 4 - 1e-9)).toBe(true);
  });
});

describe('eventi dei negozi (Black Friday, feste, saldi)', () => {
  const ev = (over: Partial<EventoNegozio> = {}): EventoNegozio => ({
    nome: 'Black Friday', data_dal: '2026-10-23', data_al: '2026-10-25', outlet_ids: null,
    persone_extra: 1, blocca_ferie: true, straordinari: true, ...over,
  });

  it('vale per tutti i negozi o solo per quelli scelti', () => {
    expect(eventiDelNegozio([ev()], 'x')).toHaveLength(1);
    expect(eventiDelNegozio([ev({ outlet_ids: ['a', 'b'] })], 'x')).toHaveLength(0);
    expect(eventiDelNegozio([ev({ outlet_ids: ['a', 'b'] })], 'b')).toHaveLength(1);
  });

  it('nei suoi giorni aggiunge le persone in piu\' e il nome, non apre un giorno chiuso', () => {
    const chiusoDom = orari.map((o) => (o.giorno === 7 ? { ...o, chiuso: true } : o));
    const g = costruisciGiorni(settimana, chiusoDom, fasce, [], [ev()]);
    expect(g[3].fabbisogno.every((n) => n === 2)).toBe(true); // giovedi', fuori evento
    expect(g[3].evento).toBeNull();
    expect(g[4].fabbisogno.every((n) => n === 3)).toBe(true); // venerdi', Black Friday
    expect(g[4]).toMatchObject({ evento: 'Black Friday', straordinari: true });
    expect(g[6].chiuso).toBe(true);
  });

  it('straordinari solo nei giorni di evento, e solo se le ore di contratto non bastano', () => {
    // 2 persone a 16 ore: senza evento coprono 32 ore e basta. Con l'evento
    // del venerdi' servono piu' ore e la proposta va oltre il contratto
    // solo quel giorno.
    const giorni = costruisciGiorni(settimana, orari, [1, 2, 3, 4, 5, 6, 7].map((g) => ({ giorno: g, dalle: '10:00', alle: '20:00', persone: 1 })), [],
      [ev({ data_dal: '2026-10-23', data_al: '2026-10-23', persone_extra: 1 })]);
    const persone = [persona('a', 16), persona('b', 16)];
    const esito = proponiSettimana({ giorni, persone });
    const straord = esito.ore.a.straordinario! + esito.ore.b.straordinario!;
    expect(straord).toBeGreaterThan(0);
    // il venerdi' resta meno scoperto che senza straordinari
    const senzaStraord = proponiSettimana({ giorni: giorni.map((g) => ({ ...g, straordinari: false })), persone });
    expect(oreScoperte([giorni[4]], esito.turni)).toBeLessThan(oreScoperte([giorni[4]], senzaStraord.turni));
    // gli altri giorni restano come senza evento: le ore in piu' vanno solo sul venerdi'
    for (const t of esito.turni.filter((x) => x.data !== '2026-10-23')) expect(oreLavorate(t)).toBeLessThanOrEqual(8);
    // fuori dall'evento nessuno supera il contratto per coprire gli altri giorni
    const senzaEvento = proponiSettimana({ giorni: costruisciGiorni(settimana, orari, [1, 2, 3, 4, 5, 6, 7].map((g) => ({ giorno: g, dalle: '10:00', alle: '20:00', persone: 1 })), []), persone });
    expect(senzaEvento.ore.a.straordinario).toBe(0);
    expect(senzaEvento.ore.b.straordinario).toBe(0);
  });

  it('senza «straordinari» l\'evento resta scoperto invece di andare oltre il contratto', () => {
    const giorni = costruisciGiorni(settimana, orari, [1, 2, 3, 4, 5, 6, 7].map((g) => ({ giorno: g, dalle: '10:00', alle: '20:00', persone: 1 })), [],
      [ev({ data_dal: '2026-10-23', data_al: '2026-10-23', straordinari: false })]);
    const esito = proponiSettimana({ giorni, persone: [persona('a', 16), persona('b', 16)] });
    expect(esito.ore.a.straordinario).toBe(0);
    expect(esito.ore.b.straordinario).toBe(0);
  });
});

describe('rispettaFasce', () => {
  it('accorcia il turno dentro la fascia e toglie quello che scende sotto il minimo', () => {
    const fasce = new Map([['2026-11-02', { dalle: 14 * 60, alle: 20 * 60 }]]);
    const turni = [
      { employeeId: 'a', data: '2026-11-02', inizio: '10:00', fine: '19:00', pausaMinuti: 60 },
      { employeeId: 'a', data: '2026-11-03', inizio: '10:00', fine: '15:00', pausaMinuti: 0 },
    ];
    const out = rispettaFasce(turni, [{ id: 'a', fasce }]);
    expect(out[0]).toEqual({ employeeId: 'a', data: '2026-11-02', inizio: '14:00', fine: '19:00', pausaMinuti: 0 });
    expect(out[1].inizio).toBe('10:00');
    const corto = rispettaFasce([{ employeeId: 'a', data: '2026-11-02', inizio: '10:00', fine: '16:00', pausaMinuti: 0 }], [{ id: 'a', fasce }]);
    expect(corto).toEqual([]);
  });
});

describe('straordinari degli eventi a chi ne ha fatti meno (Patrizio, 02/11/2026)', () => {
  it('prima si allunga chi non ne ha fatti, poi si dà un turno nuovo', () => {
    // Black Friday 2026 a Barberino: un turno nuovo intero a chi aveva un giorno libero
    // copriva di piu' e vinceva sempre. Qui manca una persona dalle 14 alle 20.
    const giorni = costruisciGiorni(['2026-11-27'], [{ giorno: 5, chiuso: false, apre: '10:00', chiude: '20:00' }],
      [{ giorno: 5, dalle: '10:00', alle: '20:00', persone: 2 }], [],
      [{ nome: 'Black Friday', data_dal: '2026-11-27', data_al: '2026-11-27', outlet_ids: null, persone_extra: 0, blocca_ferie: true, straordinari: true }]);
    const persone = [
      { id: 'part', ore: 0, nonDisponibile: new Set<string>() },
      { id: 'b', ore: 4, nonDisponibile: new Set<string>() },
      { id: 'c', ore: 4, nonDisponibile: new Set<string>() },
    ];
    const proposti: Turno[] = [
      { employeeId: 'b', data: '2026-11-27', inizio: '10:00', fine: '14:00', pausaMinuti: 0 },
      { employeeId: 'c', data: '2026-11-27', inizio: '10:00', fine: '14:00', pausaMinuti: 0 },
    ];
    const out = ritoccaScoperture(giorni, proposti, [], persone, REGOLE_DEFAULT, new Set(['2026-11-27']));
    // Le due colleghe allungano in parti uguali. Dall'11/11/2026 la pausa non toglie
    // nessuno dal negozio: senza buchi da pausa non serve un turno nuovo a chi era libera.
    const oltre = ['b', 'c'].map((id) => out.filter((t) => t.employeeId === id).reduce((a, t) => a + oreLavorate(t), 0) - 4);
    expect(Math.abs(oltre[0] - oltre[1])).toBeLessThanOrEqual(1);
    expect(oreScoperte(giorni, out)).toBe(0);
  });
});

describe('orario scritto a mano e pausa (Patrizio, 11/11/2026)', () => {
  const m = (h: string) => minuti(h);
  it('la pausa dipende dal lavoro e il turno si allunga alla presenza giusta', () => {
    // 12-18 sono 6 ore di presenza: con 6 ore di lavoro serve mezz'ora, il turno diventa 12-18:30
    expect(presenzaGiusta(m('12:00'), m('18:00'), REGOLE_DEFAULT, m('10:00'), m('20:00'))).toMatchObject({ inizio: m('12:00'), fine: m('18:30'), pausa: 30, lavoro: 360, allungato: true });
    // 7 ore e mezza di lavoro: 8 di presenza, nessun allungamento
    expect(presenzaGiusta(m('10:00'), m('18:00'))).toMatchObject({ pausa: 30, lavoro: 450, allungato: false });
    // 8 ore e mezza di presenza: con 8 di lavoro serve un'ora, il turno diventa di 9 ore
    expect(presenzaGiusta(m('10:00'), m('18:30'), REGOLE_DEFAULT, m('10:00'), m('20:00'))).toMatchObject({ fine: m('19:00'), pausa: 60, lavoro: 480, allungato: true });
    // 10 ore di presenza: 9 di lavoro e un'ora di pausa
    expect(presenzaGiusta(m('10:00'), m('20:00'))).toMatchObject({ pausa: 60, lavoro: 540, allungato: false });
    // sotto le 6 ore nessuna pausa
    expect(presenzaGiusta(m('10:00'), m('15:30'))).toMatchObject({ pausa: 0, lavoro: 330, allungato: false });
    // alla chiusura non si allunga la fine: si anticipa l'inizio
    expect(presenzaGiusta(m('14:00'), m('20:00'), REGOLE_DEFAULT, m('10:00'), m('20:00'))).toMatchObject({ inizio: m('13:30'), fine: m('20:00'), pausa: 30, allungato: true });
  });
});
