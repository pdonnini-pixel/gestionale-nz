import { describe, it, expect } from 'vitest';
import {
  costruisciGiorni, giorniDellaSettimana, giornoIso, minuti, opzioniGiorni, oreLavorate, oreScoperte, pausaMinimaPerPresenza, pausaPagataDelTurno, pausaPer, presenzaGiusta, proponiSettimana, regoleDaRiga,
  type GiornoPiano, type PersonaTurni, type Turno,
} from './turni';
import { fabbisognoDaTraffico, almenoDuePersone } from './pianoMensile';
import { ottimizzaSettimana, scegliGiorniLiberi, coppieFeriali, coppia, derogheSettimana, ripartisciStraordinari, sceltePerLaSettimana, contoSettimana } from './ottimizzaTurni';

// Un negozio inventato sul modello di quello da cui sono nate le regole
// (Patrizio, 11/11/2026): aperto 10-20, fasce 1-2-1, quattro persone.
const regole = regoleDaRiga({
  turno_min_ore: 4, turno_max_ore: 10, pausa_oltre_ore: 6, pausa_minuti: 10, pausa_lunga_oltre_ore: 8, pausa_lunga_minuti: 30,
  giorni_lavoro_max: 6, soglia_ingressi_feriali: 25, soglia_ingressi_weekend: 35, due_persone: false,
});
const orari = [1, 2, 3, 4, 5, 6, 7].map((giorno) => ({ giorno, chiuso: false, apre: '10:00', chiude: '20:00' }));
const fasce = [
  ...[1, 2, 3, 4, 5].flatMap((giorno) => [
    { giorno, dalle: '10:00', alle: '12:00', persone: 1, origine: 'manuale' },
    { giorno, dalle: '12:00', alle: '18:00', persone: 2, origine: 'manuale' },
    { giorno, dalle: '18:00', alle: '20:00', persone: 1, origine: 'manuale' }]),
  ...[6, 7].flatMap((giorno) => [
    { giorno, dalle: '10:00', alle: '11:00', persone: 1, origine: 'manuale' },
    { giorno, dalle: '11:00', alle: '19:00', persone: 2, origine: 'manuale' },
    { giorno, dalle: '19:00', alle: '20:00', persone: 1, origine: 'manuale' }]),
];
const ingressi: Record<number, number[]> = {
  1: [7, 18, 21, 17, 21, 19, 17, 16, 12, 5], 5: [8, 19, 16, 15, 24, 20, 24, 18, 18, 12],
  6: [18, 53, 62, 56, 77, 70, 99, 103, 67, 28], 7: [26, 97, 109, 75, 108, 113, 164, 182, 132, 47],
};
// 136 ore di contratto per circa 129 ore di presenza da coprire: con le pause da 10 e 30 minuti
// un'ora lavorata copre poco piu' di un'ora di negozio, e la domenica servono due persone all'apertura
const ORE: Record<string, number> = { anna: 40, bea: 32, carla: 32, dora: 32 };
const persone = (): PersonaTurni[] => Object.entries(ORE).map(([id, ore]) => ({ id, ore, nonDisponibile: new Set<string>(), saldoOre: 0 }));

function settimana(lunedi: string, eventi: { nome: string; data_dal: string; data_al: string; outlet_ids: null; persone_extra: number; blocca_ferie: boolean; straordinari: boolean }[] = []): GiornoPiano[] {
  const date = giorniDellaSettimana(lunedi);
  const base = costruisciGiorni(date, orari, fasce, [], eventi);
  const atteso = new Map(date.map((d) => {
    const g = giornoIso(d);
    const ore = ingressi[g >= 5 ? g : 1];
    return [d, Array.from({ length: 24 }, (_, h) => (h >= 10 && h < 20 ? ore[h - 10] : 0))];
  }));
  return fabbisognoDaTraffico(base, atteso, regole, new Map(date.map((d) => [d, 4])), new Map());
}
const proposta = (giorni: GiornoPiano[]): Turno[] => {
  const p = proponiSettimana({ giorni, persone: persone(), regole, fissi: [] });
  return almenoDuePersone(giorni, p.turni, persone(), [], regole, []);
};
const oreDi = (turni: Turno[], id: string) => turni.filter((t) => t.employeeId === id).reduce((a, t) => a + oreLavorate(t), 0);
const giornoLibero = new Map([['carla', 1], ['dora', 2], ['anna', 3], ['bea', 4]]);

