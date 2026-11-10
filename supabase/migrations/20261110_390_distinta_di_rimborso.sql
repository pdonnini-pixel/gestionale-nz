-- 390 — Distinta di rimborso: fatture anticipate da una persona
--
-- Caso (Sabrina, 02/11 e 09/11/2026): fatture intestate all'azienda ma pagate di
-- tasca propria da un dipendente (trasferte del magazziniere, piccoli acquisti).
-- Il rimborso è UN bonifico alla persona, che chiude N fatture di fornitori
-- diversi. Fino a oggi la distinta aveva come beneficiario il fornitore e
-- l'aggancio chiudeva una fattura per movimento: quelle fatture restavano aperte
-- (o in attesa di un estratto carta che non le avrebbe mai contenute).
--
-- Cosa fa:
--  1. payable_reimbursements: chi viene rimborsato (nome, IBAN), leggibile solo dai
--     profili amministrativi e non modificabile. payable_actions.rimborso_group_id
--     lega le disposizioni alla distinta. Solo aggiunte, nessun dato toccato.
--  2. try_match_rimborso_bank_transaction: un movimento in uscita pari alla SOMMA
--     di una distinta di rimborso chiude tutte le sue fatture. Applica solo se la
--     distinta candidata è una sola e il nome della persona è nella causale.
--  3. payable_in_distinta_for_movement: le disposizioni di rimborso non valgono
--     come conferma del beneficiario per gli agganci a fattura singola (il
--     beneficiario è la persona, non il fornitore).
--  4. trigger sui movimenti e giro notturno: provano prima la distinta di rimborso.
--  5. chiusura provvisoria di carte e contanti: salta le fatture in distinta di
--     rimborso (non sono uscite dalla carta aziendale).
--
-- Tenant: NZ + Zago (regola del 03/11/2026: Made non riceve più migration).

-- ── 1. Chi viene rimborsato: tabella a parte, solo profili amministrativi ──
-- Nome e IBAN sono dati di una persona fisica: non stanno su payable_actions,
-- che ogni profilo dell'azienda può leggere. Qui legge solo l'amministrazione,
-- scrivono contabile e super advisor, e una riga salvata non si modifica né si
-- cancella (nessuna policy di UPDATE o DELETE): resta chi l'ha creata e quando.
CREATE TABLE IF NOT EXISTS public.payable_reimbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  beneficiary_name text NOT NULL CHECK (length(btrim(beneficiary_name)) BETWEEN 3 AND 120),
  beneficiary_iban text NOT NULL CHECK (beneficiary_iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  bank_account_id uuid REFERENCES public.bank_accounts(id),
  total_amount numeric(14,2) NOT NULL CHECK (total_amount > 0),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payable_reimbursements IS
  'Distinte di rimborso (migration 390): una riga per ogni bonifico a una persona che ha anticipato fatture intestate all''azienda. Le fatture stanno in payable_actions.rimborso_group_id.';

ALTER TABLE public.payable_reimbursements ENABLE ROW LEVEL SECURITY;

-- Policy create solo se mancano (migration rieseguibile senza cancellare niente).
DO $pol$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'payable_reimbursements' AND policyname = 'payable_reimbursements_select') THEN
    CREATE POLICY payable_reimbursements_select ON public.payable_reimbursements
      FOR SELECT TO authenticated
      USING (
        company_id = (SELECT get_my_company_id())
        AND (SELECT get_my_role())::text IN ('super_advisor', 'contabile', 'ceo', 'cfo', 'coo')
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'payable_reimbursements' AND policyname = 'payable_reimbursements_insert') THEN
    CREATE POLICY payable_reimbursements_insert ON public.payable_reimbursements
      FOR INSERT TO authenticated
      WITH CHECK (
        company_id = (SELECT get_my_company_id())
        AND (SELECT get_my_role())::text IN ('super_advisor', 'contabile')
        AND created_by IS NOT DISTINCT FROM (SELECT auth.uid())
      );
  END IF;
END;
$pol$;

-- Solo lettura e inserimento: una distinta di rimborso salvata non si tocca più.
REVOKE ALL ON public.payable_reimbursements FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.payable_reimbursements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payable_reimbursements TO service_role;

-- La disposizione porta solo il legame con la distinta di rimborso.
ALTER TABLE public.payable_actions
  ADD COLUMN IF NOT EXISTS rimborso_group_id uuid REFERENCES public.payable_reimbursements(id);

