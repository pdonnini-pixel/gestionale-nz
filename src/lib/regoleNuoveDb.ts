// Lettura e scrittura di quello che serve alle regole dei turni dell'11/11/2026
// (Patrizio, Roma Soratte): il giorno libero fisso di ognuno e le coppie dei
// feriali delle settimane prima. Dove la tabella non c'e' (tenant senza la
// migration 395) si torna al comportamento di prima, senza errori a video.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { aggiungiGiorni } from './organico';
import { coppieFeriali } from './ottimizzaTurni';
import type { Turno } from './turni';

export interface GiornoLibero { giorno: number; origine: 'sistema' | 'manuale' }

// La tabella e' nuova e non sta ancora nei tipi generati del database.
const db = supabase as unknown as SupabaseClient;

/** Il giorno libero fisso di ogni persona dell'azienda; `disponibile` e' falso dove la tabella manca. */
export async function caricaGiorniLiberi(companyId: string): Promise<{ mappa: Map<string, GiornoLibero>; disponibile: boolean }> {
  const { data, error } = await db.from('employee_giorno_libero').select('employee_id, giorno, origine').eq('company_id', companyId);
  if (error) return { mappa: new Map(), disponibile: false };
  const righe = (data as { employee_id: string; giorno: number; origine: string }[]) ?? [];
  return {
    mappa: new Map(righe.map((x) => [x.employee_id, { giorno: Number(x.giorno), origine: x.origine === 'manuale' ? 'manuale' : 'sistema' }])),
    disponibile: true,
  };
}

/**
 * Salva i giorni liberi scelti dal sistema per chi non ne aveva uno. Non
 * sovrascrive mai un giorno gia' deciso (ne' a mano ne' dal sistema): se la riga
 * c'e' gia', resta quella.
 */
export async function salvaGiorniLiberiDiSistema(companyId: string, scelti: Map<string, number>, gia: Map<string, GiornoLibero>): Promise<void> {
  const nuove = [...scelti].filter(([id, g]) => !gia.has(id) && g >= 1 && g <= 7)
    .map(([employee_id, giorno]) => ({ employee_id, company_id: companyId, giorno, origine: 'sistema' }));
  if (!nuove.length) return;
  const { error } = await db.from('employee_giorno_libero').upsert(nuove, { onConflict: 'employee_id', ignoreDuplicates: true });
  if (error) throw error;
}

/** Il giorno libero deciso a mano: da quel momento il sistema non lo cambia piu'. `null` lo toglie. */
export async function impostaGiornoLibero(companyId: string, employeeId: string, giorno: number | null): Promise<void> {
  const r = giorno == null
    ? await db.from('employee_giorno_libero').delete().eq('employee_id', employeeId)
    : await db.from('employee_giorno_libero').upsert([{ employee_id: employeeId, company_id: companyId, giorno, origine: 'manuale', updated_at: new Date().toISOString() }], { onConflict: 'employee_id' });
  if (r.error) throw r.error;
}

/**
 * Le coppie dei feriali nei turni del negozio delle tre settimane prima di
 * `primaDi`: servono a non riproporre sempre le stesse persone insieme. Contano
 * i turni senza piano e quelli dei piani scelti, non le bozze scartate.
 */
export async function caricaCoppiePrima(companyId: string, outletId: string, primaDi: string, giorni = 21): Promise<Map<string, number>> {
  const { data, error } = await supabase.from('shifts')
    .select('employee_id, data, inizio, fine, pausa_minuti, plan_id, shift_plans(stato)')
    .eq('company_id', companyId).eq('outlet_id', outletId).gte('data', aggiungiGiorni(primaDi, -giorni)).lt('data', primaDi).neq('stato', 'annullato');
  if (error) return new Map();
  const turni: Turno[] = [];
  for (const x of ((data as unknown as { employee_id: string; data: string; inizio: string; fine: string; pausa_minuti: number | null; plan_id: string | null; shift_plans: { stato: string } | { stato: string }[] | null }[]) ?? [])) {
    const pl = Array.isArray(x.shift_plans) ? x.shift_plans[0] : x.shift_plans;
    if (x.plan_id && pl?.stato !== 'scelto') continue;
    turni.push({ employeeId: x.employee_id, data: x.data, inizio: x.inizio.slice(0, 5), fine: x.fine.slice(0, 5), pausaMinuti: x.pausa_minuti ?? 0 });
  }
  return coppieFeriali(turni);
}

/** Responsabile e vice del negozio per la regola del lunedi': vuoto se manca una delle due. */
export function guidaDelNegozio(negozio: { referente_employee_id?: string | null; vice_referente_employee_id?: string | null } | undefined | null): string[] {
  const r = negozio?.referente_employee_id ?? null;
  const v = negozio?.vice_referente_employee_id ?? null;
  return r && v && r !== v ? [r, v] : [];
}
