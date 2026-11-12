// Ferie e permessi: le scelte del negozio (scheda 9 di «Regole e orari», Patrizio 12/11/2026).
//
// Chi approva (referente del negozio, HR, tutte e due; ne basta una o servono entrambe) e in quali
// giorni si possono chiedere. Dove un giorno e' spento la richiesta passa solo come eccezione.
// La regola vera sta nel database (migration 407: outlet_leave_rules, ferie_blocco_giorno,
// leave_decidi): qui c'e' la stessa logica per mostrare e spiegare, non per bloccare.
// Funzioni pure. Test in ferieRegole.test.ts.

import { festivitaItaliane } from './ferieRichiesta';

export type Cosa = 'ferie' | 'permessi';

export interface ChiApprova {
  referente: boolean;
  hr: boolean;
  /** servono tutte e due le approvazioni (vale solo se referente e hr sono accese) */
  entrambe: boolean;
}

export interface QuandoSiChiede {
  ferie: boolean;
  permessi: boolean;
}

export interface RegoleFerie {
  approva: { ferie: ChiApprova; permessi: ChiApprova; eccezioni: ChiApprova };
  quando: { feriali: QuandoSiChiede; weekend: QuandoSiChiede; festivi: QuandoSiChiede };
}

/** Come si comporta un negozio che non ha mai salvato la scheda: tutto come prima della 407. */
export const REGOLE_FERIE_SPENTE: RegoleFerie = {
  approva: {
    ferie: { referente: true, hr: true, entrambe: false },
    permessi: { referente: true, hr: true, entrambe: false },
    eccezioni: { referente: false, hr: false, entrambe: false },
  },
  quando: {
    feriali: { ferie: true, permessi: true },
    weekend: { ferie: true, permessi: true },
    festivi: { ferie: true, permessi: true },
  },
};

/**
 * La proposta quando la scheda si apre per la prima volta: approva una fra referente e HR; nei
 * negozi con i giorni caldi dove lavorano tutte, sabato, domenica, festivi e giorni speciali sono
 * spenti e le eccezioni le decide una fra referente e HR. Resta una proposta finche' non si salva.
 */
export function regoleFerieDiPartenza(giorniCaldiTutti: boolean): RegoleFerie {
  const caldo = { ferie: !giorniCaldiTutti, permessi: !giorniCaldiTutti };
  return {
    approva: {
      ferie: { referente: true, hr: true, entrambe: false },
      permessi: { referente: true, hr: true, entrambe: false },
      eccezioni: { referente: giorniCaldiTutti, hr: giorniCaldiTutti, entrambe: false },
    },
    quando: { feriali: { ferie: true, permessi: true }, weekend: { ...caldo }, festivi: { ...caldo } },
  };
}

type Riga = Record<string, unknown>;
const bool = (v: unknown, se: boolean): boolean => (typeof v === 'boolean' ? v : se);

/** Da una riga di outlet_leave_rules; riga assente = regole spente. */
export function regoleFerieDaRiga(r: Riga | null | undefined): RegoleFerie {
  if (!r) return REGOLE_FERIE_SPENTE;
  const chi = (p: string, se: boolean): ChiApprova => ({
    referente: bool(r[`${p}_referente`], se), hr: bool(r[`${p}_hr`], se), entrambe: bool(r[`${p}_entrambe`], false),
  });
  const quando = (p: string): QuandoSiChiede => ({ ferie: bool(r[`ferie_${p}`], true), permessi: bool(r[`permessi_${p}`], true) });
  return {
    approva: { ferie: chi('ferie', true), permessi: chi('permessi', true), eccezioni: chi('eccezioni', false) },
    quando: { feriali: quando('feriali'), weekend: quando('weekend'), festivi: quando('festivi') },
  };
}

/** Le colonne da salvare (tutte esplicite: una scheda salvata non lascia NULL). */
export function rigaDaRegoleFerie(x: RegoleFerie): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const k of ['ferie', 'permessi', 'eccezioni'] as const) {
    out[`${k}_referente`] = x.approva[k].referente;
    out[`${k}_hr`] = x.approva[k].hr;
    out[`${k}_entrambe`] = x.approva[k].entrambe && x.approva[k].referente && x.approva[k].hr;
  }
  for (const k of ['feriali', 'weekend', 'festivi'] as const) {
    out[`ferie_${k}`] = x.quando[k].ferie;
    out[`permessi_${k}`] = x.quando[k].permessi;
  }
  return out;
}

/** Le eccezioni si possono chiedere solo se il negozio ha detto chi le approva. */
export const eccezioniAttive = (x: RegoleFerie): boolean => x.approva.eccezioni.referente || x.approva.eccezioni.hr;