COMMENT ON COLUMN public.payable_actions.rimborso_group_id IS
  'Distinta di rimborso (migration 390): le disposizioni con lo stesso valore sono pagate con UN bonifico alla persona che ha anticipato le fatture (payable_reimbursements). NULL = disposizione normale al fornitore.';

CREATE INDEX IF NOT EXISTS idx_payable_actions_rimborso_group
  ON public.payable_actions (rimborso_group_id)
  WHERE rimborso_group_id IS NOT NULL;

-- ── 2. L'aggancio: un bonifico, tutte le fatture della distinta ───────────
CREATE OR REPLACE FUNCTION public.try_match_rimborso_bank_transaction(p_bt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD; v_mov NUMERIC; v_net NUMERIC;
  v_n INT := 0; v_gid uuid; v_tot NUMERIC; v_nome text; v_iban_mov text; v_testo text;
  v_chiuse INT;
  r RECORD; v_applied NUMERIC; v_first uuid := NULL; v_linked INT := 0;
BEGIN
  PERFORM public.ruoli_operativi_non_qui(); -- migration 380
  PERFORM public.richiedi_profilo_gestionale(); -- migration 364
  -- Il movimento si blocca per tutta l'operazione: trigger d'importazione e giro
  -- notturno non possono lavorarlo insieme.
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bt_id FOR UPDATE;
  IF v_bt IS NULL OR v_bt.amount >= 0 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'not_negative_or_missing');
  END IF;
  IF COALESCE(v_bt.is_reconciled, false) THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'already_reconciled');
  END IF;

  v_mov := abs(v_bt.amount);
  v_net := public.bank_movement_net(v_bt.description);
  -- CHI è il beneficiario lo deve dire il movimento. Misura del 10/11/2026 su NZ:
  -- nei bonifici in uscita degli ultimi 90 giorni l'IBAN della controparte non è mai
  -- valorizzato (0 su 337), il nome sta sempre nella causale. Quindi: il nome della
  -- persona deve comparire nel testo del movimento (due parole, o l'unica se è una).
  v_testo := upper(translate(
    COALESCE(v_bt.description, '') || ' ' || COALESCE(v_bt.counterpart_name, '') || ' ' || COALESCE(v_bt.counterpart, ''),
    'àáâäèéêëìíîïòóôöùúûüÀÁÂÄÈÉÊËÌÍÎÏÒÓÔÖÙÚÛÜ''', 'aaaaeeeeiiiioooouuuuAAAAEEEEIIIIOOOOUUUU '));
  -- Se la banca dice a quale IBAN è andato il bonifico, deve essere quello della persona.
  v_iban_mov := NULLIF(upper(regexp_replace(COALESCE(v_bt.counterpart_iban, ''), '[^0-9A-Za-z]', '', 'g')), '');

  -- Distinte di rimborso disposte su questa banca in questi giorni (stessa finestra
  -- delle distinte normali: -3/+20), ancora tutte aperte, con somma pari al movimento.
  WITH righe AS (
    SELECT a.rimborso_group_id AS gid, a.payable_id,
           sum(a.amount) AS importo,
           max(pr.beneficiary_name) AS nome
    FROM public.payable_actions a
    JOIN public.payables p ON p.id = a.payable_id
    JOIN public.payable_reimbursements pr ON pr.id = a.rimborso_group_id
    WHERE a.action_type = 'disposizione'
      AND COALESCE(a.amount, 0) > 0
      AND p.company_id = v_bt.company_id
      AND pr.company_id = v_bt.company_id
      AND (v_iban_mov IS NULL OR v_iban_mov = pr.beneficiary_iban)
      AND (
        SELECT count(*) FILTER (WHERE position(w in v_testo) > 0) >= LEAST(2, count(*)) AND count(*) > 0
        FROM (
          SELECT DISTINCT w FROM regexp_split_to_table(upper(translate(pr.beneficiary_name,
            'àáâäèéêëìíîïòóôöùúûüÀÁÂÄÈÉÊËÌÍÎÏÒÓÔÖÙÚÛÜ''', 'aaaaeeeeiiiioooouuuuAAAAEEEEIIIIOOOOUUUU ')), '[^A-Z]+') AS w
          WHERE length(w) >= 3
        ) parole
      )
      AND (v_bt.bank_account_id IS NULL OR a.bank_account_id IS NULL
           OR a.bank_account_id = v_bt.bank_account_id)
      AND v_bt.transaction_date BETWEEN (a.performed_at::date - 3) AND (a.performed_at::date + 20)
    GROUP BY a.rimborso_group_id, a.payable_id
  ), gruppi AS (
    SELECT g.gid, sum(g.importo) AS totale, max(g.nome) AS nome,
           bool_and(
             p.bank_transaction_id IS NULL
             AND p.gross_amount > 0
             AND COALESCE(p.is_placeholder, false) = false
             AND COALESCE(p.closed_manually, false) = false
             AND p.status IN ('da_pagare', 'in_scadenza', 'scaduto', 'parziale')
             AND COALESCE(p.amount_remaining, p.gross_amount - COALESCE(p.amount_paid, 0), p.gross_amount) >= g.importo - 0.005
           ) AS tutte_aperte
    FROM righe g
    JOIN public.payables p ON p.id = g.payable_id
    GROUP BY g.gid
  )
  SELECT count(*), (array_agg(gid))[1], (array_agg(totale))[1], (array_agg(nome))[1]
    INTO v_n, v_gid, v_tot, v_nome
  FROM gruppi
  WHERE tutte_aperte
    AND (
      abs(totale - v_mov) <= 0.02
      OR (v_net IS NOT NULL AND abs(totale - v_net) <= 0.02)
      OR (v_mov > totale AND (v_mov - totale) <= LEAST(5.00, GREATEST(0.50, totale * 0.002)))
    );

  IF COALESCE(v_n, 0) <> 1 THEN
    RETURN jsonb_build_object('matched', false, 'reason',
      CASE WHEN COALESCE(v_n, 0) = 0 THEN 'no_rimborso_group' ELSE 'ambiguous_rimborso_group' END,
      'gruppi', COALESCE(v_n, 0));
  END IF;

  -- Due movimenti dello stesso importo non chiudono la stessa distinta: la distinta si
  -- blocca e si ricontrolla che le sue fatture siano ancora tutte senza movimento.
  PERFORM 1 FROM public.payable_reimbursements WHERE id = v_gid FOR UPDATE;
  SELECT count(*) INTO v_chiuse
  FROM public.payable_actions a
  JOIN public.payables p ON p.id = a.payable_id
  WHERE a.action_type = 'disposizione' AND a.rimborso_group_id = v_gid
    AND p.bank_transaction_id IS NOT NULL;
  IF v_chiuse > 0 THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'rimborso_group_already_closed');
  END IF;

  FOR r IN
    SELECT a.payable_id, sum(a.amount) AS importo
    FROM public.payable_actions a
    JOIN public.payables p ON p.id = a.payable_id
    WHERE a.action_type = 'disposizione'
      AND a.rimborso_group_id = v_gid
      AND COALESCE(a.amount, 0) > 0
      AND p.company_id = v_bt.company_id
    GROUP BY a.payable_id, p.invoice_date
    ORDER BY p.invoice_date, a.payable_id
  LOOP
    SELECT LEAST(r.importo, COALESCE(p.amount_remaining, p.gross_amount - COALESCE(p.amount_paid, 0), p.gross_amount))
      INTO v_applied
    FROM public.payables p WHERE p.id = r.payable_id;

    UPDATE public.payables
    SET amount_paid = COALESCE(amount_paid, 0) + v_applied,
        payment_date = v_bt.transaction_date,
        bank_transaction_id = p_bt_id,
        updated_at = now()
    WHERE id = r.payable_id AND bank_transaction_id IS NULL;

    INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id,
      match_type, confidence, status, applied_amount, notes)
    VALUES (v_bt.company_id, p_bt_id, r.payable_id, 'auto_exact', 95, 'applied', v_applied,
      'auto (distinta di rimborso' || COALESCE(' a ' || NULLIF(btrim(v_nome), ''), '')
      || '): un bonifico alla persona che ha anticipato, somma delle fatture della distinta'
      || CASE WHEN v_iban_mov IS NULL THEN ' (nome del beneficiario trovato nella causale)'
              ELSE ' (nome nella causale e IBAN uguale a quello della distinta)' END);

    IF v_first IS NULL THEN v_first := r.payable_id; END IF;
    v_linked := v_linked + 1;
  END LOOP;

  UPDATE public.bank_transactions
  SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_first
  WHERE id = p_bt_id;

  RETURN jsonb_build_object('matched', true, 'auto', true, 'rimborso', true,
                            'rimborso_group_id', v_gid, 'linked', v_linked,
                            'totale', v_tot, 'movimento', v_mov);
