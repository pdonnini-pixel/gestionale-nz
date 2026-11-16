// Periodo vuoto, dati altrove (16/11/2026).
//
// Quando il periodo a video non ha dati ma ce ne sono in un altro periodo, la
// pagina non deve dire «Nessun dato, importa»: chi legge ricarica i file e crea
// doppioni (Zago, onboarding con i soli cedolini di ottobre 2026). Deve dire che
// quel periodo non e' ancora caricato e portare all'ultimo periodo che ha dati.
// Qui ci sono solo le funzioni pure che trovano quel periodo; il riquadro e'
// src/components/ui/PeriodoVuoto.tsx.

export interface Mese { year: number; month: number }

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/** "ottobre 2026". */
export function etichettaMese(m: Mese): string {
  return `${MESI[m.month - 1] || m.month} ${m.year}`;
}

/**
 * Il mese piu' recente fra quelli con dati, escluso quello a video.
 * Righe senza anno o mese validi si ignorano. null se non ce ne sono.
 */
export function ultimoMeseConDati(
  righe: Iterable<{ year?: number | null; month?: number | null }>,
  escludi?: Mese | null,
): Mese | null {
  let best: Mese | null = null;
  for (const r of righe) {
    if (r.year == null || r.month == null) continue;
    const y = Number(r.year);
    const m = Number(r.month);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) continue;
    if (escludi && y === escludi.year && m === escludi.month) continue;
    if (!best || y > best.year || (y === best.year && m > best.month)) best = { year: y, month: m };
  }
  return best;
}

/** L'anno piu' recente fra quelli con dati, escluso quello a video. null se non ce ne sono. */
export function ultimoAnnoConDati(anni: Iterable<number | null | undefined>, escludi?: number | null): number | null {
  let best: number | null = null;
  for (const a of anni) {
    if (a == null) continue;
    const y = Number(a);
    if (!Number.isInteger(y)) continue;
    if (escludi != null && y === escludi) continue;
    if (best == null || y > best) best = y;
  }
  return best;
}

/**
 * La data piu' recente (YYYY-MM-DD) fra quelle date, opzionalmente solo quelle
 * prima di `prima` (esclusa). Le date si confrontano come testo ISO.
 */
export function ultimaData(date: Iterable<string | null | undefined>, prima?: string | null): string | null {
  let best: string | null = null;
  for (const d of date) {
    if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) continue;
    const g = d.slice(0, 10);
    if (prima && g >= prima.slice(0, 10)) continue;
    if (!best || g > best) best = g;
  }
  return best;
}

/** "2026-10-31" -> "31/10/2026". */
export function dataIt(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