/** Una scheda in cui nessuno puo' approvare una voce non si salva. */
export function erroriRegoleFerie(x: RegoleFerie): string[] {
  const out: string[] = [];
  if (!x.approva.ferie.referente && !x.approva.ferie.hr) out.push('Le ferie non le approva nessuno: accendi la referente, l’HR o tutte e due.');
  if (!x.approva.permessi.referente && !x.approva.permessi.hr) out.push('I permessi non li approva nessuno: accendi la referente, l’HR o tutte e due.');
  const spento = (['feriali', 'weekend', 'festivi'] as const).some((k) => !x.quando[k].ferie || !x.quando[k].permessi);
  if (spento && !eccezioniAttive(x)) out.push('Ci sono giorni in cui ferie o permessi sono spenti, ma nessuno approva le eccezioni: in quei giorni la richiesta sarà rifiutata senza alternativa.');
  return out;
}

export interface EventoFerie {
  nome: string;
  data_dal: string;
  data_al: string;
  blocca_ferie?: boolean;
  tipo?: 'giorno' | 'periodo' | null;
  /** le voci ferie e permessi delle regole dell'evento, se scritte */
  ferie?: boolean | null;
  permessi?: boolean | null;
}

/** Ferie e permessi di un evento, come li legge il database: la voce scritta, altrimenti blocca_ferie. */
export function ammesseNellEvento(e: EventoFerie): QuandoSiChiede {
  return { ferie: e.ferie ?? !e.blocca_ferie, permessi: e.permessi ?? !e.blocca_ferie };
}

/** Cosa salvare sull'evento quando si accendono o spengono le due voci. */
export function eventoConFerie(regole: Record<string, unknown> | null | undefined, q: QuandoSiChiede): { regole: Record<string, unknown>; blocca_ferie: boolean } {
  return { regole: { ...(regole ?? {}), ferie: q.ferie, permessi: q.permessi }, blocca_ferie: !q.ferie && !q.permessi };
}

export type EsitoRichiesta = { ammessa: true } | { ammessa: false; motivo: string; eccezione: boolean };

/**
 * La stessa decisione di ferie_blocco_giorno (migration 407): prima gli eventi del giorno (la voce
 * scritta sull'evento comanda; un evento di prima con blocca_ferie blocca tutte e due), poi le
 * regole del negozio per tipo di giorno. `regole` null = negozio che non ha salvato la scheda.
 */
export function esitoRichiesta(data: string, cosa: Cosa, eventi: readonly EventoFerie[], regole: RegoleFerie | null): EsitoRichiesta {
  const g = `${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(0, 4)}`;
  const ecc = !!regole && eccezioniAttive(regole);
  const no = (motivo: string): EsitoRichiesta => ({ ammessa: false, motivo, eccezione: ecc });
  let deciso = false;
  let speciale = false;
  for (const e of eventi) {
    if (data < e.data_dal || data > (e.data_al || e.data_dal)) continue;
    const scritta = e[cosa];
    if (typeof scritta === 'boolean') {
      deciso = true;
      if (!scritta) return no(`Il ${g} c'è ${e.nome}: niente ${cosa}.`);
    } else if (e.blocca_ferie) {
      return no(`Il ${g} c'è ${e.nome}: niente ferie né permessi.`);
    }
    if (e.tipo === 'giorno') speciale = true;
  }
  if (deciso || !regole) return { ammessa: true };
  const giorno = new Date(`${data}T00:00:00Z`).getUTCDay() || 7;
  if (speciale || festivitaItaliane(Number(data.slice(0, 4)))[data]) {
    if (!regole.quando.festivi[cosa]) return no(`Il ${g} è un giorno festivo o speciale: in quei giorni il negozio lavora al completo, niente ${cosa}.`);
  } else if (giorno >= 6) {
    if (!regole.quando.weekend[cosa]) return no(`Il ${g} è ${giorno === 6 ? 'sabato' : 'domenica'}: il sabato e la domenica il negozio lavora al completo, niente ${cosa}.`);
  } else if (!regole.quando.feriali[cosa]) {
    return no(`Il ${g}: in questo negozio nei giorni feriali non si chiedono ${cosa} dall'app.`);
  }
  return { ammessa: true };
}

/** «referente», «HR», «referente oppure HR», «referente e HR»: per dire in una riga chi approva. */
export function chiApprovaInParole(c: ChiApprova): string {
  if (c.referente && c.hr) return c.entrambe ? 'referente e HR, tutte e due' : 'referente oppure HR';
  if (c.referente) return 'referente';
  if (c.hr) return 'HR';
  return 'nessuno';
}

export interface PrimaDecisione { lato: 'referente' | 'hr'; nome: string | null; quando: string | null }

export function leggiPrimaDecisione(v: unknown): PrimaDecisione | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (r.lato !== 'referente' && r.lato !== 'hr') return null;
  return { lato: r.lato, nome: typeof r.nome === 'string' ? r.nome : null, quando: typeof r.quando === 'string' ? r.quando : null };
}

/** «Ha già approvato la referente (Nome): manca l'HR.» */
export function attesaInParole(p: PrimaDecisione): string {
  const chi = p.lato === 'referente' ? 'la referente' : 'l’HR';
  const manca = p.lato === 'referente' ? 'l’HR' : 'la referente del negozio';
  return `Ha già approvato ${chi}${p.nome ? ` (${p.nome})` : ''}: manca ${manca}.`;
}
