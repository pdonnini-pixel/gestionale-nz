/**
 * Reconciliation Engine — Motore di riconciliazione automatica
 *
 * Abbina i movimenti bancari in uscita (cash_movements.type = 'uscita')
 * con le fatture fornitori (payables) usando un algoritmo a punteggio:
 *   - Importo (max 50 punti)
 *   - Nome fornitore estratto dalla descrizione bancaria (max 30 punti)
 *   - Prossimità data scadenza (max 20 punti)
 *
 * Soglie (aggiornate Apr 2026 per eliminare rumore):
 *   >= 95  → auto_exact  (riconciliazione automatica, batch-confermabile)
 *   >= 85  → auto_fuzzy  (proposta, richiede conferma manuale)
 *   <  85  → NON mostrato (prima generava proposte inutili al 25-45%)
 *
 * Ogni azione viene tracciata in reconciliation_log per audit trail.
 */

import { supabase } from './supabase';

// ─── CONSTANTS ─────────────────────────────────────────────────

// Soglie innalzate: sotto 85 le proposte sono rumore (segnalati abbinamenti al
// 25-45% privi di valore). Ora:
//  score >= 95 → auto_exact (match sicuro, confermabile in batch)
//  score 85-94 → auto_fuzzy (proposta, richiede conferma manuale)
//  score < 85  → NON mostrato affatto (ne' in reconciled ne' in suggested)
const THRESHOLD_AUTO = 95;
const THRESHOLD_SUGGEST = 85;

const NAME_EXACT = 30;
const NAME_PARTIAL = 20;
const NAME_SINGLE_WORD = 10;

const DATE_WITHIN_7 = 20;
const DATE_WITHIN_30 = 15;
const DATE_WITHIN_60 = 10;
const DATE_WITHIN_90 = 5;

// AI scoring bonus (max 15 punti)
const AI_HISTORY_EXACT_MATCH = 15;   // stesso counterpart → stesso supplier già confermato
const AI_HISTORY_PARTIAL = 8;        // pattern simile confermato in passato
const AI_CATEGORY_MATCH = 5;         // AI category collegata al supplier

// Patterns that indicate incoming POS payments — skip for payable matching
const POS_PATTERNS = [
  /ACCREDITO POS/i,
  /INCASSO POS/i,
  /POS.*NEXI/i,
  /ACCREDITO CARTE/i,
];

// Patterns for bank/card fees and terminal costs — NOT supplier invoice payments
const BANK_FEE_PATTERNS = [
  /NEXI PAYMENTS/i,
  /AMERICAN EXPRESS PAYMENTS/i,
  /CANONE.*MPS/i,
  /CANONE.*SET DI BASE/i,
  /COMMISSIONI.*CARTA/i,
  /COMPETENZE E SPESE/i,
  /INTERESSI.*DEBITORI/i,
  /IMPOSTA.*BOLLO/i,
  /GLOBAL BLUE ITALIA/i,     // tax-free refunds, not supplier invoices
];

// ─── 1. MAIN RECONCILIATION ───────────────────────────────────

/**
 * Esegue la riconciliazione automatica tra movimenti bancari e fatture fornitori.
 *
 * @param {string} companyId - UUID azienda
 * @param {string|null} bankAccountId - opzionale, filtra per conto bancario
 * @param {Object} options
 * @param {boolean} options.dryRun - se true, non scrive nulla (solo proposte)
 * @param {string|null} options.dateFrom - filtra movimenti da questa data
 * @param {string|null} options.dateTo - filtra movimenti fino a questa data
 * @param {string|null} options.performedBy - UUID utente che lancia la riconciliazione
 * @returns {{ reconciled: Array, suggested: Array, unmatched: Array, errors: Array, stats: Object }}
 */
interface ReconciliationOptions {
  dryRun?: boolean;
  dateFrom?: string | null;
  dateTo?: string | null;
  performedBy?: string | null;
}

interface ReconciliationResult {
  reconciled: Record<string, unknown>[];
  suggested: Record<string, unknown>[];
  unmatched: Record<string, unknown>[];
  errors: Record<string, unknown>[];
  stats: Record<string, unknown>;
}

type CashMovementRow = {
  id: string;
  amount: number;
  date: string | null;
  description: string | null;
  counterpart: string | null;
  ai_category_id?: string | null;
  bank_account_id?: string | null;
  [key: string]: unknown;
};

type SupplierLite = { id: string; ragione_sociale: string | null; name: string | null; partita_iva: string | null };

type PayableRow = {
  id: string;
  supplier_id: string | null;
  amount_remaining: number | null;
  gross_amount: number | null;
  due_date: string | null;
  suppliers?: SupplierLite | null;
  [key: string]: unknown;
};

