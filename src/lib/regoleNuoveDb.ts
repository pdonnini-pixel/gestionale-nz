// Lettura e scrittura di quello che serve alle regole dei turni dell'11/11/2026
// (Patrizio, Roma Soratte): il giorno libero fisso di ognuno e le coppie dei
// feriali delle settimane prima. Dove la tabella non c'e' (tenant senza la
// migration 395) si torna al comportamento di prima, senza errori a video.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { aggiungiGiorni } from './organico';
import { coppieFeriali, coppieDeiLunedi } from './ottimizzaTurni';
import type { Turno } from './turni';
import { caricaTraffico } from './organicoDati';
import { ingressiPerGiorno } from './eventiTurni';

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
async function turniVeriPrima(companyId: string, outletId: string, primaDi: string, giorni: number): Promise<Turno[] | null> {
  const { data, error } = await supabase.from('shifts')
    .select('employee_id, data, inizio, fine, pausa_minuti, plan_id, shift_plans(stato)')
    .eq('company_id', companyId).eq('outlet_id', outletId).gte('data', aggiungiGiorni(primaDi, -giorni)).lt('data', primaDi).neq('stato', 'annullato');
  if (error) return null;
  const turni: Turno[] = [];
  for (const x of ((data as unknown as { employee_id: string; data: string; inizio: string; fine: string; pausa_minuti: number | null; plan_id: string | null; shift_plans: { stato: string } | { stato: string }[] | null }[]) ?? [])) {
    const pl = Array.isArray(x.shift_plans) ? x.shift_plans[0] : x.shift_plans;
    if (x.plan_id && pl?.stato !== 'scelto') continue;
    turni.push({ employeeId: x.employee_id, data: x.data, inizio: x.inizio.slice(0, 5), fine: x.fine.slice(0, 5), pausaMinuti: x.pausa_minuti ?? 0 });
  }
  return turni;
}

export async function caricaCoppiePrima(companyId: string, outletId: string, primaDi: string, giorni = 21): Promise<Map<string, number>> {
  const turni = await turniVeriPrima(companyId, outletId, primaDi, giorni);
  return turni ? coppieFeriali(turni) : new Map();
}

/**
 * Le coppie dei lunedi' delle tre settimane prima di `primaDi`, dal piu' vicino
 * (Patrizio, 12/11/2026: il lunedi' a due persone, mai la stessa coppia da un
 * lunedi' al successivo). Stessi turni di `caricaCoppiePrima`.
 */
export async function caricaLunediPrima(companyId: string, outletId: string, primaDi: string, giorni = 21): Promise<string[]> {
  const turni = await turniVeriPrima(companyId, outletId, primaDi, giorni);
  return turni ? coppieDeiLunedi(turni) : [];
}

/** Responsabile e vice del negozio per la regola del lunedi': vuoto se manca una delle due. */
export function guidaDelNegozio(negozio: { referente_employee_id?: string | null; vice_referente_employee_id?: string | null } | undefined | null): string[] {
  const r = negozio?.referente_employee_id ?? null;
  const v = negozio?.vice_referente_employee_id ?? null;
  return r && v && r !== v ? [r, v] : [];
}

// ── Riposi di ognuno (Patrizio, 12/11/2026; tabella employee_riposi, migration 405) ──

export interface RiposiPersone {
  /** giorni in cui riposa di preferenza (1 = lunedi' ... 5 = venerdi'), anche piu' di uno */
  preferiti: Map<string, number[]>;
  /** giorni in cui non riposa mai */
  mai: Map<string, number[]>;
  /** falso dove la tabella manca: allora i preferiti vengono dal giorno libero deciso a mano (395) */
  disponibile: boolean;
}

const feriali = (v: unknown): number[] => [...new Set((Array.isArray(v) ? v : []).map(Number).filter((g) => g >= 1 && g <= 5))].sort();

/**
 * I giorni di riposo preferiti e vietati di ogni persona. Dove la tabella non c'e' ancora si
 * leggono i giorni liberi decisi A MANO della 395 come preferiti (quelli scelti dal sistema non
 * contano piu': senza una scelta il riposo lo decide la turnazione); dove manca anche quella,
 * niente.
 */
export async function caricaRiposi(companyId: string): Promise<RiposiPersone> {
  const { data, error } = await db.from('employee_riposi').select('employee_id, preferiti, mai').eq('company_id', companyId);
  if (!error) {
    const righe = (data as { employee_id: string; preferiti: number[] | null; mai: number[] | null }[]) ?? [];
    return {
      preferiti: new Map(righe.filter((x) => feriali(x.preferiti).length).map((x) => [x.employee_id, feriali(x.preferiti)])),
      mai: new Map(righe.filter((x) => feriali(x.mai).length).map((x) => [x.employee_id, feriali(x.mai)])),
      disponibile: true,
    };
  }
  const vecchi = await caricaGiorniLiberi(companyId);
  return {
    preferiti: new Map([...vecchi.mappa].filter(([, g]) => g.origine === 'manuale' && g.giorno >= 1 && g.giorno <= 5).map(([id, g]) => [id, [g.giorno]])),
    mai: new Map(),
    disponibile: false,
  };
}

/** Salva i giorni di riposo preferiti e vietati di una persona. Un giorno non puo' stare in tutte e due le liste: vince «mai». */
export async function salvaRiposi(companyId: string, employeeId: string, preferiti: number[], mai: number[]): Promise<void> {
  const no = feriali(mai);
  const si = feriali(preferiti).filter((g) => !no.includes(g));
  const { error } = await db.from('employee_riposi').upsert([{ employee_id: employeeId, company_id: companyId, preferiti: si, mai: no, updated_at: new Date().toISOString() }], { onConflict: 'employee_id' });
  if (error) throw error;
}

