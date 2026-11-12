// Il ricalcolo dello straordinario dei giorni forti dopo una modifica a mano
// (correzioni dei revisori, 12/11/2026): uno straordinario scritto a mano non si
// sovrascrive, si ricalcola solo per chi e' stato toccato, i mesi chiusi restano
// fermi, il giorno di pubblicazione non si sposta, gli errori si dicono.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ricalcoloStraordinari, type TurnoSalvato } from './ottimizzaTurni';

type Riga = Record<string, unknown> & { id: string; employee_id: string; data: string };
const finto = vi.hoisted(() => ({
  righe: [] as Record<string, unknown>[],
  erroreLettura: null as { code?: string; message: string } | null,
  erroreScrittura: new Map<string, string>(),
  mesiChiusi: new Set<string>(),
  filtri: [] as [string, string, unknown][],
  scritture: [] as { id: string; valori: Record<string, unknown> }[],
  rpc: [] as string[],
}));

vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      select: () => {
        const filtri: [string, string, unknown][] = [];
        const q = {
          eq: (c: string, v: unknown) => { filtri.push(['eq', c, v]); return q; },
          in: (c: string, v: unknown) => { filtri.push(['in', c, v]); return q; },
          neq: (c: string, v: unknown) => { filtri.push(['neq', c, v]); return q; },
          then: (ok: (r: { data: unknown; error: unknown }) => unknown) => {
            finto.filtri = filtri;
            if (finto.erroreLettura) return Promise.resolve(ok({ data: null, error: finto.erroreLettura }));
            const data = (finto.righe as Riga[]).filter((r) => filtri.every(([op, c, v]) => (op === 'in' ? (v as unknown[]).includes(r[c]) : op === 'eq' ? (c in r ? r[c] === v : true) : r[c] !== v)));
            return Promise.resolve(ok({ data, error: null }));
          },
        };
        return q;
      },
      update: (valori: Record<string, unknown>) => ({
        eq: (_c: string, id: string) => {
          const messaggio = finto.erroreScrittura.get(id);
          if (messaggio) return Promise.resolve({ error: { message: messaggio } });
          finto.scritture.push({ id, valori });
          return Promise.resolve({ error: null });
        },
      }),
    }),
    rpc: (_nome: string, a: { p_data: string }) => { finto.rpc.push(a.p_data); return Promise.resolve({ data: finto.mesiChiusi.has(a.p_data.slice(0, 7)), error: null }); },
  },
}));

import { StraordinariNonAggiornati, contrattoDi, giornoDiPubblicazione, riallineaStraordinariForti } from './straordinariDb';

const SETTIMANA = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
const FORTI = new Set(['2026-11-21', '2026-11-22']);
const riga = (id: string, employee_id: string, data: string, inizio: string, fine: string, ore = 0, altro: Record<string, unknown> = {}) =>
  ({ id, employee_id, data, inizio: `${inizio}:00`, fine: `${fine}:00`, pausa_minuti: 0, plan_id: null, stato: 'bozza', ore_straordinario: ore, straordinario_motivo: ore > 0 ? 'giorno_forte' : null, straordinario_a_mano: null, ...altro });
// 4 feriali da 8 ore + sabato e domenica da 6: 44 ore su 40 di contratto
const settimanaDi = (chi: string, straordSab = 2, straordDom = 2) => [
  ...['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'].map((d, i) => riga(`${chi}-f${i}`, chi, d, '10:00', '18:00')),
  riga(`${chi}-sa`, chi, '2026-11-21', '10:00', '16:00', straordSab), riga(`${chi}-do`, chi, '2026-11-22', '10:00', '16:00', straordDom),
];
const chiama = (persone: string[], altro: Partial<Parameters<typeof riallineaStraordinariForti>[0]> = {}) => riallineaStraordinariForti({
  companyId: 'az', outletId: 'neg', date: SETTIMANA, persone, planDi: () => null,
  contratto: new Map([['anna', 40], ['bea', 40], ['carla', 40]]), giorniForti: FORTI, ...altro,
});

beforeEach(() => {
  finto.righe = []; finto.erroreLettura = null; finto.erroreScrittura = new Map(); finto.mesiChiusi = new Set();
  finto.filtri = []; finto.scritture = []; finto.rpc = [];
});

