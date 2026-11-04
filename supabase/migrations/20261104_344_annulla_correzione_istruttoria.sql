-- 20261104_344_annulla_correzione_istruttoria.sql
--
-- Ogni cosa che il gestionale scrive da sé si deve poter annullare, e la mail
-- di esito lo promette: «se una correzione non è giusta, apri la giornata e
-- annullala». Qui c'è la funzione che lo fa, con i valori di prima presi da
-- closing_checks.undo_data.
--
-- Chi può: super_advisor e contabile. Il negozio no: la correzione riguarda
-- una giornata già confermata.
--
-- Due tipi di annullo:
--   'fields'      rimette il totale corrispettivi e la riga dei contanti
--                 com'erano (annullo in contanti del registratore);
--   'expense_row' toglie la riga di spesa che il gestionale ha aggiunto
--                 (fattura pagata in contanti e non scritta).
--
-- Sul DELETE della riga aggiunta: è una riga scritta dal gestionale, non da
-- una persona, l'utente sta chiedendo esplicitamente di toglierla, e in
-- undo_data resta scritto cosa c'era (importo e descrizione), quindi si può
-- rifare. La segnalazione torna «da fare» invece di sparire.

BEGIN;

CREATE OR REPLACE FUNCTION public.undo_closing_check(p_check_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c          record;
  v_role     text;
  v_company  uuid;
  v_line     uuid;
  v_amount   numeric;
  v_descr    text;
  v_deleted  integer := 0;
BEGIN
  v_role := (SELECT get_my_role());
  v_company := (SELECT get_my_company_id());
  IF v_role NOT IN ('super_advisor', 'contabile') THEN
    RAISE EXCEPTION 'Serve il ruolo super advisor o contabile per annullare una correzione';
  END IF;

  SELECT * INTO c FROM public.closing_checks WHERE id = p_check_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Segnalazione non trovata'; END IF;
  IF c.undone_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'gia_annullata'); END IF;
  IF c.outcome <> 'sistemato' OR c.undo_kind IS NULL THEN
    RETURN jsonb_build_object('status', 'niente_da_annullare');
  END IF;

  IF c.undo_kind = 'fields' THEN
    v_line := NULLIF(c.undo_data->>'line_id', '')::uuid;
    IF v_line IS NOT NULL THEN
      UPDATE public.outlet_daily_closing_lines
         SET amount = (c.undo_data->>'line_amount')::numeric
       WHERE id = v_line;
    END IF;
    IF c.undo_data ? 'total_receipts' THEN
      UPDATE public.outlet_daily_closings
         SET total_receipts = (c.undo_data->>'total_receipts')::numeric
       WHERE id = c.closing_id;
    END IF;

  ELSIF c.undo_kind = 'expense_row' THEN
    v_amount := (c.undo_data->>'amount')::numeric;
    v_descr  := c.undo_data->>'description';
    DELETE FROM public.outlet_daily_closing_expenses
     WHERE closing_id = c.closing_id
       AND kind = 'pagamento_fattura'
       AND amount = v_amount
       AND coalesce(description, '') = coalesce(v_descr, '');
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  UPDATE public.closing_checks
     SET undone_at = now(), undone_by = (SELECT auth.uid()),
         outcome = 'da_fare', resolved_at = NULL,
         action = coalesce(action, '') || ' [annullata il ' || to_char(now(), 'DD/MM/YYYY') || ']',
         updated_at = now()
   WHERE id = p_check_id;

  RETURN jsonb_build_object('status', 'annullata', 'undo_kind', c.undo_kind, 'righe_togliate', v_deleted);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.undo_closing_check(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.undo_closing_check(uuid) IS
  'Annulla una correzione fatta dall''istruttoria dei controlli, rimettendo i valori di prima (closing_checks.undo_data). Solo super_advisor e contabile. La segnalazione torna «da fare». Migrazione 344.';

COMMIT;

-- Verifica, su ogni tenant:
-- SELECT has_function_privilege('authenticated', 'public.undo_closing_check(uuid)', 'execute');
