/**
 * Reconciliation Engine v2 — thin wrapper su RPC PostgreSQL
 *
 * Da maggio 2026 la logica di matching è server-side via:
 *   - try_match_bank_transaction(p_bt_id uuid)  → matcha 1 movimento
 *   - rerun_reconciliation()                     → batch su tutto
 *
 * Algoritmo a 3 assi (50pt importo, 30pt nome/VAT, 20pt data due_date):
 *   - score >= 80 → auto_exact (applicato)
 *   - score 50-79 → auto_fuzzy (suggerito, da confermare)
 *   - score < 50  → no match
 *
 * Tabella audit: public.reconciliation_log
 *
 * NOTA: questo file è il refactor della v1 (1057 righe client-side che lavorava
 * su cash_movements droppata). Mantenute le firme delle 4 funzioni esportate
 * (runAutoReconciliation, applyReconciliation, undoReconciliation, getReconciliationLog)
 * per compatibilità con Banche.tsx esistente.
 */

import { supabase } from './supabase'

// ─── TYPES ─────────────────────────────────────────────────────

export type MatchType = 'auto_exact' | 'auto_fuzzy' | 'manual' | 'rejected'
export type ReconciliationStatus = 'applied' | 'to_confirm' | 'rejected'

export interface ReconciliationOptions {
  apply?: boolean
  dryRun?: boolean
}

export interface ReconciliationResult {
  success: boolean
  processed: number
  matched: number
  applied?: number
  toConfirm?: number
  error?: string
}

export interface ReconciliationLogEntry {
  id: string
  company_id: string
  bank_transaction_id: string | null
  payable_id: string | null
  match_type: MatchType
  confidence: number
  score_amount: number | null
  score_name: number | null
  score_date: number | null
  status: ReconciliationStatus
  notes: string | null
  performed_at: string
  bank_transactions?: Record<string, unknown>
  payables?: Record<string, unknown>
  cash_movements?: { date?: string; description?: string }
}

// ─── PUBLIC API ────────────────────────────────────────────────