export async function runAutoReconciliation(companyId: string, bankAccountId: string | null = null, options: ReconciliationOptions = {}): Promise<ReconciliationResult> {
  const { dryRun = false, dateFrom = null, dateTo = null, performedBy = null } = options;
  const errors: Record<string, unknown>[] = [];
  const reconciled: Record<string, unknown>[] = [];
  const suggested: Record<string, unknown>[] = [];
  const unmatched: Record<string, unknown>[] = [];

  try {
    // ── Fetch unreconciled uscite ──
    let movQuery = supabase
      .from('cash_movements')
      .select('*')
      .eq('company_id', companyId)
      .eq('type', 'uscita')
      .or('is_reconciled.is.null,is_reconciled.eq.false');

    if (bankAccountId) movQuery = movQuery.eq('bank_account_id', bankAccountId);
    if (dateFrom) movQuery = movQuery.gte('date', dateFrom);
    if (dateTo) movQuery = movQuery.lte('date', dateTo);

    const { data: movements, error: movError } = await movQuery.order('date', { ascending: true });
    if (movError) {
      errors.push({ message: `Errore caricamento movimenti: ${movError.message}` });
      return { reconciled, suggested, unmatched, errors, stats: {} };
    }

    // ── Fetch unpaid payables (or paid but not yet linked to a movement) ──
    const { data: payables, error: payError } = await supabase
      .from('payables')
      .select('*, suppliers!inner(id, ragione_sociale, name, partita_iva)')
      .eq('company_id', companyId)
      .or('status.eq.da_pagare,status.eq.in_scadenza,status.eq.scaduto,status.eq.parziale,cash_movement_id.is.null')
      .is('cash_movement_id', null);

    if (payError) {
      errors.push({ message: `Errore caricamento fatture: ${payError.message}` });
      return { reconciled, suggested, unmatched, errors, stats: {} };
    }

    // ── Fetch all suppliers for name matching ──
    const { data: suppliers } = await supabase
      .from('suppliers')
      .select('id, ragione_sociale, name, partita_iva')
      .eq('company_id', companyId);

    const supplierMap: Record<string, SupplierLite> = {};
    for (const s of (suppliers || []) as SupplierLite[]) {
      supplierMap[s.id] = s;
    }

    // ── Fetch rejected pairs (operator explicitly said "no match") ──
    const { data: rejectedPairs } = await supabase
      .from('reconciliation_rejected_pairs')
      .select('cash_movement_id, payable_id')
      .eq('company_id', companyId);

    const rejectedSet = new Set(
      (rejectedPairs || []).map(r => `${r.cash_movement_id}::${r.payable_id}`)
    );

    // ── AI Enhancement: Load historical reconciliation patterns ──
    const aiPatterns = await loadReconciliationPatterns(companyId);

    // ── Filter out POS incoming movements and bank/card fees ──
    const outflowMovements = ((movements || []) as CashMovementRow[]).filter(m =>
      !isPOSMovement(m.description) && !isBankFeeMovement(m.description)
    );

    // Track which payables have been auto-matched (1-to-1, only for score >= 80)
    const matchedPayableIds = new Set<string>();

    type Candidate = {
      payable: PayableRow;
      score: number;
      details: Record<string, unknown>;
    };

    // ── Run matching for each movement ──
    // NEW PARADIGM: collect ALL candidates per movement, let operator choose
    for (const movement of outflowMovements) {
      const absAmount = Math.abs(movement.amount);
      const bankSupplierName = extractSupplierName(movement.description || '');
      const movementDate = movement.date ? new Date(movement.date) : null;

      const candidates: Candidate[] = [];

      for (const payable of ((payables || []) as PayableRow[])) {
        if (matchedPayableIds.has(payable.id)) continue;
        // Skip pairs explicitly rejected by operator
        if (rejectedSet.has(`${movement.id}::${payable.id}`)) continue;

        const supplier: Partial<SupplierLite> = payable.suppliers || (payable.supplier_id ? supplierMap[payable.supplier_id] : null) || {};
        const payableAmount = (payable.amount_remaining != null && payable.amount_remaining > 0
          ? payable.amount_remaining
          : payable.gross_amount) ?? 0;

        // ── Score: Amount ──
        const amountDiff = Math.abs(absAmount - payableAmount);
        const maxAmt = Math.max(absAmount, payableAmount, 1);
        const pctDiff = (amountDiff / maxAmt) * 100;
        let amountScore = 0;
        let amountLabel = '';

        if (amountDiff < 0.01) {
          amountScore = 50;
          amountLabel = 'esatto';       // 100% match
        } else if (pctDiff <= 0.5 && amountDiff <= 5) {
          amountScore = 45;
          amountLabel = 'quasi_esatto'; // ~99.5%
        } else if (pctDiff <= 1 && amountDiff <= 10) {
          amountScore = 40;
          amountLabel = 'trascurabile'; // ~99%
        } else if (pctDiff <= 2 && amountDiff <= 20) {
          amountScore = 30;
          amountLabel = 'vicino';       // ~98%
        } else if (pctDiff <= 5 && amountDiff <= 50) {
          amountScore = 20;
          amountLabel = 'approssimato'; // ~95%
        }
        // STOP here — no more loose matches. If >5% diff, skip entirely.
        if (amountScore === 0) continue;

        // ── Score: Name ──
        const supplierNames = [
          supplier.ragione_sociale || '',
          supplier.name || '',
        ].filter(Boolean);

        let nameScore = 0;
        let matchedName = '';
        if (bankSupplierName) {
          for (const sName of supplierNames) {
            const score = nameMatchScore(bankSupplierName, sName);
            if (score > nameScore) {
              nameScore = score;
              matchedName = sName;
            }
          }
        }

        // ── Score: Date proximity ──
        let dateScore = 0;
        const dueDate = payable.due_date ? new Date(payable.due_date) : null;
        if (movementDate && dueDate) {
          const daysDiff = Math.abs(Math.round((movementDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)));
          if (daysDiff <= 7) dateScore = DATE_WITHIN_7;
          else if (daysDiff <= 30) dateScore = DATE_WITHIN_30;
          else if (daysDiff <= 60) dateScore = DATE_WITHIN_60;
          else if (daysDiff <= 90) dateScore = DATE_WITHIN_90;
        }

        // ── Score: AI History (learned patterns from past reconciliations) ──
        let aiScore = 0;
        let aiMatchType: string | null = null;
        const supplierId = payable.supplier_id || supplier?.id;

        if (supplierId && movement.counterpart) {
          const counterpartKey = normalizeName(movement.counterpart);
          if (aiPatterns.counterpartToSupplier[counterpartKey] === supplierId) {
            aiScore = AI_HISTORY_EXACT_MATCH;
            aiMatchType = 'history_exact';
          } else {
            // Partial match: check if any known counterpart pattern partially matches
            for (const [knownCP, knownSuppId] of Object.entries(aiPatterns.counterpartToSupplier)) {
              if (knownSuppId === supplierId && (counterpartKey.includes(knownCP) || knownCP.includes(counterpartKey))) {
                aiScore = AI_HISTORY_PARTIAL;
                aiMatchType = 'history_partial';
                break;
              }
            }
          }
        }

        // AI category bonus: movement's AI category matches a category linked to this supplier
        if (aiScore === 0 && movement.ai_category_id && supplierId) {
          const supplierCategories = aiPatterns.supplierCategories[supplierId];
          if (supplierCategories && supplierCategories.includes(movement.ai_category_id)) {
            aiScore = AI_CATEGORY_MATCH;
            aiMatchType = 'category_match';
          }
        }

        const totalScore = amountScore + nameScore + dateScore + aiScore;

        candidates.push({
          payable,
          score: totalScore,
          details: {
            amountScore,
            amountLabel,
            nameScore,
            dateScore,
            aiScore,
            aiMatchType,
            amountDiff: Math.round(amountDiff * 100) / 100,
            pctDiff: Math.round(pctDiff * 10) / 10,
            bankSupplierName: bankSupplierName || null,
            matchedSupplierName: matchedName || null,
            movementAmount: absAmount,
            payableAmount,
            daysDiff: movementDate && dueDate
              ? Math.abs(Math.round((movementDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)))
              : null,
          },
        });
      }

      // Sort candidates: exact amount first, then by total score
      candidates.sort((a, b) => {
        // Exact amounts always on top
        if (a.details.amountLabel === 'esatto' && b.details.amountLabel !== 'esatto') return -1;
        if (b.details.amountLabel === 'esatto' && a.details.amountLabel !== 'esatto') return 1;
        return b.score - a.score;
      });

      const bestCandidate = candidates[0] || null;

      if (bestCandidate && bestCandidate.score >= THRESHOLD_AUTO) {
        // Auto reconciliation: solo quando score >= 95 (importo esatto + nome
        // fornitore riconosciuto). Match sicuro, confermabile in batch senza
        // revisione manuale.
        const matchType = 'auto_exact';
        matchedPayableIds.add(bestCandidate.payable.id);

        if (!dryRun) {
          try {
            await writeReconciliation(movement.id, bestCandidate.payable.id, companyId, matchType, bestCandidate.score, bestCandidate.details, performedBy);
            reconciled.push({
              movement,
              payable: bestCandidate.payable,
              score: bestCandidate.score,
              matchType,
              details: bestCandidate.details,
            });
          } catch (err: unknown) {
            errors.push({
              message: `Errore riconciliazione mov ${movement.id}: ${(err as Error).message}`,
              movementId: movement.id,
              payableId: bestCandidate.payable.id,
            });
          }
        } else {
          reconciled.push({
            movement,
            payable: bestCandidate.payable,
            score: bestCandidate.score,
            matchType,
            details: bestCandidate.details,
          });
        }
      } else if (bestCandidate && bestCandidate.score >= THRESHOLD_SUGGEST) {
        // Proposta: score tra 85 e 94 — serve conferma manuale. I candidati
        // con score < THRESHOLD_SUGGEST (sotto 85) vengono scartati: erano
        // rumore che confondeva l'utente.
        const filteredCandidates = candidates.filter(c => c.score >= THRESHOLD_SUGGEST);
        suggested.push({
          movement,
          payable: bestCandidate.payable,      // backward compat: best candidate
          score: bestCandidate.score,
          matchType: 'auto_fuzzy',
          details: bestCandidate.details,
          candidates: filteredCandidates,      // solo candidati >= soglia 85
        });
      } else {
        // ── No candidates at all (amount too different from every payable) ──
        unmatched.push({
          movement,
          bestScore: 0,
          bestDetails: null,
          bestCandidate: null,
        });
      }
    }

    const stats = {
      totalMovements: outflowMovements.length,
      reconciled: reconciled.length,
      suggested: suggested.length,
      unmatched: unmatched.length,
      errors: errors.length,
      skippedPOS: (movements || []).length - outflowMovements.length,
    };

    return { reconciled, suggested, unmatched, errors, stats };
  } catch (err: unknown) {
    errors.push({ message: `Errore imprevisto: ${(err as Error).message}` });
    return { reconciled, suggested, unmatched, errors, stats: {} };
  }
}