describe('1. uno straordinario scritto a mano non si sovrascrive', () => {
  const t = (id: string, data: string, inizio: string, fine: string, oreStraordinario = 0, altro: Partial<TurnoSalvato> = {}): TurnoSalvato =>
    ({ id, employeeId: 'anna', data, inizio, fine, pausaMinuti: 0, oreStraordinario, motivo: oreStraordinario > 0 ? 'giorno_forte' : null, ...altro });
  const feriali = () => ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'].map((d, i) => t(`f${i}`, d, '10:00', '18:00'));

  it('il turno a mano resta com\'è e conta come già assegnato: si divide solo il resto', () => {
    // 44 ore su 40: sabato 3 ore scritte a mano (motivo «giorno forte»), ne resta 1 per la domenica
    const turni = [...feriali(), t('sa', '2026-11-21', '10:00', '16:00', 3, { aMano: true }), t('do', '2026-11-22', '10:00', '16:00', 2)];
    expect(ricalcoloStraordinari(turni, new Map([['anna', 40]]), FORTI).cambi).toEqual([{ id: 'do', ore: 1 }]);
  });
  it('anche se a mano c\'è scritto più di quello che avanza, non si tocca', () => {
    const turni = [...feriali(), t('sa', '2026-11-21', '10:00', '16:00', 6, { aMano: true }), t('do', '2026-11-22', '10:00', '16:00', 2)];
    expect(ricalcoloStraordinari(turni, new Map([['anna', 40]]), FORTI).cambi).toEqual([{ id: 'do', ore: 0 }]);
  });
  it('tolta la spunta (a mano spento, zero ore) il turno torna al calcolo del sistema', () => {
    const turni = [...feriali(), t('sa', '2026-11-21', '10:00', '16:00', 0, { aMano: false }), t('do', '2026-11-22', '10:00', '16:00', 2)];
    expect(ricalcoloStraordinari(turni, new Map([['anna', 40]]), FORTI).cambi).toEqual([{ id: 'sa', ore: 2 }]);
  });
  it('sul database: il turno a mano non riceve nessuna scrittura, quello del sistema viene segnato «non a mano»', async () => {
    finto.righe = settimanaDi('anna', 3, 2).map((r) => (r.id === 'anna-sa' ? { ...r, straordinario_a_mano: true } : r));
    const esito = await chiama(['anna']);
    expect(esito).toEqual({ riscritti: 1, saltato: false, nonTorna: [] });
    expect(finto.scritture).toEqual([{ id: 'anna-do', valori: { straordinario: true, ore_straordinario: 1, straordinario_motivo: 'giorno_forte', straordinario_a_mano: false } }]);
  });
  it('dove la colonna «a mano» non c\'è non ricalcola affatto, in silenzio', async () => {
    finto.righe = settimanaDi('anna', 0, 0);
    finto.erroreLettura = { code: '42703', message: 'column shifts.straordinario_a_mano does not exist' };
    await expect(chiama(['anna'])).resolves.toEqual({ riscritti: 0, saltato: true, nonTorna: [] });
    expect(finto.scritture).toEqual([]);
  });
});

describe('2. il ricalcolo tocca solo le persone e la settimana della modifica', () => {
  it('tre persone con lo straordinario da sistemare, una sola toccata: si riscrive solo lei', async () => {
    finto.righe = [...settimanaDi('anna', 0, 0), ...settimanaDi('bea', 0, 0), ...settimanaDi('carla', 0, 0)];
    const esito = await chiama(['bea']);
    expect(esito.riscritti).toBe(2);
    expect(finto.scritture.map((s) => s.id)).toEqual(['bea-sa', 'bea-do']);
    // e legge solo i suoi turni, nelle sole date passate
    expect(finto.filtri).toContainEqual(['in', 'employee_id', ['bea']]);
    expect(finto.filtri).toContainEqual(['in', 'data', SETTIMANA]);
  });
  it('spostamento fra due persone: tutte e due, non la terza', async () => {
    finto.righe = [...settimanaDi('anna', 0, 0), ...settimanaDi('bea', 0, 0), ...settimanaDi('carla', 0, 0)];
    await chiama(['anna', 'bea']);
    expect(new Set(finto.scritture.map((s) => s.id.split('-')[0]))).toEqual(new Set(['anna', 'bea']));
  });
  it('nessuna persona toccata: non legge e non scrive', async () => {
    finto.righe = settimanaDi('anna', 0, 0);
    await expect(chiama([])).resolves.toEqual({ riscritti: 0, saltato: false, nonTorna: [] });
    expect(finto.filtri).toEqual([]);
  });
  it('contrattoDi tiene solo chi è stato toccato e ha un contratto', () => {
    expect([...contrattoDi(new Map([['anna', 40], ['bea', 30]]), ['bea', 'bea', 'zoe'])]).toEqual([['bea', 30]]);
  });
});