describe('ottimizzaSettimana: le regole dell\'11/11/2026 pesate insieme', () => {
  const giorni = settimana('2026-11-16');
  const prima = proposta(giorni);
  const dopo = ottimizzaSettimana(giorni, prima, persone(), regole, { giornoLibero, guida: ['anna', 'carla'], responsabile: 'anna' });

  it('la settimana sistemata non ha ore scoperte e non peggiora la proposta di partenza', () => {
    expect(oreScoperte(giorni, dopo)).toBeLessThanOrEqual(oreScoperte(giorni, prima));
    expect(oreScoperte(giorni, dopo)).toBe(0);
  });

  it('sabato e domenica lavorano tutti', () => {
    for (const g of giorni.filter((x) => giornoIso(x.data) >= 6)) {
      for (const id of Object.keys(ORE)) expect(dopo.some((t) => t.employeeId === id && t.data === g.data), `${id} ${g.data}`).toBe(true);
    }
  });

  it('nessuno lavora nel suo giorno libero fisso', () => {
    for (const t of dopo) expect(giornoLibero.get(t.employeeId), `${t.employeeId} ${t.data}`).not.toBe(giornoIso(t.data));
  });

  it('il lunedì c\'è la responsabile o la vice', () => {
    const lun = giorni.find((g) => giornoIso(g.data) === 1)!;
    expect(dopo.some((t) => t.data === lun.data && (t.employeeId === 'anna' || t.employeeId === 'carla'))).toBe(true);
  });

  it('vincoli duri: turni da 4 a 10 ore, un turno al giorno, al massimo 6 giorni, mai oltre il contratto', () => {
    for (const t of dopo) {
      expect(oreLavorate(t)).toBeGreaterThanOrEqual(4);
      expect(oreLavorate(t)).toBeLessThanOrEqual(10);
    }
    for (const id of Object.keys(ORE)) {
      const suoi = dopo.filter((t) => t.employeeId === id);
      expect(new Set(suoi.map((t) => t.data)).size).toBe(suoi.length);
      expect(suoi.length).toBeLessThanOrEqual(6);
      expect(oreDi(dopo, id)).toBeLessThanOrEqual(ORE[id]);
    }
  });

  it('ogni giorno ha almeno due persone e nessuna mezz\'ora vuota', () => {
    for (const g of giorni) {
      expect(new Set(dopo.filter((t) => t.data === g.data).map((t) => t.employeeId)).size).toBeGreaterThanOrEqual(2);
    }
    expect(derogheSettimana({ giorni, turni: dopo, persone: persone().map((p) => ({ ...p, nome: p.id })), regole, giornoLibero, guida: { responsabile: 'anna', vice: 'carla' } })).toEqual([]);
  });

  it('stessa settimana, stesso risultato', () => {
    const ancora = ottimizzaSettimana(giorni, prima, persone(), regole, { giornoLibero, guida: ['anna', 'carla'], responsabile: 'anna' });
    expect(ancora).toEqual(dopo);
  });

  it('ore fino al contratto: tutte a contratto pieno, senza perdere copertura', () => {
    const pieno = ottimizzaSettimana(giorni, prima, persone(), regole, { giornoLibero, guida: ['anna', 'carla'], responsabile: 'anna', riempiContratto: true });
    // con la pausa da 10 minuti le ore non cadono sempre sulla mezz'ora: restano meno di 30 minuti liberi
    for (const id of Object.keys(ORE)) {
      expect(oreDi(pieno, id)).toBeLessThanOrEqual(ORE[id] + 1e-9);
      expect(oreDi(pieno, id)).toBeGreaterThan(ORE[id] - 0.5);
    }
    expect(oreScoperte(giorni, pieno)).toBe(0);
    for (const t of pieno) expect(giornoLibero.get(t.employeeId)).not.toBe(giornoIso(t.data));
  });

  it('senza «ore fino al contratto» le ore che il traffico non chiede restano libere', () => {
    expect(Object.keys(ORE).reduce((a, id) => a + oreDi(dopo, id), 0)).toBeLessThan(136);
  });
});

describe('ottimizzaSettimana: turni fissi, eventi, partenze strane', () => {
  it('i turni fissi non si toccano e contano come presenza', () => {
    const giorni = settimana('2026-11-16');
    const fisso: Turno = { employeeId: 'anna', data: giorni[0].data, inizio: '10:00', fine: '13:00', pausaMinuti: 0 };
    const dopo = ottimizzaSettimana(giorni, [], persone(), regole, { giornoLibero }, [fisso]);
    expect(dopo).not.toContainEqual(fisso);
    expect(dopo.some((t) => t.employeeId === 'anna' && t.data === giorni[0].data)).toBe(false);
    expect(oreDi(dopo, 'anna')).toBeLessThanOrEqual(40 - 3);
  });

  it('oltre il contratto si va solo nei giorni di evento con straordinari', () => {
    const evento = [{ nome: 'Black Friday', data_dal: '2026-11-27', data_al: '2026-11-29', outlet_ids: null, persone_extra: 0, blocca_ferie: true, straordinari: true }];
    const giorni = settimana('2026-11-23', evento).map((g) => (giornoIso(g.data) >= 5 ? { ...g, fabbisogno: g.fabbisogno.map(() => 4), esatto: undefined } : g));
    const dopo = ottimizzaSettimana(giorni, proposta(giorni), persone(), regole, { giornoLibero });
    const feriali = new Set(giorni.filter((g) => !g.straordinari).map((g) => g.data));
    for (const id of Object.keys(ORE)) {
      const oltre = oreDi(dopo, id) - ORE[id];
      const inEvento = dopo.filter((t) => t.employeeId === id && !feriali.has(t.data)).reduce((a, t) => a + oreLavorate(t), 0);
      expect(oltre).toBeLessThanOrEqual(inEvento + 1e-9);
    }
    expect(Object.keys(ORE).some((id) => oreDi(dopo, id) > ORE[id])).toBe(true);
  });

  it('senza persone o senza giorni aperti restituisce i turni com\'erano', () => {
    const giorni = settimana('2026-11-16');
    expect(ottimizzaSettimana(giorni, [], [], regole)).toEqual([]);
    expect(ottimizzaSettimana(giorni.map((g) => ({ ...g, chiuso: true })), [], persone(), regole)).toEqual([]);
  });

  it('chi non può lavorare un giorno non riceve turni quel giorno', () => {
    const giorni = settimana('2026-11-16');
    const sab = giorni.find((g) => giornoIso(g.data) === 6)!.data;
    const pp = persone().map((p) => (p.id === 'dora' ? { ...p, nonDisponibile: new Set([sab]) } : p));
    const dopo = ottimizzaSettimana(giorni, [], pp, regole, { giornoLibero });
    expect(dopo.some((t) => t.employeeId === 'dora' && t.data === sab)).toBe(false);
  });
});

