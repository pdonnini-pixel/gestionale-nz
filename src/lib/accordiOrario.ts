// Accordi con il singolo dipendente per i turni (Patrizio, 28/10/2026).
//
// L'orario di contratto resta fermo: gli accordi dicono QUANDO la persona puo'
// lavorare, non quanto. Per ogni giorno della settimana: sempre, mai, oppure
// solo in una fascia (dalle-alle). Il formato accetta piu' fasce per giorno,
// ma oggi se ne usa una: il turno non si spezza, quindi conta la piu' lunga.
// Valgono per il piano del mese, il piano settimanale e le simulazioni, dentro
// le date di validita' (vuote = sempre). Li modifica solo la responsabile HR.

import { lavoroMassimoGiorno, minuti, REGOLE_DEFAULT, type Fascia, type RegoleTurni } from './turni';

export type FasciaOraria = { dalle: string; alle: string };

export interface Accordo {
  /** giorni ISO (1 = lunedi' ... 7 = domenica) in cui puo' lavorare */
  giorni: number[];
  /** per giorno ISO, le fasce in cui puo' lavorare; assente = tutto l'orario */
  fasce: Record<string, FasciaOraria[]>;
  validoDal: string | null;
  validoAl: string | null;
  nota: string | null;
}

export const NOMI_GIORNI_BREVI_ACCORDI = ['', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

const giornoIsoDi = (data: string) => new Date(`${data}T00:00:00Z`).getUTCDay() || 7;

/** L'accordo vale in quella data? (date di validita' vuote = sempre) */
export function accordoValeIl(a: Accordo, data: string): boolean {
  return (!a.validoDal || data >= a.validoDal) && (!a.validoAl || data <= a.validoAl);
}

/** La persona puo' lavorare in quella data secondo i suoi accordi? Senza accordo: sempre. */
export function puoLavorareIl(accordi: Map<string, Accordo>, employeeId: string, data: string): boolean {
  const a = accordi.get(employeeId);
  return !a || !accordoValeIl(a, data) || a.giorni.includes(giornoIsoDi(data));
}

/** La fascia in cui puo' lavorare quel giorno (la piu' lunga), o null se puo' tutto l'orario. */
export function fasciaIl(accordi: Map<string, Accordo>, employeeId: string, data: string): Fascia | null {
  const a = accordi.get(employeeId);
  if (!a || !accordoValeIl(a, data)) return null;
  const f = (a.fasce[String(giornoIsoDi(data))] ?? [])
    .map((x) => ({ dalle: minuti(x.dalle), alle: minuti(x.alle) }))
    .filter((x) => x.alle > x.dalle)
    .sort((x, y) => (y.alle - y.dalle) - (x.alle - x.dalle));
  return f[0] ?? null;
}

/** Le fasce di una persona sulle date indicate, nel formato del motore dei turni. */
export function fasceDelle(accordi: Map<string, Accordo>, employeeId: string, date: string[]): Map<string, Fascia> | undefined {
  const m = new Map<string, Fascia>();
  for (const d of date) { const f = fasciaIl(accordi, employeeId, d); if (f) m.set(d, f); }
  return m.size ? m : undefined;
}

/** Riassunto breve, es. «mar mai · gio 14-20» oppure «solo sab e dom». */
export function testoAccordo(a: Accordo): string {
  const ora = (h: string) => (h.endsWith(':00') ? String(Number(h.slice(0, 2))) : h.slice(0, 5));
  const fasciaTesto = (g: number) => (a.fasce[String(g)] ?? []).map((f) => `${ora(f.dalle)}-${ora(f.alle)}`).join(' e ');
  const mai = [1, 2, 3, 4, 5, 6, 7].filter((g) => !a.giorni.includes(g));
  const conFascia = a.giorni.filter((g) => (a.fasce[String(g)] ?? []).length);
  const parti: string[] = [];
  if (mai.length >= 4) {
    parti.push(`solo ${a.giorni.map((g) => NOMI_GIORNI_BREVI_ACCORDI[g]).join(', ').replace(/, ([^,]*)$/, ' e $1')}`);
  } else if (mai.length) {
    parti.push(`${mai.map((g) => NOMI_GIORNI_BREVI_ACCORDI[g]).join(', ')} mai`);
  }
  for (const g of conFascia) parti.push(`${NOMI_GIORNI_BREVI_ACCORDI[g]} ${fasciaTesto(g)}`);
  return parti.join(' · ') || 'sempre disponibile';
}

/**
 * Le ore che la persona puo' fare in una settimana con questi accordi, dentro
 * l'orario del negozio: in ogni giorno il turno piu' lungo che sta nella sua
 * fascia (con la pausa), al massimo nei giorni di lavoro consentiti.
 * `orario` per giorno ISO: apertura e chiusura in minuti, null se chiuso.
 */
export function orePossibiliSettimana(
  a: Accordo | null, orario: Record<number, { apre: number; chiude: number } | null>, regole: RegoleTurni = REGOLE_DEFAULT,
): number {
  const perGiorno: number[] = [];
  for (let g = 1; g <= 7; g++) {
    const o = orario[g];
    if (!o || (a && !a.giorni.includes(g))) continue;
    const f = a ? (a.fasce[String(g)] ?? []).map((x) => ({ dalle: minuti(x.dalle), alle: minuti(x.alle) })) : [];
    const finestre = f.length ? f.map((x) => ({ apre: Math.max(o.apre, x.dalle), chiude: Math.min(o.chiude, x.alle) })) : [o];
    const lavoro = Math.max(0, ...finestre.map((x) => (x.chiude > x.apre ? lavoroMassimoGiorno(x, regole) : 0)));
    if (lavoro >= regole.turnoMinOre * 60) perGiorno.push(lavoro / 60);
  }
  return perGiorno.sort((x, y) => y - x).slice(0, regole.giorniLavoroMax).reduce((s, x) => s + x, 0);
}