export async function runAutoReconciliation(
  _companyId: string,
  _bankAccountId: string | null = null,
  _options: ReconciliationOptions = {},
): Promise<ReconciliationResult> {
  try {
    // RPC creata in migration 032, types Supabase ancora stale.
    const { data, error } = await (supabase.rpc as unknown as (name: string) => Promise<{ data: unknown; error: { message: string } | null }>)('rerun_reconciliation')
    if (error) {
      return { success: false, processed: 0, matched: 0, error: error.message }
    }
    const result = (data ?? {}) as { processed?: number; matched?: number }
    return {
      success: true,
      processed: result.processed ?? 0,
      matched: result.matched ?? 0,
    }
  } catch (e) {
    return { success: false, processed: 0, matched: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function applyReconciliation(
  bankTransactionId: string,
  payableId: string,
  matchType: MatchType = 'manual',
  notes = '',
  _options: { performedBy?: string | null; companyId?: string | null } = {},
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: bt, error: btErr } = await supabase
      .from('bank_transactions')
      .select('company_id, transaction_date, amount')
      .eq('id', bankTransactionId)
      .maybeSingle()
    if (btErr || !bt) return { success: false, error: btErr?.message ?? 'bank_transaction not found' }

    // payables.bank_transaction_id aggiunto in migration 028, types Supabase ancora stale.
    const { data: pay, error: payErr } = await (supabase
      .from('payables') as unknown as { update: (v: Record<string, unknown>) => { eq: (k: string, v: string) => { select: (s: string) => { maybeSingle: () => Promise<{ data: { gross_amount?: number } | null; error: { message: string } | null }> } } } })
      .update({
        bank_transaction_id: bankTransactionId,
        status: 'pagato',
        payment_date: bt.transaction_date,
        updated_at: new Date().toISOString(),
      })
      .eq('id', payableId)
      .select('gross_amount')
      .maybeSingle()
    if (payErr) return { success: false, error: payErr.message }

    if (pay?.gross_amount) {
      await supabase
        .from('payables')
        .update({ amount_paid: pay.gross_amount, amount_remaining: 0 })
        .eq('id', payableId)
    }

    // reconciliation_log ricreata in migration 032 con bank_transaction_id, types stale.
    const { error: logErr } = await (supabase.from('reconciliation_log') as unknown as { insert: (v: Record<string, unknown>) => Promise<{ error: { message: string } | null }> }).insert({
      company_id: bt.company_id,
      bank_transaction_id: bankTransactionId,
      payable_id: payableId,
      match_type: matchType,
      confidence: matchType === 'manual' ? 100 : 0,
      status: 'applied',
      notes,
    })
    if (logErr) console.warn('reconciliation_log insert failed:', logErr.message)

    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function undoReconciliation(
  bankTransactionId: string,
  payableId: string,
  options: { performedBy?: string | null; companyId?: string | null; notes?: string } = {},
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: pay, error: payErr } = await (supabase
      .from('payables') as unknown as { update: (v: Record<string, unknown>) => { eq: (k: string, v: string) => { select: (s: string) => { maybeSingle: () => Promise<{ data: { gross_amount?: number } | null; error: { message: string } | null }> } } } })
      .update({
        bank_transaction_id: null,
        status: 'da_pagare',
        amount_paid: 0,
        payment_date: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', payableId)
      .select('gross_amount')
      .maybeSingle()
    if (payErr) return { success: false, error: payErr.message }

    if (pay?.gross_amount) {
      await supabase
        .from('payables')
        .update({ amount_remaining: pay.gross_amount })
        .eq('id', payableId)
    }

    const { error: logErr } = await (supabase
      .from('reconciliation_log') as unknown as { update: (v: Record<string, unknown>) => { eq: (k: string, v: string) => { eq: (k2: string, v2: string) => Promise<{ error: { message: string } | null }> } } })
      .update({ status: 'rejected', notes: options.notes ?? 'manual undo' })
      .eq('bank_transaction_id', bankTransactionId)
      .eq('payable_id', payableId)
    if (logErr) console.warn('reconciliation_log undo update failed:', logErr.message)

    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function getReconciliationLog(
  companyId: string,
  filters: {
    dateFrom?: string | null
    dateTo?: string | null
    matchType?: string | null
    minConfidence?: number | null
    movementId?: string | null
    payableId?: string | null
    limit?: number
    offset?: number
  } = {},
): Promise<{ data: ReconciliationLogEntry[]; count: number; error?: string }> {
  try {
    let q = supabase
      .from('reconciliation_log')
      .select('*, bank_transactions(*), payables(*)', { count: 'exact' })
      .eq('company_id', companyId)
      .order('performed_at', { ascending: false })

    if (filters.dateFrom) q = q.gte('performed_at', filters.dateFrom)
    if (filters.dateTo) q = q.lte('performed_at', filters.dateTo)
    if (filters.matchType) q = q.eq('match_type', filters.matchType)
    if (filters.minConfidence != null) q = q.gte('confidence', filters.minConfidence)
    // bank_transaction_id aggiunto in migration 032, types stale
    if (filters.movementId) q = (q as unknown as { eq: (k: string, v: string) => typeof q }).eq('bank_transaction_id', filters.movementId)
    if (filters.payableId) q = q.eq('payable_id', filters.payableId)
    if (filters.limit) q = q.limit(filters.limit)
    if (filters.offset) q = q.range(filters.offset, (filters.offset ?? 0) + (filters.limit ?? 50) - 1)

    const { data, error, count } = await q
    if (error) return { data: [], count: 0, error: error.message }

    const enriched = (data ?? []).map((row: Record<string, unknown>) => {
      const bt = row.bank_transactions as Record<string, unknown> | undefined
      return {
        ...row,
        cash_movements: bt
          ? {
              date: (bt.transaction_date as string | undefined) ?? undefined,
              description: (bt.description as string | undefined) ?? undefined,
            }
          : undefined,
        cash_movement_id: row.bank_transaction_id,
      } as ReconciliationLogEntry & { cash_movement_id: unknown }
    })

    return { data: enriched as ReconciliationLogEntry[], count: count ?? 0 }
  } catch (e) {
    return { data: [], count: 0, error: e instanceof Error ? e.message : String(e) }
  }
}
