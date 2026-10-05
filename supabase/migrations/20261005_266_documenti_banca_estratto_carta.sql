-- 266 · Documenti banca: l'estratto carta si applica da solo (R27)
--
-- Prima di questa migration l'estratto carta si caricava in Prima nota → Carte e
-- restava una lista: le righe finivano in card_transactions, ma nessuna scadenza
-- veniva confermata e l'addebito mensile sul conto non si agganciava mai (0
-- estratti su 31). Ora `apply_card_statement` fa quello che R27 chiede:
--
-- 1. salva le righe (card_transactions), ricaricare non le raddoppia;
-- 2. abbina ogni spesa a una fattura solo con importo al centesimo E nome del
--    fornitore nella descrizione, fattura entro 45 giorni (prima o dopo) dalla
--    data della spesa. Misurato su NZ il 05/10/2026: col solo importo una riga
--    su due ha piu' fatture candidate, quindi il nome e' obbligatorio. Se in testa
--    ci sono due fatture alla pari la riga non si abbina;
-- 3. la fattura abbinata si allinea al documento: pagata, con la data della
--    spesa, metodo carta, non piu' provvisoria. Ogni valore cambiato va in
--    document_corrections e payable_actions, con una nota datata in coda;
-- 4. se la fattura risulta gia' pagata con un altro movimento del conto non la
--    tocca: lo chiede in chat (puo' essere un pagamento doppio). Una fattura gia'
--    collegata a piu' righe da abbinamenti vecchi non si tocca;
-- 5. carta di credito: cerca l'addebito mensile sul conto (causale
--    della carta, importo uguale alla somma degli estratti dello stesso emittente
--    e mese, fino a 100 € in piu' per canone e commissioni). Se lo trova lo
--    aggancia all'estratto e alle fatture abbinate; il residuo non spiegato dalle
--    righe diventa una domanda in chat, solo la prima volta che quell'importo
--    compare (un canone fisso non si richiede ogni mese). Se non lo trova non chiede niente:
--    l'addebito arriva il mese dopo e si aggancia al caricamento successivo;
-- 6. prepagata: le spese chiudono le fatture con la data della spesa, senza
--    movimento bancario. Le ricariche sono giroconti e restano come sono.
--
-- Non tocca nessun dato gia' presente: lavora solo sugli estratti che vengono
-- caricati e applicati da Documenti banca (decisione di Patrizio del 05/10/2026).
-- Nessun DROP.
--
-- Collaudo su NZ il 05/10/2026, transazione annullata, sui 31 estratti carta gia'
-- presenti: 23/23 addebiti mensili trovati (luglio: 2.415,80 contro 2.362,51 di
-- spese, residuo 53,29), 49 abbinamenti nuovi, 51 fatture allineate, 3 domande
-- (canone BCC 3,29 una volta sola, luglio 53,29, una fattura pagata due volte);
-- secondo caricamento senza effetti.
-- Applicata via MCP su NZ, Made, Zago: md5(prosrc) = efa6da163c857c7794260c8ed19c96d9 sui tre.

CREATE OR REPLACE FUNCTION public.apply_card_statement(
  p_statement_id uuid,
  p_lines jsonb,
  p_debit_date date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_role text := public.get_my_role()::text;
  v_uid uuid := auth.uid();
  st record;
  l record;
  p record;
  v_label text;
  v_prepaid boolean;
  v_group text;
  v_method public.payment_method;
  v_ids uuid[];
  v_scores int[];
  v_pid uuid;
  v_new_method public.payment_method;
  v_changed boolean;
  v_note text;
  v_righe int := 0;
  v_spese int := 0;
  v_nuove int := 0;
  v_confermate int := 0;
  v_corrette int := 0;
  v_conflitti int := 0;
  v_domande int := 0;
  v_group_ids uuid[];
  v_group_total numeric;
  v_debit record;
  v_debit_date date;
  v_debit_amt numeric;
  v_debit_id uuid;
  v_residuo numeric;
  v_agganciate int := 0;
  v_summary jsonb;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nessuna azienda associata all''utente';
  END IF;
  IF COALESCE(v_role, '') NOT IN ('super_advisor', 'cfo', 'contabile') THEN
    RAISE EXCEPTION 'Ruolo % non abilitato a caricare documenti della banca', v_role;
  END IF;

  SELECT * INTO st FROM public.bank_statements WHERE id = p_statement_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Estratto % non trovato', p_statement_id; END IF;
  IF COALESCE(st.doc_kind, '') <> 'carta' THEN
    RAISE EXCEPTION 'apply_card_statement e'' per gli estratti carta';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Righe non valide';
  END IF;

  v_label := COALESCE(st.filename, 'estratto carta') || ' (' || to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY') || ')';
  v_prepaid := COALESCE(st.source_label, '') ~* 'prepagat';
  -- Emittente: l'etichetta senza le ultime cifre («Carta credito BCC *3145» → «Carta credito BCC»).
  v_group := btrim(regexp_replace(COALESCE(st.source_label, ''), '\s*\*\s*\d{3,4}\s*$', ''));
  v_method := CASE WHEN v_prepaid THEN 'carta_debito'::public.payment_method ELSE 'carta_credito'::public.payment_method END;

  -- 1) Le righe. Ricaricare aggiorna i campi ma non tocca l'abbinamento gia' fatto.
  INSERT INTO public.card_transactions (company_id, statement_id, row_no, card_last4, purchase_date, posting_date,
                                        description, amount, fee, currency, original_amount, raw, created_by)
  SELECT v_company, st.id, (x->>'row_no')::int, NULLIF(x->>'card_last4', ''), (x->>'purchase_date')::date,
         NULLIF(x->>'posting_date', '')::date, COALESCE(x->>'description', ''), round((x->>'amount')::numeric, 2),
         round(COALESCE(NULLIF(x->>'fee', '')::numeric, 0), 2), COALESCE(NULLIF(x->>'currency', ''), 'EUR'),
         NULLIF(x->>'original_amount', '')::numeric, x, v_uid
  FROM jsonb_array_elements(p_lines) x
  ON CONFLICT (statement_id, row_no) DO UPDATE SET
    card_last4 = EXCLUDED.card_last4, purchase_date = EXCLUDED.purchase_date, posting_date = EXCLUDED.posting_date,
    description = EXCLUDED.description, amount = EXCLUDED.amount, fee = EXCLUDED.fee, currency = EXCLUDED.currency,
    original_amount = EXCLUDED.original_amount, raw = EXCLUDED.raw;

  SELECT count(*) INTO v_righe FROM public.card_transactions WHERE statement_id = st.id;

  -- 2) e 3) Spese → fatture.
  FOR l IN
    SELECT ct.* FROM public.card_transactions ct
    WHERE ct.statement_id = st.id AND ct.amount < 0
    ORDER BY ct.purchase_date, ct.row_no
  LOOP
    v_spese := v_spese + 1;
    v_pid := l.payable_id;

    IF v_pid IS NULL THEN
      SELECT array_agg(z.id ORDER BY z.s DESC, z.dd, z.id), array_agg(z.s ORDER BY z.s DESC, z.dd, z.id)
        INTO v_ids, v_scores
      FROM (
        SELECT py.id,
               public.fn_text_overlap(l.description, COALESCE(s.name, '') || ' ' || COALESCE(py.supplier_name, '')) AS s,
               abs(py.invoice_date - l.purchase_date) AS dd
        FROM public.payables py
        LEFT JOIN public.suppliers s ON s.id = py.supplier_id
        WHERE py.company_id = v_company
          AND abs(COALESCE(py.gross_amount, 0) - abs(l.amount)) < 0.005
          AND py.invoice_date BETWEEN l.purchase_date - 45 AND l.purchase_date + 45
          AND COALESCE(py.status::text, '') NOT IN ('annullato', 'nota_credito')
          AND NOT COALESCE(py.is_placeholder, false)
          AND NOT COALESCE(py.is_forecast, false)
          AND NOT EXISTS (SELECT 1 FROM public.card_transactions c2 WHERE c2.payable_id = py.id)
      ) z
      WHERE z.s > 0;
      IF COALESCE(array_length(v_ids, 1), 0) = 1
         OR (COALESCE(array_length(v_ids, 1), 0) > 1 AND v_scores[1] > v_scores[2]) THEN
        v_pid := v_ids[1];
        UPDATE public.card_transactions SET payable_id = v_pid WHERE id = l.id;
        v_nuove := v_nuove + 1;
      END IF;
    END IF;

    CONTINUE WHEN v_pid IS NULL;

    SELECT * INTO p FROM public.payables WHERE id = v_pid;
    CONTINUE WHEN NOT FOUND;

    -- Una fattura collegata a piu' righe (abbinamenti vecchi fatti a video) non si
    -- tocca: due spese non possono essere la stessa fattura, e non si sceglie.
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.card_transactions c3
                          WHERE c3.payable_id = v_pid AND c3.id <> l.id);

    -- 4) Gia' pagata con un altro movimento del conto: non si tocca, si chiede.
    IF p.bank_transaction_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.bank_statements b2
                       WHERE b2.company_id = v_company AND b2.doc_kind = 'carta'
                         AND b2.settled_bank_transaction_id = p.bank_transaction_id)
       -- Gia' agganciata a un addebito di carta (anche a mano): e' lo stesso pagamento.
       AND NOT EXISTS (SELECT 1 FROM public.bank_transactions bx
                       WHERE bx.id = p.bank_transaction_id
                         AND bx.description ~* '(CARTA DEL CREDITO COOPERATIVO|ADDEBITO DIRETTO CARTA|ADD\.? ?DIRETTO CARTA|POSIZIONE CARTA|CARTA ?MONTEPASCHI|SALDO CARTA|ESTRATTO CONTO CARTA)') THEN
      v_conflitti := v_conflitti + 1;
      IF public.fn_bank_doc_ask(v_company, st.id, 'carta_fattura_gia_pagata', 'carta-fattura-pagata:' || l.id, p.bank_transaction_id,
           format('L''estratto %s dice che la fattura %s di %s (%s) e'' stata pagata con la carta il %s, ma nel gestionale risulta pagata con un movimento del conto. E'' stata pagata due volte o il movimento era un''altra cosa?',
                  COALESCE(st.filename, ''), COALESCE(p.invoice_number, '?'), COALESCE(p.supplier_name, '?'),
                  public.fn_eur_it(p.gross_amount), to_char(l.purchase_date, 'DD/MM/YYYY')),
           jsonb_build_object('payable_id', p.id, 'card_transaction_id', l.id)) THEN v_domande := v_domande + 1; END IF;
      CONTINUE;
    END IF;

    v_new_method := CASE WHEN p.payment_method::text IN ('carta_credito', 'carta_debito') THEN p.payment_method ELSE v_method END;
    v_changed := COALESCE(p.amount_paid, 0) < COALESCE(p.gross_amount, 0)
                 OR p.payment_date IS DISTINCT FROM l.purchase_date
                 OR p.payment_method IS DISTINCT FROM v_new_method
                 OR COALESCE(p.is_provisional_paid, false);

    IF NOT v_changed THEN
      v_confermate := v_confermate + 1;
      CONTINUE;
    END IF;

    v_note := to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY') || ': estratto carta ' || COALESCE(st.filename, '')
              || ' (' || COALESCE(st.source_label, 'carta') || '): pagata con carta il ' || to_char(l.purchase_date, 'DD/MM/YYYY') || ' (R27).';

    UPDATE public.payables SET
      amount_paid = GREATEST(COALESCE(amount_paid, 0), COALESCE(gross_amount, 0)),
      payment_date = l.purchase_date,
      payment_method = v_new_method,
      is_provisional_paid = false,
      notes = CASE WHEN COALESCE(btrim(notes), '') = '' THEN v_note ELSE notes || E'\n' || v_note END
    WHERE id = p.id;

    IF COALESCE(p.amount_paid, 0) < COALESCE(p.gross_amount, 0) THEN
      INSERT INTO public.document_corrections (company_id, statement_id, document_label, target_table, target_id, field, old_value, new_value, reason)
      VALUES (v_company, st.id, v_label, 'payables', p.id, 'amount_paid', COALESCE(p.amount_paid, 0)::text, p.gross_amount::text, 'R27: pagata con carta secondo l''estratto');
    END IF;
    IF p.payment_date IS DISTINCT FROM l.purchase_date THEN
      INSERT INTO public.document_corrections (company_id, statement_id, document_label, target_table, target_id, field, old_value, new_value, reason)
      VALUES (v_company, st.id, v_label, 'payables', p.id, 'payment_date', p.payment_date::text, l.purchase_date::text, 'R27: data della spesa sull''estratto carta');
    END IF;
    IF p.payment_method IS DISTINCT FROM v_new_method THEN
      INSERT INTO public.document_corrections (company_id, statement_id, document_label, target_table, target_id, field, old_value, new_value, reason)
      VALUES (v_company, st.id, v_label, 'payables', p.id, 'payment_method', p.payment_method::text, v_new_method::text, 'R27: pagata con carta secondo l''estratto');
    END IF;
    IF COALESCE(p.is_provisional_paid, false) THEN
      INSERT INTO public.document_corrections (company_id, statement_id, document_label, target_table, target_id, field, old_value, new_value, reason)
      VALUES (v_company, st.id, v_label, 'payables', p.id, 'is_provisional_paid', 'true', 'false', 'R27: chiusura provvisoria confermata dall''estratto carta');
    END IF;

    INSERT INTO public.payable_actions (payable_id, action_type, old_status, new_status, amount, payment_method, note, performed_by)
    SELECT p.id, 'conferma_estratto_carta', p.status, py.status, py.gross_amount, v_new_method, v_note, v_uid
    FROM public.payables py WHERE py.id = p.id;

    v_corrette := v_corrette + 1;
  END LOOP;

  -- 5) Carta di credito: l'addebito mensile sul conto.
  IF NOT v_prepaid AND st.period_year IS NOT NULL AND st.period_month IS NOT NULL THEN
    SELECT array_agg(b.id), -sum(COALESCE(b.statement_total, 0))
      INTO v_group_ids, v_group_total
    FROM public.bank_statements b
    WHERE b.company_id = v_company AND b.doc_kind = 'carta'
      AND b.period_year = st.period_year AND b.period_month = st.period_month
      AND btrim(regexp_replace(COALESCE(b.source_label, ''), '\s*\*\s*\d{3,4}\s*$', '')) = v_group;

    SELECT settled_bank_transaction_id INTO v_debit_id FROM public.bank_statements
    WHERE id = ANY (v_group_ids) AND settled_bank_transaction_id IS NOT NULL LIMIT 1;

    IF v_debit_id IS NULL AND v_group_total > 0 THEN
      SELECT array_agg(bt.id ORDER BY abs(-bt.amount - v_group_total), bt.transaction_date) INTO v_ids
      FROM public.bank_transactions bt
      WHERE bt.company_id = v_company
        AND bt.amount < 0
        AND -bt.amount >= v_group_total - 0.005
        AND -bt.amount <= v_group_total + 100
        AND bt.description ~* '(CARTA DEL CREDITO COOPERATIVO|ADDEBITO DIRETTO CARTA|ADD\.? ?DIRETTO CARTA|POSIZIONE CARTA|CARTA ?MONTEPASCHI|SALDO CARTA|ESTRATTO CONTO CARTA)'
        AND bt.description !~* 'AMERICAN EXPRESS|NEXI PAYMENTS'
        AND CASE WHEN p_debit_date IS NOT NULL
                 THEN bt.transaction_date BETWEEN p_debit_date - 5 AND p_debit_date + 5
                 ELSE bt.transaction_date BETWEEN make_date(st.period_year, st.period_month, 1) + interval '1 month'
                                              AND make_date(st.period_year, st.period_month, 1) + interval '2 months' + interval '10 days'
            END
        AND NOT EXISTS (SELECT 1 FROM public.bank_statements b3
                        WHERE b3.settled_bank_transaction_id = bt.id AND NOT (b3.id = ANY (v_group_ids)));
      -- Solo se l'addebito e' uno: con due candidati non si sceglie.
      IF COALESCE(array_length(v_ids, 1), 0) = 1 THEN
        v_debit_id := v_ids[1];
      END IF;
    END IF;

    IF v_debit_id IS NOT NULL THEN
      SELECT * INTO v_debit FROM public.bank_transactions WHERE id = v_debit_id;
      v_debit_date := v_debit.transaction_date;
      v_debit_amt := -v_debit.amount;
      UPDATE public.bank_statements SET settled_bank_transaction_id = v_debit_id
      WHERE id = ANY (v_group_ids) AND settled_bank_transaction_id IS DISTINCT FROM v_debit_id;

      -- Le fatture abbinate agli estratti del gruppo si appoggiano all'addebito,
      -- solo dove non c'e' gia' un movimento.
      FOR p IN
        SELECT py.* FROM public.payables py
        WHERE py.id IN (SELECT ct.payable_id FROM public.card_transactions ct
                        WHERE ct.statement_id = ANY (v_group_ids) AND ct.payable_id IS NOT NULL)
          AND py.bank_transaction_id IS NULL
      LOOP
        UPDATE public.payables SET bank_transaction_id = v_debit_id WHERE id = p.id;
        INSERT INTO public.document_corrections (company_id, statement_id, document_label, target_table, target_id, field, old_value, new_value, reason)
        VALUES (v_company, st.id, v_label, 'payables', p.id, 'bank_transaction_id', NULL, v_debit_id::text, 'R27: addebito mensile della carta');
        INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, notes, performed_by, confirmed_at, applied_amount)
        VALUES (v_company, v_debit_id, p.id, 'auto_exact', 1, 'applied',
                'estratto carta ' || COALESCE(st.filename, '') || ': fattura pagata con la carta, addebito mensile (R27)', v_uid, now(), p.gross_amount);
        v_agganciate := v_agganciate + 1;
      END LOOP;

      -- Le proposte del motore su questo addebito (per solo importo) non valgono piu'.
      UPDATE public.reconciliation_log rl SET status = 'rejected',
        notes = COALESCE(rl.notes, '') || ' | archiviata il ' || to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY') || ': e'' l''addebito mensile della carta (R27)'
      WHERE rl.bank_transaction_id = v_debit_id AND rl.status = 'to_confirm';

      UPDATE public.bank_transactions SET is_reconciled = true, reconciled_at = COALESCE(reconciled_at, now())
      WHERE id = v_debit_id AND NOT COALESCE(is_reconciled, false);

      v_residuo := round(v_debit_amt - v_group_total, 2);
      -- Si chiede solo un residuo nuovo: lo stesso importo gia' visto per la stessa
      -- carta in un altro mese e' un canone fisso (BCC: 3,29 € tutti i mesi).
      IF v_residuo > 0.005
         AND NOT EXISTS (SELECT 1 FROM public.bank_statements b4
                         WHERE b4.company_id = v_company AND b4.doc_kind = 'carta'
                           AND NOT (b4.id = ANY (v_group_ids))
                           AND btrim(regexp_replace(COALESCE(b4.source_label, ''), '\s*\*\s*\d{3,4}\s*$', '')) = v_group
                           AND (b4.applied_summary->'addebito'->>'residuo')::numeric = v_residuo) THEN
        IF public.fn_bank_doc_ask(v_company, st.id, 'carta_residuo_addebito', 'carta-residuo:' || v_debit_id, v_debit_id,
             format('L''addebito della carta del %s e'' di %s, le spese degli estratti %s %s/%s fanno %s: restano %s che nessuna riga spiega. Sai cosa sono (canone, commissioni, altro)?',
                    to_char(v_debit_date, 'DD/MM/YYYY'), public.fn_eur_it(v_debit_amt), v_group,
                    lpad(st.period_month::text, 2, '0'), st.period_year, public.fn_eur_it(v_group_total), public.fn_eur_it(v_residuo)),
             jsonb_build_object('statements', to_jsonb(v_group_ids), 'residuo', v_residuo)) THEN v_domande := v_domande + 1; END IF;
      END IF;
    END IF;
  END IF;

  v_summary := jsonb_build_object(
    'righe', v_righe, 'spese', v_spese,
    'abbinate_nuove', v_nuove, 'confermate', v_confermate, 'corrette', v_corrette,
    'conflitti', v_conflitti, 'domande_nuove', v_domande,
    'prepagata', v_prepaid,
    'addebito', CASE WHEN v_debit_id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', v_debit_id, 'data', v_debit_date, 'importo', v_debit_amt,
        'spese_estratti', v_group_total, 'residuo', v_residuo, 'fatture_agganciate', v_agganciate) END
  );

  UPDATE public.bank_statements SET
    status = 'completed',
    transaction_count = v_righe,
    applied_at = now(),
    applied_summary = v_summary
  WHERE id = st.id;

  RETURN v_summary;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_card_statement(uuid, jsonb, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_card_statement(uuid, jsonb, date) TO authenticated;
