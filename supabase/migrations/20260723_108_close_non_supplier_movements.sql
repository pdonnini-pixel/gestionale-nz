-- =====================================================================
-- Migrazione 108 — Chiusura movimenti NON-fornitore (costi banca, tasse, stipendi)
-- =====================================================================
-- CONTESTO (Patrizio): molti movimenti in uscita non sono pagamenti a fornitore e
-- non avranno mai una fattura: commissioni/oneri banca, carte/POS/prelievi,
-- giroconti, F24/imposte, stipendi (emolumenti). Vanno "chiusi" (tolti da "da
-- riconciliare"), non lasciati in sospeso.
--
-- close_non_supplier_movements(): marca is_reconciled=true (come il tasto "Ignora")
-- SOLO i movimenti che corrispondono a un allowlist PRUDENTE di causali chiaramente
-- non-fornitore, e imposta la categoria. Reversibile (is_reconciled=false).
--
-- ESCLUSIONI di sicurezza — NON tocca (restano per l'abbinamento a fattura):
--   • "A FAVORE …" (bonifici a fornitore)
--   • "EFFETTI RITIRATI" (RiBa: pagamenti a fornitore)
--   • "RIMBORSO FINANZIAMENTI / MUTUI / PRESTITI" (sezione Finanziamenti)
--   • "ASSEGNO" (assegni, spesso a fornitore)
--
-- Aggiunta a run_daily_reconciliation così i nuovi costi banca si chiudono da soli.
-- ⚠️ REGOLA #0 — NZ + Made + Zago.
-- =====================================================================

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

REVOKE EXECUTE ON FUNCTION public.close_non_supplier_movements() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_non_supplier_movements() TO authenticated, service_role;

-- La giornaliera chiude anche i costi non-fornitore.
CREATE OR REPLACE FUNCTION public.run_daily_reconciliation()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_group jsonb; v_bij jsonb; v_close jsonb;
BEGIN
  v_group := public.rerun_group_reconciliation();
  v_bij := public.rerun_bijective_reconciliation();
  v_close := public.close_non_supplier_movements();
  RETURN jsonb_build_object('granitici', v_group, 'biettivo', v_bij, 'chiusi_non_fornitore', v_close, 'run_at', now());
END;
$function$;