END;
$function$;

-- La chiamano solo il trigger e il giro notturno (che girano come proprietario):
-- dall'API non serve a nessuno.
REVOKE ALL ON FUNCTION public.try_match_rimborso_bank_transaction(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_match_rimborso_bank_transaction(uuid) TO service_role;

-- ── 3. Il rimborso non conferma il fornitore come beneficiario ────────────
CREATE OR REPLACE FUNCTION public.payable_in_distinta_for_movement(p_payable_id uuid, p_bank_account_id uuid, p_date date)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.payable_actions a
    WHERE a.payable_id = p_payable_id
      AND a.action_type = 'disposizione'
      AND a.rimborso_group_id IS NULL -- migration 390: il rimborso va alla persona, non al fornitore
      AND (
        p_bank_account_id IS NULL
        OR a.bank_account_id IS NULL
        OR a.bank_account_id = p_bank_account_id
      )
      AND p_date BETWEEN (a.performed_at::date - 3) AND (a.performed_at::date + 20)
  );
$function$;

-- ── 4a. Trigger sui movimenti: prima la distinta di rimborso ──────────────
CREATE OR REPLACE FUNCTION public.trg_auto_reconcile_bank_transaction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE v_res jsonb;
BEGIN
  IF NEW.status IN ('posted', 'booked') AND NEW.amount < 0 THEN
    v_res := public.try_match_rimborso_bank_transaction(NEW.id); -- migration 390
    IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
      v_res := public.try_match_distinta_bank_transaction(NEW.id);
      IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
        v_res := public.try_match_group_bank_transaction(NEW.id);
        IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
          v_res := public.try_match_group_numbers_bank_transaction(NEW.id);
          IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
            v_res := public.try_match_bank_transaction(NEW.id);
            IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
              PERFORM public.try_match_amount_bank_transaction(NEW.id);
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 4b. Giro notturno: prima la distinta di rimborso ──────────────────────
CREATE OR REPLACE FUNCTION public.rerun_distinta_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_bt RECORD;
  v_res jsonb;
  v_matched INT := 0;
  v_seen INT := 0;
