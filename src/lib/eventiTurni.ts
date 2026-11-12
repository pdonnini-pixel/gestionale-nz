// Giorni speciali e periodi speciali dei negozi (Patrizio, 12/11/2026).
//
//  - GIORNO SPECIALE SINGOLO (outlet_events.tipo = 'giorno'): vale come un sabato.
//  - PERIODO SPECIALE (tipo = 'periodo'): dal giorno X al giorno Y, con regole proprie per
//    quel negozio (orario, persone per fascia, MODA sopra, tutte al lavoro, straordinari,
//    apertura e chiusura fra responsabile e vice, ferie e permessi, riposi minimi).
//    Le regole partono «come un sabato», «come la domenica», copiate da un altro evento oppure
//    scritte a mano, e poi si cambiano una per una.
//  - CONTROLLO MODA: quando si crea un periodo il sistema guarda gli ingressi dello stesso
//    periodo dell'anno prima, con tre giorni di margine prima e dopo, e li confronta con le
//    settimane vicine, per capire se il periodo e' davvero piu' forte.
//
// Per legge il riposo settimanale e' di almeno un giorno: nessun periodo puo' scendere sotto.
//
// Funzioni pure, nessuna query. Test in eventiTurni.test.ts. Come i giorni di un evento
// entrano nei turni lo decide costruisciGiorni (turni.ts).

import { RIPOSO_LEGALE, eventiDelGiorno, eventiDelNegozio, type EventoNegozio, type FasciaFabbisogno, type RegoleEvento, type RegoleTurni } from './turni';

export type OrigineRegole = 'sabato' | 'domenica' | 'evento' | 'manuale';

const ORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const ora5 = (v: unknown): string | null => (typeof v === 'string' && ORA.test(v.slice(0, 5)) ? v.slice(0, 5) : null);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

/**
 * Le regole di un periodo lette dal database (jsonb): si tiene solo quello che ha la forma
 * giusta, il resto si ignora. I riposi minimi non scendono mai sotto uno.
 */
export function leggiRegoleEvento(json: unknown): RegoleEvento | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const j = json as Record<string, unknown>;
  const fasce = Array.isArray(j.fasce)
    ? (j.fasce as Record<string, unknown>[])
      .map((f) => ({ dalle: ora5(f?.dalle), alle: ora5(f?.alle), persone: Number(f?.persone) }))
      .filter((f): f is { dalle: string; alle: string; persone: number } => !!f.dalle && !!f.alle && f.alle > f.dalle && Number.isFinite(f.persone) && f.persone >= 0)
      .map((f) => ({ ...f, persone: Math.round(f.persone) }))
    : null;
  const out: RegoleEvento = {};
  if (ora5(j.apre)) out.apre = ora5(j.apre);
  if (ora5(j.chiude)) out.chiude = ora5(j.chiude);
  if (fasce && fasce.length) out.fasce = fasce;
  for (const k of ['moda', 'tutti', 'straordinari', 'guida', 'ferie', 'permessi'] as const) {
    const v = bool(j[k]);
    if (v !== undefined) out[k] = v;
  }
  if (j.riposi_min != null && Number.isFinite(Number(j.riposi_min))) out.riposi_min = Math.max(RIPOSO_LEGALE, Math.round(Number(j.riposi_min)));
  return out;
}

/** Una riga di outlet_events come arriva dal database, con le regole gia' controllate. */
export function eventoDaRiga(r: Record<string, unknown>): EventoNegozio {
  const tipo = r.tipo === 'giorno' || r.tipo === 'periodo' ? r.tipo : null;
  const origine = ['sabato', 'domenica', 'evento', 'manuale'].includes(String(r.regole_origine)) ? (r.regole_origine as OrigineRegole) : null;
  return {
    id: r.id == null ? undefined : String(r.id),
    nome: String(r.nome ?? ''),
    data_dal: String(r.data_dal ?? ''),
    data_al: String(r.data_al ?? ''),
    outlet_ids: Array.isArray(r.outlet_ids) && r.outlet_ids.length ? (r.outlet_ids as string[]) : null,
    persone_extra: Number(r.persone_extra ?? 0) || 0,
    blocca_ferie: !!r.blocca_ferie,
    straordinari: !!r.straordinari,
    nota: (r.nota as string) ?? null,
    ...(tipo ? { tipo, regole: tipo === 'periodo' ? leggiRegoleEvento(r.regole) : null, regole_origine: origine } : {}),
  };
}

