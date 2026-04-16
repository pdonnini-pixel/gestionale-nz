/**
 * Reconciliation Engine — Motore di riconciliazione automatica
 *
 * Abbina i movimenti bancari in uscita (cash_movements.type = 'uscita')
 * con le fatture fornitori (payables) usando un algoritmo a punteggio:
 *   - Importo (max 50 punti)
 *   - Nome fornitore estratto dalla descrizione bancaria (max 30 punti)
 *   - Prossimità data scadenza (max 20 punti)
 *
 * Soglie:
 *   >= 80  → auto_exact  (riconciliazione automatica)
 *   >= 50  → auto_fuzzy  (proposta, richiede conferma)
 *   <  50  → nessun match
 *
 * Ogni azione viene tracciata in reconciliation_log per audit trail.
 */

import { supabase } from './supabase';

// ─── CONSTANTS ─────────────────────────────────────────────────

const THRESHOLD_AUTO = 80;
const THRESHOLD_SUGGEST = 50;

const AMOUNT_EXACT = 50;
const AMOUNT_WITHIN_2 = 40;
const AMOUNT_WITHIN_5 = 30;
const AMOUNT_WITHIN_10 = 20;

const NAME_EXACT = 30;
const NAME_PARTIAL = 20;
const NAME_SINGLE_WORD = 10;

const DATE_WITHIN_7 = 20;
const DATE_WITHIN_30 = 15;
const DATE_WITHIN_60 = 10;
const DATE_WITHIN_90 = 5;

