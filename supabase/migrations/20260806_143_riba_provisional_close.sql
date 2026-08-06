-- ============================================================================
-- 20260806_143_riba_provisional_close.sql
-- FASE 1 — RiBa: chiusura PROVVISORIA automatica alla scadenza
-- ----------------------------------------------------------------------------
-- Regola (Patrizio): un fornitore che paga con RICEVUTA BANCARIA (riba_*) viene
-- addebitato dalla banca alla scadenza di ogni rata, a prescindere dalla
-- divisione 30/60/90. Quindi, ALLA DATA DI SCADENZA, la scadenza si deve dare
-- per PAGATA e CHIUSA in via PROVVISORIA (non "a fiducia definitiva"): resta
-- provvisoria finche' non arriva
--   (a) l'upload/conferma di una distinta della ricevuta bancaria  (Fase 2), OPPURE
--   (b) un movimento bancario riconciliato che la conferma.
-- Se non arriva ne' l'una ne' l'altra, resta pagata di default.
--
-- Modello dati:
--   - is_provisional_paid = true  => la scadenza e' chiusa in via provvisoria.
--   - amount_paid = gross_amount, payment_date = due_date, NESSUN movimento
--     bancario (come una chiusura a mano: la prima nota NON viene toccata).
--   - Il trigger update_payable_status porta di conseguenza status='pagato'.
--   - Appena un bank_transaction_id viene agganciato (riconciliazione reale),
--     il flag is_provisional_paid si azzera da solo => diventa PAGATO definitivo.
--
-- Ambito (decisione Patrizio 2026-08-06):
--   - AUTOMATICO solo per scadenze con due_date >= data di attivazione
--     (2026-08-06): l'automatismo vale d'ora in poi, sulle scadenze future.
--   - Lo STORICO gia' scaduto (due_date < 2026-08-06) NON viene toccato in
--     automatico: si chiude in blocco solo su richiesta esplicita via
--     rpc_riba_provisional_close_backlog() (pulsante dedicato, reversibile).
--
--   Le NOTE DI CREDITO (gross_amount < 0 / status nota_credito) sono ESCLUSE:
--   per i fornitori RiBa vanno abbinate a mano (Fase 3), mai compensate qui.
--
-- Additiva, idempotente, non distruttiva. Applicare su NZ + Made + Zago.
-- ============================================================================

BEGIN;

-- 1) Colonne di stato provvisorio -------------------------------------------
ALTER TABLE public.payables
  ADD COLUMN IF NOT EXISTS is_provisional_paid boolean NOT NULL DEFAULT false;
ALTER TABLE public.payables
  ADD COLUMN IF NOT EXISTS provisional_paid_at timestamptz;

COMMENT ON COLUMN public.payables.is_provisional_paid IS
  'RiBa chiusa in via provvisoria alla scadenza (in attesa di distinta o movimento bancario). Si azzera quando si aggancia un movimento reale.';

-- Indice parziale: le provvisorie sono un sottoinsieme piccolo, spesso filtrato.
CREATE INDEX IF NOT EXISTS idx_payables_provisional_paid
  ON public.payables (company_id) WHERE is_provisional_paid = true;

-- 2) update_payable_status: un movimento agganciato conferma la provvisoria ---
--    (ridefinizione identica alla versione corrente + azzeramento del flag)
CREATE OR REPLACE FUNCTION public.update_payable_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.original_due_date := NEW.due_date;
  END IF;

  NEW.amount_remaining := NEW.gross_amount - COALESCE(NEW.amount_paid, 0);

  -- Un movimento bancario agganciato conferma DEFINITIVAMENTE una RiBa
  -- provvisoria: da qui in poi non e' piu' "provvisoria".
  IF NEW.bank_transaction_id IS NOT NULL AND COALESCE(NEW.is_provisional_paid, false) THEN
    NEW.is_provisional_paid := false;
  END IF;

  IF NEW.status = 'nota_credito' THEN
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  IF NEW.status IN ('sospeso', 'annullato', 'bloccato') THEN
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  IF NEW.status = 'rimandato' AND NEW.postponed_to IS NOT NULL THEN
    NEW.due_date := NEW.postponed_to;
    NEW.status := 'da_pagare';
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  IF NEW.amount_remaining <= 0 THEN
    NEW.status := 'pagato';
  ELSIF COALESCE(NEW.amount_paid, 0) > 0 AND NEW.amount_remaining > 0 THEN
    NEW.status := 'parziale';
  ELSIF COALESCE(NEW.is_auto_debit, false) THEN
    IF NEW.due_date <= CURRENT_DATE + 7 THEN
      NEW.status := 'in_scadenza';
    ELSE
      NEW.status := 'da_pagare';
    END IF;
  ELSIF NEW.due_date < CURRENT_DATE THEN
    NEW.status := 'scaduto';
  ELSIF NEW.due_date <= CURRENT_DATE + 7 THEN
    NEW.status := 'in_scadenza';
  ELSE
    NEW.status := 'da_pagare';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$;