BEGIN
  PERFORM public.ruoli_operativi_non_qui(); -- migration 380
  PERFORM public.richiedi_profilo_gestionale(); -- migration 364
  FOR v_bt IN
    SELECT id FROM public.bank_transactions
    WHERE amount < 0
      AND COALESCE(is_reconciled, false) = false
      AND status IN ('posted', 'booked')
      AND transaction_date >= (CURRENT_DATE - INTERVAL '400 days')
    ORDER BY transaction_date DESC
  LOOP
    v_seen := v_seen + 1;
    v_res := public.try_match_rimborso_bank_transaction(v_bt.id); -- migration 390
    IF NOT COALESCE((v_res->>'matched')::boolean, false) THEN
      v_res := public.try_match_distinta_bank_transaction(v_bt.id);
    END IF;
    IF COALESCE((v_res->>'matched')::boolean, false) THEN
      v_matched := v_matched + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('esaminati', v_seen, 'agganciati', v_matched);
END;
$function$;

-- ── 5. Chiusura provvisoria carte/contanti: non le fatture in rimborso ────
-- Riscrittura sul testo vivo (una sola riga aggiunta), così il resto della
-- funzione, guardia della 380 compresa, resta identico carattere per carattere.
DO $do$
DECLARE
  v_def text;
  v_ancora CONSTANT text := E'      AND p.bank_transaction_id IS NULL\n';
  v_aggiunta CONSTANT text :=
    E'      AND NOT EXISTS ( -- migration 390: in distinta di rimborso, non è uscita dalla carta\n'
    || E'        SELECT 1 FROM public.payable_actions ra\n'
    || E'        WHERE ra.payable_id = p.id AND ra.action_type = ''disposizione''\n'
    || E'          AND ra.rimborso_group_id IS NOT NULL)\n';
BEGIN
  v_def := pg_get_functiondef('public.fn_cash_card_provisional_close(uuid, boolean)'::regprocedure);
  IF position('migration 390' in v_def) > 0 THEN
    RETURN; -- già applicata
  END IF;
  IF (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 THEN
    RAISE EXCEPTION 'fn_cash_card_provisional_close: ancora non trovata o non unica, migration 390 non applicata';
  END IF;
  IF position('ruoli_operativi_non_qui' in v_def) = 0 THEN
    RAISE EXCEPTION 'fn_cash_card_provisional_close: guardia della 380 assente, mi fermo';
  END IF;
  EXECUTE replace(v_def, v_ancora, v_ancora || v_aggiunta);
END;
$do$;
