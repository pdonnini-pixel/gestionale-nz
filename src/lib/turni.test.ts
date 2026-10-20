import { describe, it, expect } from 'vitest';
import {
  costruisciGiorni, proponiSettimana, giorniDellaSettimana, lunediDi, giornoIso, oreLavorate, pausaPer,
  scopertureDelGiorno, oreDaCoprire, minuti, collocaPause, copertura, type OrarioGiornoTipo, type FasciaFabbisogno, type PersonaTurni, type Turno,
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
        expect(oreLavorate(t)).toBeGreaterThanOrEqual(4);
        expect(oreLavorate(t)).toBeLessThanOrEqual(8);
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

  it('quando non si può coprire tutto, usa comunque tutte le ore di contratto', () => {
    const esito = proponiSettimana({ giorni, persone: ['a', 'b', 'c', 'd'].map((id) => persona(id, 40)) });
    expect(Object.values(esito.ore).every((o) => o.pianificate === 40)).toBe(true);
    expect(esito.scoperture.length).toBeGreaterThan(0);
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
  it('30 minuti da 6 ore lavorate, un\'ora da 8', () => {
    expect(pausaPer(5.5 * 60)).toBe(0);
    expect(pausaPer(6 * 60)).toBe(30);
    expect(pausaPer(7.5 * 60)).toBe(30);
    expect(pausaPer(8 * 60)).toBe(60);
  });

  it('un turno da 8 ore occupa 9 ore di negozio; se non ci sta si accorcia', () => {
    const lun = costruisciGiorni(['2026-10-19'], [{ giorno: 1, chiuso: false, apre: '10:00', chiude: '18:30' }], [{ giorno: 1, dalle: '10:00', alle: '18:30', persone: 1 }], []);
    const esito = proponiSettimana({ giorni: lun, persone: [persona('a', 8)] });
    // 8 ore + un'ora non stanno in 8 ore e mezza: 7,5 ore con 30 minuti di pausa
    expect(esito.turni).toHaveLength(1);
    expect(oreLavorate(esito.turni[0])).toBe(7.5);
    expect(esito.turni[0].pausaMinuti).toBe(30);
  });
});

describe('pause: chi e\' in pausa non e\' in negozio', () => {
  const LUN = '2026-10-19';
  const giorno = (persone: number) => costruisciGiorni([LUN], [{ giorno: 1, chiuso: false, apre: '10:00', chiude: '20:00' }], [{ giorno: 1, dalle: '10:00', alle: '20:00', persone }], [])[0];

  it('una persona sola: la pausa lascia il negozio scoperto, e lo si dice', () => {
    const t = [{ employeeId: 'a', data: LUN, inizio: '10:00', fine: '19:00', pausaMinuti: 60 }];
    const [p] = collocaPause(giorno(1), t);
    // almeno due ore di lavoro prima e due dopo
    expect(minuti(p.dalle)).toBeGreaterThanOrEqual(minuti('12:00'));
    expect(minuti(p.alle)).toBeLessThanOrEqual(minuti('17:00'));
    const s = scopertureDelGiorno(giorno(1), t);
    expect(s.some((x) => x.dalle === p.dalle && x.alle === p.alle)).toBe(true);
  });

  it('due persone che si sovrappongono: le pause cadono dove c\'e\' l\'altra', () => {
    const t = [
      { employeeId: 'a', data: LUN, inizio: '10:00', fine: '16:30', pausaMinuti: 30 },
      { employeeId: 'b', data: LUN, inizio: '13:30', fine: '20:00', pausaMinuti: 30 },
    ];
    const g = giorno(1);
    const cop = copertura(g, t);
    expect(cop.every((c) => c >= 1)).toBe(true);
    expect(scopertureDelGiorno(g, t)).toEqual([]);
    const pause = collocaPause(g, t);
    expect(pause).toHaveLength(2);
    expect(pause[0].dalle).not.toBe(pause[1].dalle);
  });

  it('la proposta tiene conto delle pause: con 2 persone sempre servono pause sfalsate', () => {
    const date = giorniDellaSettimana('2026-10-19');
    const g7 = costruisciGiorni(date, [1, 2, 3, 4, 5, 6, 7].map((g) => ({ giorno: g, chiuso: false, apre: '10:00', chiude: '20:00' })),
      [1, 2, 3, 4, 5, 6, 7].map((g) => ({ giorno: g, dalle: '10:00', alle: '20:00', persone: 2 })), []);
    const esito = proponiSettimana({ giorni: g7, persone: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => persona(id, 40)) });
    expect(esito.scoperture).toEqual([]);
    for (const g of g7) expect(copertura(g, esito.turni).every((c) => c >= 2)).toBe(true);
  });
});
