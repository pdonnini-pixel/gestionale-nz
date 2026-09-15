-- =====================================================================
-- ROLLBACK Migrazione 112
-- =====================================================================
-- ⚠️ SCONSIGLIATO: ripristina le versioni PRECEDENTI di
-- try_match_amount_bank_transaction (110, tolleranza 0,3% -> falsi positivi) e di
-- close_non_supplier_movements (108, chiude i bonifici con "IMPORTO COMMISSIONI").
-- Reintroduce i bug corretti dalla 112. Gli UNDO/riaperture di dati fatti dalla 112
-- NON vengono ripristinati (non è data loss: il motore li ri-deriva). Usare solo se
-- strettamente necessario.
-- ⚠️ REGOLA #0 — NZ + Made + Zago.
-- =====================================================================

-- close_non_supplier_movements torna alla 108 (senza esclusione IMPORTO BONIFICI).
CREATE OR REPLACE FUNCTION public.close_non_supplier_movements()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n INT;
BEGIN
  WITH cand AS (
    SELECT bt.id, upper(coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '')) AS d
    FROM public.bank_transactions bt
    WHERE bt.amount < 0 AND COALESCE(bt.is_reconciled, false) = false AND bt.status IN ('posted', 'booked')
  ),
  match AS (
    SELECT id, d,
      CASE
        WHEN d ~ '(EMOLUMENTI|STIPEND|\ySALARI|RETRIBUZ|BUSTA PAGA)' THEN 'stipendi'
        WHEN d ~ '(\yF24\y|DELEGA UNIFICATA|\yDELEGHE\y|IMPOSTE E TASSE|IMPOSTE/TASSE|\yIRPEF\y|\yINPS\y|\yIRAP\y|RITENUT|\yTRIBUT|DIRITTO CAMERALE|\yTARI\y|CBILL|PAGOPA)' THEN 'tasse'
        WHEN d ~ '(PAG\.?POS|\yCARTA\y|MASTERCARD|\yVISA\y|\yBANCOMAT\y|PRELIEV)' THEN 'carte'
        WHEN d ~ '(GIROCONTO|GIROFONDI|\yTRASFERIMENTO\y)' THEN 'giroconti'
        WHEN d ~ '(COMMISSION|\yONERI\y|COMPETENZE|\yBOLLO\y|INTERESS|PAGOBANCOMAT)' THEN 'spese_banca'
        ELSE NULL
      END AS categoria
    FROM cand
    WHERE d !~ '(A FAVORE|EFFETTI RITIRAT|RIMBORSO FINANZIAMENT|\yMUTU|PRESTIT|\yASSEGNO)'
  ),
  upd AS (
    UPDATE public.bank_transactions bt
    SET is_reconciled = true, reconciled_at = now(), category = m.categoria,
        note = COALESCE(bt.note || ' | ', '') || 'chiuso automaticamente (non-fornitore: ' || m.categoria || ')'
    FROM match m
    WHERE m.id = bt.id AND m.categoria IS NOT NULL
    RETURNING bt.id
  )
  SELECT count(*) INTO v_n FROM upd;
  RETURN jsonb_build_object('chiusi', v_n);
END;
$function$;

-- NB: try_match_amount_bank_transaction e run_daily_reconciliation restano nella
-- versione 112 (corretta). Per ripristinare integralmente la 110 riapplicare la 110.
