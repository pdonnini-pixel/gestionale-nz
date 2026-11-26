// Servizi del negozio (Patrizio, 26/11/2026): scarico merce e pulizie prima dell'apertura.
//
// - Scarico merce: ogni negozio ha un giorno abituale di consegna (Valmontone il martedì) con
//   ora di arrivo, durata e persone che servono. Il giorno e l'ora possono cambiare: il calendario
//   delle consegne (`outlet_consegne`) sposta, cambia d'ora o annulla la singola consegna. Durante
//   lo scarico in negozio servono almeno quelle persone (di norma due): se la programmazione le ha
//   già non si aggiunge niente, altrimenti la regola le impone, sopra MODA e sopra le fasce.
//   La parte dello scarico che cade fuori dall'orario non chiede nessuno: chi consegna ha le chiavi.
// - Pulizie prima dell'apertura: in alcuni giorni (Valmontone lunedì e venerdì dalle 9) il negozio
//   apre per le pulizie, non per la vendita. Sono ore di lavoro e di contratto: il giorno comincia
//   prima, con le persone delle pulizie, ma quelle mezz'ore non contano nelle ore sotto MODA
//   (esatto a zero) e non spostano la regola delle due persone, che resta misurata sull'apertura.
//
// Tabelle: `outlet_servizi` (regole ricorrenti) e `outlet_consegne` (calendario), migration 468.
import { SLOT_MINUTI, eFestivo, giornoIso, hhmm, minuti, type GiornoPiano } from './turni';

export type TipoServizio = 'scarico' | 'pulizie';

/** Una regola ricorrente: il giorno della settimana (1 = lunedì) e la fascia oraria. */
export interface ServizioRicorrente {
  id?: string;
  tipo: TipoServizio;
  giorno: number;
  /** 'HH:MM' */
  dalle: string;
  alle: string;
  persone: number;
  /** persone dedicate (employees.id): il piano le preferisce quando ha la scelta (migration 475) */
  dedicate?: string[];
}

/** Al massimo `persone` persone diverse nella giornata, nei `giorni` (1 = lunedì) (migration 475). */
export interface TettoPersone { persone: number; giorni: number[] }

/** Una riga del calendario delle consegne: vale al posto della consegna abituale di quel giorno. */
export interface ConsegnaCalendario {
  id?: string;
  data: string;
  dalle: string | null;
  alle: string | null;
  persone: number | null;
  /** nessuna consegna (o consegna che non chiede personale) quel giorno */
  annullata: boolean;
  nota: string | null;
}

export interface ServiziNegozio {
  ricorrenti: ServizioRicorrente[];
  consegne: ConsegnaCalendario[];
  /** tetto di persone diverse nella giornata: scelta del negozio, assente = spento */
  tetto?: TettoPersone | null;
}

export interface FinestraServizio { dalle: number; alle: number; persone: number; dedicate?: string[] }

/** Persone dello scarico se la regola non le dice: due (Patrizio, 26/11/2026). */
export const PERSONE_SCARICO = 2;
/** Persone delle pulizie se la regola non le dice. */
export const PERSONE_PULIZIE = 1;

const valida = (dalle: number, alle: number) => alle > dalle;

/**
 * Lo scarico di una data: la riga del calendario se c'è (annullata = nessuno scarico), altrimenti
 * la consegna abituale di quel giorno della settimana. Null se quel giorno non arriva merce.
 */
export function scaricoDelGiorno(data: string, servizi: ServiziNegozio | null | undefined): FinestraServizio | null {
  if (!servizi) return null;
  const c = servizi.consegne.find((x) => x.data === data);
  const abituale = servizi.ricorrenti.find((r) => r.tipo === 'scarico' && r.giorno === giornoIso(data));
  if (c) {
    if (c.annullata) return null;
    // la riga del calendario può cambiare solo l'ora o solo le persone: il resto viene dall'abituale
    const dalle = minuti(c.dalle ?? abituale?.dalle ?? null);
    const alle = minuti(c.alle ?? abituale?.alle ?? null);
    if (!valida(dalle, alle)) return null;
    return { dalle, alle, persone: Math.max(1, c.persone ?? abituale?.persone ?? PERSONE_SCARICO), dedicate: abituale?.dedicate ?? [] };
  }
  if (!abituale) return null;
  const dalle = minuti(abituale.dalle);
  const alle = minuti(abituale.alle);
  return valida(dalle, alle) ? { dalle, alle, persone: Math.max(1, abituale.persone || PERSONE_SCARICO), dedicate: abituale.dedicate ?? [] } : null;
}

/** Le pulizie di una data (regola ricorrente di quel giorno della settimana), o null. */
export function pulizieDelGiorno(data: string, servizi: ServiziNegozio | null | undefined): FinestraServizio | null {
  const r = servizi?.ricorrenti.find((x) => x.tipo === 'pulizie' && x.giorno === giornoIso(data));
  if (!r) return null;
  const dalle = minuti(r.dalle);
  const alle = minuti(r.alle);
  return valida(dalle, alle) ? { dalle, alle, persone: Math.max(1, r.persone || PERSONE_PULIZIE), dedicate: r.dedicate ?? [] } : null;
}

/** Arrotonda alla mezz'ora precedente (i turni stanno sulle mezz'ore). */
const giu = (t: number) => Math.floor(t / SLOT_MINUTI) * SLOT_MINUTI;