// ─── 2. APPLY RECONCILIATION (manual or confirming suggestion) ─

/**
 * Applica una riconciliazione singola (manuale o conferma di un suggerimento).
 *
 * @param {string} movementId - UUID del movimento bancario
 * @param {string} payableId - UUID della fattura fornitore
 * @param {string} matchType - 'manual' | 'auto_exact' | 'auto_fuzzy'
 * @param {string} notes - note opzionali
 * @param {Object} options
 * @param {string|null} options.performedBy - UUID utente
 * @param {string|null} options.companyId - UUID azienda (per il log)
 * @returns {{ success: boolean, error?: string }}
 */
export async function applyReconciliation(movementId: string, payableId: string, matchType = 'manual', notes = '', options: { performedBy?: string | null; companyId?: string | null } = {}): Promise<{ success: boolean; error?: string }> {
  const { performedBy = null, companyId = null } = options;

  try {
    const now = new Date().toISOString();

    // Fetch the movement and payable to get company_id if not provided
    let resolvedCompanyId = companyId;
    if (!resolvedCompanyId) {
      const { data: mov } = await supabase
        .from('cash_movements')
        .select('company_id')
        .eq('id', movementId)
        .single();
      resolvedCompanyId = mov?.company_id ?? null;
    }

    // ── Fetch current payable status before changing ──
    const { data: currentPayable } = await supabase
      .from('payables')
      .select('status')
      .eq('id', payableId)
      .single();

    const previousStatus = currentPayable?.status || 'da_pagare';

    // ── Update payable: link to movement, save previous status ──
    const { error: payError } = await supabase
      .from('payables')
      .update({
        cash_movement_id: movementId,
        payment_date: now.split('T')[0],
        status: 'pagato',
        previous_status: previousStatus,
      })
      .eq('id', payableId);

    if (payError) throw new Error(`Errore aggiornamento fattura: ${payError.message}`);

    // ── Update movement: mark as reconciled ──
    const { error: movError } = await supabase
      .from('cash_movements')
      .update({
        is_reconciled: true,
        reconciled_with: payableId,
        reconciled_at: now,
        reconciled_by: performedBy,
      })
      .eq('id', movementId);

    if (movError) throw new Error(`Errore aggiornamento movimento: ${movError.message}`);

    // ── Log to reconciliation_log ──
    if (resolvedCompanyId) {
      const { error: logError } = await supabase
        .from('reconciliation_log')
        .insert({
          company_id: resolvedCompanyId,
          cash_movement_id: movementId,
          payable_id: payableId,
          match_type: matchType,
          confidence: matchType === 'manual' ? 100 : null,
          match_details: { source: 'manual_apply' },
          performed_by: performedBy,
          performed_at: now,
          notes: notes || `Riconciliazione ${matchType}`,
          previous_payable_status: previousStatus,
          new_payable_status: 'pagato',
        });

      if (logError) {
        console.warn('Errore log riconciliazione (non bloccante):', logError.message);
      }
    }

    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message };
  }
}