describe('3. i turni di un mese chiuso non si riscrivono', () => {
  // settimana a cavallo: lunedì 30/11 (novembre chiuso) e 1-6 dicembre aperto
  const CAVALLO = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06'];
  const forti = new Set(['2026-11-30', '2026-12-05', '2026-12-06']); // il 30 è un giorno di evento
  const righe = () => [
    riga('lu', 'anna', '2026-11-30', '10:00', '18:00', 0), riga('ma', 'anna', '2026-12-01', '10:00', '18:00'), riga('me', 'anna', '2026-12-02', '10:00', '18:00'),
    riga('gi', 'anna', '2026-12-03', '10:00', '18:00'), riga('sa', 'anna', '2026-12-05', '10:00', '16:00', 0), riga('do', 'anna', '2026-12-06', '10:00', '16:00', 0),
  ];
  it('ricalcola solo la parte nel mese aperto', async () => {
    finto.righe = righe(); finto.mesiChiusi = new Set(['2026-11']);
    const esito = await chiama(['anna'], { date: CAVALLO, giorniForti: forti });
    // 44 ore su 40: 4 ore, a mezz'ore fra sabato e domenica; il lunedì 30 resta fermo
    expect(finto.scritture.map((s) => [s.id, s.valori.ore_straordinario])).toEqual([['sa', 2], ['do', 2]]);
    expect(finto.rpc.sort()).toEqual(['2026-11-01', '2026-12-01']);
    // le 4 ore sono tutte scritte lo stesso, sui giorni del mese aperto: il conto della settimana torna
    expect(esito.nonTorna).toEqual([]);
  });
  it('se il conto della settimana non torna per colpa del mese chiuso, lo dice', async () => {
    // sul lunedì chiuso sono scritte 3 ore di straordinario che oggi non spetterebbero più: 40 ore su 40
    finto.righe = righe().filter((r) => r.id !== 'do').map((r) => (r.id === 'lu' ? { ...r, ore_straordinario: 3, straordinario_motivo: 'giorno_forte' } : r));
    finto.righe.push(riga('ve', 'anna', '2026-12-04', '10:00', '12:00'));
    finto.mesiChiusi = new Set(['2026-11']);
    const esito = await chiama(['anna'], { date: CAVALLO, giorniForti: forti });
    expect(finto.scritture).toEqual([]);
    expect(esito.nonTorna).toEqual(['anna']);
  });
  it('mese tutto chiuso: nessuna scrittura', async () => {
    finto.righe = settimanaDi('anna', 0, 0); finto.mesiChiusi = new Set(['2026-11']);
    const esito = await chiama(['anna']);
    expect(esito.riscritti).toBe(0);
    expect(finto.scritture).toEqual([]);
  });
});

describe('4. il giorno di pubblicazione non si sposta', () => {
  it('il ricalcolo scrive solo lo straordinario: mai lo stato né il giorno di pubblicazione', async () => {
    finto.righe = settimanaDi('anna', 0, 0).map((r) => ({ ...r, stato: 'pubblicato' }));
    await chiama(['anna']);
    expect(finto.scritture).toHaveLength(2);
    for (const s of finto.scritture) expect(Object.keys(s.valori).sort()).toEqual(['ore_straordinario', 'straordinario', 'straordinario_a_mano', 'straordinario_motivo']);
  });
  it('si legge pubblicato_il; dove manca vale l\'ultimo aggiornamento', () => {
    // pubblicati il 10/11, poi il ricalcolo ha spostato updated_at al 12/11: resta il 10
    expect(giornoDiPubblicazione([
      { pubblicato_il: '2026-11-10T09:00:00+00:00', updated_at: '2026-11-12T15:00:00+00:00' },
      { pubblicato_il: '2026-11-10T09:00:01+00:00', updated_at: '2026-11-12T15:00:01+00:00' },
    ])).toBe('2026-11-10');
    // turni pubblicati prima della 408, mai più toccati: colonna vuota
    expect(giornoDiPubblicazione([{ pubblicato_il: null, updated_at: '2026-11-08T10:00:00+00:00' }, { updated_at: '2026-11-07T10:00:00+00:00' }])).toBe('2026-11-08');
    expect(giornoDiPubblicazione([])).toBeNull();
  });
  it('il giorno è quello di Roma, non quello UTC', () => {
    expect(giornoDiPubblicazione([{ pubblicato_il: '2026-11-10T23:30:00+00:00' }])).toBe('2026-11-11');
  });
});

describe('5. gli errori veri si dicono', () => {
  it('errore di lettura che non è «colonna mancante»: lo lancia', async () => {
    finto.erroreLettura = { code: '57014', message: 'canceling statement due to statement timeout' };
    await expect(chiama(['anna'])).rejects.toThrow(/Non riesco a rileggere i turni/);
  });
  it('una scrittura fallisce a metà: prova le altre, poi dice che non è aggiornato per tutte', async () => {
    finto.righe = settimanaDi('anna', 0, 0);
    finto.erroreScrittura.set('anna-sa', 'rete caduta');
    const errore = await chiama(['anna']).catch((e: unknown) => e);
    expect(errore).toBeInstanceOf(StraordinariNonAggiornati);
    expect((errore as StraordinariNonAggiornati).message).toMatch(/non è aggiornato per tutte.*rete caduta.*prossimo salvataggio/);
    expect((errore as StraordinariNonAggiornati).riscritti).toBe(1);
    expect(finto.scritture.map((s) => s.id)).toEqual(['anna-do']);
  });
});
