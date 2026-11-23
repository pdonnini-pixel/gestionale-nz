// Chiusura di meta' giornata (Patrizio, 23/11/2026, migration 446): Forte dei Marmi apre
// 10-13 e 15:30-19 (sabato fino alle 19:30), lunedi' chiuso. Nella chiusura non serve
// nessuno e chi la attraversa la conta come pausa non pagata. Dove la chiusura non c'e'
// niente cambia.
import { describe, it, expect } from 'vitest';
import {
  REGOLE_DEFAULT, applicaChiusure, costruisciGiorni, copertura, finestraLavoro, giorniDellaSettimana, minuti, oreLavorate,
  pausaDelTurno, riassuntoOrari, sovrapposizioneChiusura, turnoConChiusura, lavoroMassimoGiorno,
  type OrarioGiornoTipo, type Turno,
} from './turni';
import { pianificaMese } from './pianoMensile';

const forte: OrarioGiornoTipo[] = [1, 2, 3, 4, 5, 6, 7].map((g) => (g === 1
  ? { giorno: 1, chiuso: true, apre: null, chiude: null }
  : { giorno: g, chiuso: false, apre: '10:00', chiude: g === 6 ? '19:30' : '19:00', chiusura_dalle: '13:00', chiusura_alle: '15:30' }));
const continuato: OrarioGiornoTipo[] = [1, 2, 3, 4, 5, 6, 7].map((g) => ({ giorno: g, chiuso: false, apre: '10:00', chiude: '20:00' }));
const MAR = '2026-12-01';
const C = { dalle: 13 * 60, alle: 15 * 60 + 30 };

describe('le funzioni della chiusura', () => {
  it('quanto della chiusura cade in un turno', () => {
    expect(sovrapposizioneChiusura({ chiusura: C }, 600, 1140)).toBe(150);
    expect(sovrapposizioneChiusura({ chiusura: C }, 600, 780)).toBe(0);
    expect(sovrapposizioneChiusura({ chiusura: C }, 840, 1140)).toBe(90);
    expect(sovrapposizioneChiusura(undefined, 600, 1140)).toBe(0);
  });

  it('chi attraversa la chiusura ha come pausa la chiusura', () => {
    // 10-19: 6 ore e mezza di lavoro, 2 ore e mezza di pausa
    expect(pausaDelTurno({ chiusura: C }, 600, 1140)).toBe(150);
    // senza chiusura la pausa e' quella di sempre (9 ore di presenza = 8 di lavoro + 30' con i default)
    expect(pausaDelTurno(undefined, 600, 1140)).toBe(REGOLE_DEFAULT.pausaLungaMinuti);
  });

  it('il turno che parte la mattina scavalca la chiusura', () => {
    expect(finestraLavoro({ chiusura: C }, 600, 390)).toEqual({ inizio: 600, fine: 1140, pausa: 150 });
    // un inizio dentro la chiusura si sposta alla riapertura
    expect(finestraLavoro({ chiusura: C }, 840, 210)).toEqual({ inizio: 930, fine: 1140, pausa: 0 });
    // tutto la mattina: nessuna pausa
    expect(finestraLavoro({ chiusura: C }, 600, 180)).toEqual({ inizio: 600, fine: 780, pausa: 0 });
    // senza chiusura: inizio + lavoro + pausa di regola, come prima
    expect(finestraLavoro(undefined, 600, 480)).toEqual({ inizio: 600, fine: 600 + 480 + REGOLE_DEFAULT.pausaLungaMinuti, pausa: REGOLE_DEFAULT.pausaLungaMinuti });
  });

  it('nessun turno comincia o finisce nella chiusura', () => {
    const t: Turno = { employeeId: 'a', data: MAR, inizio: '14:00', fine: '19:00', pausaMinuti: 0 };
    expect(turnoConChiusura({ chiusura: C }, t)).toEqual({ ...t, inizio: '15:30', pausaMinuti: 0 });
    const u: Turno = { employeeId: 'a', data: MAR, inizio: '10:00', fine: '14:00', pausaMinuti: 0 };
    expect(turnoConChiusura({ chiusura: C }, u)).toEqual({ ...u, fine: '13:00', pausaMinuti: 0 });
  });

  it('il lavoro massimo del giorno toglie la chiusura', () => {
    expect(lavoroMassimoGiorno({ apre: 600, chiude: 1140, chiusura: C })).toBe(390);
    expect(lavoroMassimoGiorno({ apre: 600, chiude: 1170, chiusura: C })).toBe(420);
  });

  it('il riassunto mostra i due pezzi', () => {
    expect(riassuntoOrari(forte)).toBe('Lun chiuso · Mar-Ven 10-13 / 15:30-19 · Sab 10-13 / 15:30-19:30 · Dom 10-13 / 15:30-19');
  });
});