// ─── 3. UNDO RECONCILIATION ───────────────────────────────────

/**
 * Annulla una riconciliazione esistente.
 *
 * @param {string} movementId - UUID del movimento bancario
 * @param {string} payableId - UUID della fattura fornitore
 * @param {Object} options
 * @param {string|null} options.performedBy - UUID utente
 * @param {string|null} options.companyId - UUID azienda
 * @param {string} options.notes - motivo annullamento
 * @returns {{ success: boolean, error?: string }}
 */
export async function undoReconciliation(movementId: string, payableId: string, options: { performedBy?: string | null; companyId?: string | null; notes?: string } = {}): Promise<{ success: boolean; error?: string }> {
  const { performedBy = null, companyId = null, notes = '' } = options;

  try {
    const now = new Date().toISOString();

    let resolvedCompanyId = companyId;
    if (!resolvedCompanyId) {
      const { data: mov } = await supabase
        .from('cash_movements')
        .select('company_id')
        .eq('id', movementId)
        .single();
      resolvedCompanyId = mov?.company_id ?? null;
    }

    // ── Fetch payable to restore original status ──
    const { data: currentPayable } = await supabase
      .from('payables')
      .select('status, previous_status')
      .eq('id', payableId)
      .single();

    const currentStatus = currentPayable?.status || 'pagato';
    // Restore to previous_status if available, otherwise fallback to da_pagare
    const restoredStatus = currentPayable?.previous_status || 'da_pagare';

    // ── Clear payable link and restore original status ──
    const { error: payError } = await supabase
      .from('payables')
      .update({
        cash_movement_id: null,
        payment_date: null,
        status: restoredStatus,
        previous_status: null,
      })
      .eq('id', payableId);

    if (payError) throw new Error(`Errore reset fattura: ${payError.message}`);

    // ── Clear movement reconciliation fields ──
    const { error: movError } = await supabase
      .from('cash_movements')
      .update({
        is_reconciled: false,
        reconciled_with: null,
        reconciled_at: null,
        reconciled_by: null,
      })
      .eq('id', movementId);

    if (movError) throw new Error(`Errore reset movimento: ${movError.message}`);

    // ── Log unlink action ──
    if (resolvedCompanyId) {
      const { error: logError } = await supabase
        .from('reconciliation_log')
        .insert({
          company_id: resolvedCompanyId,
          cash_movement_id: movementId,
          payable_id: payableId,
          match_type: 'unlinked',
          confidence: 0,
          match_details: { source: 'undo' },
          performed_by: performedBy,
          performed_at: now,
          notes: notes || 'Riconciliazione annullata',
          previous_payable_status: currentStatus,
          new_payable_status: restoredStatus,
        });

      if (logError) {
        console.warn('Errore log annullamento (non bloccante):', logError.message);
      }
    }

    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message };
  }
}

