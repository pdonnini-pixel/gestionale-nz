// Le regole del 12/11/2026 (Patrizio): il lunedi' a due persone con la coppia a
// rotazione, il pezzo di settimana nel piano del mese, lo straordinario dei giorni
// forti ricalcolato dopo una modifica a mano, chi non e' piu' in servizio fuori dai turni.
import { describe, it, expect } from 'vitest';
import {
  costruisciGiorni, giorniDellaSettimana, giornoIso, opzioniGiorni, oreLavorate, proponiSettimana, regoleDaRiga, scopertureDelGiorno,
  type GiornoPiano, type PersonaTurni, type Turno,
} from './turni';
import { fabbisognoDaTraffico, almenoDuePersone, tettoDelLunedi, pianificaMese } from './pianoMensile';
import {
  ottimizzaSettimana, sceltePerLaSettimana, derogheSettimana, coppia, coppiaDelGiorno, coppieDeiLunedi, straordinariDaRiscrivere, type TurnoSalvato,
} from './ottimizzaTurni';
import { personaAllaData, presenzaNeiTurni, type SchedaPersona, type EventoOrganico } from './organico';

// Un negozio inventato sul modello di quello di prova: aperto 10-20, quattro persone,
// giorni caldi accesi, due riposi a testa.
const riga = {
  turno_min_ore: 4, turno_max_ore: 10, pausa_oltre_ore: 6, pausa_minuti: 10, pausa_lunga_oltre_ore: 8, pausa_lunga_minuti: 30,
  giorni_lavoro_max: 6, soglia_ingressi_feriali: 25, soglia_ingressi_weekend: 35, due_persone: false, pausa_corta_pagata: true, giorni_pieni: true,
  riposi_min_settimana: 2, straordinari_pari: true, caldi_fasce_festivi: 'sabato', caldi_guida_apre_chiude: true, caldi_ore_apertura: 9,
};
const regole = regoleDaRiga({ ...riga, lunedi_due_persone: true });
const regoleSpente = regoleDaRiga(riga);
const orari = [1, 2, 3, 4, 5, 6, 7].map((giorno) => ({ giorno, chiuso: false, apre: '10:00', chiude: '20:00' }));
const fasceFeriali = (lunedi: number) => [1, 2, 3, 4, 5].flatMap((giorno) => [
  { giorno, dalle: '10:00', alle: '12:00', persone: 1, origine: 'manuale' },
  { giorno, dalle: '12:00', alle: '18:00', persone: giorno === 1 ? lunedi : 2, origine: 'manuale' },
  { giorno, dalle: '18:00', alle: '20:00', persone: 1, origine: 'manuale' }]);
const fasceWeekend = [6, 7].flatMap((giorno) => [
  { giorno, dalle: '10:00', alle: '10:30', persone: 1, origine: 'manuale' }, { giorno, dalle: '10:30', alle: '11:00', persone: 2, origine: 'manuale' },
  { giorno, dalle: '11:00', alle: '19:00', persone: 4, origine: 'manuale' }, { giorno, dalle: '19:00', alle: '20:00', persone: 1, origine: 'manuale' }]);
const ORE: Record<string, number> = { anna: 40, bea: 30, carla: 30, dora: 30 };
const persone = (): PersonaTurni[] => Object.entries(ORE).map(([id, ore]) => ({ id, ore, nonDisponibile: new Set<string>(), saldoOre: 0 }));
// ingressi per ora: il lunedi' ne ha abbastanza da chiedere tre persone a mezzogiorno (80 / 25)
const attesoDi = (date: string[], lunedi = 80) => new Map(date.map((d) => {
  const g = giornoIso(d);
  const v = g >= 6 ? 120 : g === 1 ? lunedi : 30;
  return [d, Array.from({ length: 24 }, (_, h) => (h >= 10 && h < 20 ? (h >= 12 && h < 17 ? v : 10) : 0))];
}));
type Ev = { nome: string; data_dal: string; data_al: string; outlet_ids: null; persone_extra: number; blocca_ferie: boolean; straordinari: boolean };
function settimana(lunedi: string, r = regole, opz: { fasceLunedi?: number; eventi?: Ev[] } = {}): GiornoPiano[] {
  const date = giorniDellaSettimana(lunedi);
  const base = costruisciGiorni(date, orari, [...fasceFeriali(opz.fasceLunedi ?? 2), ...fasceWeekend], [], opz.eventi ?? [], null, opzioniGiorni(r));
  return fabbisognoDaTraffico(base, attesoDi(date), r, new Map(date.map((d) => [d, 4])), new Map());
}
function sistema(giorni: GiornoPiano[], r = regole, lunediPrima: string[] = [], guida = ['anna', 'bea']): Turno[] {
  const p = proponiSettimana({ giorni, persone: persone(), regole: r, fissi: [] });
  const prima = almenoDuePersone(giorni, p.turni, persone(), [], r, []);
  return ottimizzaSettimana(giorni, prima, persone(), r, { guida, lunediPrima, ...sceltePerLaSettimana({ giorni, regole: r, responsabile: guida[0], vice: guida[1] }) });
}
const chiIl = (turni: Turno[], data: string) => [...new Set(turni.filter((t) => t.data === data).map((t) => t.employeeId))].sort();