/**
 * Il giorno con i servizi applicati, dopo il fabbisogno (MODA, fasce, due persone, lunedì,
 * chiusura di metà giornata). Idempotente: un giorno già passato di qui resta com'è.
 * - Scarico: nelle mezz'ore dello scarico dentro l'orario, fabbisogno, minimo, esigenza ed esatto
 *   almeno le persone dello scarico. Mai dentro la chiusura di metà giornata.
 * - Pulizie: se cominciano prima dell'apertura il giorno comincia prima (`apre`), con le persone
 *   delle pulizie in quelle mezz'ore; `apreVendita` resta l'apertura vera. Esatto a zero: le
 *   pulizie non sono traffico.
 */
export function applicaServizi(g: GiornoPiano, servizi: ServiziNegozio | null | undefined): GiornoPiano {
  if (!servizi || g.chiuso || g.apreVendita != null || g.scarico || g.tettoPersone != null) return g;
  let out = g;
  const sc = scaricoDelGiorno(g.data, servizi);
  if (sc) {
    const n = out.fabbisogno.length;
    const dentro = (i: number) => {
      const t = out.apre + i * SLOT_MINUTI;
      if (out.chiusura && t >= out.chiusura.dalle && t < out.chiusura.alle) return false;
      return t + SLOT_MINUTI > sc.dalle && t < sc.alle;
    };
    const alza = (v: number[] | undefined) => v?.map((x, i) => (dentro(i) ? Math.max(x, sc.persone) : x));
    if (Array.from({ length: n }, (_, i) => i).some(dentro)) {
      out = {
        ...out,
        scarico: { dalle: Math.max(sc.dalle, out.apre), alle: Math.min(sc.alle, out.chiude), persone: sc.persone, ...(sc.dedicate?.length ? { dedicate: sc.dedicate } : {}) },
        fabbisogno: alza(out.fabbisogno)!,
        ...(out.minimo ? { minimo: alza(out.minimo) } : {}),
        ...(out.esigenza ? { esigenza: alza(out.esigenza) } : {}),
        ...(out.esatto ? { esatto: alza(out.esatto) } : {}),
      };
    }
  }
  // Tetto di persone diverse nella giornata (migration 475): non nei giorni caldi, festivi, eventi
  // e nel lunedì a due, che ha il suo tetto
  const tt = servizi.tetto;
  if (tt && tt.persone >= 2 && tt.giorni.includes(giornoIso(g.data)) && !g.caldo && !g.tutti && !g.evento && !g.lunediDue && !eFestivo(g.data)) {
    out = { ...out, tettoPersone: tt.persone };
  }
  const pu = pulizieDelGiorno(g.data, servizi);
  if (pu) {
    const inizio = giu(pu.dalle);
    const slotPrima = (out.apre - inizio) / SLOT_MINUTI;
    if (slotPrima > 0 && slotPrima <= 8) {
      // fra l'inizio delle pulizie e l'apertura: le persone delle pulizie (oltre la fine scritta: una)
      const valore = (k: number) => (inizio + k * SLOT_MINUTI < pu.alle ? pu.persone : 1);
      const prima = Array.from({ length: slotPrima }, (_, k) => valore(k));
      const zeri = prima.map(() => 0);
      out = {
        ...out,
        apreVendita: out.apre,
        apre: inizio,
        pulizie: { dalle: inizio, alle: out.apre, persone: pu.persone, ...(pu.dedicate?.length ? { dedicate: pu.dedicate } : {}) },
        fabbisogno: [...prima, ...out.fabbisogno],
        ...(out.minimo ? { minimo: [...prima, ...out.minimo] } : {}),
        ...(out.esigenza ? { esigenza: [...prima, ...out.esigenza] } : {}),
        ...(out.esatto ? { esatto: [...zeri, ...out.esatto] } : {}),
      };
    }
  }
  return out;
}

/** Testo breve per il piano: «Scarico 10:00-12:00 · 2 persone», «Pulizie 09:00-10:00». */
export function testoServizi(g: Pick<GiornoPiano, 'scarico' | 'pulizie'>): string[] {
  const out: string[] = [];
  if (g.pulizie) out.push(`Pulizie ${hhmm(g.pulizie.dalle)}-${hhmm(g.pulizie.alle)}`);
  if (g.scarico) out.push(`Scarico ${hhmm(g.scarico.dalle)}-${hhmm(g.scarico.alle)} · ${g.scarico.persone} ${g.scarico.persone === 1 ? 'persona' : 'persone'}`);
  return out;
}

/** L'orario in cui si può mettere un turno quel giorno: dalle pulizie, se cominciano prima dell'apertura. */
export function aperturaConPulizie(data: string, apre: number, servizi: ServiziNegozio | null | undefined): number {
  const pu = pulizieDelGiorno(data, servizi);
  if (!pu) return apre;
  const inizio = giu(pu.dalle);
  return inizio < apre && apre - inizio <= 8 * SLOT_MINUTI ? inizio : apre;
}

/**
 * Le consegne effettive fra due date (comprese), abituali e del calendario, per l'elenco della
 * pagina: una riga per giorno con consegna, più le righe del calendario annullate.
 */
export function consegneDelPeriodo(dal: string, al: string, servizi: ServiziNegozio): { data: string; finestra: FinestraServizio | null; riga: ConsegnaCalendario | null; abituale: boolean }[] {
  const out: { data: string; finestra: FinestraServizio | null; riga: ConsegnaCalendario | null; abituale: boolean }[] = [];
  const d = new Date(`${dal}T00:00:00Z`);
  const fine = new Date(`${al}T00:00:00Z`);
  while (d <= fine) {
    const data = d.toISOString().slice(0, 10);
    const riga = servizi.consegne.find((c) => c.data === data) ?? null;
    const finestra = scaricoDelGiorno(data, servizi);
    if (riga || finestra) out.push({ data, finestra, riga, abituale: !riga });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
