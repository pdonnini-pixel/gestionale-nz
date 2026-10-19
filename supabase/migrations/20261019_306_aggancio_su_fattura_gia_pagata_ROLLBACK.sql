-- ============================================================================
-- ROLLBACK della 306 — aggancio su fattura già pagata
-- ============================================================================
-- Riporta le due funzioni al comportamento di prima, con la stessa tecnica della
-- patch (si legge la definizione viva, non si riscrive il testo intero).
--
-- La colonna `linked_only` NON viene eliminata: un DROP COLUMN su una tabella
-- viva ricade sotto la regola NO DATA LOSS, e una colonna in più non fa danno.
-- Se la si volesse togliere davvero, serve la conferma binaria di Patrizio e il
-- comando va dato a mano (in fondo al file, commentato).
--
-- ATTENZIONE: dopo questo rollback, annullare una riga di solo aggancio torna a
-- sottrarre applied_amount da amount_paid, cioè a riaprire una fattura pagata.
-- È il difetto che la 306 chiude: ripristinarlo si fa solo con una ragione.
-- ============================================================================

BEGIN;

-- 1. reconcile_movement: il ramo «solo aggancio» torna alle sole fatture senza movimento
DO $rb_reconcile$
DECLARE
  v_src text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'reconcile_movement'
     AND pg_get_function_identity_arguments(p.oid) = 'p_bt_id uuid, p_payable_id uuid, p_log_id uuid';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'reconcile_movement non trovata';
  END IF;

  v_new := replace(v_src,
    'IF v_pay.status = ''pagato'' THEN',
    'IF v_pay.status = ''pagato'' AND v_pay.bank_transaction_id IS NULL THEN');
  v_new := replace(v_new,
    'UPDATE public.payables SET bank_transaction_id = COALESCE(bank_transaction_id, p_bt_id), updated_at = now() WHERE id = p_payable_id;',
    'UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = p_payable_id;');
  v_new := replace(v_new,
    'applied_amount = abs(v_bt.amount), linked_only = true, confirmed_at = now()',
    'applied_amount = abs(v_bt.amount), confirmed_at = now()');
  v_new := replace(v_new,
    'status, applied_amount, linked_only, notes)',
    'status, applied_amount, notes)');
  v_new := replace(v_new,
    '''applied'', abs(v_bt.amount), true,',
    '''applied'', abs(v_bt.amount),');

  EXECUTE v_new;
  RAISE NOTICE 'reconcile_movement riportata al comportamento pre-306';
END
$rb_reconcile$;

-- 2. undo_reconcile_movement: via il ramo che rispetta linked_only
DO $rb_undo$
DECLARE
  v_src text;
  v_new text;
  v_inizio int;
  v_fine int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'undo_reconcile_movement';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'undo_reconcile_movement non trovata';
  END IF;

  IF v_src NOT LIKE '%COALESCE(v_log.linked_only, false)%' THEN
    RAISE NOTICE 'undo_reconcile_movement non porta la patch 306: niente da fare';
    RETURN;
  END IF;

  v_inizio := position('  IF COALESCE(v_log.linked_only, false) THEN' in v_src);
  v_fine := position('  v_new_paid := GREATEST(0' in v_src);
  IF v_inizio = 0 OR v_fine = 0 OR v_fine <= v_inizio THEN
    RAISE EXCEPTION 'non riesco a delimitare il ramo da togliere: fermarsi e rileggere la funzione viva';
  END IF;

  -- si toglie il blocco, lasciando intatto tutto quello che viene dopo
  v_new := substring(v_src from 1 for v_inizio - 1) || substring(v_src from v_fine);

  IF v_new NOT LIKE '%payable_credit_note_links%'
     OR v_new NOT LIKE '%GREATEST(0, COALESCE(v_pay.amount_paid%' THEN
    RAISE EXCEPTION 'il rollback avrebbe perso dei rami: annullato';
  END IF;

  EXECUTE v_new;
  RAISE NOTICE 'undo_reconcile_movement riportata al comportamento pre-306';
END
$rb_undo$;

COMMIT;

-- La colonna resta. Per toglierla davvero, SOLO con conferma binaria di Patrizio:
--   ALTER TABLE public.reconciliation_log DROP COLUMN linked_only;
