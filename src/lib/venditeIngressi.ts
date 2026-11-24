// «Vendite e ingressi»: i calcoli del report del mese, a partire da quello che
// restituisce vendite_ingressi_report (migration 464). Funzioni pure, nessuna
// query. Test in venditeIngressi.test.ts.
//
// La fonte e' il report MODA «Statistica Situazione Vendite con Conversion
// Rate» per giorno e ora. Gli importi sono tutti IMPONIBILI (senza IVA).
// Colonne MODA → misure:
//   N.P. = ingressi (persone entrate), Scontr = scontrini, Qta = pezzi,
//   Teorico = vendite a listino, Reale = vendite incassate, V.Acq = costo
//   d'acquisto (costo medio). Si calcolano: conversione (scontrini / ingressi),
//   sconto (1 − reale / teorico), prezzo medio (reale / pezzi), pezzi per
//   scontrino, scontrino medio (reale / scontrini), ricarichi (teorico o reale
//   / costo) e resa (reale − costo, la colonna Resa di MODA).
//
// Gli importi valgono solo per i giorni caricati con le colonne nuove: i
// report caricati prima della 464 avevano solo ingressi e scontrini. Un
// periodo con giorni senza importi lo dice (importiCompleti = false) e le
// misure in euro si calcolano sui soli giorni con gli importi.

export interface GiornoVI {
  outletId: string;
  data: string; // YYYY-MM-DD
  ingressi: number;
  scontrini: number;
  pezzi: number;
  teorico: number;
  reale: number;
  costo: number;
  /** il giorno ha gli importi (caricato con la 464 o dopo) */
  importi: boolean;
}

export interface OraVI { outletId: string; giornoSett: number; ora: number; ingressi: number; scontrini: number; reale: number }

export interface ReportVI {
  mese: string; // YYYY-MM
  soloSuoi: boolean;
  negozi: { id: string; nome: string }[];
  mesi: string[];
  giorni: GiornoVI[];
  ore: OraVI[];
  /** incasso netto delle chiusure di cassa del mese, per negozio */
  cassa: Map<string, number>;
  /** incasso netto delle chiusure di cassa per negozio e giorno («negozio|data»), migration 465 */
  cassaGiorni: Map<string, number>;
}

const n = (v: unknown): number => (v == null || v === '' ? 0 : Number(v));

/** Il jsonb della funzione, in tipi. */
export function leggiReportVI(raw: unknown): ReportVI {
  const r = (raw ?? {}) as Record<string, unknown>;
  const arr = (k: string) => (Array.isArray(r[k]) ? (r[k] as unknown[]) : []);
  return {
    mese: String(r.mese ?? ''),
    soloSuoi: r.solo_suoi === true,
    negozi: arr('negozi').map((x) => { const o = x as { id: string; nome: string }; return { id: String(o.id), nome: String(o.nome ?? '') }; }),
    mesi: arr('mesi').map(String),
    giorni: arr('giorni').map((x) => {
      const a = x as unknown[];
      return { outletId: String(a[0]), data: String(a[1]), ingressi: n(a[2]), scontrini: n(a[3]), pezzi: n(a[4]), teorico: n(a[5]), reale: n(a[6]), costo: n(a[7]), importi: a[8] === true };
    }),
    ore: arr('ore').map((x) => {
      const a = x as unknown[];
      return { outletId: String(a[0]), giornoSett: n(a[1]), ora: n(a[2]), ingressi: n(a[3]), scontrini: n(a[4]), reale: n(a[5]) };
    }),
    cassa: new Map(arr('cassa').map((x) => { const a = x as unknown[]; return [String(a[0]), n(a[1])] as [string, number]; })),
    cassaGiorni: new Map(arr('cassa_giorni').map((x) => { const a = x as unknown[]; return [`${String(a[0])}|${String(a[1])}`, n(a[2])] as [string, number]; })),
  };
}

// ── Periodi ─────────────────────────────────────────────────────────────────

export const mesePrima = (mese: string): string => {
  const [a, m] = mese.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
};
export const meseAnnoPrima = (mese: string): string => `${Number(mese.slice(0, 4)) - 1}-${mese.slice(5, 7)}`;