describe('regole del 11/11/2026: pause da 10 e 30 minuti, domenica, straordinari del weekend', () => {
  const giorni = settimana('2026-11-16');
  const dopo = ottimizzaSettimana(giorni, proposta(giorni), persone(), regole, { giornoLibero, responsabile: 'anna', straordinariWeekend: true });

  it('gli orari restano sulle mezz\'ore e la pausa e\' quella della presenza', () => {
    for (const t of dopo) {
      expect(minuti(t.inizio) % 30).toBe(0);
      expect(minuti(t.fine) % 30).toBe(0);
      expect(t.pausaMinuti).toBe(pausaMinimaPerPresenza(minuti(t.fine) - minuti(t.inizio), regole));
    }
    expect(dopo.some((t) => t.pausaMinuti === 10)).toBe(true);
  });

  it('sabato e domenica la responsabile entra all\'apertura ed esce dopo nove ore: 10-19', () => {
    for (const g of giorni.filter((x) => giornoIso(x.data) >= 6)) {
      expect(dopo.find((t) => t.employeeId === 'anna' && t.data === g.data)).toMatchObject({ inizio: '10:00', fine: '19:00', pausaMinuti: 30 });
    }
    expect(derogheSettimana({ giorni, turni: dopo, persone: persone().map((p) => ({ ...p, nome: p.id })), regole, giornoLibero, guida: { responsabile: 'anna', vice: null } })
      .filter((d) => d.regola === 'domenica_apertura')).toEqual([]);
  });

  it('nei feriali nessuno supera il contratto: oltre si va solo con le ore di sabato e domenica', () => {
    for (const id of Object.keys(ORE)) {
      const feriali = dopo.filter((t) => t.employeeId === id && giornoIso(t.data) <= 5).reduce((a, t) => a + oreLavorate(t), 0);
      expect(feriali).toBeLessThanOrEqual(ORE[id] + 1e-9);
    }
    expect(oreScoperte(giorni, dopo)).toBe(0);
  });

  it('senza straordinari del weekend (simulazioni) nessuno supera il contratto', () => {
    const senza = ottimizzaSettimana(giorni, proposta(giorni), persone(), regole, { giornoLibero, responsabile: 'anna' });
    for (const id of Object.keys(ORE)) expect(oreDi(senza, id)).toBeLessThanOrEqual(ORE[id] + 1e-9);
  });
});

describe('giorno libero fisso scelto dal sistema', () => {
  it('uno a testa da lunedì a venerdì, distribuiti; chi ce l\'ha lo tiene', () => {
    const g = scegliGiorniLiberi(['a', 'b', 'c', 'd', 'e'], new Map([['c', 5]]));
    expect(g.get('c')).toBe(5);
    expect(new Set(g.values()).size).toBe(5);
    for (const v of g.values()) { expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(5); }
  });

  it('responsabile e vice non hanno mai tutte e due il lunedì', () => {
    const g = scegliGiorniLiberi(['v', 'x', 'y', 'r'], new Map([['v', 1]]), ['r', 'v']);
    expect(g.get('r')).not.toBe(1);
    const tante = Array.from({ length: 12 }, (_, i) => `p${i}`);
    const h = scegliGiorniLiberi(tante, new Map(), ['p10', 'p11']);
    expect(h.get('p10') === 1 && h.get('p11') === 1).toBe(false);
  });
});

