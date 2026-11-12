// Responsabile e vice responsabile del negozio, e la regola del lunedi'
// (Patrizio, 11/11/2026): ogni lunedi' almeno una delle due deve essere al
// lavoro in negozio, perche' e' il giorno del versamento in banca. Il
// versamento e' in cassa continua, quindi non conta l'orario: basta che una
// delle due abbia un turno quel giorno.
//
// Funzioni pure, senza query: le usano il motore dei turni e le pagine dei
// turni. Il blocco sulle ferie sta nel database (migration 393).

export type RuoloGuida = 'responsabile' | 'vice';

type Id = string | null | undefined;

/** Il ruolo di una persona in un negozio: responsabile, vice o nessuno dei due. */
export function ruoloGuida(employeeId: Id, responsabileId: Id, viceId: Id): RuoloGuida | null {
  if (!employeeId) return null;
  if (responsabileId && employeeId === responsabileId) return 'responsabile';
  if (viceId && employeeId === viceId) return 'vice';
  return null;
}

/** L'etichetta da mostrare accanto al nome («Responsabile», «Vice responsabile»). */
export function etichettaRuoloGuida(ruolo: RuoloGuida | null): string | null {
  if (ruolo === 'responsabile') return 'Responsabile';
  if (ruolo === 'vice') return 'Vice responsabile';
  return null;
}

/**
 * Il negozio non ha tutte e due le figure (o sono la stessa persona): la
 * regola del lunedi' non si puo' applicare, e la pagina puo' dire «manca il
 * vice responsabile».
 */
export function guidaIncompleta(responsabileId: Id, viceId: Id): boolean {
  return !responsabileId || !viceId || responsabileId === viceId;
}

/** Cosa manca, in parole: per l'avviso nella pagina. null se ci sono tutte e due. */
export function cosaMancaAllaGuida(responsabileId: Id, viceId: Id): string | null {
  if (!responsabileId && !viceId) return 'Mancano la responsabile e il vice responsabile';
  if (!responsabileId) return 'Manca la responsabile';
  if (!viceId) return 'Manca il vice responsabile';
  if (responsabileId === viceId) return 'Responsabile e vice sono la stessa persona';
  return null;
}

/** Vero se la data (AAAA-MM-GG) e' un lunedi'. Una data scritta male non lo e'. */
export function eLunedi(data: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  if (!m) return false;
  const [anno, mese, giorno] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(anno, mese - 1, giorno));
  // 31/02 e simili: Date li sposta al mese dopo, qui non valgono.
  if (d.getUTCFullYear() !== anno || d.getUTCMonth() !== mese - 1 || d.getUTCDate() !== giorno) return false;
  return d.getUTCDay() === 1;
}

/** I lunedi' fra le date, senza doppioni, in ordine, tolti i giorni chiusi. */
function lunediAperti(date: readonly string[], chiusi?: readonly string[]): string[] {
  const no = new Set(chiusi ?? []);
  return [...new Set(date)].filter((d) => eLunedi(d) && !no.has(d)).sort();
}

export interface ArgLunediSenzaGuida {
  /** i giorni mostrati (AAAA-MM-GG): si guardano solo i lunedi' */
  date: readonly string[];
  responsabileId: Id;
  viceId: Id;
  /** i turni del negozio: conta solo chi ha un turno e in che giorno */
  turni: readonly { employeeId: string; data: string }[];
  /** giorni in cui il negozio e' chiuso: non si segnalano */
  chiusi?: readonly string[];
}

/**
 * I lunedi' in cui ne' la responsabile ne' la vice hanno un turno.
 * Se il negozio non ha tutte e due le figure restituisce [] (vedi
 * `guidaIncompleta`): lo strumento va prima riempito.
 */
export function lunediSenzaGuida(args: ArgLunediSenzaGuida): string[] {
  const { responsabileId, viceId } = args;
  if (guidaIncompleta(responsabileId, viceId)) return [];
  const coperti = new Set<string>();
  for (const t of args.turni) {
    if (t.employeeId === responsabileId || t.employeeId === viceId) coperti.add(t.data);
  }
  return lunediAperti(args.date, args.chiusi).filter((d) => !coperti.has(d));
}

export interface ArgLunediScopertiDaAssenze {
  /** i giorni da guardare (AAAA-MM-GG): si guardano solo i lunedi' */
  date: readonly string[];
  responsabileId: Id;
  viceId: Id;
  /**
   * Assenze a giornata intera, di qualunque tipo: ferie, permessi a giornata,
   * malattia, riposo. Una riga per persona e giorno.
   */
  assenze: readonly { employeeId: string; data: string }[];
  /** giorni in cui il negozio e' chiuso: non si segnalano */
  chiusi?: readonly string[];
}

/**
 * I lunedi' in cui sono assenti TUTTE E DUE, responsabile e vice. Serve per
 * la malattia, che non si puo' impedire: il sistema non blocca, segnala.
 * Se il negozio non ha tutte e due le figure restituisce [].
 */
export function lunediScopertiDaAssenze(args: ArgLunediScopertiDaAssenze): string[] {
  const { responsabileId, viceId } = args;
  if (guidaIncompleta(responsabileId, viceId)) return [];
  const senzaResp = new Set<string>();
  const senzaVice = new Set<string>();
  for (const a of args.assenze) {
    if (a.employeeId === responsabileId) senzaResp.add(a.data);
    else if (a.employeeId === viceId) senzaVice.add(a.data);
  }
  return lunediAperti(args.date, args.chiusi).filter((d) => senzaResp.has(d) && senzaVice.has(d));
}

// ── Il ripiego (Patrizio, 12/11/2026) ────────────────────────────────────

export interface PersonaPerGuida {
  id: string;
  /** ore settimanali di contratto */
  ore: number;
  /** data di assunzione AAAA-MM-GG; chi non ce l'ha viene dopo */
  assunta?: string | null;
}

export interface GuidaConRipiego {
  responsabile: string | null;
  vice: string | null;
  /** vero dove la persona l'ha scelta il sistema e non e' stata ancora caricata */
  provvisoria: { responsabile: boolean; vice: boolean };
}

/**
 * Responsabile e vice del negozio, con la scelta provvisoria dove mancano: finche' non sono
 * caricate il sistema usa chi ha piu' ore di contratto e, a parita', chi e' assunta da piu'
 * tempo (a parita' anche di data, l'ordine dell'identificativo, cosi' la scelta non cambia da
 * una volta all'altra). La prima libera fa da responsabile, la seconda da vice. Chi e' gia'
 * caricata resta al suo posto.
 */
export function guidaConRipiego(responsabileId: Id, viceId: Id, persone: readonly PersonaPerGuida[]): GuidaConRipiego {
  const ordinate = [...persone].filter((p) => p.ore > 0).sort((a, b) =>
    b.ore - a.ore
    || (a.assunta ?? '9999-12-31').localeCompare(b.assunta ?? '9999-12-31')
    || a.id.localeCompare(b.id));
  let responsabile = responsabileId && persone.some((p) => p.id === responsabileId) ? responsabileId : null;
  let vice = viceId && viceId !== responsabile && persone.some((p) => p.id === viceId) ? viceId : null;
  const provvisoria = { responsabile: false, vice: false };
  if (!responsabile) {
    responsabile = ordinate.find((p) => p.id !== vice)?.id ?? null;
    provvisoria.responsabile = !!responsabile;
  }
  if (!vice) {
    vice = ordinate.find((p) => p.id !== responsabile)?.id ?? null;
    provvisoria.vice = !!vice;
  }
  return { responsabile, vice, provvisoria };
}