/**
 * Le regole di partenza di un periodo, da cambiare poi una per una.
 * «Come un sabato» e «come la domenica»: le fasce restano quelle del negozio (non si copiano,
 * cosi' se cambiano nel negozio cambiano anche qui) e valgono le scelte dei giorni caldi.
 * «Da un altro evento»: una copia delle sue regole. «A mano»: si parte dalle scelte dei giorni caldi.
 */
export function regoleDiPartenza(origine: OrigineRegole, regoleNegozio: RegoleTurni, daEvento?: Pick<EventoNegozio, 'regole'> | null): RegoleEvento {
  if (origine === 'evento' && daEvento?.regole) {
    const r = daEvento.regole;
    return { ...r, ...(r.fasce ? { fasce: r.fasce.map((f) => ({ ...f })) } : {}), riposi_min: Math.max(RIPOSO_LEGALE, r.riposi_min ?? RIPOSO_LEGALE) };
  }
  return {
    moda: true,
    tutti: regoleNegozio.caldiTutti ?? true,
    straordinari: regoleNegozio.caldiStraordinari ?? true,
    guida: regoleNegozio.caldiGuidaApreChiude ?? true,
    ferie: false,
    permessi: false,
    // in un periodo lungo due riposi a testa spesso non ci stanno: si parte da uno, quello di legge
    riposi_min: RIPOSO_LEGALE,
  };
}

/** Le fasce del negozio per un giorno della settimana, nella forma delle regole di un periodo. */
export function fasceDelGiorno(fasce: FasciaFabbisogno[], giorno: number): { dalle: string; alle: string; persone: number }[] {
  return fasce.filter((f) => f.giorno === giorno)
    .map((f) => ({ dalle: f.dalle.slice(0, 5), alle: f.alle.slice(0, 5), persone: f.persone }))
    .sort((a, b) => a.dalle.localeCompare(b.dalle));
}

type EventoDate = Pick<EventoNegozio, 'id' | 'nome' | 'data_dal' | 'data_al' | 'outlet_ids' | 'tipo'>;

/**
 * Gli eventi gia' salvati che toccano gli stessi giorni e almeno un negozio del nuovo: due
 * eventi sullo stesso giorno e negozio non si possono avere, perche' avrebbero due serie di
 * regole diverse. Un evento senza negozi vale per tutti.
 */
export function eventiInConflitto<E extends EventoDate>(esistenti: E[], nuovo: EventoDate): E[] {
  const negoziNuovo = nuovo.outlet_ids && nuovo.outlet_ids.length ? nuovo.outlet_ids : null;
  return esistenti.filter((e) => {
    if (nuovo.id && e.id === nuovo.id) return false;
    if (e.data_al < nuovo.data_dal || e.data_dal > nuovo.data_al) return false;
    const negozi = e.outlet_ids && e.outlet_ids.length ? e.outlet_ids : null;
    return !negozi || !negoziNuovo || negozi.some((id) => negoziNuovo.includes(id));
  });
}

/**
 * I riposi che il negozio chiede in una settimana: quelli delle regole, oppure meno se nella
 * settimana c'e' un periodo che ne chiede meno (con tre giorni di evento due riposi a testa
 * non ci stanno). Mai sotto uno. `undefined` se ne' il negozio ne' un periodo dicono niente.
 */