-- 3) Worker: chiude in via provvisoria le RiBa scadute -----------------------
--    p_include_backlog = false  => solo due_date >= data attivazione (futuro)
--    p_include_backlog = true   => include anche lo storico gia' scaduto
CREATE OR REPLACE FUNCTION public.fn_riba_provisional_close(
  p_company_id uuid DEFAULT NULL,
  p_include_backlog boolean DEFAULT false
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_activation CONSTANT date := DATE '2026-08-06';
  v_count integer := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.id, p.gross_amount, p.due_date, p.status
    FROM public.payables p
    LEFT JOIN public.suppliers s ON s.id = p.supplier_id
    WHERE (p_company_id IS NULL OR p.company_id = p_company_id)
      -- RiBa dalla fattura o, in mancanza, dal piano del fornitore
      AND COALESCE(p.payment_method::text, s.payment_method::text, s.default_payment_method::text) LIKE 'riba%'
      AND p.gross_amount > 0                       -- esclude le note di credito
      AND COALESCE(p.is_placeholder, false) = false
      AND COALESCE(p.is_provisional_paid, false) = false
      AND COALESCE(p.closed_manually, false) = false
      AND p.bank_transaction_id IS NULL            -- non gia' riconciliata
      AND p.status IN ('da_pagare', 'in_scadenza', 'scaduto')  -- solo aperte, non parziali
      AND p.due_date <= CURRENT_DATE
      AND (p_include_backlog OR p.due_date >= v_activation)
  LOOP
    UPDATE public.payables
    SET amount_paid = gross_amount,
        payment_date = r.due_date,
        is_provisional_paid = true,
        provisional_paid_at = now()
    WHERE id = r.id;

    INSERT INTO public.payable_actions
      (payable_id, action_type, old_status, new_status, amount, note, performed_at)
    VALUES
      (r.id, 'chiusura_provvisoria_riba', r.status, 'pagato'::payable_status, r.gross_amount,
       'Chiusura provvisoria RiBa alla scadenza ' || to_char(r.due_date, 'DD/MM/YYYY')
         || ' (in attesa di distinta o movimento bancario)', now());

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- 4) Wrapper per il cron notturno (solo futuro, tutte le aziende del tenant) --
CREATE OR REPLACE FUNCTION public.rerun_riba_provisional_close()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n integer;
BEGIN
  v_n := public.fn_riba_provisional_close(NULL, false);
  RETURN jsonb_build_object('riba_provisional_closed', v_n, 'run_at', now());
END;
$function$;

-- 5) RPC storico: chiude in blocco lo storico RiBa gia' scaduto (reversibile) -
CREATE OR REPLACE FUNCTION public.rpc_riba_provisional_close_backlog()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid;
  v_role text;
  v_n integer;
BEGIN
  SELECT company_id, role INTO v_company, v_role
  FROM public.user_profiles WHERE id = auth.uid();

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Company non determinata per l''utente corrente';
  END IF;
  IF COALESCE(v_role, '') NOT IN ('super_advisor', 'contabile') THEN
    RAISE EXCEPTION 'Non autorizzato: serve il ruolo contabile o super_advisor';
  END IF;

  v_n := public.fn_riba_provisional_close(v_company, true);
  RETURN jsonb_build_object('riba_provisional_closed', v_n, 'company_id', v_company, 'run_at', now());