describe('il lunedì a due persone', () => {
  it('il tetto: il lunedì il fabbisogno non supera due persone, anche se MODA e le fasce ne chiedono tre', () => {
    const acceso = settimana('2026-11-16', regole, { fasceLunedi: 3 });
    const spento = settimana('2026-11-16', regoleSpente, { fasceLunedi: 3 });
    expect(Math.max(...spento[0].fabbisogno)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...acceso[0].fabbisogno)).toBe(2);
    expect(Math.max(...(acceso[0].minimo ?? [0]))).toBe(2);
    expect(acceso[0].lunediDue).toBe(true);
    expect(acceso[0].lunediFasceOltre).toBe(true);
    // gli altri giorni non cambiano
    expect(acceso.slice(1).map((g) => g.fabbisogno)).toEqual(spento.slice(1).map((g) => g.fabbisogno));
    // spenta: i giorni sono gli stessi oggetti, niente segni
    expect(spento[0].lunediDue).toBeUndefined();
    expect(tettoDelLunedi(spento[0], regoleSpente)).toBe(spento[0]);
  });

  it('un lunedì festivo o dentro un evento segue le regole dei giorni caldi, non il tetto', () => {
    // lunedì 7/12/2026 dentro un evento
    const evento: Ev[] = [{ nome: 'Ponte', data_dal: '2026-12-07', data_al: '2026-12-08', outlet_ids: null, persone_extra: 0, blocca_ferie: true, straordinari: true }];
    const g = settimana('2026-12-07', regole, { eventi: evento })[0];
    expect(g.lunediDue).toBeUndefined();
    // lunedì di Pasquetta (6/4/2026): festivo
    const pasquetta = settimana('2026-04-06')[0];
    expect(pasquetta.lunediDue).toBeUndefined();
  });

  it('il motore mette due persone esatte il lunedì, una è la responsabile o la vice, e il negozio resta coperto', () => {
    const giorni = settimana('2026-11-16');
    const turni = sistema(giorni);
    const lun = chiIl(turni, '2026-11-16');
    expect(lun).toHaveLength(2);
    expect(lun.some((id) => id === 'anna' || id === 'bea')).toBe(true);
    expect(scopertureDelGiorno(giorni[0], turni)).toEqual([]);
    // nessun turno sotto le 4 ore
    expect(turni.every((t) => oreLavorate(t) >= 4)).toBe(true);
  });

  it('la coppia cambia da un lunedì al successivo, sempre con responsabile o vice', () => {
    const viste: string[] = [];
    for (const lunedi of ['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']) {
      const turni = sistema(settimana(lunedi), regole, viste);
      const k = coppiaDelGiorno(turni, lunedi);
      expect(k).not.toBeNull();
      expect(k).not.toBe(viste[0]);
      expect(k!.includes('anna') || k!.includes('bea')).toBe(true);
      viste.unshift(k!);
    }
    expect(new Set(viste).size).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('spenta, il lunedì resta com\'era: stessi turni con e senza le coppie dei lunedì prima', () => {
    const giorni = settimana('2026-11-16', regoleSpente);
    const a = sistema(giorni, regoleSpente, []);
    const b = sistema(giorni, regoleSpente, [coppia('anna', 'bea')]);
    expect(b).toEqual(a);
  });

  it('le deroghe: tre persone, la stessa coppia del lunedì prima, le fasce che chiedono di più', () => {
    const giorni = settimana('2026-11-16', regole, { fasceLunedi: 3 });
    const t = (employeeId: string, data: string, inizio: string, fine: string): Turno => ({ employeeId, data, inizio, fine, pausaMinuti: 0 });
    const args = { giorni, persone: persone().map((p) => ({ ...p, nome: p.id })), regole, guida: { responsabile: 'anna', vice: 'bea' } };
    const tre = derogheSettimana({ ...args, turni: [t('anna', '2026-11-16', '10:00', '16:00'), t('bea', '2026-11-16', '12:00', '18:00'), t('carla', '2026-11-16', '14:00', '20:00')] });
    expect(tre.map((d) => d.regola)).toContain('lunedi_troppi');
    expect(tre.map((d) => d.regola)).toContain('lunedi_fasce');
    const stessa = derogheSettimana({ ...args, lunediPrima: [coppia('anna', 'carla')], turni: [t('anna', '2026-11-16', '10:00', '18:00'), t('carla', '2026-11-16', '12:00', '20:00')] });
    expect(stessa.map((d) => d.regola)).toContain('lunedi_coppia');
    const diversa = derogheSettimana({ ...args, lunediPrima: [coppia('anna', 'dora')], turni: [t('anna', '2026-11-16', '10:00', '18:00'), t('carla', '2026-11-16', '12:00', '20:00')] });
    expect(diversa.map((d) => d.regola)).not.toContain('lunedi_coppia');
    expect(diversa.map((d) => d.regola)).not.toContain('lunedi_troppi');
  });

  it('coppieDeiLunedi: dal lunedì più recente, solo i lunedì con due persone esatte', () => {
    const t = (employeeId: string, data: string): Turno => ({ employeeId, data, inizio: '10:00', fine: '18:00', pausaMinuti: 0 });
    const turni = [t('a', '2026-11-02'), t('b', '2026-11-02'), t('a', '2026-11-09'), t('b', '2026-11-09'), t('c', '2026-11-09'), t('c', '2026-11-16'), t('a', '2026-11-16'), t('a', '2026-11-17'), t('b', '2026-11-17')];
    expect(coppieDeiLunedi(turni)).toEqual([coppia('a', 'c'), coppia('a', 'b')]);
  });
});

describe('piano del mese: il pezzo di settimana di un giorno (lunedì 30/11/2026)', () => {
  const mese = '2026-11';
  const tutte: string[] = [];
  for (let d = new Date('2026-10-26T12:00:00Z'); tutte.length < 42; d.setUTCDate(d.getUTCDate() + 1)) tutte.push(d.toISOString().slice(0, 10));
  const fasce = [...fasceFeriali(2), ...fasceWeekend];
  const personeMese = () => Object.entries(ORE).map(([id, ore]) => ({ id, oreSettimana: ore, nonDisponibile: new Set<string>(), oreFerie: new Map<string, number>() }));
  const piano = (r: ReturnType<typeof regoleDaRiga>) => pianificaMese({
    mese, giorni: costruisciGiorni(tutte, orari, fasce, [], [], null, opzioniGiorni(r)), persone: personeMese(), regola: 'nessuno',
    storicoWeekend: new Map(), atteso: attesoDi(tutte, 30), regole: r,
    nuove: { giornoLibero: new Map(), guida: ['anna', 'bea'], responsabile: 'anna', vice: 'bea', coppiePrima: new Map(), lunediPrima: [] },
  });
  const esito = piano(regole);
  const del30 = esito.turni.filter((t) => t.data === '2026-11-30');

  it('due persone con turni lunghi, non quattro turni da 4 ore per «stare in linea»', () => {
    expect(new Set(del30.map((t) => t.employeeId)).size).toBe(2);
    expect(del30.reduce((a, t) => a + oreLavorate(t), 0)).toBeGreaterThanOrEqual(14);
    expect(scopertureDelGiorno(esito.giorni.find((g) => g.data === '2026-11-30')!, del30)).toEqual([]);
  }, 60_000);

  it('le ore di contratto del pezzo sono quelle messe in turno: il resto della settimana resta a dicembre', () => {
    for (const id of Object.keys(ORE)) {
      const fatte = del30.filter((t) => t.employeeId === id).reduce((a, t) => a + oreLavorate(t), 0);
      expect(esito.persone[id].settimane?.['2026-11-30']).toBeCloseTo(fatte, 6);
    }
    const s = esito.settimane.find((w) => w.lunedi === '2026-11-30')!;
    expect(s.nonUsate).toBeCloseTo(0, 6);
    expect(s.contratto).toBeCloseTo(s.pianificate, 6);
  });

  it('i lunedì del mese: sempre due persone, mai la stessa coppia due volte di fila', () => {
    const coppie = ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'].map((d) => coppiaDelGiorno(esito.turni, d));
    coppie.forEach((k) => expect(k).not.toBeNull());
    for (let i = 1; i < coppie.length; i++) expect(coppie[i]).not.toBe(coppie[i - 1]);
  });

  it('dove il negozio non ha le scelte nuove il pezzo resta in proporzione, come prima', () => {
    const vecchie = regoleDaRiga({ turno_min_ore: 4, turno_max_ore: 10, pausa_oltre_ore: 6, pausa_minuti: 30, pausa_lunga_oltre_ore: 8, pausa_lunga_minuti: 60, giorni_lavoro_max: 6, soglia_ingressi_feriali: 25, soglia_ingressi_weekend: 25, due_persone: true });
    const e = piano(vecchie);
    // la quota di un giorno su sette, con il minimo di un turno: nessuno arriva alla settimana intera
    for (const id of Object.keys(ORE)) expect(e.persone[id].settimane?.['2026-11-30'] ?? 0).toBeLessThanOrEqual(ORE[id] / 2);
  }, 60_000);
});

describe('lo straordinario «giorno forte» ricalcolato dopo una modifica a mano', () => {
  const forti = new Set(['2026-11-21', '2026-11-22']);
  const t = (id: string, data: string, inizio: string, fine: string, oreStraordinario = 0, motivo: string | null = null, employeeId = 'anna'): TurnoSalvato =>
    ({ id, employeeId, data, inizio, fine, pausaMinuti: 0, oreStraordinario, motivo });
  // 40 ore di contratto: 4 feriali da 8 + sabato 6 + domenica 6 = 44, 4 di straordinario (2 + 2)
  const base = () => [
    t('lu', '2026-11-16', '10:00', '18:00'), t('ma', '2026-11-17', '10:00', '18:00'), t('me', '2026-11-18', '10:00', '18:00'), t('gi', '2026-11-19', '10:00', '18:00'),
    t('sa', '2026-11-21', '10:00', '16:00', 2, 'giorno_forte'), t('do', '2026-11-22', '10:00', '16:00', 2, 'giorno_forte'),
  ];
  const contratto = new Map([['anna', 40]]);

  it('se i valori scritti sono giusti non riscrive niente', () => {
    expect(straordinariDaRiscrivere(base(), contratto, forti)).toEqual([]);
  });
  it('turno accorciato: lo straordinario scende', () => {
    const turni = base().map((x) => (x.id === 'sa' ? { ...x, fine: '14:00' } : x)); // 42 ore: 2 di straordinario
    expect(straordinariDaRiscrivere(turni, contratto, forti)).toEqual([{ id: 'sa', ore: 1 }, { id: 'do', ore: 1 }]);
  });
  it('turno allungato: lo straordinario sale, a mezz\'ore', () => {
    const turni = base().map((x) => (x.id === 'do' ? { ...x, fine: '17:30' } : x)); // 45,5 ore: 5,5 di straordinario
    expect(straordinariDaRiscrivere(turni, contratto, forti)).toEqual([{ id: 'sa', ore: 3 }, { id: 'do', ore: 2.5 }]);
  });
  it('turno feriale tolto: si torna nel contratto e lo straordinario si azzera', () => {
    const turni = base().filter((x) => x.id !== 'gi'); // 36 ore
    expect(straordinariDaRiscrivere(turni, contratto, forti)).toEqual([{ id: 'sa', ore: 0 }, { id: 'do', ore: 0 }]);
  });
  it('turno del sabato dato a una collega: a lei compare, a chi l\'ha dato si ricalcola', () => {
    const turni = [...base().map((x) => (x.id === 'sa' ? { ...x, employeeId: 'bea' } : x)),
      ...['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'].map((d, i) => t(`b${i}`, d, '12:00', '20:00', 0, null, 'bea'))];
    // anna: 38 ore, niente straordinario; bea: 32 + 6 = 38 ore su 30 di contratto, 8 di straordinario ma il turno ne regge 6
    const cambi = straordinariDaRiscrivere(turni, new Map([['anna', 40], ['bea', 30]]), forti);
    expect(cambi).toContainEqual({ id: 'do', ore: 0 });
    expect(cambi).toContainEqual({ id: 'sa', ore: 6 });
  });
  it('ricarico e allestimento segnati a mano non si toccano e si tolgono prima di dividere', () => {
    // giovedì allungato di 2 ore per ricarico: 46 ore, 6 oltre il contratto, 2 sono a mano, ne restano 4 (2 + 2)
    const turni = base().map((x) => (x.id === 'gi' ? { ...x, fine: '20:00', oreStraordinario: 2, motivo: 'ricarico' } : x));
    expect(straordinariDaRiscrivere(turni, contratto, forti)).toEqual([]);
    // allestimento di domenica: quel turno resta com'è, il resto va sul sabato
    const dom = base().map((x) => (x.id === 'do' ? { ...x, oreStraordinario: 3, motivo: 'allestimento' } : x));
    expect(straordinariDaRiscrivere(dom, contratto, forti)).toEqual([{ id: 'sa', ore: 1 }]);
  });
  it('vale anche per i turni pubblicati e per chi non ha il motivo scritto (piano del mese)', () => {
    const turni = base().map((x) => ({ ...x, motivo: null }));
    // valori giusti ma senza motivo: si riscrivono per segnare «giorno forte»
    expect(straordinariDaRiscrivere(turni, contratto, forti)).toEqual([{ id: 'sa', ore: 2 }, { id: 'do', ore: 2 }]);
  });
  it('chi non ha contratto nella mappa non viene toccato', () => {
    expect(straordinariDaRiscrivere(base(), new Map(), forti)).toEqual([]);
  });
});

describe('chi non è più in servizio non si vede nei turni', () => {
  const scheda: SchedaPersona = {
    id: 'x', nome: 'Prova', cognome: 'Persona', outlet_id: 'o1', is_active: true, contratto_tipo: 'determinato',
    data_assunzione: '2026-11-02', data_cessazione: null, scadenza_td: '2027-01-31', ore_settimanali: 30,
  } as SchedaPersona;
  const date = giorniDellaSettimana('2026-11-16');
  const perGiorno = (s: SchedaPersona, ev: EventoOrganico[] = []) => date.map((d) => personaAllaData(s, ev, d));

  it('in servizio tutta la settimana: si vede, senza segni', () => {
    expect(presenzaNeiTurni(perGiorno(scheda), date, 'o1', false)).toEqual({ inForza: true, finoAl: null });
  });
  it('uscita prima della settimana e senza turni: non si vede', () => {
    const uscita = { ...scheda, is_active: false, data_cessazione: '2026-11-10' } as SchedaPersona;
    expect(presenzaNeiTurni(perGiorno(uscita), date, 'o1', false)).toBeNull();
  });
  it('uscita prima della settimana ma con un turno ancora salvato: si vede, segnalata', () => {
    const uscita = { ...scheda, is_active: false, data_cessazione: '2026-11-10' } as SchedaPersona;
    expect(presenzaNeiTurni(perGiorno(uscita), date, 'o1', true)).toEqual({ inForza: false, finoAl: null });
  });
  it('esce a metà settimana: si vede, con l\'ultimo giorno', () => {
    const esce = { ...scheda, data_cessazione: '2026-11-18' } as SchedaPersona;
    expect(presenzaNeiTurni(perGiorno(esce), date, 'o1', false)).toEqual({ inForza: true, finoAl: '2026-11-18' });
  });
  it('di un altro negozio: non si vede, salvo un turno salvato qui', () => {
    expect(presenzaNeiTurni(perGiorno(scheda), date, 'o2', false)).toBeNull();
    expect(presenzaNeiTurni(perGiorno(scheda), date, 'o2', true)).toEqual({ inForza: false, finoAl: null });
  });
});
