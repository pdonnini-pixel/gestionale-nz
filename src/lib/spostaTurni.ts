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
