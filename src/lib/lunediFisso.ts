// Il lunedì fisso (Patrizio, 27/11/2026): in tutti i negozi, il lunedì che non è festivo né dentro
// un evento né un giorno speciale del calendario lavorano due persone, una apre e fa fino alle 18
// (8 ore lavorate al massimo), l'altra entra alle 12 e fa la chiusura. Chi apre non ha fatto la
// chiusura la domenica prima. Responsabile e vice possono esserci anche tutte e due; almeno una.
// Dove il negozio apre prima per le pulizie (Valmontone, 9) chi apre entra all'ora delle pulizie.
//
// Libreria pura: sceglie le due persone e i due turni; il motore li tratta poi come turni fissi.

import { eFestivo, giornoIso, hhmm, lavoroMassimoGiorno, limitiPersona, minuti, pausaMinimaPerPresenza, pausaPer, type GiornoPiano, type PersonaTurni, type RegoleTurni, type Turno } from './turni';

/** La chiave di una coppia di persone, uguale in tutti e due gli ordini (come `coppia` di ottimizzaTurni). */
function coppia(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Il lunedì segue la regola fissa: lunedì aperto, non festivo, non evento, non giorno caldo o speciale. */
export function eLunediFisso(g: Pick<GiornoPiano, 'data' | 'chiuso' | 'caldo' | 'evento' | 'speciale' | 'chiusura'>, regole?: Pick<RegoleTurni, 'lunediFisso'>): boolean {
  // acceso sempre (Patrizio: «sempre il lunedì 2 persone»); `lunediFisso: false` serve solo alle prove delle altre regole
  if (regole?.lunediFisso === false) return false;
  // con la chiusura di metà giornata (Forte dei Marmi) i due turni 10-18 e 12-20 non ci stanno: il lunedì resta come prima
  return giornoIso(g.data) === 1 && !g.chiuso && !g.chiusura && !g.caldo && !g.evento && !g.speciale && !eFestivo(g.data);
}

/** Nei giorni speciali (sabato, domenica, festivi, eventi) un turno può arrivare fino a 10 ore lavorate. */
export const TURNO_MAX_SPECIALI_ORE = 10;

/** La presenza più lunga che sta nel turno massimo della giornata (8 ore lavorate + 30' = 8 ore e mezza). */
function presenzaMassima(regole: RegoleTurni): number {
  const lavoro = regole.turnoMaxOre * 60;
  return lavoro + pausaPer(lavoro, regole);
}

/**
 * Gli orari dei due turni del lunedì, in minuti: chi apre dall'apertura (o dalle pulizie) fino a due ore
 * prima della chiusura, senza superare il turno massimo; chi chiude da due ore dopo l'apertura di
 * vendita fino alla chiusura, senza superare il turno massimo. Negozio 10-20: 10-18 e 12-20.
 */
export function orariDelLunedi(g: Pick<GiornoPiano, 'apre' | 'chiude' | 'apreVendita'>, regole: RegoleTurni): { apre: [number, number]; chiude: [number, number] } {
  const max = presenzaMassima(regole);
  const vendita = g.apreVendita ?? g.apre;
  const fineApre = Math.min(g.apre + max, g.chiude - 120);
  const inizioChiude = Math.max(vendita + 120, g.chiude - max);
  return { apre: [g.apre, fineApre], chiude: [inizioChiude, g.chiude] };
}

/** Le persone che hanno fatto la chiusura in quel giorno: il turno che finisce all'ora più tarda. */
export function chiHaChiuso(turni: Pick<Turno, 'employeeId' | 'data' | 'fine'>[], data: string): Set<string> {
  const del = turni.filter((t) => t.data === data);
  if (!del.length) return new Set();
  const ultima = Math.max(...del.map((t) => minuti(t.fine)));
  return new Set(del.filter((t) => minuti(t.fine) === ultima).map((t) => t.employeeId));
}

export interface SceltaLunedi {
  g: GiornoPiano;
  /** chi può lavorare il lunedì, con le ore che ha ancora nella settimana */
  persone: PersonaTurni[];
  regole: RegoleTurni;
  /** responsabile e vice: se ci sono tutte e due, almeno una delle due lavora il lunedì */
  guida?: { responsabile: string | null; vice: string | null };
  /** chi può aprire e chi può chiudere; senza, la regola delle chiavi è spenta */
  chiavi?: { apre: Set<string>; chiude: Set<string> };
  /** chi ha fatto la chiusura la domenica prima: non apre il lunedì */
  chiusoDomenica?: Set<string>;
  /** le coppie dei lunedì prima, dalla più recente: la stessa coppia di fila si evita */
  lunediPrima?: string[];
  /** giorni di riposo preferiti e vietati (1 = lunedì) */
  riposi?: { preferiti?: Map<string, number[]>; mai?: Map<string, number[]> };
  /** giorno libero fisso di ognuno (1 = lunedì) */
  giornoLibero?: Map<string, number>;
}

/**
 * I due turni del lunedì fisso, oppure null se non ci sono due persone che li possano fare (allora il
 * motore pianifica il lunedì come gli altri giorni). Vincoli: orari dentro gli accordi della persona,
 * ore della settimana sufficienti, chiavi, chi apre non ha chiuso la domenica, almeno una fra
 * responsabile e vice. Preferenze: niente coppia del lunedì prima, rispetto di riposi e giorno libero,
 * più ore libere nella settimana.
 */
export function scegliLunedi(a: SceltaLunedi): Turno[] | null {
  const { g, regole } = a;
  if (!eLunediFisso(g, regole)) return null;
  const orari = orariDelLunedi(g, regole);
  const turno = (id: string, [da, al]: [number, number]): Turno => ({
    employeeId: id, data: g.data, inizio: hhmm(da), fine: hhmm(al), pausaMinuti: pausaMinimaPerPresenza(al - da, regole),
  });
  const ore = ([da, al]: [number, number]) => (al - da - pausaMinimaPerPresenza(al - da, regole)) / 60;
  const puo = (p: PersonaTurni, [da, al]: [number, number]) => {
    if (p.nonDisponibile.has(g.data) || p.ore < ore([da, al]) - 1e-9) return false;
    const l = limitiPersona(p, g);
    return l.apre <= da && l.chiude >= al && lavoroMassimoGiorno(l, regole) >= ore([da, al]) * 60 - 1e-9;
  };
  const guide = a.guida?.responsabile && a.guida?.vice ? [a.guida.responsabile, a.guida.vice] : [];
  let meglio: { t: Turno[]; punti: number } | null = null;
  for (const pa of a.persone) {
    if (!puo(pa, orari.apre)) continue;
    if (a.chiavi && !a.chiavi.apre.has(pa.id)) continue;
    if (a.chiusoDomenica?.has(pa.id)) continue;
    for (const pc of a.persone) {
      if (pc.id === pa.id || !puo(pc, orari.chiude)) continue;
      if (a.chiavi && !a.chiavi.chiude.has(pc.id)) continue;
      if (guide.length && !guide.includes(pa.id) && !guide.includes(pc.id)) continue;
      let punti = 0;
      const k = coppia(pa.id, pc.id);
      (a.lunediPrima ?? []).slice(0, 3).forEach((x, i) => { if (x === k) punti += [100, 50, 25][i]; });
      for (const id of [pa.id, pc.id]) {
        if (a.riposi?.preferiti?.get(id)?.includes(1)) punti += 20;
        if (a.giornoLibero?.get(id) === 1) punti += 20;
        if (a.riposi?.mai?.get(id)?.includes(1)) punti -= 10;
      }
      // a parità, a chi ha più ore libere nella settimana
      punti -= (pa.ore + pc.ore) / 100;
      if (!meglio || punti < meglio.punti - 1e-9) meglio = { t: [turno(pa.id, orari.apre), turno(pc.id, orari.chiude)], punti };
    }
  }
  return meglio ? meglio.t : null;
}

/**
 * Il fabbisogno del lunedì fisso: le persone che i due turni mettono in negozio, mezz'ora per mezz'ora
 * (una, poi due dalle 12 alle 18, poi una). MODA e fasce non aggiungono nessuno.
 */
export function coperturaDelLunedi(g: Pick<GiornoPiano, 'apre' | 'chiude' | 'apreVendita' | 'fabbisogno'>, regole: RegoleTurni): number[] {
  const o = orariDelLunedi(g, regole);
  return g.fabbisogno.map((_, i) => {
    const m = g.apre + i * 30;
    return (m >= o.apre[0] && m < o.apre[1] ? 1 : 0) + (m >= o.chiude[0] && m < o.chiude[1] ? 1 : 0);
  });
}
