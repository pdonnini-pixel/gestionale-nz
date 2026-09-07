-- 20260907_200 — fix: cash_bank_monthly_summary() andava in errore
-- "aggregate functions are not allowed in GROUP BY" (SQLSTATE 42803).
--
-- Sintomo: in Incassi giornalieri, aprendo la tab "Banca", la RPC
-- cash_bank_monthly_summary() falliva e il pannello mostrava il messaggio
-- di errore Postgres al posto dei controlli del mese.
--
-- Causa: nel terzo blocco (accrediti non abbinati) la sottoquery ha UNA sola
-- colonna in output (il jsonb_build_object, alias x) ma raggruppava con
-- "GROUP BY 1, 2, 3". Le posizioni numeriche si riferiscono alle colonne
-- della SELECT, non agli argomenti di jsonb_build_object: la posizione 1 e'
-- quindi x, che contiene count(*) e sum(), da cui l'errore. Essendo dentro
-- una funzione plpgsql l'errore non emerge alla creazione ma solo a runtime.
--
-- Fix: le tre chiavi di raggruppamento (codice terminale, circuito, data di
-- riferimento) vengono calcolate in una sottoquery e il GROUP BY le nomina
-- esplicitamente. Nessuna modifica ai dati e nessun cambio di risultato
-- atteso: e' la stessa aggregazione che il codice intendeva fare.
--
-- Tabelle coinvolte: nessuna scrittura. Solo CREATE OR REPLACE FUNCTION.