describe('coppie dei feriali', () => {
  const t = (id: string, data: string, inizio: string, fine: string): Turno => ({ employeeId: id, data, inizio, fine, pausaMinuti: 0 });
  it('contano le persone insieme almeno un\'ora, solo da lunedì a venerdì', () => {
    const c = coppieFeriali([
      t('a', '2026-11-16', '10:00', '16:00'), t('b', '2026-11-16', '12:00', '18:00'), t('c', '2026-11-16', '15:30', '20:00'),
      t('a', '2026-11-21', '10:00', '16:00'), t('b', '2026-11-21', '10:00', '16:00'),
    ]);
    expect(c.get(coppia('a', 'b'))).toBe(1);
    expect(c.get(coppia('b', 'c'))).toBe(1);
    expect(c.has(coppia('a', 'c'))).toBe(false);
    expect(coppia('b', 'a')).toBe(coppia('a', 'b'));
  });

  it('una coppia già vista nelle settimane prima pesa: a parità si cambia', () => {
    // un lunedì solo, due persone tutto il giorno, tre persone uguali: fra le coppie possibili
    // non esce quella che ha già lavorato insieme nelle settimane prima
    const lun = settimana('2026-11-16').slice(0, 1).map((g) => ({ ...g, fabbisogno: g.fabbisogno.map(() => 2), minimo: g.fabbisogno.map(() => 2), esatto: undefined }));
    const tre: PersonaTurni[] = ['x', 'y', 'z'].map((id) => ({ id, ore: 10, nonDisponibile: new Set<string>() }));
    for (const vista of [coppia('x', 'y'), coppia('x', 'z'), coppia('y', 'z')]) {
      const dopo = ottimizzaSettimana(lun, [], tre, regole, { coppiePrima: new Map([[vista, 5]]) });
      expect(oreScoperte(lun, dopo)).toBe(0);
      expect(coppieFeriali(dopo).has(vista), vista).toBe(false);
    }
  });
});

describe('deroghe', () => {
  it('segnala weekend libero, giorno fisso lavorato, lunedì senza guida, persona sola', () => {
    const giorni = settimana('2026-11-16');
    const t = (id: string, k: number): Turno => ({ employeeId: id, data: giorni[k].data, inizio: '10:00', fine: '18:00', pausaMinuti: 30 });
    const turni = [t('bea', 0), t('carla', 1), t('anna', 1), ...[2, 3, 4, 5, 6].flatMap((k) => [t('anna', k), t('bea', k)])];
    const d = derogheSettimana({ giorni, turni, persone: persone().map((p) => ({ ...p, nome: p.id })), regole, giornoLibero, guida: { responsabile: 'anna', vice: 'carla' } });
    const regoleViste = new Set(d.map((x) => x.regola));
    expect(regoleViste.has('una_sola')).toBe(true);
    expect(regoleViste.has('lunedi_guida')).toBe(true);
    expect(regoleViste.has('weekend')).toBe(true);
    expect(regoleViste.has('giorno_libero')).toBe(true);
    expect(d.filter((x) => x.regola === 'troppi_giorni').map((x) => x.employeeId)).toEqual([]);
  });
});

// Il negozio in prova (Patrizio, 11/11/2026, Roma Soratte): due scelte del negozio, spente altrove.
describe('negozio in prova: pausa corta pagata e giorni a massima intensità', () => {
  const pilota = regoleDaRiga({
    turno_min_ore: 4, turno_max_ore: 10, pausa_oltre_ore: 6, pausa_minuti: 10, pausa_lunga_oltre_ore: 8, pausa_lunga_minuti: 30,
    giorni_lavoro_max: 6, soglia_ingressi_feriali: 25, soglia_ingressi_weekend: 35, due_persone: false,
    pausa_corta_pagata: true, giorni_pieni: true,
  });
  const m = (o: string) => minuti(o);
  const t = (inizio: string, fine: string, pausaMinuti = 0) => ({ inizio, fine, pausaMinuti });

  it('negli altri negozi le due scelte sono spente', () => {
    expect(regole.pausaCortaPagata).toBe(false);
    expect(regole.giorniPieni).toBe(false);
  });

  it('fino a 6 ore niente, oltre 6 e fino a 8 dieci minuti pagati, sopra le 8 mezz\'ora tolta', () => {
    // 10-16: 6 ore, nessuna pausa
    expect(pausaMinimaPerPresenza(6 * 60, pilota)).toBe(0);
    expect(pausaPagataDelTurno(t('10:00', '16:00'), pilota)).toBe(0);
    // 10-18: 8 ore piene, dieci minuti timbrati ma non tolti
    expect(pausaMinimaPerPresenza(8 * 60, pilota)).toBe(0);
    expect(pausaPagataDelTurno(t('10:00', '18:00'), pilota)).toBe(10);
    expect(oreLavorate(t('10:00', '18:00', pausaMinimaPerPresenza(8 * 60, pilota)))).toBe(8);
    expect(pausaPagataDelTurno(t('10:00', '16:30'), pilota)).toBe(10);
    // 10-19: 8 ore e mezza, mezz'ora tolta e nessuna pausa pagata
    expect(pausaMinimaPerPresenza(9 * 60, pilota)).toBe(30);
    expect(pausaPagataDelTurno(t('10:00', '19:00', 30), pilota)).toBe(0);
    // 10:30-19: 8 ore; 10-20: 9 ore e mezza
    expect(oreLavorate(t('10:30', '19:00', pausaMinimaPerPresenza(8.5 * 60, pilota)))).toBe(8);
    expect(oreLavorate(t('10:00', '20:00', pausaMinimaPerPresenza(10 * 60, pilota)))).toBe(9.5);
    // dal lavoro alla pausa: 8 ore di lavoro sono un turno di 8 ore, 8 e mezza un turno di 9
    expect(pausaPer(8 * 60, pilota)).toBe(0);
    expect(pausaPer(8.5 * 60, pilota)).toBe(30);
    // nessun orario scritto a mano viene allungato
    expect(presenzaGiusta(m('10:00'), m('18:30'), pilota, m('10:00'), m('20:00'))).toMatchObject({ fine: m('18:30'), pausa: 30, lavoro: 480, allungato: false });
    // dove la scelta e' spenta non c'e' pausa pagata
    expect(pausaPagataDelTurno(t('10:00', '18:00'), regole)).toBe(0);
  });

});

