-- ROLLBACK migrazione 119 — ripristina close_utility_movements alla versione 118
-- (match a sottostringa via supplier_confirmed_in_text) e rimuove l'helper stretto.
-- NB: la versione 118 over-matcha (vedi 119). Usare solo per tornare esattamente
-- allo stato pre-119; di norma NON serve.

CREATE OR REPLACE FUNCTION public.close_utility_movements()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n INT;
BEGIN
  WITH upd AS (
    UPDATE public.bank_transactions bt
    SET is_reconciled = true,
        reconciled_at = now(),
        category = COALESCE(bt.category, 'utenze'),
        note = COALESCE(bt.note || ' | ', '') || 'chiuso automaticamente (utenza — addebito permanente)'
    WHERE bt.amount < 0
      AND COALESCE(bt.is_reconciled, false) = false
      AND bt.status IN ('posted', 'booked')
      AND NOT EXISTS (
        SELECT 1 FROM public.reconciliation_log rl
        WHERE rl.bank_transaction_id = bt.id AND rl.status IN ('applied', 'to_confirm'))
      AND EXISTS (
        SELECT 1 FROM public.suppliers s
        WHERE s.company_id = bt.company_id
          AND COALESCE(s.is_utility, false) = true
          AND public.supplier_confirmed_in_text(
                s.name, COALESCE(s.vat_number, s.partita_iva),
                coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '')))
    RETURNING bt.id
  )
  SELECT count(*) INTO v_n FROM upd;
  RETURN jsonb_build_object('chiusi_utenze', v_n);
END;
$function$;

DROP FUNCTION IF EXISTS public.supplier_confirmed_in_text_strict(text, text, text);