/** L'ultimo giorno del mese con dati (1-31), 0 se nessuno. */
export function ultimoGiorno(giorni: GiornoVI[], mese: string): number {
  return giorni.filter((g) => g.data.startsWith(mese)).reduce((a, g) => Math.max(a, Number(g.data.slice(8, 10))), 0);
}

/** I giorni di un mese, fino al giorno indicato (per confrontare periodi della stessa lunghezza) e per i negozi scelti. */
export function giorniDel(giorni: GiornoVI[], mese: string, finoAl = 31, negozi?: Set<string>): GiornoVI[] {
  return giorni.filter((g) => g.data.startsWith(mese) && Number(g.data.slice(8, 10)) <= finoAl && (!negozi || negozi.has(g.outletId)));
}

/** La data spostata di n giorni (negativo = indietro). */
export function spostaGiorni(data: string, n: number): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Giorni della settimana a cui confrontare l'anno prima: 52 settimane, cioe' 364 giorni. */
export const GIORNI_ANNO_PRIMA = 364;

/**
 * I giorni dell'anno prima che corrispondono, uno per uno, a quelli del
 * periodo: stesso negozio, stesso giorno della settimana, 52 settimane prima.
 * Cosi' una domenica si confronta con una domenica (1-3/11/2026, domenica-
 * martedi', va con 2-4/11/2025, non con 1-3/11/2025 che era sabato-lunedi').
 */
export function giorniAnnoPrima(tutti: GiornoVI[], periodo: GiornoVI[]): GiornoVI[] {
  const chiavi = new Set(periodo.map((g) => `${g.outletId}|${spostaGiorni(g.data, -GIORNI_ANNO_PRIMA)}`));
  return tutti.filter((g) => chiavi.has(`${g.outletId}|${g.data}`));
}

/** L'incasso di cassa sui soli giorni che MODA ha (stesso negozio, stesso giorno). Null se la cassa non ne ha nessuno. */
export function cassaSuiGiorni(cassaGiorni: Map<string, number>, periodo: GiornoVI[]): number | null {
  let tot = 0; let trovati = 0;
  for (const g of periodo) {
    const v = cassaGiorni.get(`${g.outletId}|${g.data}`);
    if (v != null) { tot += v; trovati++; }
  }
  return trovati ? tot : null;
}

// ── Misure ──────────────────────────────────────────────────────────────────

export interface Misure {
  ingressi: number;
  scontrini: number;
  giorni: number;
  /** importi sommati sui soli giorni che li hanno */
  pezzi: number;
  teorico: number;
  reale: number;
  costo: number;
  /** scontrini e ingressi dei soli giorni con gli importi: servono a scontrino medio e pezzi per scontrino */
  scontriniConImporti: number;
  giorniConImporti: number;
  importiCompleti: boolean;
}

export function somma(giorni: GiornoVI[]): Misure {
  const m: Misure = { ingressi: 0, scontrini: 0, giorni: giorni.length, pezzi: 0, teorico: 0, reale: 0, costo: 0, scontriniConImporti: 0, giorniConImporti: 0, importiCompleti: giorni.length > 0 };
  for (const g of giorni) {
    m.ingressi += g.ingressi; m.scontrini += g.scontrini;
    if (g.importi) {
      m.pezzi += g.pezzi; m.teorico += g.teorico; m.reale += g.reale; m.costo += g.costo;
      m.scontriniConImporti += g.scontrini; m.giorniConImporti++;
    } else m.importiCompleti = false;
  }
  return m;
}

const div = (a: number, b: number): number | null => (b ? a / b : null);

export interface Derivate {
  conversione: number | null; // %
  scontrinoMedio: number | null;
  pezziPerScontrino: number | null;
  prezzoMedio: number | null;
  sconto: number | null; // %
  resa: number | null;
  resaPct: number | null; // % delle vendite
  ricaricoTeorico: number | null;
  ricaricoReale: number | null;
}