// Patterns that indicate incoming POS payments — skip for payable matching
const POS_PATTERNS = [
  /ACCREDITO POS/i,
  /INCASSO POS/i,
  /POS.*NEXI/i,
  /ACCREDITO CARTE/i,
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
export async function runAutoReconciliation(companyId, bankAccountId = null, options = {}) {
  const { dryRun = false, dateFrom = null, dateTo = null, performedBy = null } = options;
  const errors = [];
  const reconciled = [];
  const suggested = [];
  const unmatched = [];

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

    const supplierMap = {};
    for (const s of (suppliers || [])) {
      supplierMap[s.id] = s;
    }

    // ── Filter out POS incoming movements ──
    const outflowMovements = (movements || []).filter(m => !isPOSMovement(m.description));

    // Track which payables have been matched (1-to-1)
    const matchedPayableIds = new Set();

    // ── Run matching for each movement ──
    for (const movement of outflowMovements) {
      const absAmount = Math.abs(movement.amount);
      const bankSupplierName = extractSupplierName(movement.description || '');
      const movementDate = movement.date ? new Date(movement.date) : null;

      let bestMatch = null;
      let bestScore = 0;
      let bestDetails = {};

      for (const payable of (payables || [])) {
        if (matchedPayableIds.has(payable.id)) continue;

        const supplier = payable.suppliers || supplierMap[payable.supplier_id] || {};
        const payableAmount = payable.amount_remaining != null && payable.amount_remaining > 0
          ? payable.amount_remaining
          : payable.gross_amount;

        // ── Score: Amount ──
        const amountDiff = Math.abs(absAmount - payableAmount);
        let amountScore = 0;
        if (amountDiff < 0.01) amountScore = AMOUNT_EXACT;
        else if (amountDiff <= 2) amountScore = AMOUNT_WITHIN_2;
        else if (amountDiff <= 5) amountScore = AMOUNT_WITHIN_5;
        else if (amountDiff <= 10) amountScore = AMOUNT_WITHIN_10;

        // Skip if amount is way off (no point computing name/date)
        if (amountScore === 0 && amountDiff > 50) continue;

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
          const daysDiff = Math.abs(Math.round((movementDate - dueDate) / (1000 * 60 * 60 * 24)));
          if (daysDiff <= 7) dateScore = DATE_WITHIN_7;
          else if (daysDiff <= 30) dateScore = DATE_WITHIN_30;
          else if (daysDiff <= 60) dateScore = DATE_WITHIN_60;
          else if (daysDiff <= 90) dateScore = DATE_WITHIN_90;
        }

        const totalScore = amountScore + nameScore + dateScore;

        if (totalScore > bestScore) {
          bestScore = totalScore;
          bestMatch = payable;
          bestDetails = {
            amountScore,
            nameScore,
            dateScore,
            amountDiff: Math.round(amountDiff * 100) / 100,
            bankSupplierName: bankSupplierName || null,
            matchedSupplierName: matchedName || null,
            movementAmount: absAmount,
            payableAmount,
            daysDiff: movementDate && dueDate
              ? Math.abs(Math.round((movementDate - dueDate) / (1000 * 60 * 60 * 24)))
              : null,
          };
        }
      }

      if (bestMatch && bestScore >= THRESHOLD_AUTO) {
        // ── Auto reconciliation ──
        const matchType = 'auto_exact';
        matchedPayableIds.add(bestMatch.id);

        if (!dryRun) {
          try {
            await writeReconciliation(movement.id, bestMatch.id, companyId, matchType, bestScore, bestDetails, performedBy);
            reconciled.push({
              movement,
              payable: bestMatch,
              score: bestScore,
              matchType,
              details: bestDetails,
            });
          } catch (err) {
            errors.push({
              message: `Errore riconciliazione mov ${movement.id}: ${err.message}`,
              movementId: movement.id,
              payableId: bestMatch.id,
            });
          }
        } else {
          reconciled.push({
            movement,
            payable: bestMatch,
            score: bestScore,
            matchType,
            details: bestDetails,
          });
        }
      } else if (bestMatch && bestScore >= THRESHOLD_SUGGEST) {
        // ── Suggestion (needs manual confirmation) ──
        if (!dryRun) {
          // Log the suggestion but don't apply it
          try {
            await supabase.from('reconciliation_log').insert({
              company_id: companyId,
              cash_movement_id: movement.id,
              payable_id: bestMatch.id,
              match_type: 'auto_fuzzy',
              confidence: bestScore,
              match_details: bestDetails,
              performed_by: performedBy,
              performed_at: new Date().toISOString(),
              notes: 'Proposta automatica — in attesa di conferma',
            });
          } catch (err) {
            errors.push({ message: `Errore log suggerimento: ${err.message}` });
          }
        }

        suggested.push({
          movement,
          payable: bestMatch,
          score: bestScore,
          matchType: 'auto_fuzzy',
          details: bestDetails,
        });
      } else {
        // ── No match ──
        unmatched.push({
          movement,
          bestScore,
          bestDetails: bestMatch ? bestDetails : null,
          bestCandidate: bestMatch || null,
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
  } catch (err) {
    errors.push({ message: `Errore imprevisto: ${err.message}` });
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
export async function applyReconciliation(movementId, payableId, matchType = 'manual', notes = '', options = {}) {
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
      resolvedCompanyId = mov?.company_id;
    }

    // ── Update payable: link to movement ──
    const { error: payError } = await supabase
      .from('payables')
      .update({
        cash_movement_id: movementId,
        payment_date: now.split('T')[0],
        status: 'pagato',
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
      });

    if (logError) {
      console.warn('Errore log riconciliazione (non bloccante):', logError.message);
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
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
export async function undoReconciliation(movementId, payableId, options = {}) {
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
      resolvedCompanyId = mov?.company_id;
    }

    // ── Clear payable link ──
    const { error: payError } = await supabase
      .from('payables')
      .update({
        cash_movement_id: null,
        payment_date: null,
        status: 'da_pagare',
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
      });

    if (logError) {
      console.warn('Errore log annullamento (non bloccante):', logError.message);
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
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
export async function getReconciliationLog(companyId, filters = {}) {
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
  } catch (err) {
    return { data: [], count: 0, error: err.message };
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
export async function applyBatchReconciliation(movementId, payableIds, options = {}) {
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
      const amt = p.amount_remaining > 0 ? p.amount_remaining : p.gross_amount;
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
  } catch (err) {
    return { success: false, matched: 0, error: err.message };
  }
}

// ─── INTERNAL: Write a single reconciliation ──────────────────

async function writeReconciliation(movementId, payableId, companyId, matchType, score, details, performedBy) {
  const now = new Date().toISOString();

  // Update payable
  const { error: payError } = await supabase
    .from('payables')
    .update({
      cash_movement_id: movementId,
      payment_date: now.split('T')[0],
      status: 'pagato',
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
      match_details: details,
      performed_by: performedBy,
      performed_at: now,
      notes: `Riconciliazione automatica (score: ${score})`,
    });

  if (logError) {
    console.warn('Errore log riconciliazione (non bloccante):', logError.message);
  }
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
function extractSupplierName(description) {
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
function isPOSMovement(description) {
  if (!description) return false;
  return POS_PATTERNS.some(p => p.test(description));
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
function nameMatchScore(bankName, supplierName) {
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
function normalizeName(name) {
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
function stringSimilarity(a, b) {
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