export function riposiMinDellaSettimana(regole: RegoleTurni, eventi: EventoNegozio[], date: string[], outletId?: string | null): number | undefined {
  const delNegozio = outletId === undefined ? eventi : eventiDelNegozio(eventi, outletId);
  const dePeriodi = date.flatMap((d) => eventiDelGiorno(delNegozio, d))
    .map((e) => e.regole?.riposi_min)
    .filter((n): n is number => typeof n === 'number');
  const tutti = [...(regole.riposiMinSettimana != null ? [regole.riposiMinSettimana] : []), ...dePeriodi];
  return tutti.length ? Math.max(RIPOSO_LEGALE, Math.min(...tutti)) : undefined;
}

/** Nei giorni di un evento le richieste di ferie o di permesso sono ammesse? Senza regole decide `blocca_ferie`. */
export function richiesteAmmesse(eventi: EventoNegozio[], data: string, cosa: 'ferie' | 'permessi'): boolean {
  return eventiDelGiorno(eventi, data).every((e) => (e.regole?.[cosa] ?? !e.blocca_ferie));
}

// ── Il controllo sugli ingressi MODA ─────────────────────────────────────

const giorno = (d: string): Date => new Date(`${d}T00:00:00Z`);
const iso = (d: Date): string => d.toISOString().slice(0, 10);
const piu = (d: string, n: number): string => { const x = giorno(d); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
const giorniFra = (a: string, b: string): number => Math.round((giorno(b).getTime() - giorno(a).getTime()) / 86_400_000);

/** La stessa data dell'anno prima (il 29 febbraio diventa il 28). */
export function annoPrima(data: string): string {
  const [a, m, g] = data.split('-').map(Number);
  const x = new Date(Date.UTC(a - 1, m - 1, g));
  if (x.getUTCMonth() !== m - 1) x.setUTCDate(0);
  return iso(x);
}

/** Giorni di margine prima e dopo il periodo dell'anno prima (Patrizio, 12/11/2026: «3 giorni prima e 3 giorni dopo»). */
export const MARGINE_GIORNI = 3;
/** Settimane vicine con cui si confronta, prima e dopo. */
export const SETTIMANE_VICINE = 3;
/** Sopra questa percentuale il periodo e' «sopra la media» delle settimane vicine. */
export const SOGLIA_SOPRA_MEDIA = 10;

export interface ControlloModa {
  /** 'senza_dati' se l'anno prima non ci sono ingressi nel periodo o nelle settimane vicine */
  esito: 'sopra' | 'nella_media' | 'sotto' | 'senza_dati';
  /** il periodo dell'anno prima con le stesse date: ingressi medi al giorno */
  periodo: { dal: string; al: string; mediaGiorno: number; giorniConDati: number };
  /** i giorni piu' forti dentro il margine, lunghi quanto il periodo */
  picco: { dal: string; al: string; mediaGiorno: number };
  /** gli stessi giorni della settimana nelle settimane vicine */
  riferimento: { mediaGiorno: number; giorni: number };
  /** quanto il picco sta sopra (o sotto) le settimane vicine, in percentuale */
  scostamentoPct: number | null;
  /** di quanti giorni il picco dell'anno prima e' spostato rispetto alle date scritte (0 = coincide) */
  spostaDiGiorni: number;
  /** le date di quest'anno se si segue il picco dell'anno prima; null se coincide o mancano i dati */
  proposta: { dal: string; al: string } | null;
  /** per il grafico: da tre settimane prima a tre dopo, con il periodo in mezzo */
  barre: { etichetta: string; mediaGiorno: number | null; periodo: boolean }[];
}

/**
 * Il controllo MODA di un periodo. `ingressi` e' il totale del giorno per data (del negozio, o
 * del suo negozio di riferimento se non ha storico). Si guarda lo stesso periodo dell'anno
 * prima allargato di tre giorni per parte, si trovano i giorni piu' forti lunghi quanto il
 * periodo, e li si confronta con gli STESSI GIORNI DELLA SETTIMANA delle tre settimane prima e
 * delle tre dopo: confrontare un venerdi'-domenica con la media di una settimana intera
 * direbbe sempre «sopra», perche' il fine settimana lo e' comunque.
 */
export function controlloModaPeriodo(ingressi: Map<string, number>, dal: string, al: string): ControlloModa {
  const n = Math.max(1, giorniFra(dal, al) + 1);
  const dalPrima = annoPrima(dal);
  const alPrima = piu(dalPrima, n - 1);
  const media = (date: string[]): { media: number; giorni: number } => {
    const v = date.map((d) => ingressi.get(d)).filter((x): x is number => typeof x === 'number');
    return { media: v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0, giorni: v.length };
  };
  const finestra = (da: string): string[] => Array.from({ length: n }, (_, i) => piu(da, i));
  const periodo = media(finestra(dalPrima));
  // i giorni piu' forti dentro il margine: fra le finestre con tutti i dati vince la piu' alta
  let picco = { dal: dalPrima, media: periodo.media, giorni: periodo.giorni };
  for (let s = -MARGINE_GIORNI; s <= MARGINE_GIORNI; s++) {
    const da = piu(dalPrima, s);
    const m = media(finestra(da));
    if (m.giorni === n && (picco.giorni < n || m.media > picco.media + 1e-9)) picco = { dal: da, media: m.media, giorni: m.giorni };
  }
  const settimana = (k: number) => media(finestra(piu(picco.dal, 7 * k)));
  const vicine = [...Array(SETTIMANE_VICINE).keys()].flatMap((i) => [-(i + 1), i + 1]);
  const rifDate = vicine.flatMap((k) => finestra(piu(picco.dal, 7 * k)));
  const rif = media(rifDate);
  const senzaDati = picco.giorni === 0 || rif.giorni === 0 || rif.media <= 0;
  const scostamentoPct = senzaDati ? null : Math.round(((picco.media - rif.media) / rif.media) * 1000) / 10;
  const sposta = giorniFra(dalPrima, picco.dal);
  const etichetta = (k: number) => (k === 0 ? 'periodo' : `${Math.abs(k) === 1 ? 'sett.' : `${Math.abs(k)} sett.`} ${k < 0 ? 'prima' : 'dopo'}`);
  return {
    esito: senzaDati ? 'senza_dati' : scostamentoPct! > SOGLIA_SOPRA_MEDIA ? 'sopra' : scostamentoPct! < -SOGLIA_SOPRA_MEDIA ? 'sotto' : 'nella_media',
    periodo: { dal: dalPrima, al: alPrima, mediaGiorno: Math.round(periodo.media), giorniConDati: periodo.giorni },
    picco: { dal: picco.dal, al: piu(picco.dal, n - 1), mediaGiorno: Math.round(picco.media) },
    riferimento: { mediaGiorno: Math.round(rif.media), giorni: rif.giorni },
    scostamentoPct,
    spostaDiGiorni: senzaDati ? 0 : sposta,
    proposta: !senzaDati && sposta !== 0 ? { dal: piu(dal, sposta), al: piu(al, sposta) } : null,
    barre: [-3, -2, -1, 0, 1, 2, 3].map((k) => {
      const m = k === 0 ? { media: picco.media, giorni: picco.giorni } : settimana(k);
      return { etichetta: etichetta(k), mediaGiorno: m.giorni ? Math.round(m.media) : null, periodo: k === 0 };
    }),
  };
}

/** Gli ingressi del giorno, sommando le ore: la forma che serve a `controlloModaPeriodo`. */
export function ingressiPerGiorno(righe: { data: string; ingressi: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of righe) out.set(r.data, (out.get(r.data) ?? 0) + Math.max(0, Number(r.ingressi) || 0));
  return out;
}
