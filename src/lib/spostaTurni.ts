// Spostare, scambiare e affiancare i turni dal calendario (Patrizio, 29/10/2026).
// Qui i controlli: cosa succede alla persona che riceve il turno e al giorno
// da cui parte. Non bloccano (un turno messo a mano resta libero): si mostrano
// prima di confermare.

import { minuti } from './turni';

export type TurnoSemplice = { employee_id: string; data: string; inizio: string; fine: string };

export type MossaTurno = 'sposta' | 'affianca' | 'scambia' | 'sostituisci';

/** Cosa si puo' fare lasciando un turno sulla casella di una persona in un giorno. */
export function mossePossibili(arrivoHaTurno: boolean, stessaPersona: boolean): MossaTurno[] {
  if (stessaPersona) return arrivoHaTurno ? [] : ['sposta'];
  return arrivoHaTurno ? ['scambia', 'sostituisci'] : ['sposta', 'affianca'];
}

/**
 * Gli avvisi per la persona che riceve un turno in un giorno: ferie, accordi,
 * trasferta, giorni di lavoro della settimana. Le frasi sono pronte da mostrare.
 */
export function avvisiPerChiRiceve(args: {
  nome: string;
  inFerie: boolean;
  inTrasferta: boolean;
  puoLavorare: boolean;
  fascia: { dalle: number; alle: number } | null;
  inizio: string; fine: string;
  giorniSettimana: number;
  giorniMax: number;
  inServizio: boolean;
}): string[] {
  const out: string[] = [];
  const n = args.nome.split(' ')[0];
  if (!args.inServizio) out.push(`${n} quel giorno non è in servizio in questo negozio.`);
  if (args.inFerie) out.push(`${n} quel giorno è in ferie o permesso.`);
  if (args.inTrasferta) out.push(`${n} quel giorno è in trasferta.`);
  if (!args.puoLavorare) out.push(`Per gli accordi della scheda ${n} quel giorno non lavora.`);
  if (args.fascia && (minuti(args.inizio) < args.fascia.dalle || minuti(args.fine) > args.fascia.alle)) {
    const hh = (m: number) => `${Math.floor(m / 60)}${m % 60 ? `:${String(m % 60).padStart(2, '0')}` : ''}`;
    out.push(`Per gli accordi della scheda ${n} quel giorno lavora solo dalle ${hh(args.fascia.dalle)} alle ${hh(args.fascia.alle)}.`);
  }
  if (args.giorniSettimana >= args.giorniMax) out.push(`${n} quella settimana avrebbe ${args.giorniSettimana + 1} giorni di lavoro (massimo ${args.giorniMax}).`);
  return out;
}

/**
 * Cosa resta del giorno dopo la mossa: una persona sola, oppure mezz'ore senza
 * nessuno (orario di apertura in minuti).
 */
export function avvisiPerIlGiorno(turni: TurnoSemplice[], data: string, apre: number, chiude: number, etichetta: string): string[] {
  const delGiorno = turni.filter((t) => t.data === data);
  const out: string[] = [];
  const persone = new Set(delGiorno.map((t) => t.employee_id)).size;
  if (persone === 1) out.push(`${etichetta} resta con una persona sola.`);
  const buchi: string[] = [];
  for (let m = apre; m < chiude; m += 30) {
    if (!delGiorno.some((t) => minuti(t.inizio) <= m && minuti(t.fine) > m)) {
      const hh = (x: number) => `${Math.floor(x / 60)}${x % 60 ? `:${String(x % 60).padStart(2, '0')}` : ''}`;
      const ultimo = buchi[buchi.length - 1];
      if (ultimo && ultimo.endsWith(`-${hh(m)}`)) buchi[buchi.length - 1] = `${ultimo.split('-')[0]}-${hh(m + 30)}`;
      else buchi.push(`${hh(m)}-${hh(m + 30)}`);
    }
  }
  if (persone === 0) out.push(`${etichetta} resta senza nessuno.`);
  else if (buchi.length) out.push(`${etichetta} resta scoperto ${buchi.join(', ')}.`);
  return out;
}

/** La lista dei turni dopo la mossa, per i controlli (non scrive niente). */
export function dopoLaMossa<T extends TurnoSemplice & { id: string }>(
  turni: T[], mossa: MossaTurno, turno: T, versoId: string, versoData: string, ore?: { inizio: string; fine: string },
): T[] {
  const nuovo = { ...turno, employee_id: versoId, data: versoData, ...(ore ?? {}) };
  const arrivo = turni.find((t) => t.employee_id === versoId && t.data === versoData && t.id !== turno.id);
  switch (mossa) {
    case 'sposta': return turni.map((t) => (t.id === turno.id ? nuovo : t));
    case 'affianca': return [...turni, { ...nuovo, id: `${turno.id}-copia` }];
    case 'sostituisci': return turni.filter((t) => t !== arrivo).map((t) => (t.id === turno.id ? nuovo : t));
    case 'scambia': return turni.map((t) => (t.id === turno.id ? nuovo : arrivo && t.id === arrivo.id ? { ...arrivo, employee_id: turno.employee_id, data: turno.data } : t));
  }
}

// ── Le operazioni, comuni al piano del mese e al piano settimanale ──

export type TurnoRiga = TurnoSemplice & { id: string; pausa_minuti: number; stato: string };

