// Caricamento dei dati dell'organico di oggi, condiviso da Organico, Turni e
// Piano ferie. Le regole stanno in organico.ts (pure, testate); qui ci sono
// solo le query.

import { supabase } from './supabase';
import type { EventoOrganico, SchedaPersona } from './organico';
import { oraRoma, type ChiusuraGiorno } from './stimaNegozio';

export interface NegozioRif {
  id: string;
  code: string | null;
  name: string | null;
  is_active: boolean | null;
  opening_date: string | null;
  /** la referente del negozio (outlets.referente_employee_id) */
  referente_employee_id?: string | null;
}

export interface DatiOrganico {
  schede: SchedaPersona[];
  eventi: EventoOrganico[];
  negozi: NegozioRif[];
}

/** Ruoli che tengono l'organico: «contabilita' o superiore» (Patrizio, 19/10/2026). */
export const RUOLI_ORGANICO = ['super_advisor', 'ceo', 'cfo', 'coo', 'contabile'];
export const puoTenereOrganico = (ruolo: string | null | undefined): boolean => RUOLI_ORGANICO.includes(ruolo ?? '');
/** Il fabbisogno di persone lo decide Patrizio: solo super_advisor. */
export const puoDecidereFabbisogno = (ruolo: string | null | undefined): boolean => ruolo === 'super_advisor';

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));

export async function caricaOrganico(companyId: string): Promise<DatiOrganico> {
  const [emp, ev, neg] = await Promise.all([
    supabase.from('employees')
      .select('id, nome, cognome, first_name, last_name, matricola, outlet_id, contratto_tipo, ore_settimanali, ore_settimanali_paghe, data_assunzione, hire_date, scadenza_td, data_cessazione, termination_date, is_active, livello, qualifica, role_description')
      .eq('company_id', companyId),
    supabase.from('employee_events').select('*').eq('company_id', companyId).order('data_dal'),
    supabase.from('outlets').select('id, code, name, is_active, opening_date, referente_employee_id').eq('company_id', companyId).order('name'),
  ]);
  if (emp.error) throw emp.error;
  if (ev.error) throw ev.error;
  if (neg.error) throw neg.error;

  const schede: SchedaPersona[] = ((emp.data as Record<string, unknown>[]) ?? []).map((d) => ({
    id: String(d.id),
    nome: (d.nome as string) ?? (d.first_name as string) ?? null,
    cognome: (d.cognome as string) ?? (d.last_name as string) ?? null,
    matricola: (d.matricola as string) ?? null,
    outlet_id: (d.outlet_id as string) ?? null,
    contratto_tipo: (d.contratto_tipo as string) ?? null,
    ore_settimanali: num(d.ore_settimanali),
    ore_settimanali_paghe: num(d.ore_settimanali_paghe),
    data_assunzione: (d.data_assunzione as string) ?? (d.hire_date as string) ?? null,
    scadenza_td: (d.scadenza_td as string) ?? null,
    data_cessazione: (d.data_cessazione as string) ?? (d.termination_date as string) ?? null,
    is_active: (d.is_active as boolean) ?? null,
    livello: (d.livello as string) ?? null,
    qualifica: (d.qualifica as string) ?? null,
    role_description: (d.role_description as string) ?? null,
  }));

  const eventi: EventoOrganico[] = ((ev.data as Record<string, unknown>[]) ?? []).map((e) => ({
    ...(e as unknown as EventoOrganico),
    ore_settimanali: num(e.ore_settimanali),
  }));

  return { schede, eventi, negozi: (neg.data as NegozioRif[]) ?? [] };
}

