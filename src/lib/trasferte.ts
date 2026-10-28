// Trasferte (Patrizio, 28/10/2026): orario di lavoro fuori dal negozio di
// riferimento, per le referenti che vanno in altre sedi. Le ore valgono come
// lavoro (entrano nelle ore della settimana) ma non come presenza nel negozio
// di riferimento: il piano dei turni pianifica intorno. Se la destinazione e'
// uno dei negozi, volta per volta si decide se coprono anche quel negozio.
// Stanno in `employee_trasferte`, non in `shifts`, cosi' nessun conteggio dei
// turni in negozio le prende per presenza.

import { supabase } from './supabase';
import { oreLavorate, type Turno } from './turni';

export interface Trasferta {
  id: string;
  employeeId: string;
  /** negozio di riferimento della persona quando e' partita */
  outletId: string | null;
  data: string;
  inizio: string;
  fine: string;
  pausaMinuti: number;
  destinazioneOutletId: string | null;
  luogo: string | null;
  /** le ore coprono anche il negozio di destinazione */
  copreDestinazione: boolean;
  motivo: string | null;
  creataDa: string | null;
}

export async function caricaTrasferte(companyId: string, dal: string, al: string): Promise<Trasferta[]> {
  const { data, error } = await supabase.from('employee_trasferte')
    .select('id, employee_id, outlet_id, data, inizio, fine, pausa_minuti, destinazione_outlet_id, luogo, copre_destinazione, motivo, created_by_nome')
    .eq('company_id', companyId).gte('data', dal).lte('data', al).order('data');
  if (error) throw error;
  return ((data as {
    id: string; employee_id: string; outlet_id: string | null; data: string; inizio: string; fine: string; pausa_minuti: number;
    destinazione_outlet_id: string | null; luogo: string | null; copre_destinazione: boolean; motivo: string | null; created_by_nome: string | null;
  }[]) ?? []).map((x) => ({
    id: x.id, employeeId: x.employee_id, outletId: x.outlet_id, data: x.data, inizio: x.inizio.slice(0, 5), fine: x.fine.slice(0, 5),
    pausaMinuti: x.pausa_minuti ?? 0, destinazioneOutletId: x.destinazione_outlet_id, luogo: x.luogo,
    copreDestinazione: x.copre_destinazione, motivo: x.motivo, creataDa: x.created_by_nome,
  }));
}

/** Ore di lavoro di una trasferta (la pausa non si conta). */
export const oreTrasferta = (t: Pick<Trasferta, 'inizio' | 'fine' | 'pausaMinuti'>) => oreLavorate(t);

/** Le ore di trasferta di una persona per data. */
export function orePerData(trasferte: Trasferta[], employeeId: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of trasferte.filter((x) => x.employeeId === employeeId)) m.set(t.data, (m.get(t.data) ?? 0) + oreTrasferta(t));
  return m;
}

/** Le trasferte che coprono un negozio, come turni fissi per la copertura. */
export function copertureVerso(trasferte: Trasferta[], outletId: string): Turno[] {
  return trasferte.filter((t) => t.copreDestinazione && t.destinazioneOutletId === outletId)
    .map((t) => ({ employeeId: t.employeeId, data: t.data, inizio: t.inizio, fine: t.fine, pausaMinuti: t.pausaMinuti }));
}

/** Dove: il negozio di destinazione o il luogo scritto a mano. */
export function doveTrasferta(t: Pick<Trasferta, 'destinazioneOutletId' | 'luogo'>, nomeNegozio: (id: string) => string): string {
  return t.destinazioneOutletId ? nomeNegozio(t.destinazioneOutletId) : (t.luogo ?? '').trim();
}

export interface RiepilogoTrasferte {
  persone: { employeeId: string; giornate: number; ore: number; destinazioni: string[] }[];
  destinazioni: { dove: string; giornate: number; ore: number }[];
  giornate: number;
  ore: number;
}

/** Totali del periodo, per persona e per destinazione (le giornate sono date distinte). */
export function riepilogaTrasferte(trasferte: Trasferta[], nomeNegozio: (id: string) => string): RiepilogoTrasferte {
  const perPersona = new Map<string, { date: Set<string>; ore: number; dove: Set<string> }>();
  const perDove = new Map<string, { date: Set<string>; ore: number }>();
  for (const t of trasferte) {
    const ore = oreTrasferta(t);
    const dove = doveTrasferta(t, nomeNegozio);
    const p = perPersona.get(t.employeeId) ?? { date: new Set<string>(), ore: 0, dove: new Set<string>() };
    p.date.add(t.data); p.ore += ore; p.dove.add(dove);
    perPersona.set(t.employeeId, p);
    const d = perDove.get(dove) ?? { date: new Set<string>(), ore: 0 };
    d.date.add(`${t.employeeId}|${t.data}`); d.ore += ore;
    perDove.set(dove, d);
  }
  return {
    persone: [...perPersona].map(([employeeId, x]) => ({ employeeId, giornate: x.date.size, ore: x.ore, destinazioni: [...x.dove].sort() })),
    destinazioni: [...perDove].map(([dove, x]) => ({ dove, giornate: x.date.size, ore: x.ore })).sort((a, b) => b.ore - a.ore),
    giornate: [...perPersona.values()].reduce((a, x) => a + x.date.size, 0),
    ore: trasferte.reduce((a, t) => a + oreTrasferta(t), 0),
  };
}