// ── Le regole del 12/11/2026: giorni caldi sulle fasce, responsabile e vice, riposi, straordinari pari ──
describe('regole del 12/11/2026: giorni caldi, apertura e chiusura, riposi equilibrati', () => {
  const m = (o: string) => minuti(o);
  // il negozio di prova: fasce del sabato e della domenica 1 · 2 · 4 · 1, quattro persone
  const fasceCalde = [
    ...fasce.filter((f) => f.giorno <= 5),
    ...[6, 7].flatMap((giorno) => [
      { giorno, dalle: '10:00', alle: '10:30', persone: 1, origine: 'manuale' }, { giorno, dalle: '10:30', alle: '11:00', persone: 2, origine: 'manuale' },
      { giorno, dalle: '11:00', alle: '19:00', persone: 4, origine: 'manuale' }, { giorno, dalle: '19:00', alle: '20:00', persone: 1, origine: 'manuale' }]),
  ];
  const riga = {
    turno_min_ore: 4, turno_max_ore: 10, pausa_oltre_ore: 6, pausa_minuti: 10, pausa_lunga_oltre_ore: 8, pausa_lunga_minuti: 30,
    giorni_lavoro_max: 6, soglia_ingressi_feriali: 25, soglia_ingressi_weekend: 35, due_persone: false,
    pausa_corta_pagata: true, giorni_pieni: true,
  };
  const pilota = regoleDaRiga({ ...riga, riposi_min_settimana: 2, straordinari_pari: true, caldi_fasce_festivi: 'sabato', caldi_guida_apre_chiude: true, caldi_ore_apertura: 9 });
  const eventi = [{ nome: 'Black Friday', data_dal: '2026-11-27', data_al: '2026-11-29', outlet_ids: null, persone_extra: 0, blocca_ferie: true, straordinari: true }];
  const maxP = (date: string[]) => new Map(date.map((d) => [d, 4]));
  // traffico basso, cosi' comandano le fasce: nei test delle fasce MODA non deve aggiungere niente
  const pochi = (date: string[]) => new Map(date.map((d) => [d, [...Array(10).fill(0), ...Array(10).fill(10)]] as [string, number[]]));
  const calda = [1, 2, ...Array(16).fill(4), 1, 1];

  it('le scelte nuove si leggono dalla riga; assenti restano non definite', () => {
    expect(pilota).toMatchObject({ riposiMinSettimana: 2, straordinariPari: true, caldiFasceFestivi: 6, caldiGuidaApreChiude: true, caldiOreApertura: 9 });
    expect(regole.riposiMinSettimana).toBeUndefined();
    expect(regole.straordinariPari).toBeUndefined();
    expect(opzioniGiorni(regole)).toMatchObject({ caldi: false, tutti: false, straordinari: false });
    expect(opzioniGiorni(pilota)).toMatchObject({ caldi: true, tutti: true, straordinari: true, fasceFestivi: 6 });
    // per legge mai meno di un riposo, qualunque cosa sia scritta
    expect(regoleDaRiga({ ...riga, riposi_min_settimana: 0 }).riposiMinSettimana).toBe(1);
  });

  it('giorni caldi: le persone le decidono le fasce del sabato e della domenica, non piu\' lo schema fisso', () => {
    const date = giorniDellaSettimana('2026-11-16');
    const base = costruisciGiorni(date, orari, fasceCalde, [], [], null, opzioniGiorni(pilota));
    const g = fabbisognoDaTraffico(base, pochi(date), pilota, maxP(date));
    expect(g[5].fabbisogno).toEqual(calda);
    expect(g[6].fabbisogno).toEqual(calda);
    expect(g[5]).toMatchObject({ caldo: true, tutti: true, straordinariCaldo: true, guida: true });
    expect(g[2].caldo).toBe(false);
    // MODA aggiunge sopra le fasce anche nei giorni caldi: 110 ingressi alle 10 con soglia 35 fanno tre persone
    const tanti = new Map(pochi(date));
    tanti.set(date[5], [...Array(10).fill(0), 110, ...Array(9).fill(10)]);
    expect(fabbisognoDaTraffico(base, tanti, pilota, maxP(date))[5].fabbisogno.slice(0, 3)).toEqual([3, 3, 4]);
  });

  it('festivi e giorni di evento in un feriale usano le fasce del sabato (o della domenica, se il negozio lo sceglie)', () => {
    const date = giorniDellaSettimana('2026-11-23');
    const diverse = fasceCalde.map((f) => (f.giorno === 7 && f.persone === 4 ? { ...f, persone: 3 } : f));
    const venerdi = (r: typeof pilota) => fabbisognoDaTraffico(costruisciGiorni(date, orari, diverse, [], eventi, null, opzioniGiorni(r)), pochi(date), r, maxP(date))[4];
    expect(venerdi(pilota).fabbisogno).toEqual(calda);
    expect(venerdi(regoleDaRiga({ ...riga, caldi_fasce_festivi: 'domenica' })).fabbisogno).toEqual([1, 2, ...Array(16).fill(3), 1, 1]);
    // l'Immacolata 2026 e' un martedi': festivo, quindi caldo
    const dic = giorniDellaSettimana('2026-12-07');
    expect(fabbisognoDaTraffico(costruisciGiorni(dic, orari, fasceCalde, [], [], null, opzioniGiorni(pilota)), pochi(dic), pilota, maxP(dic))[1].fabbisogno).toEqual(calda);
  });

  it('negozio con i giorni caldi spenti: festivi ed eventi seguono le fasce del loro giorno, come prima', () => {
    const date = giorniDellaSettimana('2026-11-23');
    const prima = costruisciGiorni(date, orari, fasceCalde, [], eventi);
    const dopo = costruisciGiorni(date, orari, fasceCalde, [], eventi, null, opzioniGiorni(regole));
    expect(dopo.map((g) => g.fabbisogno)).toEqual(prima.map((g) => g.fabbisogno));
    expect(dopo.map((g) => g.minimo)).toEqual(prima.map((g) => g.minimo));
    expect(dopo.every((g) => !g.caldo && !g.tutti && !g.straordinariCaldo && !g.guida)).toBe(true);
    expect(fabbisognoDaTraffico(dopo, pochi(date), regole, maxP(date)).map((g) => g.fabbisogno))
      .toEqual(fabbisognoDaTraffico(prima, pochi(date), regole, maxP(date)).map((g) => g.fabbisogno));
    expect(sceltePerLaSettimana({ giorni: dopo, regole, responsabile: 'anna', vice: 'bea' })).toEqual({});
  });

  it('giorno speciale singolo: vale come un sabato anche dove i giorni caldi sono spenti', () => {
    const date = giorniDellaSettimana('2026-11-16');
    const speciale = [{ nome: 'Apertura serale', data_dal: '2026-11-18', data_al: '2026-11-18', outlet_ids: null, persone_extra: 0, blocca_ferie: false, straordinari: true, tipo: 'giorno' as const }];
    const g = fabbisognoDaTraffico(costruisciGiorni(date, orari, fasceCalde, [], speciale, null, opzioniGiorni(regole)), pochi(date), regole, maxP(date));
    expect(g[2].fabbisogno).toEqual(calda);
    expect(g[2]).toMatchObject({ caldo: true, tutti: true });
    expect(g[1].caldo).toBe(false);
  });

  it('periodo speciale: orario, fasce e MODA propri; le persone in piu\' non si sommano alle sue fasce', () => {
    const date = giorniDellaSettimana('2026-11-23');
    const periodo = [{
      nome: 'Black Friday', data_dal: '2026-11-27', data_al: '2026-11-29', outlet_ids: null, persone_extra: 2, blocca_ferie: true, straordinari: false,
      tipo: 'periodo' as const, regole_origine: 'manuale' as const,
      regole: { apre: '10:00', chiude: '21:00', fasce: [{ dalle: '10:00', alle: '11:00', persone: 2 }, { dalle: '11:00', alle: '21:00', persone: 3 }], moda: false, tutti: true, straordinari: true, guida: false, riposi_min: 1 },
    }];
    const base = costruisciGiorni(date, orari, fasceCalde, [], periodo, null, opzioniGiorni(pilota));
    expect(base[4]).toMatchObject({ apre: m('10:00'), chiude: m('21:00'), caldo: true, tutti: true, straordinari: true, guida: false, senzaModa: true, fasceEvento: true, riposiMin: 1 });
    const tanti = new Map(date.map((d) => [d, [...Array(10).fill(0), ...Array(12).fill(400)]] as [string, number[]]));
    const g = fabbisognoDaTraffico(base, tanti, pilota, maxP(date), new Map(date.map((d) => [d, 2])));
    // MODA spenta e niente persone in piu': restano le fasce del periodo, anche con 400 ingressi l'ora
    expect(g[4].fabbisogno).toEqual([2, 2, ...Array(20).fill(3)]);
    // il giovedi' fuori dal periodo resta normale
    expect(base[3]).toMatchObject({ chiude: m('20:00'), caldo: false });
    // i riposi della settimana scendono a quelli del periodo, mai sotto uno
    expect(sceltePerLaSettimana({ giorni: g, regole: pilota, responsabile: 'anna', vice: 'bea' }).riposi?.min).toBe(1);
  });

  const settimana = (lunedi: string, ev = eventi) => {
    const date = giorniDellaSettimana(lunedi);
    const atteso = new Map(date.map((d) => { const g = giornoIso(d); return [d, [...Array(10).fill(0), ...ingressi[g >= 5 ? g : 1]]] as [string, number[]]; }));
    return fabbisognoDaTraffico(costruisciGiorni(date, orari, fasceCalde, [], ev, null, opzioniGiorni(pilota)), atteso, pilota, maxP(date));
  };
  const sistema = (giorni: GiornoPiano[], extra: Partial<Parameters<typeof ottimizzaSettimana>[4]> = {}, r = pilota) => {
    const prima = almenoDuePersone(giorni, proponiSettimana({ giorni, persone: persone(), regole: r, fissi: [] }).turni, persone(), [], r, []);
    const nuove = { guida: ['anna', 'bea'], ...sceltePerLaSettimana({ giorni, regole: r, responsabile: 'anna', vice: 'bea' }), ...extra };
    return { turni: ottimizzaSettimana(giorni, prima, persone(), r, nuove), nuove };
  };
  const riposiDi = (turni: Turno[], id: string) => 7 - new Set(turni.filter((t) => t.employeeId === id).map((t) => t.data)).size;

  it('settimana normale: negozio coperto, tutte nei giorni caldi, due riposi a testa, ore sulle mezz\'ore', () => {
    const giorni = settimana('2026-11-16');
    const { turni } = sistema(giorni);
    expect(oreScoperte(giorni, turni)).toBe(0);
    for (const d of giorni.slice(5).map((g) => g.data)) expect(new Set(turni.filter((t) => t.data === d).map((t) => t.employeeId)).size).toBe(4);
    for (const id of Object.keys(ORE)) {
      expect(riposiDi(turni, id)).toBeGreaterThanOrEqual(2);
      // nei feriali nessuno supera il contratto: lo straordinario sta nei giorni caldi
      const feriali = turni.filter((t) => t.employeeId === id && giornoIso(t.data) <= 5).reduce((a, t) => a + oreLavorate(t), 0);
      expect(feriali).toBeLessThanOrEqual(ORE[id]);
    }
    for (const t of turni) expect((oreLavorate(t) * 2) % 1).toBe(0);
    // straordinari pari: fra chi ne fa di piu' e chi di meno non passano piu' di tre ore
    const oltre = Object.keys(ORE).map((id) => Math.max(0, oreDi(turni, id) - ORE[id]));
    expect(Math.max(...oltre) - Math.min(...oltre)).toBeLessThanOrEqual(3);
  }, 30_000);

  it('giorni caldi: una fra responsabile e vice apre e resta nove ore, l\'altra chiude, e il giorno dopo si scambiano', () => {
    const giorni = settimana('2026-11-16');
    const { turni } = sistema(giorni);
    const chi = (d: string, inizio: boolean) => ['anna', 'bea'].filter((id) => turni.some((t) => t.employeeId === id && t.data === d && (inizio ? t.inizio === '10:00' && t.fine === '19:00' : t.fine === '20:00')));
    const [sab, dom] = giorni.slice(5).map((g) => g.data);
    expect(chi(sab, true).length).toBe(1);
    expect(chi(dom, true).length).toBe(1);
    expect(chi(sab, true)[0]).not.toBe(chi(dom, true)[0]);
    expect(chi(sab, false)).toContain(chi(dom, true)[0]);
    expect(chi(dom, false)).toContain(chi(sab, true)[0]);
    // nessuna deroga su apertura e chiusura
    const der = derogheSettimana({ giorni, turni, persone: persone().map((p) => ({ ...p, nome: p.id })), regole: pilota, guida: { responsabile: 'anna', vice: 'bea' } });
    expect(der.filter((d) => d.regola === 'domenica_apertura' || d.regola === 'caldo_chiusura')).toEqual([]);
  }, 30_000);

  it('solo la responsabile, o regola «una apre, l\'altra chiude» spenta: apre sempre lei', () => {
    const giorni = settimana('2026-11-16');
    const senzaVice = regoleDaRiga({ ...riga, riposi_min_settimana: 2 });
    const { turni } = sistema(fabbisognoDaTraffico(costruisciGiorni(giorni.map((g) => g.data), orari, fasceCalde, [], [], null, opzioniGiorni(senzaVice)), new Map(), senzaVice, maxP(giorni.map((g) => g.data))), {}, senzaVice);
    for (const d of giorni.slice(5).map((g) => g.data)) expect(turni.find((t) => t.employeeId === 'anna' && t.data === d)).toMatchObject({ inizio: '10:00', fine: '19:00' });
  }, 30_000);

  it('settimana con tre giorni di evento: per legge almeno un riposo a testa, e due se ci stanno', () => {
    const giorni = settimana('2026-11-23');
    const { turni } = sistema(giorni);
    expect(oreScoperte(giorni, turni)).toBe(0);
    for (const id of Object.keys(ORE)) expect(riposiDi(turni, id)).toBeGreaterThanOrEqual(1);
    expect(Object.keys(ORE).filter((id) => riposiDi(turni, id) >= 2).length).toBeGreaterThanOrEqual(3);
    for (const d of giorni.slice(4).map((g) => g.data)) expect(new Set(turni.filter((t) => t.data === d).map((t) => t.employeeId)).size).toBe(4);
  }, 30_000);

  it('giorni preferiti e giorni in cui non si riposa mai, piu\' di uno a testa', () => {
    const giorni = settimana('2026-11-16');
    const riposi = { preferiti: new Map([['carla', [1, 3]], ['dora', [2]]]), mai: new Map([['bea', [1, 4]]]) };
    const scelte = sceltePerLaSettimana({ giorni, regole: pilota, responsabile: 'anna', vice: 'bea', riposi });
    const { turni } = sistema(giorni, scelte);
    const lavora = (id: string, iso: number) => turni.some((t) => t.employeeId === id && giornoIso(t.data) === iso);
    expect(lavora('carla', 1)).toBe(false);
    expect(lavora('carla', 3)).toBe(false);
    expect(lavora('dora', 2)).toBe(false);
    expect(lavora('bea', 1)).toBe(true);
    expect(lavora('bea', 4)).toBe(true);
    expect(oreScoperte(giorni, turni)).toBe(0);
    // la deroga si vede se a mano si toglie il turno del giorno vietato
    const der = derogheSettimana({ giorni, turni: turni.filter((t) => !(t.employeeId === 'bea' && giornoIso(t.data) === 4)), persone: persone().map((p) => ({ ...p, nome: p.id })), regole: pilota, guida: { responsabile: 'anna', vice: 'bea' }, riposi: scelte.riposi });
    expect(der.some((d) => d.regola === 'riposo_vietato' && d.employeeId === 'bea')).toBe(true);
  }, 30_000);

  it('il conto: due riposi a testa costano meno di tre a una e uno a un\'altra, a parita\' del resto', () => {
    const giorni = settimana('2026-11-16');
    const { turni, nuove } = sistema(giorni);
    expect(contoSettimana(giorni, turni, persone(), pilota, nuove)).toBeLessThan(Infinity);
    // sei giorni a una persona sono il massimo; sette non passano mai, nemmeno con le regole spente
    const sette = giorni.map((g) => ({ employeeId: 'anna', data: g.data, inizio: '10:00', fine: '14:00', pausaMinuti: 0 }));
    expect(contoSettimana(giorni, sette, persone(), pilota, nuove)).toBe(Infinity);
    expect(contoSettimana(giorni, sette, persone(), regoleDaRiga({ ...riga, giorni_lavoro_max: 7 }), {})).toBe(Infinity);
  }, 30_000);
});