END;
$function$;

-- 6) RPC undo: riapre una singola RiBa chiusa in via provvisoria --------------
CREATE OR REPLACE FUNCTION public.rpc_riba_provisional_undo(p_payable_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid;
  v_role text;
  v_pay RECORD;
BEGIN
  SELECT company_id, role INTO v_company, v_role
  FROM public.user_profiles WHERE id = auth.uid();

  IF COALESCE(v_role, '') NOT IN ('super_advisor', 'contabile') THEN
    RAISE EXCEPTION 'Non autorizzato: serve il ruolo contabile o super_advisor';
  END IF;

  SELECT * INTO v_pay FROM public.payables
  WHERE id = p_payable_id AND company_id = v_company;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scadenza non trovata o non accessibile';
  END IF;
  IF NOT COALESCE(v_pay.is_provisional_paid, false) THEN
    RAISE EXCEPTION 'La scadenza non e'' una RiBa provvisoria';
  END IF;

  UPDATE public.payables
  SET amount_paid = 0,
      payment_date = NULL,
      is_provisional_paid = false,
      provisional_paid_at = NULL
  WHERE id = p_payable_id;   -- il trigger ricalcola status (scaduto/da_pagare)

  INSERT INTO public.payable_actions
    (payable_id, action_type, amount, note, performed_at)
  VALUES
    (p_payable_id, 'annulla_chiusura_provvisoria_riba', v_pay.gross_amount,
     'Riapertura scadenza RiBa provvisoria', now());

  RETURN jsonb_build_object('ok', true, 'payable_id', p_payable_id);
END;
$function$;

-- 7) Aggancio al cron notturno di riconciliazione (05:45) --------------------
--    La chiusura provvisoria gira PER ULTIMA: prima la riconciliazione reale
--    ha la precedenza (se un movimento gia' esiste, meglio agganciarlo).
CREATE OR REPLACE FUNCTION public.run_daily_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_group jsonb;
  v_bij jsonb;
  v_amt jsonb;
  v_close jsonb;
  v_util jsonb;
  v_riba jsonb;
BEGIN
  v_group := public.rerun_group_reconciliation();
  v_bij := public.rerun_bijective_reconciliation();
  v_amt := public.rerun_amount_reconciliation();
  v_close := public.close_non_supplier_movements();
  v_util := public.close_utility_movements();
  v_riba := public.rerun_riba_provisional_close();
  RETURN jsonb_build_object('granitici', v_group, 'biettivo', v_bij, 'importo_anonimo', v_amt,
                            'chiusi_non_fornitore', v_close, 'chiusi_utenze', v_util,
                            'riba_provvisorie', v_riba, 'run_at', now());
END;
$function$;

-- 8) Grants: solo gli RPC scoping-caller sono esposti al frontend -------------
REVOKE ALL ON FUNCTION public.fn_riba_provisional_close(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_riba_provisional_close_backlog() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_riba_provisional_undo(uuid) TO authenticated;

COMMIT;

-- ============================================================================
-- VERIFICA (eseguire dopo l'apply su ciascun tenant)
-- ============================================================================
-- Quante RiBa aperte diventerebbero provvisorie in AUTOMATICO (solo futuro):
--   SELECT count(*) FROM public.payables p
--   LEFT JOIN public.suppliers s ON s.id = p.supplier_id
--   WHERE COALESCE(p.payment_method::text, s.payment_method::text, s.default_payment_method::text) LIKE 'riba%'
--     AND p.gross_amount > 0 AND COALESCE(p.is_placeholder,false)=false
--     AND COALESCE(p.closed_manually,false)=false AND p.bank_transaction_id IS NULL
--     AND p.status IN ('da_pagare','in_scadenza','scaduto')
--     AND p.due_date <= CURRENT_DATE AND p.due_date >= DATE '2026-08-06';
-- Storico escluso dall'automatico (backlog, due_date < 2026-08-06): stessa query con < '2026-08-06'.
-- Colonne presenti: SELECT is_provisional_paid, provisional_paid_at FROM public.payables LIMIT 0;
