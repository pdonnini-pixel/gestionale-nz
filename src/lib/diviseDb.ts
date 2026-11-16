// Letture e scritture di divise e acquisti (migration 422). Dove le tabelle o le funzioni
// mancano (Made, o prima della migration) le letture rispondono «non disponibile» e la
// pagina non mostra niente: nessun errore a video.

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Capo, Divisa, VoceCapo } from './divise'

// tabelle e funzioni nuove: non ancora nei tipi generati del database
const db = supabase as unknown as SupabaseClient

/** Chi può gestire divise e acquisti (elenco scelto dal Super Advisor, più il Super Advisor). null = funzione assente. */
export async function possoGestireDivise(): Promise<boolean | null> {
  const { data, error } = await db.rpc('divise_posso_gestire')
  if (error) return null
  return !!data
}

export interface DatiPersonaDivise {
  capi: Capo[]
  divise: Divisa[]
  sconti: { divise: number | null; acquisti: number | null }
  standard: { divise: number; acquisti: number }
  registro: { id: number; azione: string; dettaglio: Record<string, unknown>; utente_nome: string | null; creato_il: string; capo_id: string | null }[]
}

const num = (v: unknown): number | null => (v == null ? null : Number(v))

export async function caricaDivisePersona(companyId: string, employeeId: string): Promise<DatiPersonaDivise> {
  const [k, d, s, i, r] = await Promise.all([
    db.from('employee_capi').select('*').eq('employee_id', employeeId).order('registrato_il', { ascending: false }),
    db.from('employee_divise').select('id, numero, tipo, outlet_id, aperta_il').eq('employee_id', employeeId).order('numero'),
    db.from('employee_divise_sconti').select('sconto_divise_pct, sconto_acquisti_pct').eq('employee_id', employeeId).maybeSingle(),
    db.from('divise_impostazioni').select('sconto_divise_pct, sconto_acquisti_pct').eq('company_id', companyId).maybeSingle(),
    db.from('divise_registro').select('id, azione, dettaglio, utente_nome, creato_il, capo_id').eq('employee_id', employeeId).order('creato_il', { ascending: false }).limit(50),
  ])
  const errore = k.error ?? d.error ?? s.error ?? i.error ?? r.error
  if (errore) throw new Error(errore.message)
  const capi = ((k.data ?? []) as Record<string, unknown>[]).map((x) => ({
    ...(x as unknown as Capo),
    prezzo_outlet: num(x.prezzo_outlet), prezzo_corretto: num(x.prezzo_corretto), sconto_pct: num(x.sconto_pct),
  }))
  const sc = s.data as { sconto_divise_pct: unknown; sconto_acquisti_pct: unknown } | null
  const st = i.data as { sconto_divise_pct: unknown; sconto_acquisti_pct: unknown } | null
  return {
    capi,
    divise: (d.data ?? []) as Divisa[],
    sconti: { divise: num(sc?.sconto_divise_pct), acquisti: num(sc?.sconto_acquisti_pct) },
    standard: { divise: num(st?.sconto_divise_pct) ?? 0, acquisti: num(st?.sconto_acquisti_pct) ?? 0 },
    registro: (r.data ?? []) as DatiPersonaDivise['registro'],
  }
}

/** Per l'elenco dei dipendenti: i capi ancora da scaricare o da addebitare. null = non disponibile. */
export async function caricaDaSistemare(companyId: string): Promise<Pick<Capo, 'employee_id' | 'voce' | 'scaricato_il' | 'addebitato_il'>[] | null> {
  const { data, error } = await db.from('employee_capi').select('employee_id, voce, scaricato_il, addebitato_il')
    .eq('company_id', companyId).or('scaricato_il.is.null,addebitato_il.is.null')
  if (error) return null
  return (data ?? []) as Pick<Capo, 'employee_id' | 'voce' | 'scaricato_il' | 'addebitato_il'>[]
}

const scrivi = async (fn: string, args: Record<string, unknown>) => {
  const { data, error } = await db.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data
}

export const segnaCapi = (ids: string[], cosa: 'scaricato' | 'addebitato', valore: boolean) =>
  scrivi('divise_capi_segna', { p_capi: ids, p_cosa: cosa, p_valore: valore }) as Promise<number>
export const correggiPrezzo = (capoId: string, prezzo: number | null) =>
  scrivi('divise_capo_correggi_prezzo', { p_capo: capoId, p_prezzo: prezzo })
export const impostaScontiPersona = (employeeId: string, divise: number | null, acquisti: number | null) =>
  scrivi('divise_sconti_persona_imposta', { p_employee: employeeId, p_divise: divise, p_acquisti: acquisti })
export const salvaScontiStandard = (divise: number, acquisti: number) =>
  scrivi('divise_impostazioni_salva', { p_divise: divise, p_acquisti: acquisti })
export const impostaGestore = (userId: string, dentro: boolean) =>
  scrivi('divise_gestore_imposta', { p_user: userId, p_dentro: dentro })

export async function caricaGestori(companyId: string): Promise<{ user_id: string; aggiunto_il: string }[]> {
  const { data, error } = await db.from('divise_gestori').select('user_id, aggiunto_il').eq('company_id', companyId)
  if (error) throw new Error(error.message)
  return (data ?? []) as { user_id: string; aggiunto_il: string }[]
}

// ── Telefono del negozio ──

/** Il tasto si mostra solo se la funzione esiste su questo tenant. */
export async function diviseAttive(): Promise<boolean> {
  const { data, error } = await db.rpc('divise_attive')
  return !error && data === true
}

export interface AperturaDivise { divise: { numero: number; tipo: 'fornita' | 'sconto'; aperta_il: string; pezzi: number }[]; prossima: number }

/** Apre la sezione della persona. Risposta {errore} per QR o PIN non validi o persona non entrata. */
export async function apriDivise(outletId: string, codice: string): Promise<AperturaDivise | { errore: string }> {
  const { data, error } = await db.rpc('divise_timbratrice_apri', { p_outlet_id: outletId, p_codice: codice })
  if (error) return { errore: error.message }
  return data as AperturaDivise | { errore: string }
}

export async function registraCapi(outletId: string, codice: string, voce: VoceCapo, divisa: number | null, capi: { codice: string; prezzo: number | null }[]):
  Promise<{ capi: number; divisa: number | null; pezzi_divisa: number | null } | { errore: string }> {
  const { data, error } = await db.rpc('divise_registra', {
    p_outlet_id: outletId, p_codice: codice, p_voce: voce, p_divisa: divisa,
    p_capi: capi.map((c) => (c.prezzo == null ? { codice: c.codice } : { codice: c.codice, prezzo: c.prezzo })),
  })
  if (error) return { errore: error.message }
  return data as { capi: number; divisa: number | null; pezzi_divisa: number | null } | { errore: string }
}

// ── App della dipendente ──

export interface MioCapo { id: string; registrato_il: string; voce: VoceCapo; divisa: number | null; codice: string; prezzo_outlet: number | null; sconto_pct: number | null; prezzo: number }

/** I capi della dipendente collegata. null = funzione assente (sezione nascosta). */
export async function mieiCapi(): Promise<MioCapo[] | null> {
  const { data, error } = await db.rpc('app_dipendente_divise')
  if (error) return null
  return ((data ?? []) as Record<string, unknown>[]).map((x) => ({
    ...(x as unknown as MioCapo), prezzo_outlet: num(x.prezzo_outlet), sconto_pct: num(x.sconto_pct), prezzo: Number(x.prezzo ?? 0),
  }))
}
