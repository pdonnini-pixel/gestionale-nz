-- =============================================================================
-- Scadenze fiscali: aggancio al movimento bancario
-- =============================================================================
--
-- PROBLEMA. Le scadenze fiscali (F24, IVA, IRES/IRAP, TARI, diritti camerali) vivono
-- su fiscal_deadlines, che non ha alcun riferimento al movimento bancario. Il motore
-- di riconciliazione lavora solo su payables, quindi ogni F24 pagato lascia dietro di
-- se' un addebito orfano: si puo' segnare la scadenza come pagata, ma il movimento
-- resta li' non riconciliato per sempre.
--
-- Non sono spiccioli. Su NZ, al 03/09/2026: IVA di luglio 39.063,80 addebitata il
-- 20/08 su MPS e IRES/IRAP rata 2/5 da 9.165,00 addebitata lo stesso giorno su BCC
-- Figline, entrambe orfane.
--
-- SOLUZIONE. Colonna additiva bank_transaction_id su fiscal_deadlines, piu' due RPC
-- simmetriche a quelle dei payables: reconcile_fiscal_deadline e il suo undo.
-- Nessun dato toccato, nessuna colonna rimossa.
-- =============================================================================

BEGIN;

ALTER TABLE public.fiscal_deadlines
  ADD COLUMN IF NOT EXISTS bank_transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.fiscal_deadlines.bank_transaction_id IS
  'Movimento bancario che ha pagato questa scadenza fiscale. Simmetrico a payables.bank_transaction_id: chiude il cerchio fra scadenzario fiscale e prima nota.';

CREATE INDEX IF NOT EXISTS idx_fiscal_deadlines_bank_transaction
  ON public.fiscal_deadlines (bank_transaction_id)
  WHERE bank_transaction_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Aggancio di un movimento a una scadenza fiscale
-- -----------------------------------------------------------------------------
-- Chiude la scadenza (status 'paid', paid_date = data del movimento) e marca il
-- movimento come riconciliato. reconciled_invoice_id resta NULL: quel campo punta a
-- payables e una scadenza fiscale non e' una fattura fornitore.
CREATE OR REPLACE FUNCTION public.reconcile_fiscal_deadline(p_bt_id uuid, p_fiscal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD;
  v_fd RECORD;
  v_caller uuid;
BEGIN
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id;
  IF v_bt IS NULL THEN
    RAISE EXCEPTION 'Movimento bancario non trovato';
  END IF;

  SELECT * INTO v_fd FROM public.fiscal_deadlines WHERE id = p_fiscal_id;
  IF v_fd IS NULL THEN
    RAISE EXCEPTION 'Scadenza fiscale non trovata';
  END IF;

  IF v_bt.company_id IS DISTINCT FROM v_fd.company_id THEN
    RAISE EXCEPTION 'Movimento e scadenza appartengono ad aziende diverse';
  END IF;

  -- Isolamento tenant: un utente autenticato opera solo sulla propria azienda.
  -- Il cron e il service_role (auth.uid() NULL) passano.
  v_caller := auth.uid();
  IF v_caller IS NOT NULL AND public.get_my_company_id() IS DISTINCT FROM v_fd.company_id THEN
    RAISE EXCEPTION 'Operazione non consentita su un''altra azienda';
  END IF;

  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'stale');
  END IF;

  IF v_fd.bank_transaction_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_linked');
  END IF;

  UPDATE public.fiscal_deadlines
  SET bank_transaction_id = p_bt_id,
      status = 'paid',
      paid_date = COALESCE(paid_date, v_bt.transaction_date),
      amount_paid = COALESCE(amount_paid, amount),
      updated_at = now()
  WHERE id = p_fiscal_id;

  UPDATE public.bank_transactions
  SET is_reconciled = true, reconciled_at = now()
  WHERE id = p_bt_id;

  RETURN jsonb_build_object('ok', true, 'fiscal_deadline_id', p_fiscal_id,
                            'bank_transaction_id', p_bt_id, 'amount', v_fd.amount);
END;
$function$;

COMMENT ON FUNCTION public.reconcile_fiscal_deadline(uuid, uuid) IS
  'Aggancia un movimento bancario a una scadenza fiscale (F24, IVA, IRES/IRAP, TARI): chiude la scadenza e marca il movimento riconciliato.';

-- -----------------------------------------------------------------------------
-- Annullamento (reversibile, come per le fatture)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.undo_reconcile_fiscal_deadline(p_fiscal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_fd RECORD;
  v_caller uuid;
BEGIN
  SELECT * INTO v_fd FROM public.fiscal_deadlines WHERE id = p_fiscal_id;
  IF v_fd IS NULL OR v_fd.bank_transaction_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_applicable');
  END IF;

  v_caller := auth.uid();
  IF v_caller IS NOT NULL AND public.get_my_company_id() IS DISTINCT FROM v_fd.company_id THEN
    RAISE EXCEPTION 'Operazione non consentita su un''altra azienda';
  END IF;

  UPDATE public.bank_transactions
  SET is_reconciled = false, reconciled_at = NULL
  WHERE id = v_fd.bank_transaction_id;

  UPDATE public.fiscal_deadlines
  SET bank_transaction_id = NULL, updated_at = now()
  WHERE id = p_fiscal_id;

  RETURN jsonb_build_object('ok', true, 'fiscal_deadline_id', p_fiscal_id);
END;
$function$;

COMMENT ON FUNCTION public.undo_reconcile_fiscal_deadline(uuid) IS
  'Annulla l''aggancio fra scadenza fiscale e movimento bancario. Non riapre la scadenza: lo stato pagato resta, si stacca solo il movimento.';

REVOKE ALL ON FUNCTION public.reconcile_fiscal_deadline(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.undo_reconcile_fiscal_deadline(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_fiscal_deadline(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.undo_reconcile_fiscal_deadline(uuid) TO authenticated, service_role;

COMMIT;
