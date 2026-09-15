-- =====================================================================
-- Migrazione 109 — Chiusura automatica scadenze fiscali PAGATE (anche a gruppi)
-- =====================================================================
-- REGOLA (Patrizio): una scadenza fiscale/paga può essere saldata da PIÙ movimenti
-- individuali — es. la 14ª mensilità pagata ai singoli dipendenti (N disposizioni
-- EMOLUMENTI che sommano all'importo), o F24 cumulativi. Nel verificare se una
-- scadenza è pagata bisogna cercare anche il GRUPPO di movimenti che somma
-- all'importo, non solo il bonifico unico.
--
-- close_paid_fiscal_deadlines(): per ogni scadenza fiscale PENDING e già scaduta
-- (due_date <= oggi), la marca 'paid' se trova il pagamento in banca:
--   (a) un singolo movimento di importo ~ = scadenza (tol 0,5% / 2 cent) entro
--       ±10 giorni dalla scadenza; oppure
--   (b) per le scadenze di natura RETRIBUTIVA (14ª/13ª/stipendi/emolumenti/"altro"),
--       la SOMMA delle disposizioni EMOLUMENTI su una stessa data entro ±3 giorni
--       che coincide con l'importo (tol 1%). Copre il pagamento ai singoli dipendenti.
-- Non tocca le scadenze FUTURE. Reversibile (status → 'pending'). Aggiunta al cron.
--
-- ⚠️ REGOLA #0 — NZ + Made + Zago.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.close_paid_fiscal_deadlines()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  fd RECORD; v_date DATE; v_grp RECORD; v_closed INT := 0; v_is_payroll BOOLEAN;
BEGIN
  FOR fd IN
    SELECT * FROM public.fiscal_deadlines
    WHERE status = 'pending' AND COALESCE(amount,0) > 0 AND due_date IS NOT NULL AND due_date <= current_date
  LOOP
    -- (a) singolo movimento di importo ~ = scadenza, vicino alla data
    SELECT bt.transaction_date INTO v_date
    FROM public.bank_transactions bt
    WHERE bt.company_id = fd.company_id AND bt.amount < 0
      AND abs(abs(bt.amount) - fd.amount) <= GREATEST(0.02, fd.amount * 0.005)
      AND bt.transaction_date BETWEEN fd.due_date - 10 AND fd.due_date + 10
    ORDER BY abs(bt.transaction_date - fd.due_date)
    LIMIT 1;

    IF FOUND THEN
      UPDATE public.fiscal_deadlines
      SET status = 'paid', amount_paid = amount, paid_date = v_date,
          notes = COALESCE(notes || ' | ', '') || 'chiusa auto: pagamento singolo riscontrato in banca',
          updated_at = now()
      WHERE id = fd.id;
      v_closed := v_closed + 1;
      CONTINUE;
    END IF;

    -- (b) gruppo: scadenze retributive pagate ai singoli dipendenti (EMOLUMENTI che sommano)
    v_is_payroll := lower(coalesce(fd.title, '') || ' ' || coalesce(fd.deadline_type, ''))
                    ~ '(mensilit|stipend|emolument|tredic|quattordic|retribuz|\y13\y|\y14\y|altro)';
    IF v_is_payroll THEN
      SELECT t.d AS d, t.s AS s INTO v_grp
      FROM (
        SELECT bt.transaction_date AS d, sum(abs(bt.amount)) AS s
        FROM public.bank_transactions bt
        WHERE bt.company_id = fd.company_id AND bt.amount < 0
          AND upper(coalesce(bt.description, '')) ~ '(EMOLUMENTI|STIPEND)'
          AND bt.transaction_date BETWEEN fd.due_date - 3 AND fd.due_date + 3
        GROUP BY bt.transaction_date
      ) t
      WHERE abs(t.s - fd.amount) <= GREATEST(1, fd.amount * 0.01)
      ORDER BY abs(t.s - fd.amount)
      LIMIT 1;

      IF FOUND THEN
        UPDATE public.fiscal_deadlines
        SET status = 'paid', amount_paid = amount, paid_date = v_grp.d,
            notes = COALESCE(notes || ' | ', '') || 'chiusa auto: pagata ai singoli dipendenti (somma EMOLUMENTI ' || round(v_grp.s, 2) || ')',
            updated_at = now()
        WHERE id = fd.id;
        v_closed := v_closed + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('scadenze_chiuse', v_closed);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.close_paid_fiscal_deadlines() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_paid_fiscal_deadlines() TO authenticated, service_role;

-- La giornaliera chiude anche le scadenze fiscali pagate.
CREATE OR REPLACE FUNCTION public.run_daily_reconciliation()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_group jsonb; v_bij jsonb; v_close jsonb; v_fisc jsonb;
BEGIN
  v_group := public.rerun_group_reconciliation();
  v_bij := public.rerun_bijective_reconciliation();
  v_close := public.close_non_supplier_movements();
  v_fisc := public.close_paid_fiscal_deadlines();
  RETURN jsonb_build_object('granitici', v_group, 'biettivo', v_bij,
                            'chiusi_non_fornitore', v_close, 'scadenze_fiscali', v_fisc, 'run_at', now());
END;
$function$;
