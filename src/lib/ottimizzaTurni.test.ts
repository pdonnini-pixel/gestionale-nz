import { describe, it, expect } from 'vitest';
import {
  costruisciGiorni, giorniDellaSettimana, giornoIso, minuti, oreLavorate, oreScoperte, pausaMinimaPerPresenza, proponiSettimana, regoleDaRiga,
  type GiornoPiano, type PersonaTurni, type Turno,
} from './turni';
import { fabbisognoDaTraffico, almenoDuePersone } from './pianoMensile';
import { ottimizzaSettimana, scegliGiorniLiberi, coppieFeriali, coppia, derogheSettimana } from './ottimizzaTurni';

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

  it('la proposta di partenza lascia ore scoperte, la settimana sistemata no', () => {
    expect(oreScoperte(giorni, prima)).toBeGreaterThan(0);
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

describe('regole del 12/11/2026: pause da 10 e 30 minuti, domenica, straordinari del weekend', () => {
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

  it('la domenica la responsabile fa l\'apertura', () => {
    const dom = giorni.find((g) => giornoIso(g.data) === 7)!;
    expect(dopo.find((t) => t.employeeId === 'anna' && t.data === dom.data)?.inizio).toBe('10:00');
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