/**
 * Gli ingressi MODA giorno per giorno per il controllo di un periodo speciale: quelli del
 * negozio, oppure del suo negozio di riferimento se non ha storico (Roma Soratte usa
 * Valmontone), come fanno i turni. `fonte` dice da dove vengono.
 */
export async function caricaIngressiGiornalieri(companyId: string, outletId: string): Promise<{ ingressi: Map<string, number>; fonte: 'propria' | 'riferimento' | 'nessuna'; riferimentoId: string | null }> {
  const sue = await caricaTraffico(companyId, outletId);
  if (sue.length) return { ingressi: ingressiPerGiorno(sue), fonte: 'propria', riferimentoId: null };
  const r = await supabase.from('outlet_shift_rules').select('traffico_da_outlet_id').eq('outlet_id', outletId).maybeSingle();
  const rif = r.error ? null : ((r.data as { traffico_da_outlet_id?: string | null } | null)?.traffico_da_outlet_id ?? null);
  if (rif && rif !== outletId) {
    const delRif = await caricaTraffico(companyId, rif);
    if (delRif.length) return { ingressi: ingressiPerGiorno(delRif), fonte: 'riferimento', riferimentoId: rif };
  }
  return { ingressi: new Map(), fonte: 'nessuna', riferimentoId: null };
}

/**
 * Gli eventi dei negozi con le regole del 12/11/2026. Dove le colonne nuove mancano (tenant
 * senza la 405) si leggono quelle di prima: gli eventi restano «di prima» e non cambia niente.
 */
export async function caricaEventi(companyId: string, dal: string, al: string): Promise<{ righe: Record<string, unknown>[]; conRegole: boolean }> {
  const nuove = await db.from('outlet_events')
    .select('id, nome, data_dal, data_al, outlet_ids, persone_extra, blocca_ferie, straordinari, nota, tipo, regole, regole_origine')
    .eq('company_id', companyId).lte('data_dal', al).gte('data_al', dal);
  if (!nuove.error) return { righe: (nuove.data as Record<string, unknown>[]) ?? [], conRegole: true };
  const prima = await supabase.from('outlet_events').select('id, nome, data_dal, data_al, outlet_ids, persone_extra, blocca_ferie, straordinari, nota')
    .eq('company_id', companyId).lte('data_dal', al).gte('data_al', dal);
  if (prima.error) throw prima.error;
  return { righe: (prima.data as Record<string, unknown>[]) ?? [], conRegole: false };
}

// ── Ferie e permessi per negozio (Patrizio, 12/11/2026; migration 407) ──
// Dove tabelle o colonne mancano (tenant Made, o prima della 407) `disponibile` e' falso: la
// scheda non si mostra e le richieste restano come prima.

/** Le scelte del negozio su ferie e permessi: la riga com'e', oppure null se non e' mai stata salvata. */
export async function caricaRegoleFerie(outletId: string): Promise<{ riga: Record<string, unknown> | null; disponibile: boolean }> {
  const { data, error } = await db.from('outlet_leave_rules').select('*').eq('outlet_id', outletId).maybeSingle();
  if (error) return { riga: null, disponibile: false };
  return { riga: (data as Record<string, unknown> | null) ?? null, disponibile: true };
}

export async function salvaRegoleFerie(companyId: string, outletId: string, colonne: Record<string, boolean>): Promise<string | null> {
  const { error } = await db.from('outlet_leave_rules')
    .upsert([{ outlet_id: outletId, company_id: companyId, ...colonne, updated_at: new Date().toISOString() }], { onConflict: 'outlet_id' });
  return error ? error.message : null;
}

/** Chi e' HR nell'azienda (elenco che cambia solo il Super Advisor). */
export async function caricaHr(companyId: string): Promise<{ utenti: string[]; disponibile: boolean }> {
  const { data, error } = await db.from('leave_hr').select('user_id').eq('company_id', companyId);
  if (error) return { utenti: [], disponibile: false };
  return { utenti: ((data as { user_id: string }[]) ?? []).map((x) => x.user_id), disponibile: true };
}

export async function aggiungiHr(companyId: string, userId: string): Promise<string | null> {
  const { error } = await db.from('leave_hr').insert([{ company_id: companyId, user_id: userId }]);
  return error ? error.message : null;
}

/** Toglie una persona dall'elenco HR: null se e' andata, altrimenti il motivo (anche «nessuna riga tolta»). */
export async function togliHr(companyId: string, userId: string): Promise<string | null> {
  const { data, error } = await db.from('leave_hr').delete().eq('company_id', companyId).eq('user_id', userId).select('user_id');
  if (error) return error.message;
  return (data as unknown[] | null)?.length ? null : 'Non tolto: l’elenco HR lo cambia solo il Super Advisor.';
}

/** La 407 c'è su questo database? (le tabelle delle regole di ferie e permessi rispondono) */
export async function ferie407Disponibile(): Promise<boolean> {
  const { error } = await db.from('outlet_leave_rules').select('outlet_id').limit(1);
  return !error;
}

/**
 * Ferie e permessi di un evento: scrive le due voci dentro le regole e tiene allineato blocca_ferie.
 * Solo dove la 407 c'è: senza, le due voci separate non le legge nessuno e un evento con una voce
 * accesa smetterebbe di bloccare.
 */
export async function salvaFerieEvento(id: string, regole: Record<string, unknown>, bloccaFerie: boolean): Promise<string | null> {
  if (!(await ferie407Disponibile())) return 'Ferie e permessi separati per evento arrivano con il prossimo aggiornamento del database.';
  const { error } = await db.from('outlet_events').update({ regole, blocca_ferie: bloccaFerie }).eq('id', id);
  return error ? error.message : null;
}