// ─── 4. RECONCILIATION HISTORY / LOG ──────────────────────────

/**
 * Recupera lo storico delle riconciliazioni con filtri opzionali.
 *
 * @param {string} companyId
 * @param {Object} filters
 * @param {string|null} filters.dateFrom
 * @param {string|null} filters.dateTo
 * @param {string|null} filters.matchType - 'auto_exact'|'auto_fuzzy'|'manual'|'unlinked'
 * @param {number|null} filters.minConfidence
 * @param {string|null} filters.movementId
 * @param {string|null} filters.payableId
 * @param {number} filters.limit
 * @param {number} filters.offset
 * @returns {{ data: Array, count: number, error?: string }}
 */
export async function getReconciliationLog(companyId: string, filters: { dateFrom?: string | null; dateTo?: string | null; matchType?: string | null; minConfidence?: number | null; movementId?: string | null; payableId?: string | null; limit?: number; offset?: number } = {}): Promise<{ data: Record<string, unknown>[]; count: number; error?: string }> {
  const {
    dateFrom = null,
    dateTo = null,
    matchType = null,
    minConfidence = null,
    movementId = null,
    payableId = null,
    limit = 100,
    offset = 0,
  } = filters;

  try {
    let query = supabase
      .from('reconciliation_log')
      .select(`
        *,
        cash_movements(id, date, amount, description, counterpart),
        payables(id, invoice_number, gross_amount, due_date, supplier_id,
          suppliers(ragione_sociale, name))
      `, { count: 'exact' })
      .eq('company_id', companyId)
      .order('performed_at', { ascending: false });

    if (dateFrom) query = query.gte('performed_at', dateFrom);
    if (dateTo) query = query.lte('performed_at', dateTo);
    if (matchType) query = query.eq('match_type', matchType);
    if (minConfidence != null) query = query.gte('confidence', minConfidence);
    if (movementId) query = query.eq('cash_movement_id', movementId);
    if (payableId) query = query.eq('payable_id', payableId);

    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      return { data: [], count: 0, error: error.message };
    }

    return { data: data || [], count: count || 0 };
  } catch (err: unknown) {
    return { data: [], count: 0, error: (err as Error).message };
  }
}