export interface ContestoSpostamenti {
  turni: TurnoRiga[];
  nomeDi: (id: string) => string;
  inServizio: (id: string, data: string) => boolean;
  inFerie: (id: string, data: string) => boolean;
  inTrasferta: (id: string, data: string) => boolean;
  puoLavorare: (id: string, data: string) => boolean;
  fascia: (id: string, data: string) => { dalle: number; alle: number } | null;
  giorniMax: number;
  /** apertura del giorno in minuti; undefined o chiuso = niente controllo di copertura */
  apertura: (data: string) => { apre: number; chiude: number; chiuso: boolean } | undefined;
  /** chi copre il negozio senza essere nei turni (trasferte verso questo negozio) */
  coperture: TurnoSemplice[];
  /** lunedi' della settimana di una data e i suoi sette giorni */
  settimanaDi: (data: string) => string[];
}

const NOMI_BREVI = ['', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
export const giornoEsteso = (d: string) => `${NOMI_BREVI[new Date(`${d}T00:00:00Z`).getUTCDay() || 7]} ${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;

/** Tutti gli avvisi di una mossa: per chi riceve il turno e per i giorni toccati. */
export function avvisiMossa(c: ContestoSpostamenti, m: MossaTurno, t: TurnoRiga, versoId: string, versoData: string, ore?: { inizio: string; fine: string }): string[] {
  const dopo = dopoLaMossa(c.turni, m, t, versoId, versoData, ore);
  const out: string[] = [];
  const chiRiceve = (id: string, d: string, inizio: string, fine: string, escludi: string[]) => {
    const settimana = c.settimanaDi(d);
    return avvisiPerChiRiceve({
      nome: c.nomeDi(id), inFerie: c.inFerie(id, d), inTrasferta: c.inTrasferta(id, d), puoLavorare: c.puoLavorare(id, d),
      fascia: c.fascia(id, d), inizio, fine, giorniMax: c.giorniMax, inServizio: c.inServizio(id, d),
      giorniSettimana: new Set(c.turni.filter((x) => x.employee_id === id && settimana.includes(x.data) && !escludi.includes(x.id) && x.data !== d).map((x) => x.data)).size,
    });
  };
  out.push(...chiRiceve(versoId, versoData, ore?.inizio ?? t.inizio, ore?.fine ?? t.fine, [t.id]));
  if (m === 'scambia') {
    const u = c.turni.find((x) => x.employee_id === versoId && x.data === versoData && x.id !== t.id);
    if (u) out.push(...chiRiceve(t.employee_id, t.data, u.inizio, u.fine, [u.id, t.id]));
  }
  for (const d of [...new Set([t.data, versoData])]) {
    const g = c.apertura(d);
    if (g && !g.chiuso) out.push(...avvisiPerIlGiorno([...dopo, ...c.coperture], d, g.apre, g.chiude, giornoEsteso(d)));
  }
  return out;
}

/** Cosa scrivere su `shifts` per eseguire la mossa (i turni toccati diventano «a mano»). */
export function scrittureMossa(
  c: Pick<ContestoSpostamenti, 'turni'>, m: MossaTurno, t: TurnoRiga, versoId: string, versoData: string,
  ore: { inizio: string; fine: string; pausa_minuti: number } | undefined,
): { aggiorna: { id: string; valori: Record<string, unknown> }[]; inserisci: Record<string, unknown> | null; togli: { id: string; pubblicato: boolean } | null } {
  const u = c.turni.find((x) => x.employee_id === versoId && x.data === versoData && x.id !== t.id);
  if (m === 'affianca') {
    return {
      aggiorna: [], togli: null,
      inserisci: { employee_id: versoId, data: versoData, inizio: ore?.inizio ?? t.inizio, fine: ore?.fine ?? t.fine, pausa_minuti: ore?.pausa_minuti ?? t.pausa_minuti, stato: 'bozza', origine: 'manuale' },
    };
  }
  const aggiorna = [{ id: t.id, valori: { employee_id: versoId, data: versoData, origine: 'manuale', ...(ore ?? {}) } as Record<string, unknown> }];
  if (m === 'scambia' && u) aggiorna.push({ id: u.id, valori: { employee_id: t.employee_id, data: t.data, origine: 'manuale' } });
  return { aggiorna, inserisci: null, togli: m === 'sostituisci' && u ? { id: u.id, pubblicato: u.stato === 'pubblicato' } : null };
}

/** La frase di esito dopo la mossa. */
export function esitoMossa(c: Pick<ContestoSpostamenti, 'nomeDi'>, m: MossaTurno, t: TurnoRiga, versoId: string, versoData: string): string {
  const da = `${c.nomeDi(t.employee_id).split(' ')[0]} ${giornoEsteso(t.data)}`;
  const a = `${c.nomeDi(versoId).split(' ')[0]} ${giornoEsteso(versoData)}`;
  return m === 'sposta' ? `Turno spostato da ${da} a ${a}.`
    : m === 'affianca' ? `Turno messo anche a ${a}.`
      : m === 'scambia' ? `Turni scambiati fra ${da} e ${a}.`
        : `Turno di ${da} dato a ${a} al posto del suo.`;
}

export const ETICHETTE_MOSSA: Record<MossaTurno, { titolo: string; spiega: string }> = {
  sposta: { titolo: 'Sposta', spiega: 'il turno passa a questa casella, la casella di partenza resta libera' },
  affianca: { titolo: 'Metti anche qui', spiega: 'stesso orario anche a questa persona: lavorano insieme' },
  scambia: { titolo: 'Scambia i turni', spiega: "ognuna prende il turno dell'altra" },
  sostituisci: { titolo: 'Sostituisci', spiega: "resta solo il turno trascinato; quello che c'era si toglie" },
};