describe('i giorni con la chiusura', () => {
  const settimana = giorniDellaSettimana(MAR.replace('01', '01'));
  const fasce = [2, 3, 4, 5, 6, 7].map((g) => ({ giorno: g, dalle: '10:00', alle: '19:30', persone: 2, origine: 'manuale' }));

  it('nella chiusura non serve nessuno, nemmeno per le fasce salvate', () => {
    const [, mar] = costruisciGiorni(giorniDellaSettimana('2026-11-30'), forte, fasce, []);
    expect(mar.chiusura).toEqual(C);
    const i = (m: number) => (m - mar.apre) / 30;
    expect(mar.fabbisogno[i(13 * 60)]).toBe(0);
    expect(mar.fabbisogno[i(15 * 60)]).toBe(0);
    expect(mar.fabbisogno[i(15 * 60 + 30)]).toBe(2);
    expect(mar.minimo![i(14 * 60)]).toBe(0);
    expect(mar.minimo![i(12 * 60)]).toBe(2);
    // la chiusura non conta come negozio vuoto
    expect(copertura(mar, []).slice(i(13 * 60), i(15 * 60 + 30)).every((c) => c >= 1)).toBe(true);
    expect(settimana.length).toBe(7);
  });

  it('un giorno speciale con orario suo non eredita la chiusura', () => {
    const [, , , , , sab] = costruisciGiorni(giorniDellaSettimana('2026-12-14'), forte, [], [
      { data: '2026-12-19', chiuso: false, apre: '10:00', chiude: '19:30', persone_extra: 0 },
    ]);
    expect(sab.chiusura).toBeUndefined();
    expect(sab.fabbisogno.every((x) => x === 0)).toBe(true);
  });

  it('senza chiusura i giorni restano quelli di prima', () => {
    const g = costruisciGiorni(giorniDellaSettimana('2026-11-30'), continuato, [], []);
    expect(g.every((x) => x.chiusura === undefined)).toBe(true);
  });

  it('la rete di sicurezza in fondo non tocca i giorni senza chiusura', () => {
    const g = costruisciGiorni(giorniDellaSettimana('2026-11-30'), continuato, [], []);
    const t: Turno[] = [{ employeeId: 'a', data: '2026-12-01', inizio: '10:00', fine: '19:00', pausaMinuti: 60 }];
    expect(applicaChiusure(g, t)).toBe(t);
  });
});

describe('il piano del mese a Forte dei Marmi', () => {
  const tutte: string[] = [];
  for (let d = new Date('2026-11-30T00:00:00Z'); tutte.length < 35; d.setUTCDate(d.getUTCDate() + 1)) tutte.push(d.toISOString().slice(0, 10));
  const fasce = [2, 3, 4, 5, 6, 7].map((g) => ({ giorno: g, dalle: '10:00', alle: '19:30', persone: 1, origine: 'manuale' }));
  const giorni = costruisciGiorni(tutte, forte, fasce, []);
  const atteso = new Map(tutte.map((d) => [d, Array.from({ length: 24 }, (_, h) => (h >= 10 && h < 20 ? 20 : 0))]));
  const persone = [35, 35, 30, 20].map((ore, i) => ({ id: `p${i}`, oreSettimana: ore, nonDisponibile: new Set<string>(), oreFerie: new Map<string, number>() }));
  const e = pianificaMese({ mese: '2026-12', giorni, persone, regola: 'nessuno', storicoWeekend: new Map(), atteso, rapido: true });

  it('nessun turno comincia o finisce nella chiusura e la pausa e\' la chiusura', () => {
    expect(e.turni.length).toBeGreaterThan(0);
    for (const t of e.turni) {
      const a = minuti(t.inizio); const b = minuti(t.fine);
      expect(a >= C.dalle && a < C.alle).toBe(false);
      expect(b > C.dalle && b <= C.alle).toBe(false);
      if (a < C.dalle && b > C.alle) expect(t.pausaMinuti).toBeGreaterThanOrEqual(150);
      expect(oreLavorate(t)).toBeGreaterThanOrEqual(REGOLE_DEFAULT.turnoMinOre - 1e-9);
    }
  });

  it('il lunedi\' chiuso resta senza turni', () => {
    expect(e.turni.some((t) => new Date(`${t.data}T00:00:00Z`).getUTCDay() === 1)).toBe(false);
  });
});