describe('ripartisciStraordinari: a ore e mezz\'ore, solo nei giorni forti', () => {
  const t = (employeeId: string, data: string, inizio: string, fine: string, pausaMinuti = 0): Turno => ({ employeeId, data, inizio, fine, pausaMinuti });
  const forti = new Set(['2026-11-21', '2026-11-22']);
  it('5 ore oltre il contratto: 2 e mezza il sabato e 2 e mezza la domenica', () => {
    const turni = [t('a', '2026-11-16', '10:00', '18:00'), t('a', '2026-11-17', '12:00', '20:00'), t('a', '2026-11-19', '10:00', '18:00'), t('a', '2026-11-20', '10:00', '14:00'),
      t('a', '2026-11-21', '10:00', '19:00', 30), t('a', '2026-11-22', '10:00', '19:00', 30)];
    const r = ripartisciStraordinari(turni, new Map([['a', 40]]), forti);
    expect([...r.values()]).toEqual([2.5, 2.5]);
    expect(r.get(turni[4])).toBe(2.5);
  });
  it('3 ore: un\'ora e mezza a giorno; mezz\'ora dispari al primo giorno; niente sotto il contratto', () => {
    const base = [t('b', '2026-11-16', '12:00', '20:00'), t('b', '2026-11-18', '10:00', '18:00'), t('b', '2026-11-21', '10:30', '20:00', 30), t('b', '2026-11-22', '10:30', '19:00', 30)];
    expect([...ripartisciStraordinari(base, new Map([['b', 30]]), forti).values()]).toEqual([1.5, 1.5]);
    expect([...ripartisciStraordinari(base, new Map([['b', 29.5]]), forti).values()]).toEqual([2, 1.5]);
    expect(ripartisciStraordinari(base, new Map([['b', 33]]), forti).size).toBe(0);
  });
  it('senza turni nei giorni forti non scrive niente', () => {
    expect(ripartisciStraordinari([t('c', '2026-11-16', '10:00', '20:00', 30)], new Map([['c', 4]]), forti).size).toBe(0);
  });
});

describe('negozio con i giorni caldi spenti: un evento nuovo non toglie «nel weekend lavorano tutti»', () => {
  it('il giorno dell\'evento si aggiunge a sabato e domenica', () => {
    const date = giorniDellaSettimana('2026-12-07');
    const eventi = [{ nome: 'Apertura serale', data_dal: '2026-12-10', data_al: '2026-12-10', outlet_ids: null, persone_extra: 0, blocca_ferie: false, straordinari: false, tipo: 'giorno' as const }];
    const giorni = costruisciGiorni(date, orari, fasce, [], eventi, null, opzioniGiorni(regole));
    const scelte = sceltePerLaSettimana({ giorni, regole, responsabile: null, vice: null });
    expect(scelte.giorniPieni?.has('2026-12-10')).toBe(true);
    expect(scelte.giorniPieni?.has('2026-12-12')).toBe(true);
    expect(scelte.giorniPieni?.has('2026-12-13')).toBe(true);
  });
});