// ─── 5. BATCH PAYMENT RECONCILIATION ──────────────────────────

/**
 * Riconcilia un pagamento cumulativo (es. "NUM.EFFETTI: 10") con N fatture.
 * L'importo totale del movimento deve corrispondere alla somma delle fatture.
 *
 * @param {string} movementId - UUID del movimento bancario cumulativo
 * @param {string[]} payableIds - array di UUID fatture
 * @param {Object} options
 * @returns {{ success: boolean, matched: number, error?: string }}
 */
export async function applyBatchReconciliation(movementId: string, payableIds: string[], options: { performedBy?: string | null; companyId?: string | null; notes?: string } = {}): Promise<{ success: boolean; matched: number; error?: string }> {
  const { performedBy = null, companyId = null, notes = '' } = options;

  try {
    const now = new Date().toISOString();

    // Fetch movement
    const { data: movement, error: movFetchErr } = await supabase
      .from('cash_movements')
      .select('*')
      .eq('id', movementId)
      .single();

    if (movFetchErr || !movement) {
      throw new Error('Movimento non trovato');
    }

    // Fetch payables
    const { data: payables, error: payFetchErr } = await supabase
      .from('payables')
      .select('*')
      .in('id', payableIds);

    if (payFetchErr) throw new Error(`Errore caricamento fatture: ${payFetchErr.message}`);

    // Validate: sum of payables should roughly match movement amount
    const totalPayables = (payables || []).reduce((sum, p) => {
      const remaining = p.amount_remaining ?? 0
      const amt = remaining > 0 ? remaining : (p.gross_amount ?? 0);
      return sum + amt;
    }, 0);
    const absMovement = Math.abs(movement.amount);
    const batchDiff = Math.abs(absMovement - totalPayables);

    if (batchDiff > 10) {
      console.warn(
        `Batch reconciliation: differenza di ${batchDiff.toFixed(2)}€ ` +
        `(movimento: ${absMovement}, fatture: ${totalPayables})`
      );
    }

    const resolvedCompanyId = companyId || movement.company_id;
    let matched = 0;

    // Apply reconciliation to each payable
    for (const payable of (payables || [])) {
      const { error: payErr } = await supabase
        .from('payables')
        .update({
          cash_movement_id: movementId,
          payment_date: movement.date,
          status: 'pagato',
        })
        .eq('id', payable.id);

      if (payErr) {
        console.warn(`Errore aggiornamento fattura ${payable.id}:`, payErr.message);
        continue;
      }

      // Log each match
      await supabase.from('reconciliation_log').insert({
        company_id: resolvedCompanyId,
        cash_movement_id: movementId,
        payable_id: payable.id,
        match_type: 'manual',
        confidence: 100,
        match_details: {
          source: 'batch_reconciliation',
          batchSize: payableIds.length,
          totalPayables,
          movementAmount: absMovement,
          batchDiff: Math.round(batchDiff * 100) / 100,
        },
        performed_by: performedBy,
        performed_at: now,
        notes: notes || `Pagamento cumulativo — ${payableIds.length} fatture`,
      });

      matched++;
    }

    // Mark movement as reconciled
    if (matched > 0) {
      await supabase
        .from('cash_movements')
        .update({
          is_reconciled: true,
          reconciled_with: payableIds.join(','),
          reconciled_at: now,
          reconciled_by: performedBy,
        })
        .eq('id', movementId);
    }

    return { success: true, matched };
  } catch (err: unknown) {
    return { success: false, matched: 0, error: (err as Error).message };
  }
}

// ─── INTERNAL: Write a single reconciliation ──────────────────

