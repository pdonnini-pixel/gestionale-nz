-- 20260909_194 — Chiusura provvisoria alla scadenza per contanti, carta di credito e carta di debito.
--
-- Perché: questi tre metodi non lasciano in banca un movimento riconducibile alla singola
-- fattura. I contanti non passano dal conto; la carta di credito produce un unico addebito
-- mensile cumulativo; la carta di debito genera un pagamento POS che spesso nomina
-- l'esercente e non il fornitore fatturato. Risultato: le scadenze restavano aperte per
-- sempre anche a pagamento avvenuto (al 09/09/2026 su NZ: 30 scadenze per 1.678 €).
--
-- Come: la stessa meccanica già in uso per le RiBa (fn_riba_provisional_close, migr. 146).
-- Alla scadenza la scadenza si chiude in via PROVVISORIA (is_provisional_paid = true),
-- resta marcata "Pagato (provvisorio)" in UI e NON è una chiusura manuale: quando il
-- movimento arriva davvero — da A-Cube oppure da un estratto conto caricato a mano — il
-- trigger update_payable_status azzera is_provisional_paid e la chiusura diventa definitiva
-- con la sua prova bancaria. Reversibile con reopen_payable.
--
-- Additiva: due funzioni nuove più il cron notturno che le richiama. Nessun dato cancellato.
-- Rollback in 20260909_194_chiusura_provvisoria_contanti_carte_ROLLBACK.sql

CREATE OR REPLACE FUNCTION public.fn_cash_card_provisional_close(
  p_company_id uuid DEFAULT NULL::uuid,
  p_include_backlog boolean DEFAULT false
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  -- Prima di questa data si chiude solo su richiesta esplicita (p_include_backlog),
  -- così l'automatico non tocca a sorpresa lo storico di un tenant.
  v_activation CONSTANT date := DATE '2026-09-09';
  v_count integer := 0;
  v_metodo text;
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.id, p.gross_amount, p.due_date, p.status,
           COALESCE(p.payment_method::text, s.payment_method::text, s.default_payment_method::text) AS metodo
    FROM public.payables p
    LEFT JOIN public.suppliers s ON s.id = p.supplier_id
    WHERE (p_company_id IS NULL OR p.company_id = p_company_id)
      AND COALESCE(p.payment_method::text, s.payment_method::text, s.default_payment_method::text)
          IN ('contanti', 'carta_credito', 'carta_debito')
      AND p.gross_amount > 0
      AND COALESCE(p.is_placeholder, false) = false
      AND COALESCE(p.is_provisional_paid, false) = false
      AND COALESCE(p.closed_manually, false) = false
      AND p.bank_transaction_id IS NULL
      AND p.status IN ('da_pagare', 'in_scadenza', 'scaduto')
      AND p.due_date <= CURRENT_DATE
      AND (p_include_backlog OR p.due_date >= v_activation)
  LOOP
    UPDATE public.payables
    SET amount_paid = gross_amount,
        payment_date = r.due_date,
        is_provisional_paid = true,
        provisional_paid_at = now()
    WHERE id = r.id;

    v_metodo := CASE r.metodo
                  WHEN 'contanti' THEN 'in contanti'
                  WHEN 'carta_credito' THEN 'con carta di credito'
                  ELSE 'con carta di debito'
                END;

    INSERT INTO public.payable_actions
      (payable_id, action_type, old_status, new_status, amount, note, performed_at)
    VALUES
      (r.id, 'chiusura_provvisoria_cassa_carte', r.status, 'pagato'::payable_status, r.gross_amount,
       'Chiusura provvisoria (pagamento ' || v_metodo || ') alla scadenza '
         || to_char(r.due_date, 'DD/MM/YYYY')
         || ' — in attesa del movimento, da A-Cube o da estratto conto caricato', now());

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_cash_card_provisional_close(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_cash_card_provisional_close(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_cash_card_provisional_close(uuid, boolean) TO authenticated, service_role;

-- Giro quotidiano su tutte le aziende (lo richiama il cron notturno).
CREATE OR REPLACE FUNCTION public.rerun_cash_card_provisional_close()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE v_n integer;
BEGIN
  v_n := public.fn_cash_card_provisional_close(NULL, false);
  RETURN jsonb_build_object('cash_card_provisional_closed', v_n, 'run_at', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.rerun_cash_card_provisional_close() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rerun_cash_card_provisional_close() FROM anon;
GRANT EXECUTE ON FUNCTION public.rerun_cash_card_provisional_close() TO authenticated, service_role;

-- Recupero dello storico già scaduto, dalla UI, riservato a contabile / super_advisor.
CREATE OR REPLACE FUNCTION public.rpc_cash_card_provisional_close_backlog()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
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

  v_n := public.fn_cash_card_provisional_close(v_company, true);
  RETURN jsonb_build_object('cash_card_provisional_closed', v_n, 'company_id', v_company, 'run_at', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_cash_card_provisional_close_backlog() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_cash_card_provisional_close_backlog() FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_cash_card_provisional_close_backlog() TO authenticated, service_role;

-- Il giro notturno chiama anche la nuova chiusura, accanto a quella delle RiBa.
CREATE OR REPLACE FUNCTION public.run_daily_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_disp jsonb;
  v_group jsonb;
  v_bij jsonb;
  v_amt jsonb;
  v_close jsonb;
  v_util jsonb;
  v_riba jsonb;
  v_cash jsonb;
  v_t0 timestamptz := clock_timestamp();
BEGIN
  -- Il job notturno puo' durare piu' dei 2 minuti di default: qui il tempo serve.
  SET LOCAL statement_timeout = '20min';

  v_disp := public.rerun_distinta_reconciliation();
  v_group := public.rerun_group_reconciliation();
  v_bij := public.rerun_bijective_reconciliation();
  v_amt := public.rerun_amount_reconciliation();
  v_close := public.close_non_supplier_movements();
  v_util := public.close_utility_movements();
  v_riba := public.rerun_riba_provisional_close();
  v_cash := public.rerun_cash_card_provisional_close();

  RETURN jsonb_build_object('distinte', v_disp, 'granitici', v_group, 'biettivo', v_bij,
                            'importo_anonimo', v_amt, 'chiusi_non_fornitore', v_close,
                            'chiusi_utenze', v_util, 'riba_provvisorie', v_riba,
                            'contanti_carte_provvisorie', v_cash,
                            'run_at', now(),
                            'durata_sec', round(extract(epoch from (clock_timestamp() - v_t0))::numeric, 1));
END;
$function$;

REVOKE ALL ON FUNCTION public.run_daily_reconciliation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_daily_reconciliation() FROM anon;
GRANT EXECUTE ON FUNCTION public.run_daily_reconciliation() TO authenticated, service_role;