CREATE OR REPLACE FUNCTION public.cash_bank_monthly_summary(p_year integer, p_month integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_from date := make_date(p_year, p_month, 1);
  v_to   date := (make_date(p_year, p_month, 1) + interval '1 month')::date;
  v_channels jsonb; v_outlets jsonb; v_unmatched jsonb;
BEGIN
  IF COALESCE(public.get_my_role()::text, '') NOT IN ('super_advisor', 'contabile') THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'outlet_name', x->>'label'), '[]'::jsonb) INTO v_channels
  FROM (
    SELECT jsonb_build_object(
      'channel_id', ch.id, 'label', ch.label, 'kind', ch.kind, 'terminal_code', ch.terminal_code,
      'outlet_id', ch.outlet_id, 'outlet_name', o.name,
      'declared', COALESCE(sum(l.amount), 0),
      'credited', COALESCE(sum(l.bank_amount), 0),
      'days', count(l.id) FILTER (WHERE l.amount > 0),
      'accreditato', count(l.id) FILTER (WHERE l.amount > 0 AND l.bank_status = 'accreditato'),
      'differenza', count(l.id) FILTER (WHERE l.amount > 0 AND l.bank_status = 'differenza'),
      'mancante', count(l.id) FILTER (WHERE l.amount > 0 AND l.bank_status = 'mancante'),
      'in_attesa', count(l.id) FILTER (WHERE l.amount > 0 AND l.bank_status = 'in_attesa'),
      'non_verificabile', count(l.id) FILTER (WHERE l.amount > 0 AND l.bank_status = 'non_verificabile')
    ) AS x
    FROM public.outlet_payment_channels ch
    JOIN public.outlets o ON o.id = ch.outlet_id
    LEFT JOIN public.outlet_daily_closing_lines l ON l.channel_id = ch.id
    LEFT JOIN public.outlet_daily_closings c ON c.id = l.closing_id AND c.closing_date >= v_from AND c.closing_date < v_to AND c.status IN ('confermata', 'verificata')
    WHERE ch.company_id = v_company AND ch.is_active AND ch.kind IN ('pos', 'pos_amex')
      AND (l.id IS NULL OR c.id IS NOT NULL)
    GROUP BY ch.id, ch.label, ch.kind, ch.terminal_code, ch.outlet_id, o.name
  ) q;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'outlet_name'), '[]'::jsonb) INTO v_outlets
  FROM (
    SELECT jsonb_build_object(
      'outlet_id', o.id, 'outlet_name', o.name,
      'closings', count(c.id),
      'verified', count(c.id) FILTER (WHERE c.status = 'verificata'),
      'cash_in', COALESCE((SELECT sum(l.amount) FROM public.outlet_daily_closing_lines l JOIN public.outlet_payment_channels ch ON ch.id = l.channel_id
                             WHERE l.closing_id IN (SELECT id FROM public.outlet_daily_closings cc WHERE cc.outlet_id = o.id AND cc.closing_date >= v_from AND cc.closing_date < v_to AND cc.status IN ('confermata','verificata'))
                               AND ch.kind = 'contanti'), 0),
      'expenses', COALESCE(sum(c.cash_expenses + c.customer_refunds), 0),
      'deposits_declared', COALESCE(sum(c.cash_deposit), 0),
      'deposits_found', COALESCE(sum(c.deposit_bank_amount) FILTER (WHERE c.deposit_bank_status = 'accreditato'), 0),
      'deposits_missing', count(c.id) FILTER (WHERE c.cash_deposit > 0 AND c.deposit_bank_status = 'mancante'),
      'deposits_pending', count(c.id) FILTER (WHERE c.cash_deposit > 0 AND c.deposit_bank_status = 'in_attesa'),
      'float_start', (SELECT COALESCE(cc.cash_float_expected - (SELECT sum(l2.amount) FROM public.outlet_daily_closing_lines l2 JOIN public.outlet_payment_channels ch2 ON ch2.id = l2.channel_id WHERE l2.closing_id = cc.id AND ch2.kind = 'contanti') + cc.cash_expenses + cc.customer_refunds + cc.cash_deposit, cc.cash_float_opening)
                        FROM public.outlet_daily_closings cc WHERE cc.outlet_id = o.id AND cc.closing_date >= v_from AND cc.closing_date < v_to AND cc.status IN ('confermata','verificata') ORDER BY cc.closing_date LIMIT 1),
      'float_end', (SELECT cc.cash_float_declared FROM public.outlet_daily_closings cc WHERE cc.outlet_id = o.id AND cc.closing_date >= v_from AND cc.closing_date < v_to AND cc.status IN ('confermata','verificata') ORDER BY cc.closing_date DESC LIMIT 1)
    ) AS x
    FROM public.outlets o
    LEFT JOIN public.outlet_daily_closings c ON c.outlet_id = o.id AND c.closing_date >= v_from AND c.closing_date < v_to AND c.status IN ('confermata', 'verificata')
    WHERE o.company_id = v_company AND COALESCE(o.is_active, true)
      AND lower(COALESCE(o.outlet_type, 'outlet')) NOT IN ('sede', 'magazzino', 'warehouse', 'hq', 'ufficio')
    GROUP BY o.id, o.name
  ) q;

  -- Accrediti POS/Amex del mese senza abbinamento: le chiavi di raggruppamento
  -- sono calcolate una volta sola in tx e nominate esplicitamente nel GROUP BY.
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'circuit', x->>'code', x->>'ref_date'), '[]'::jsonb) INTO v_unmatched
  FROM (
    SELECT jsonb_build_object(
      'code', tx.code, 'circuit', tx.circuit, 'ref_date', tx.ref_date,
      'n', count(*), 'total', round(sum(tx.amount), 2),
      'mapped', EXISTS (SELECT 1 FROM public.outlet_payment_channels ch WHERE ch.company_id = v_company AND ch.is_active
                          AND public.cash_bank_norm_code(ch.terminal_code) = tx.code
                          AND ch.kind = CASE WHEN tx.circuit = 'amex' THEN 'pos_amex' ELSE 'pos' END)
    ) AS x
    FROM (
      SELECT public.cash_bank_terminal_code(bt.description) AS code,
             public.cash_bank_circuit(bt.description)       AS circuit,
             public.cash_bank_ref_date(bt.description)      AS ref_date,
             bt.amount
        FROM public.bank_transactions bt
       WHERE bt.company_id = v_company AND bt.amount > 0
         AND public.cash_bank_terminal_code(bt.description) IS NOT NULL
         AND public.cash_bank_ref_date(bt.description) >= v_from
         AND public.cash_bank_ref_date(bt.description) < v_to
         AND NOT EXISTS (SELECT 1 FROM public.closing_bank_matches m WHERE m.bank_transaction_id = bt.id)
    ) tx
    GROUP BY tx.code, tx.circuit, tx.ref_date
  ) q;

  RETURN jsonb_build_object('year', p_year, 'month', p_month, 'channels', v_channels, 'outlets', v_outlets, 'unmatched', v_unmatched);
END;
$$;
REVOKE ALL ON FUNCTION public.cash_bank_monthly_summary(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_bank_monthly_summary(integer, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- Verifica (su ogni tenant): non deve piu' sollevare 42803.
-- ---------------------------------------------------------------------
-- SELECT public.cash_bank_monthly_summary(2026, 9);