export function derivate(m: Misure): Derivate {
  const conImporti = m.giorniConImporti > 0;
  const conv = div(m.scontrini, m.ingressi);
  return {
    conversione: conv == null ? null : conv * 100,
    scontrinoMedio: conImporti ? div(m.reale, m.scontriniConImporti) : null,
    pezziPerScontrino: conImporti ? div(m.pezzi, m.scontriniConImporti) : null,
    prezzoMedio: conImporti ? div(m.reale, m.pezzi) : null,
    sconto: conImporti && m.teorico ? (1 - m.reale / m.teorico) * 100 : null,
    resa: conImporti ? m.reale - m.costo : null,
    resaPct: conImporti && m.reale ? ((m.reale - m.costo) / m.reale) * 100 : null,
    ricaricoTeorico: conImporti ? div(m.teorico, m.costo) : null,
    ricaricoReale: conImporti ? div(m.reale, m.costo) : null,
  };
}

/** Variazione percentuale; null se manca la base. */
export const variazione = (ora: number | null, prima: number | null): number | null =>
  ora == null || prima == null || prima === 0 ? null : ((ora - prima) / Math.abs(prima)) * 100;

// ── Perche' sono cambiate le vendite ────────────────────────────────────────

export interface Scomposizione {
  /** su cosa: vendite in euro se tutti e due i periodi hanno gli importi, altrimenti scontrini */
  base: 'vendite' | 'scontrini';
  prima: number;
  ora: number;
  traffico: number;
  conversione: number;
  /** solo con base vendite */
  scontrino: number;
}

/**
 * Vendite = ingressi × conversione × scontrino medio. La differenza fra due
 * periodi si divide in tre pezzi che sommati la ridanno esatta: prima cambia
 * il traffico (con conversione e scontrino di prima), poi la conversione (con
 * lo scontrino di prima), poi lo scontrino. Senza importi si scompongono gli
 * scontrini (ingressi × conversione). Null se manca un periodo.
 */
export function scomponi(prima: Misure, ora: Misure): Scomposizione | null {
  if (!prima.ingressi || !ora.ingressi) return null;
  const c0 = prima.scontrini / prima.ingressi;
  const c1 = ora.scontrini / ora.ingressi;
  const traffico = (ora.ingressi - prima.ingressi) * c0;
  const conversione = ora.ingressi * (c1 - c0);
  if (prima.importiCompleti && ora.importiCompleti && prima.scontrini && ora.scontrini) {
    const m0 = prima.reale / prima.scontrini;
    const m1 = ora.reale / ora.scontrini;
    return {
      base: 'vendite', prima: prima.reale, ora: ora.reale,
      traffico: traffico * m0, conversione: conversione * m0, scontrino: ora.scontrini * (m1 - m0),
    };
  }
  return { base: 'scontrini', prima: prima.scontrini, ora: ora.scontrini, traffico, conversione, scontrino: 0 };
}

// ── Quadratura con le chiusure di cassa ─────────────────────────────────────

/** Differenza % fra incasso netto delle chiusure e vendite MODA (positivo = MODA sotto la cassa). Null se manca uno dei due. */
export function scartoCassa(cassaNetta: number | undefined | null, venditeModa: number, importiCompleti: boolean): number | null {
  if (!cassaNetta || !importiCompleti) return null;
  return ((cassaNetta - venditeModa) / cassaNetta) * 100;
}

/** Oltre questa soglia la differenza con la cassa e' da guardare. */
export const SOGLIA_CASSA = 2;

// ── Ore e giorni della settimana ────────────────────────────────────────────

/** Ingressi e scontrini per giorno della settimana (1-7) e ora, sommati sui negozi scelti. */
export function mappaOre(ore: OraVI[], negozi?: Set<string>): Map<string, { ingressi: number; scontrini: number }> {
  const out = new Map<string, { ingressi: number; scontrini: number }>();
  for (const o of ore) {
    if (negozi && !negozi.has(o.outletId)) continue;
    const k = `${o.giornoSett}|${o.ora}`;
    const x = out.get(k) ?? { ingressi: 0, scontrini: 0 };
    x.ingressi += o.ingressi; x.scontrini += o.scontrini;
    out.set(k, x);
  }
  return out;
}

/** Le ore da mostrare: da quella del primo ingresso a quella dell'ultimo, nel mese. */
export function oreAperte(ore: OraVI[]): number[] {
  const conIngressi = ore.filter((o) => o.ingressi > 0).map((o) => o.ora);
  if (!conIngressi.length) return [];
  const da = Math.min(...conIngressi); const a = Math.max(...conIngressi);
  return Array.from({ length: a - da + 1 }, (_, i) => da + i);
}