async function writeReconciliation(movementId: string, payableId: string, companyId: string, matchType: string, score: number, details: Record<string, unknown>, performedBy: string | null): Promise<void> {
  const now = new Date().toISOString();

  // Fetch current payable status BEFORE changing it (for audit + restore)
  const { data: currentPayable } = await supabase
    .from('payables')
    .select('status')
    .eq('id', payableId)
    .single();

  const previousStatus = currentPayable?.status || 'da_pagare';

  // Update payable — save previous_status for future restore
  const { error: payError } = await supabase
    .from('payables')
    .update({
      cash_movement_id: movementId,
      payment_date: now.split('T')[0],
      status: 'pagato',
      previous_status: previousStatus,
    })
    .eq('id', payableId);

  if (payError) throw new Error(`Errore aggiornamento fattura: ${payError.message}`);

  // Update movement
  const { error: movError } = await supabase
    .from('cash_movements')
    .update({
      is_reconciled: true,
      reconciled_with: payableId,
      reconciled_at: now,
      reconciled_by: performedBy,
    })
    .eq('id', movementId);

  if (movError) throw new Error(`Errore aggiornamento movimento: ${movError.message}`);

  // Insert audit log
  const { error: logError } = await supabase
    .from('reconciliation_log')
    .insert({
      company_id: companyId,
      cash_movement_id: movementId,
      payable_id: payableId,
      match_type: matchType,
      confidence: score,
      match_details: details as Record<string, string | number | boolean | null>,
      performed_by: performedBy,
      performed_at: now,
      notes: `Riconciliazione automatica (score: ${score})`,
      previous_payable_status: previousStatus,
      new_payable_status: 'pagato',
    });

  if (logError) {
    console.warn('Errore log riconciliazione (non bloccante):', logError.message);
  }
}

// ─── AI PATTERN LEARNING ─────────────────────────────────────────

/**
 * Carica i pattern storici dalle riconciliazioni confermate.
 * Costruisce una mappa counterpart → supplier_id basata sulle conferme passate.
 * Questo permette di "imparare" dagli abbinamenti fatti dall'operatore.
 *
 * @param {string} companyId
 * @returns {{ counterpartToSupplier: Object, supplierCategories: Object }}
 */
async function loadReconciliationPatterns(companyId: string): Promise<{ counterpartToSupplier: Record<string, string>; supplierCategories: Record<string, string[]> }> {
  const counterpartToSupplier: Record<string, string> = {};
  const supplierCategories: Record<string, string[]> = {};

  try {
    // Fetch confirmed reconciliations (movements linked to payables via reconciliation_log)
    const { data: confirmed } = await supabase
      .from('reconciliation_log')
      .select(`
        cash_movement_id,
        payable_id,
        match_type,
        cash_movements(counterpart, ai_category_id),
        payables(supplier_id)
      `)
      .eq('company_id', companyId)
      .in('match_type', ['auto_exact', 'manual', 'auto_fuzzy'])
      .not('cash_movement_id', 'is', null)
      .not('payable_id', 'is', null)
      .limit(500);

    for (const entry of (confirmed || [])) {
      const counterpart = entry.cash_movements?.counterpart;
      const supplierId = entry.payables?.supplier_id;
      const aiCategoryId = entry.cash_movements?.ai_category_id;

      if (counterpart && supplierId) {
        const key = normalizeName(counterpart);
        if (key.length >= 3) {
          // Count occurrences — only keep if seen at least once
          counterpartToSupplier[key] = supplierId;
        }
      }

      // Build supplier → category map
      if (supplierId && aiCategoryId) {
        if (!supplierCategories[supplierId]) {
          supplierCategories[supplierId] = [];
        }
        if (!supplierCategories[supplierId].includes(aiCategoryId)) {
          supplierCategories[supplierId].push(aiCategoryId);
        }
      }
    }
  } catch (e: unknown) {
    console.warn('AI pattern loading error (non bloccante):', (e as Error).message);
  }

  return { counterpartToSupplier, supplierCategories };
}

// ─── HELPERS: Supplier name extraction ─────────────────────────

/**
 * Estrae il nome del fornitore dalla descrizione di un movimento MPS.
 *
 * Pattern supportati:
 *   "...A FAVORE PREVIGES SAS DI ... IBAN IT..."
 *   "...A FAVORE DI ENEL ENERGIA..."
 *   "...FAVORE DI MARIO ROSSI SRL CODICE..."
 *   "...BENEF PREVIGES SAS..."
 *
 * @param {string} description
 * @returns {string} nome estratto (uppercase, trimmed) o stringa vuota
 */
function extractSupplierName(description: string): string {
  if (!description) return '';

  const upper = description.toUpperCase();

  // Try multiple patterns in priority order
  const patterns = [
    /A FAVORE(?:\s+DI)?\s+(.+?)(?:\s+IBAN|\s+COMM\.|\s+CODICE|\s+C\.F\.|\s+P\.IVA|\s+CRO|\s+RIF\.|\s+DATA|\s+CAUS\.|\s+TRN|\s+NOSTRO|\s+VOSTRO|\s+END\.)/i,
    /FAVORE(?:\s+DI)?\s+(.+?)(?:\s+IBAN|\s+COMM\.|\s+CODICE|\s+C\.F\.)/i,
    /BENEF(?:ICIARIO)?\.?\s+(.+?)(?:\s+IBAN|\s+COMM\.|\s+CODICE|\s+C\.F\.)/i,
    /VERS(?:AMENTO)?\.?\s+A\s+(.+?)(?:\s+IBAN|\s+COMM\.|\s+CODICE)/i,
  ];

  for (const pattern of patterns) {
    const match = upper.match(pattern);
    if (match && match[1]) {
      let name = match[1].trim();
      // Clean up common suffixes that might be left
      name = name
        .replace(/\s+IT\d{2}[A-Z]\d{22,}.*$/, '') // trailing IBAN
        .replace(/\s+\d{10,}.*$/, '')              // trailing long numbers
        .replace(/\s{2,}/g, ' ')                   // collapse whitespace
        .trim();

      if (name.length >= 3) return name;
    }
  }

  return '';
}

