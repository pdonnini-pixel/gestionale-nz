// Orari e fabbisogno di un negozio stimati dai dati, per non partire da una
// pagina vuota (Patrizio, 19/10/2026).
//
// Da dove vengono:
//  - ORA DI CHIUSURA: le chiusure di cassa (outlet_daily_closings) si
//    confermano a fine giornata. La mediana dell'ora di conferma, giorno
//    della settimana per giorno della settimana, arrotondata alla mezz'ora
//    prima, e' l'ora di chiusura (settembre 2026: le 20 quasi ovunque,
//    Valmontone alle 21 il sabato e la domenica).
//  - GIORNI CHIUSI: le chiusure segnate «giorno di chiusura».
//  - APERTURA: nessun dato la registra. Si usa lo standard dei village,
//    le 10, e la spiegazione lo dice.
//  - FABBISOGNO: le ore di contratto delle persone in servizio nel negozio,
//    distribuite sui giorni in proporzione all'incasso medio di quel giorno
//    della settimana (attenuato con la radice: il sabato incassa quattro
//    volte il lunedi' ma non servono quattro volte le persone). Una fascia
//    per giorno, dall'apertura alla chiusura, con almeno una persona.
//
// E' una stima: si salva con origine = 'stima' e si sostituisce appena
// qualcuno conferma. Funzioni pure, test in stimaNegozio.test.ts.

import type { FasciaFabbisogno, OrarioGiornoTipo } from './turni';
import { REGOLE_DEFAULT, giornoIso, hhmm, minuti, pausaPer } from './turni';

export const APERTURA_STANDARD = '10:00';
export const CHIUSURA_STANDARD = '20:00';

export interface ChiusuraGiorno {
  data: string;
  giornoChiuso: boolean;
  /** ora (Roma, HH:MM) in cui la chiusura di cassa e' stata confermata */
  oraConferma: string | null;
  incasso: number | null;
}

export interface StimaNegozio {
  orari: OrarioGiornoTipo[];
  fasce: FasciaFabbisogno[];
  spiegazione: string[];
  giorniLetti: number;
}

const mediana = (v: number[]): number | null => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Ora di Roma (HH:MM) di un timestamp ISO. */
export function oraRoma(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

export function stimaOrariEFabbisogno(
  chiusure: ChiusuraGiorno[],
  oreContratto: number,
  personeInServizio: number,
): StimaNegozio {
  const spiegazione: string[] = [];
  const orari: OrarioGiornoTipo[] = [];
  const incassoMedio: Record<number, number> = {};

  for (let g = 1; g <= 7; g++) {
    const righe = chiusure.filter((c) => giornoIso(c.data) === g);
    const chiusi = righe.filter((c) => c.giornoChiuso).length;
    if (righe.length && chiusi / righe.length >= 0.5) {
      orari.push({ giorno: g, chiuso: true, apre: null, chiude: null });
      continue;
    }
    const ore = righe
      .filter((c) => !c.giornoChiuso && c.oraConferma && minuti(c.oraConferma) >= 12 * 60)
      .map((c) => minuti(c.oraConferma));
    const m = mediana(ore);
    const chiude = m != null ? hhmm(Math.floor(m / 30) * 30) : CHIUSURA_STANDARD;
    orari.push({ giorno: g, chiuso: false, apre: APERTURA_STANDARD, chiude: chiude <= APERTURA_STANDARD ? CHIUSURA_STANDARD : chiude });
    const inc = righe.filter((c) => !c.giornoChiuso && (c.incasso ?? 0) > 0).map((c) => c.incasso as number);
    incassoMedio[g] = inc.length ? inc.reduce((a, b) => a + b, 0) / inc.length : 0;
  }

  const giorniLetti = chiusure.length;
  if (giorniLetti) {
    spiegazione.push(`Chiusura: ora mediana di conferma delle chiusure di cassa (${giorniLetti} giorni letti), arrotondata alla mezz'ora.`);
  } else {
    spiegazione.push(`Nessuna chiusura di cassa: orario standard ${APERTURA_STANDARD}-${CHIUSURA_STANDARD}.`);
  }
  spiegazione.push(`Apertura alle ${APERTURA_STANDARD}: nessun dato registra l'ora di apertura.`);

  const aperti = orari.filter((o) => !o.chiuso);
  const conIncasso = aperti.some((o) => incassoMedio[o.giorno] > 0);
  const peso = (g: number) => (conIncasso ? Math.sqrt(Math.max(incassoMedio[g] ?? 0, 1)) : 1);
  const totalePeso = aperti.reduce((s, o) => s + peso(o.giorno), 0);
  const tetto = Math.max(1, personeInServizio);

  const fasce: FasciaFabbisogno[] = aperti.map((o) => {
    const oreGiorno = (minuti(o.chiude) - minuti(o.apre)) / 60;
    let persone: number;
    if (oreContratto > 0 && totalePeso > 0 && oreGiorno > 0) {
      const oreDelGiorno = oreContratto * peso(o.giorno) / totalePeso;
      // Per difetto: chiedere piu' persone di quante le ore ne coprono lascerebbe
      // buchi certi; le ore che avanzano la proposta dei turni le mette dove serve.
      // Una persona fa un turno al giorno, al massimo il turno massimo piu' la pausa: se
      // il negozio resta aperto di piu', per avere k persone tutto il giorno
      // servono k che aprono e k che chiudono. Il tetto lo tiene possibile.
      const turnoLungo = REGOLE_DEFAULT.turnoMaxOre + pausaPer(REGOLE_DEFAULT.turnoMaxOre * 60) / 60;
      const tettoGiorno = oreGiorno > turnoLungo ? Math.max(1, Math.floor(tetto / 2)) : tetto;
      persone = Math.min(tettoGiorno, Math.max(1, Math.floor(oreDelGiorno / oreGiorno + 0.2)));
    } else {
      persone = 2;
    }
    return { giorno: o.giorno, dalle: o.apre as string, alle: o.chiude as string, persone };
  });

  if (oreContratto > 0) {
    spiegazione.push(`Persone: le ${oreContratto.toLocaleString('it-IT')} ore di contratto del negozio distribuite sui giorni secondo l'incasso medio${conIncasso ? '' : ' (incassi non disponibili: in parti uguali)'}, almeno una persona.`);
  } else {
    spiegazione.push('Nessuna persona in servizio nel negozio: 2 persone per giorno, da rivedere.');
  }

  return { orari, fasce, spiegazione, giorniLetti };
}
