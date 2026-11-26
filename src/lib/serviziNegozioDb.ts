// Lettura e scrittura dei servizi del negozio (migration 468): scarico merce e pulizie.
// Dove le tabelle non ci sono (Made, fuori dal 03/11/2026) si torna a prima: nessun servizio,
// nessun errore a video.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { ConsegnaCalendario, ServiziNegozio, ServizioRicorrente, TipoServizio } from './serviziNegozio';

// Le tabelle sono nuove e non stanno ancora nei tipi generati del database.
const db = supabase as unknown as SupabaseClient;
const t5 = (x: string | null | undefined) => (x ? x.slice(0, 5) : null);

/**
 * I servizi di un negozio, con le consegne del calendario fra `dal` e `al`. Null se le tabelle
 * mancano o la lettura non riesce: chi calcola i turni procede come prima.
 */
export async function caricaServizi(outletId: string, dal: string, al: string): Promise<ServiziNegozio | null> {
  const [r, c] = await Promise.all([
    db.from('outlet_servizi').select('id, tipo, giorno, dalle, alle, persone').eq('outlet_id', outletId),
    db.from('outlet_consegne').select('id, data, dalle, alle, persone, annullata, nota').eq('outlet_id', outletId).gte('data', dal).lte('data', al),
  ]);
  if (r.error || c.error) return null;
  return {
    ricorrenti: ((r.data as { id: string; tipo: TipoServizio; giorno: number; dalle: string; alle: string; persone: number }[]) ?? [])
      .map((x) => ({ id: x.id, tipo: x.tipo, giorno: Number(x.giorno), dalle: t5(x.dalle)!, alle: t5(x.alle)!, persone: Number(x.persone) })),
    consegne: ((c.data as { id: string; data: string; dalle: string | null; alle: string | null; persone: number | null; annullata: boolean; nota: string | null }[]) ?? [])
      .map((x) => ({ id: x.id, data: x.data, dalle: t5(x.dalle), alle: t5(x.alle), persone: x.persone == null ? null : Number(x.persone), annullata: !!x.annullata, nota: x.nota })),
  };
}

/**
 * Salva le regole ricorrenti di un tipo per il negozio: aggiorna quelle dei giorni scritti e
 * toglie quelle dei giorni non più scritti. Le altre del negozio non si toccano.
 */
export async function salvaRicorrenti(companyId: string, outletId: string, tipo: TipoServizio, righe: Omit<ServizioRicorrente, 'id' | 'tipo'>[]): Promise<void> {
  const giorni = righe.map((x) => x.giorno);
  if (righe.length) {
    const { error } = await db.from('outlet_servizi').upsert(
      righe.map((x) => ({ company_id: companyId, outlet_id: outletId, tipo, giorno: x.giorno, dalle: x.dalle, alle: x.alle, persone: x.persone, updated_at: new Date().toISOString() })),
      { onConflict: 'outlet_id,tipo,giorno' });
    if (error) throw error;
  }
  let q = db.from('outlet_servizi').delete().eq('outlet_id', outletId).eq('tipo', tipo);
  if (giorni.length) q = q.not('giorno', 'in', `(${giorni.join(',')})`);
  const { error } = await q;
  if (error) throw error;
}

/** Aggiunge o cambia la consegna di una data (una riga per negozio e data). */
export async function salvaConsegna(companyId: string, outletId: string, c: Omit<ConsegnaCalendario, 'id'>): Promise<void> {
  const { error } = await db.from('outlet_consegne').upsert([{
    company_id: companyId, outlet_id: outletId, data: c.data,
    dalle: c.annullata ? null : c.dalle, alle: c.annullata ? null : c.alle, persone: c.annullata ? null : c.persone,
    annullata: c.annullata, nota: c.nota?.trim() || null, updated_at: new Date().toISOString(),
  }], { onConflict: 'outlet_id,data' });
  if (error) throw error;
}

/** Toglie la riga del calendario di una data: torna a valere la consegna abituale. */
export async function togliConsegna(outletId: string, data: string): Promise<void> {
  const { error } = await db.from('outlet_consegne').delete().eq('outlet_id', outletId).eq('data', data);
  if (error) throw error;
}

// ── La responsabile del negozio (funzioni della 468 che controllano i suoi negozi) ──

export interface ServiziNegozioResp extends ServiziNegozio { outlet_id: string; nome: string }

export async function caricaServiziResponsabile(dal: string, al: string): Promise<ServiziNegozioResp[]> {
  const { data, error } = await db.rpc('responsabile_servizi', { p_dal: dal, p_al: al });
  if (error) throw error;
  return ((data as ServiziNegozioResp[]) ?? []).map((n) => ({
    ...n,
    ricorrenti: (n.ricorrenti ?? []).map((x) => ({ ...x, giorno: Number(x.giorno), persone: Number(x.persone) })),
    consegne: (n.consegne ?? []).map((x) => ({ ...x, persone: x.persone == null ? null : Number(x.persone), annullata: !!x.annullata })),
  }));
}

export async function salvaConsegnaResponsabile(outletId: string, c: Omit<ConsegnaCalendario, 'id'>): Promise<void> {
  const { error } = await db.rpc('responsabile_consegna_salva', {
    p_outlet_id: outletId, p_data: c.data, p_dalle: c.annullata ? null : c.dalle, p_alle: c.annullata ? null : c.alle,
    p_persone: c.annullata ? null : c.persone, p_annullata: c.annullata, p_nota: c.nota ?? null,
  });
  if (error) throw error;
}

export async function togliConsegnaResponsabile(outletId: string, data: string): Promise<void> {
  const { error } = await db.rpc('responsabile_consegna_togli', { p_outlet_id: outletId, p_data: data });
  if (error) throw error;
}