/** Nome leggibile del negozio («FRANCIACORTA» → «Franciacorta»). */
export function nomeNegozio(n: Pick<NegozioRif, 'name' | 'code'> | undefined | null): string {
  if (!n) return 'Senza negozio';
  const t = (n.name ?? n.code ?? '').toLowerCase();
  return t.replace(/(^|[\s/'-])\p{L}/gu, (c) => c.toUpperCase()) || 'Senza negozio';
}

/** Giorni di ferie e permessi approvati a giornata intera, per persona: in quei giorni non si lavora. */
export async function caricaGiorniFerie(companyId: string, dal: string, al: string): Promise<{
  employee_id: string; data: string; ore: number; tipo: string; stato_richiesta: string; stato_giorno: string; creato_il: string;
}[]> {
  const { data, error } = await supabase.from('leave_request_days')
    .select('data, ore, tipo, stato, created_at, request_id, leave_requests!inner(employee_id, stato)')
    .eq('company_id', companyId)
    .gte('data', dal)
    .lte('data', al);
  if (error) throw error;
  return ((data as unknown as {
    data: string; ore: number; tipo: string; stato: string; created_at: string;
    leave_requests: { employee_id: string; stato: string } | { employee_id: string; stato: string }[];
  }[]) ?? []).map((d) => {
    const r = Array.isArray(d.leave_requests) ? d.leave_requests[0] : d.leave_requests;
    return { employee_id: r?.employee_id, data: d.data, ore: Number(d.ore), tipo: d.tipo, stato_richiesta: r?.stato, stato_giorno: d.stato, creato_il: d.created_at };
  }).filter((d) => !!d.employee_id);
}

/**
 * Chiusure di cassa delle ultime settimane, per stimare orari e fabbisogno
 * (stimaNegozio.ts). Ora di conferma gia' convertita nell'ora di Roma.
 */
export async function caricaChiusurePerStima(companyId: string, settimane = 8): Promise<(ChiusuraGiorno & { outlet_id: string })[]> {
  const dal = new Date(Date.now() - settimane * 7 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase.from('outlet_daily_closings')
    .select('outlet_id, closing_date, is_closed_day, confirmed_at, total_receipts')
    .eq('company_id', companyId)
    .gte('closing_date', dal);
  if (error) throw error;
  return ((data as { outlet_id: string; closing_date: string; is_closed_day: boolean | null; confirmed_at: string | null; total_receipts: number | null }[]) ?? [])
    .map((c) => ({
      outlet_id: c.outlet_id,
      data: c.closing_date,
      giornoChiuso: !!c.is_closed_day,
      oraConferma: oraRoma(c.confirmed_at),
      incasso: c.total_receipts != null ? Number(c.total_receipts) : null,
    }));
}

/**
 * Traffico per ora (MODA) di un negozio, o di tutti i negozi se outletId e'
 * null. Si legge a pagine: il server restituisce al massimo mille righe per
 * richiesta e un negozio ne ha una per ora aperta di ogni giorno.
 */
export async function caricaTraffico(companyId: string, outletId: string | null): Promise<{ data: string; ora: number; ingressi: number }[]> {
  const out: { data: string; ora: number; ingressi: number }[] = [];
  for (let da = 0; ; da += 1000) {
    let q = supabase.from('outlet_traffic_hourly').select('data, ora, ingressi').eq('company_id', companyId);
    if (outletId) q = q.eq('outlet_id', outletId);
    const { data, error } = await q.order('data').order('ora').order('outlet_id').range(da, da + 999);
    if (error) throw error;
    const righe = (data as { data: string; ora: number; ingressi: number }[]) ?? [];
    out.push(...righe);
    if (righe.length < 1000) break;
  }
  return out;
}

/**
 * Giorni della settimana in cui ognuno puo' lavorare (1 = lunedi' ... 7 = domenica),
 * da `employee_availability` (Patrizio, 20/10/2026). Chi non c'e' puo' lavorare tutti i giorni.
 */
export async function caricaDisponibilita(companyId: string): Promise<Map<string, number[]>> {
  const { data, error } = await supabase.from('employee_availability').select('employee_id, giorni').eq('company_id', companyId);
  if (error) throw error;
  return new Map(((data as { employee_id: string; giorni: number[] }[]) ?? []).map((x) => [x.employee_id, x.giorni.map(Number)]));
}

/** La persona puo' lavorare in quella data secondo la sua disponibilita'? */
export function puoLavorareIl(disponibilita: Map<string, number[]>, employeeId: string, data: string): boolean {
  const g = disponibilita.get(employeeId);
  return !g || g.includes(new Date(`${data}T00:00:00Z`).getUTCDay() || 7);
}