/**
 * Determina se un movimento è un accredito POS (da saltare per il matching fornitori).
 */
function isPOSMovement(description: string | null | undefined): boolean {
  if (!description) return false;
  return POS_PATTERNS.some(p => p.test(description));
}

/**
 * Determina se un movimento è una commissione/canone bancario (non è un pagamento fornitore).
 */
function isBankFeeMovement(description: string | null | undefined): boolean {
  if (!description) return false;
  return BANK_FEE_PATTERNS.some(p => p.test(description));
}

// ─── HELPERS: Fuzzy name matching ──────────────────────────────

/**
 * Calcola un punteggio di corrispondenza tra il nome estratto dalla banca
 * e il nome del fornitore in anagrafica.
 *
 * @param {string} bankName - nome estratto dalla descrizione bancaria
 * @param {string} supplierName - ragione_sociale o name dal DB
 * @returns {number} 0-30
 */
function nameMatchScore(bankName: string, supplierName: string): number {
  if (!bankName || !supplierName) return 0;

  const normBank = normalizeName(bankName);
  const normSupplier = normalizeName(supplierName);

  if (!normBank || !normSupplier) return 0;

  // Exact substring match (either direction)
  if (normBank.includes(normSupplier) || normSupplier.includes(normBank)) {
    return NAME_EXACT;
  }

  // Word-level matching
  const bankWords = normBank.split(/\s+/).filter(w => w.length > 2);
  const supplierWords = normSupplier.split(/\s+/).filter(w => w.length > 2);

  if (bankWords.length === 0 || supplierWords.length === 0) return 0;

  // Count how many supplier words appear in bank name
  const matchedWords = supplierWords.filter(sw =>
    bankWords.some(bw => bw === sw || bw.includes(sw) || sw.includes(bw))
  );

  const matchRatio = matchedWords.length / supplierWords.length;

  // Also check reverse: bank words in supplier name
  const reverseMatched = bankWords.filter(bw =>
    supplierWords.some(sw => sw === bw || sw.includes(bw) || bw.includes(sw))
  );

  const bestRatio = Math.max(matchRatio, reverseMatched.length / bankWords.length);

  if (bestRatio >= 0.8 || matchedWords.length >= 3) return NAME_PARTIAL;
  if (matchedWords.length >= 1) return NAME_SINGLE_WORD;

  // Last resort: Levenshtein-like similarity on the full string
  const similarity = stringSimilarity(normBank, normSupplier);
  if (similarity >= 0.7) return NAME_PARTIAL;
  if (similarity >= 0.5) return NAME_SINGLE_WORD;

  return 0;
}

/**
 * Normalizza un nome: uppercase, rimuove punteggiatura, forme giuridiche comuni.
 */
function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[''`]/g, ' ')
    .replace(/[.,;:!\-\/\\()[\]{}""«»]/g, ' ')
    // Remove common legal forms
    .replace(/\b(SRL|S\.R\.L|SPA|S\.P\.A|SAS|S\.A\.S|SNC|S\.N\.C|SRLS|S\.R\.L\.S|SCARL|SOC\s*COOP|SOCIETA|DITTA|IND)\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Calcola similarità tra due stringhe (Dice coefficient sulle coppie di caratteri).
 * Veloce e sufficiente per il matching nomi fornitori.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} 0.0 - 1.0
 */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const bigram = a.substring(i, i + 2);
    bigramsA.set(bigram, (bigramsA.get(bigram) || 0) + 1);
  }

  let intersectionSize = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bigram = b.substring(i, i + 2);
    const count = bigramsA.get(bigram) || 0;
    if (count > 0) {
      bigramsA.set(bigram, count - 1);
      intersectionSize++;
    }
  }

  return (2.0 * intersectionSize) / (a.length + b.length - 2);
}

// ─── EXPORTS (named, for tree-shaking) ─────────────────────────

// Also export helpers for testing and UI usage
export { extractSupplierName, nameMatchScore, normalizeName };
