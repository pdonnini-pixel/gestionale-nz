-- 269 · Documenti banca: niente domande su cio' che il sistema sa gia' (R27/R28)
--
-- Nata il 07/10/2026 dalle 11 domande aperte dopo gli estratti di settembre
-- (MPS e BCC Figline, Excel stampati fino al 05/10). Patrizio: «tu hai gia' le
-- risposte». Era vero:
--  - 9 movimenti «che l'estratto non contiene» (sette addebiti da 29,70 e un
--    versamento da 240,90 su MPS, un POS da 278,16 su Figline) la banca li ha
--    registrati il 06/10, il giorno dopo la stampa dell'estratto. L'open banking
--    lo dice: raw_data.extra.postingDate. Su 786 movimenti di settembre gia'
--    confermati la postingDate coincide con la data contabile dell'estratto
--    786 volte su 786. Il POS era anche «pending». Non sono assenti: stanno
--    nell'estratto successivo, che li confermera'.
--  - le 2 domande «quadratura» ripetevano in un numero la somma delle altre
--    domande dello stesso estratto. Per costruzione lo scarto e' sempre la somma
--    delle righe gia' chieste: non e' mai un'informazione nuova.
--
-- Cosa cambia rispetto alla 264:
--  1. un movimento del gestionale assente dall'estratto, ma che la banca ha
--     registrato dopo l'ultimo giorno dell'estratto (postingDate dell'open
--     banking) o che e' ancora in sospeso, non si chiede e non entra nello
--     scarto: si conta in «dopo_estratto» e lo controlla l'estratto successivo;
--  2. la quadratura resta nel riepilogo (balance_check) ma non e' piu' una domanda;
--  3. la domanda rimasta (movimento assente dall'estratto, registrato dalla banca
--     prima della stampa) dice cosa guardare e cosa rispondere.
--
-- Stessa firma della 264. Applicata via MCP su NZ, Made, Zago.

CREATE OR REPLACE FUNCTION public.apply_bank_statement(
  p_statement_id uuid,
  p_rows jsonb,
  p_opening numeric DEFAULT NULL,
  p_closing numeric DEFAULT NULL,
  p_edge_days integer DEFAULT 3
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_role text := public.get_my_role()::text;
  st record;
  r record;
  m record;
  v_label text;
  v_from date;
  v_to date;
  v_ids uuid[];
  v_used uuid[] := ARRAY[]::uuid[];
  v_pending uuid[] := ARRAY[]::uuid[];
  v_cand uuid[];
  v_scores int[];
  v_n_date int;
  v_n int;
  v_righe int;
  v_match uuid;
  v_new uuid;
  v_amt_doc numeric;
  v_outcome text;
  v_note text;
  v_conf int := 0;
  v_corr int := 0;
  v_ins int := 0;
  v_amb int := 0;
  v_altro int := 0;
  v_noins int := 0;
  v_domande int := 0;
  v_sum_rows numeric := 0;
  v_all_signed boolean := true;
  v_sum_bt numeric;
  v_check jsonb;
  v_summary jsonb;
  v_extra_db numeric := 0;
  v_unres_rows numeric := 0;
  v_dopo int := 0;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nessuna azienda associata all''utente';
  END IF;
  IF COALESCE(v_role, '') NOT IN ('super_advisor', 'cfo', 'contabile') THEN
    RAISE EXCEPTION 'Ruolo % non abilitato a caricare documenti della banca', v_role;
  END IF;

  SELECT * INTO st FROM public.bank_statements WHERE id = p_statement_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Estratto % non trovato', p_statement_id; END IF;
  IF st.bank_account_id IS NULL THEN RAISE EXCEPTION 'Estratto senza conto: non si puo'' applicare'; END IF;
  IF COALESCE(st.doc_kind, 'conto_corrente') <> 'conto_corrente' THEN
    RAISE EXCEPTION 'apply_bank_statement e'' per gli estratti di conto corrente';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'Nessuna riga da applicare';
  END IF;

  v_label := COALESCE(st.filename, 'estratto conto') || ' (' || to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY') || ')';

  SELECT min((x->>'date')::date), max((x->>'date')::date),
         bool_and(COALESCE((x->>'sign_known')::boolean, true)),
         sum(round((x->>'amount')::numeric, 2)), count(*)
    INTO v_from, v_to, v_all_signed, v_sum_rows, v_righe
  FROM jsonb_array_elements(p_rows) x;

  FOR r IN
    SELECT (x->>'row_no')::int AS row_no,
           (x->>'date')::date AS d,
           NULLIF(x->>'value_date', '')::date AS vd,
           COALESCE(NULLIF(x->>'value_date', '')::date, (x->>'date')::date) AS e,
           round((x->>'amount')::numeric, 2) AS amt,
           COALESCE((x->>'sign_known')::boolean, true) AS sk,
           NULLIF(btrim(x->>'description'), '') AS descr,
           NULLIF(btrim(x->>'flusso_cbi'), '') AS cbi,
           NULLIF(btrim(x->>'beneficiario'), '') AS benef
    FROM jsonb_array_elements(p_rows) x
    ORDER BY 2, 1
  LOOP
    v_match := NULL;
    v_outcome := NULL;
    v_note := NULL;

    -- 1) Aggancio certo: stesso ID flusso CBI.
    IF r.cbi IS NOT NULL THEN
      SELECT array_agg(b.id) INTO v_ids FROM public.bank_transactions b
      WHERE b.company_id = v_company AND b.bank_account_id = st.bank_account_id
        AND b.transaction_date BETWEEN r.e - 10 AND r.e + 10
        AND (regexp_match(COALESCE(b.description, ''), 'ID FLUSSO CBI:\s*(\d+)', 'i'))[1] = r.cbi
        AND NOT (b.id = ANY (v_used));
      IF COALESCE(array_length(v_ids, 1), 0) = 1 THEN v_match := v_ids[1]; END IF;
    END IF;

    -- 2) Stesso importo al centesimo, data entro 3 giorni. Il PDF perde il segno:
    --    in quel caso si confronta il valore assoluto.
    IF v_match IS NULL THEN
      SELECT array_agg(b.id ORDER BY abs(b.transaction_date - r.e), b.id) INTO v_ids FROM public.bank_transactions b
      WHERE b.company_id = v_company AND b.bank_account_id = st.bank_account_id
        AND b.transaction_date BETWEEN r.e - 3 AND r.e + 3
        AND NOT (b.id = ANY (v_used))
        AND CASE WHEN r.sk THEN b.amount = r.amt ELSE abs(b.amount) = abs(r.amt) END;
      v_n := COALESCE(array_length(v_ids, 1), 0);
      IF v_n = 1 THEN
        v_match := v_ids[1];
      ELSIF v_n > 1 THEN
        -- Piu' candidati. Prima decide la causale: il candidato che ha piu' parole
        -- in comune con la riga dell'estratto (codice del bonifico, beneficiario),
        -- se e' l'unico in testa. Poi la data esatta, se e' una sola.
        v_cand := v_ids;
        SELECT array_agg(z.id ORDER BY z.s DESC, z.id), array_agg(z.s ORDER BY z.s DESC, z.id)
          INTO v_ids, v_scores
        FROM (SELECT b.id, public.fn_text_overlap(r.descr, COALESCE(b.description, '') || ' ' || COALESCE(b.statement_description, '')) AS s
              FROM public.bank_transactions b WHERE b.id = ANY (v_cand)) z;
        IF v_scores[1] > 0 AND v_scores[1] > v_scores[2] THEN
          v_match := v_ids[1];
        ELSE
          -- Pari merito sulla causale. Se i migliori sono anche nello stesso
          -- giorno (cinque commissioni da 3,00 il 05/08) sono intercambiabili:
          -- se ne prende uno, chiedere quale sarebbe rumore (regola granitica).
          SELECT array_agg(z.id ORDER BY z.id), count(DISTINCT z.transaction_date)
            INTO v_ids, v_n_date
          FROM (SELECT b.id, b.transaction_date FROM public.bank_transactions b
                WHERE b.id = ANY (v_cand)
                  AND public.fn_text_overlap(r.descr, COALESCE(b.description, '') || ' ' || COALESCE(b.statement_description, '')) = v_scores[1]) z;
          -- Fra i pari merito, quelli proprio nel giorno della riga sono
          -- intercambiabili fra loro: se ce n'e' almeno uno si prende il primo.
          SELECT (array_agg(b.id ORDER BY b.id))[1] INTO v_match FROM public.bank_transactions b
          WHERE b.id = ANY (v_ids) AND b.transaction_date = r.e;
          IF v_match IS NULL AND v_n_date = 1 THEN
            v_match := v_ids[1];
          ELSIF v_match IS NULL THEN
          SELECT array_agg(b.id) INTO v_ids FROM public.bank_transactions b
          WHERE b.id = ANY (v_cand) AND b.transaction_date = r.e;
          IF COALESCE(array_length(v_ids, 1), 0) = 1 THEN
            v_match := v_ids[1];
          ELSE
            v_outcome := 'ambiguo';
            v_note := v_n || ' movimenti con lo stesso importo vicino a questa data';
            -- Gia' oggetto di questa domanda: non si chiedono una seconda volta.
            v_pending := v_pending || v_cand;
          END IF;
          END IF;
        END IF;
      END IF;
    END IF;

    IF v_match IS NOT NULL THEN
      v_used := v_used || v_match;
      SELECT b.id, b.transaction_date, b.value_date, b.amount, b.is_reconciled INTO m
      FROM public.bank_transactions b WHERE b.id = v_match;
      v_outcome := 'confermato';

      -- L'estratto comanda: data e importo si allineano al documento. Prima si
      -- aggiorna, poi si scrive la traccia.
      v_amt_doc := CASE WHEN r.sk THEN r.amt ELSE sign(m.amount) * abs(r.amt) END;
      BEGIN
        -- La data si corregge solo se l'estratto porta la valuta: senza (il PDF
        -- a volte la perde) la contabile non la sostituisce.
        UPDATE public.bank_transactions bt SET
          transaction_date = CASE WHEN r.vd IS NOT NULL THEN r.e ELSE bt.transaction_date END,
          booking_date = r.d,
          value_date = CASE WHEN r.vd IS NOT NULL THEN r.e ELSE bt.value_date END,
          amount = v_amt_doc,
          statement_id = st.id,
          statement_confirmed_at = now(),
          statement_source = st.filename,
          -- La causale dell'estratto riempie solo se manca: dal PDF esce a pezzi
          -- e non deve sostituire una causale estesa gia' salvata.
          statement_description = CASE
            WHEN NULLIF(btrim(bt.statement_description), '') IS NULL
             AND r.descr IS NOT NULL AND r.descr IS DISTINCT FROM bt.description THEN r.descr
            ELSE bt.statement_description END,
          statement_enriched_at = CASE
            WHEN NULLIF(btrim(bt.statement_description), '') IS NULL
             AND r.descr IS NOT NULL AND r.descr IS DISTINCT FROM bt.description THEN now()
            ELSE bt.statement_enriched_at END,
          counterpart = COALESCE(NULLIF(btrim(bt.counterpart), ''), r.benef)
        WHERE bt.id = m.id;
      EXCEPTION WHEN unique_violation THEN
        v_outcome := 'ambiguo';
        v_note := 'la correzione la renderebbe identica a un altro movimento';
      END;

      IF v_outcome = 'confermato' THEN
        -- La data del movimento e' la data valuta (come la porta l'open banking):
        -- si confronta con la valuta dell'estratto, la contabile va in booking_date.
        IF r.vd IS NOT NULL AND m.transaction_date <> r.e THEN
          INSERT INTO public.document_corrections (company_id, statement_id, document_label, target_table, target_id, field, old_value, new_value, reason)
          VALUES (v_company, st.id, v_label, 'bank_transactions', m.id, 'transaction_date', m.transaction_date::text, r.e::text, 'R27: data valuta dell''estratto conto');
          v_outcome := 'corretto';
        END IF;
        IF v_amt_doc <> m.amount THEN
          INSERT INTO public.document_corrections (company_id, statement_id, document_label, target_table, target_id, field, old_value, new_value, reason)
          VALUES (v_company, st.id, v_label, 'bank_transactions', m.id, 'amount', m.amount::text, v_amt_doc::text, 'R27: importo dell''estratto conto');
          v_outcome := 'corretto';
          IF m.is_reconciled THEN
            IF public.fn_bank_doc_ask(v_company, st.id, 'importo_corretto_su_abbinato', 'bt-importo:' || m.id, m.id,
                 format('L''estratto %s dice che il movimento del %s era di %s, non di %s. L''ho corretto. Era gia'' abbinato a una fattura: va bene cosi'' o l''abbinamento va rivisto?',
                        COALESCE(st.filename, ''), to_char(r.d, 'DD/MM/YYYY'), public.fn_eur_it(v_amt_doc), public.fn_eur_it(m.amount)),
                 jsonb_build_object('row_no', r.row_no)) THEN v_domande := v_domande + 1; END IF;
          END IF;
        END IF;
        IF v_outcome = 'corretto' THEN v_corr := v_corr + 1; ELSE v_conf := v_conf + 1; END IF;
      END IF;

    ELSIF v_outcome IS NULL THEN
      -- Nessun movimento sul conto. Prima di inserire: e' finito su un altro conto?
      SELECT array_agg(b.id) INTO v_ids FROM public.bank_transactions b
      WHERE b.company_id = v_company
        AND b.bank_account_id IS DISTINCT FROM st.bank_account_id
        AND b.transaction_date BETWEEN r.e - 3 AND r.e + 3
        AND CASE WHEN r.sk THEN b.amount = r.amt ELSE abs(b.amount) = abs(r.amt) END;
      IF COALESCE(array_length(v_ids, 1), 0) > 0 THEN
        v_outcome := 'altro_conto';
        v_match := v_ids[1];
        v_altro := v_altro + 1;
        IF public.fn_bank_doc_ask(v_company, st.id, 'riga_su_altro_conto', 'riga-altro-conto:' || st.bank_account_id || ':' || r.d || ':' || r.amt, v_ids[1],
             format('Nell''estratto %s c''e'' un movimento del %s di %s («%s»). Sul conto dell''estratto non lo trovo, ma ce n''e'' uno uguale su un altro conto. E'' lo stesso movimento registrato sul conto sbagliato?',
                    COALESCE(st.filename, ''), to_char(r.d, 'DD/MM/YYYY'), public.fn_eur_it(r.amt), left(COALESCE(r.descr, ''), 120)),
             jsonb_build_object('row_no', r.row_no, 'candidati', to_jsonb(v_ids))) THEN v_domande := v_domande + 1; END IF;
      ELSIF NOT r.sk THEN
        -- Dal PDF il segno non si legge: senza segno non si scrive un movimento.
        v_outcome := 'non_inserito';
        v_note := 'segno non leggibile dal PDF: caricare l''Excel dello stesso estratto';
        v_noins := v_noins + 1;
      ELSE
        BEGIN
          INSERT INTO public.bank_transactions (
            company_id, bank_account_id, transaction_date, booking_date, value_date, amount, currency,
            description, counterpart, status, source, statement_id, statement_confirmed_at,
            statement_description, statement_source, is_reconciled, note)
          VALUES (
            v_company, st.bank_account_id, r.e, r.d, r.e, r.amt, 'EUR',
            COALESCE(r.descr, 'Movimento da estratto conto'), r.benef, 'booked', 'estratto_conto', st.id, now(),
            r.descr, st.filename, false,
            'Inserito dall''estratto conto ' || v_label || ': l''open banking non l''aveva portato (R27).')
          RETURNING id INTO v_new;
          v_match := v_new;
          v_used := v_used || v_new;
          v_outcome := 'inserito';
          v_ins := v_ins + 1;
          INSERT INTO public.document_corrections (company_id, statement_id, document_label, target_table, target_id, field, old_value, new_value, reason)
          VALUES (v_company, st.id, v_label, 'bank_transactions', v_new, 'insert', NULL, r.amt::text, 'R27: movimento presente nell''estratto e assente nel gestionale');
        EXCEPTION WHEN unique_violation THEN
          v_outcome := 'non_inserito';
          v_note := 'un movimento identico (stesso giorno, importo e causale) e'' gia'' presente';
          v_noins := v_noins + 1;
        END;
      END IF;
    END IF;

    -- Una riga ambigua ha comunque il suo movimento nel gestionale (solo non si
    -- sa quale): conta su entrambi i lati e non sposta la quadratura.
    IF v_outcome IN ('altro_conto', 'non_inserito') THEN
      v_unres_rows := v_unres_rows + r.amt;
    END IF;

    IF v_outcome = 'ambiguo' THEN
      v_amb := v_amb + 1;
      IF public.fn_bank_doc_ask(v_company, st.id, 'riga_ambigua', 'riga-ambigua:' || st.bank_account_id || ':' || r.d || ':' || r.amt || ':' || r.row_no, NULL,
           format('Nell''estratto %s c''e'' un movimento del %s di %s («%s»), ma nel gestionale ce ne sono piu'' d''uno uguali in quei giorni e non so quale sia. Ricordi a cosa si riferisce?',
                  COALESCE(st.filename, ''), to_char(r.d, 'DD/MM/YYYY'), public.fn_eur_it(r.amt), left(COALESCE(r.descr, ''), 120)),
           jsonb_build_object('row_no', r.row_no)) THEN v_domande := v_domande + 1; END IF;
    END IF;

    INSERT INTO public.bank_statement_lines (company_id, statement_id, row_no, booking_date, value_date, amount, sign_known, description, flusso_cbi, bank_transaction_id, outcome, note)
    VALUES (v_company, st.id, r.row_no, r.d, r.vd, r.amt, r.sk, r.descr, r.cbi, v_match, v_outcome, v_note)
    ON CONFLICT (statement_id, row_no) DO UPDATE SET
      booking_date = EXCLUDED.booking_date, value_date = EXCLUDED.value_date, amount = EXCLUDED.amount,
      sign_known = EXCLUDED.sign_known, description = EXCLUDED.description, flusso_cbi = EXCLUDED.flusso_cbi,
      bank_transaction_id = EXCLUDED.bank_transaction_id, outcome = EXCLUDED.outcome, note = EXCLUDED.note;
  END LOOP;

  -- Movimenti del gestionale che l'estratto non contiene: mai cancellati.
  -- Quelli che la banca ha registrato dopo l'ultimo giorno dell'estratto (data
  -- contabile dell'open banking, postingDate) o ancora in sospeso stanno
  -- nell'estratto successivo: non si chiedono e non entrano nello scarto.
  SELECT count(*) INTO v_dopo FROM public.bank_transactions b
  WHERE b.company_id = v_company AND b.bank_account_id = st.bank_account_id
    AND b.transaction_date BETWEEN v_from AND v_to - p_edge_days
    AND NOT (b.id = ANY (v_used))
    AND NOT (b.id = ANY (v_pending))
    AND (COALESCE(b.raw_data->>'status' = 'pending', false)
         OR CASE WHEN (b.raw_data->'extra'->>'postingDate') ~ '^\d{4}-\d{2}-\d{2}$'
                 THEN (b.raw_data->'extra'->>'postingDate')::date > v_to ELSE false END);

  FOR m IN
    SELECT b.id, b.transaction_date, b.amount, b.description FROM public.bank_transactions b
    WHERE b.company_id = v_company AND b.bank_account_id = st.bank_account_id
      -- Dalla prima data contabile a qualche giorno prima dell'ultima: i movimenti
      -- degli ultimi giorni la banca li contabilizza nell'estratto successivo.
      AND b.transaction_date BETWEEN v_from AND v_to - p_edge_days
      AND NOT (b.id = ANY (v_used))
      AND NOT (b.id = ANY (v_pending))
      AND NOT COALESCE(b.raw_data->>'status' = 'pending', false)
      AND NOT CASE WHEN (b.raw_data->'extra'->>'postingDate') ~ '^\d{4}-\d{2}-\d{2}$'
                   THEN (b.raw_data->'extra'->>'postingDate')::date > v_to ELSE false END
  LOOP
    v_extra_db := v_extra_db + m.amount;
    IF public.fn_bank_doc_ask(v_company, st.id, 'movimento_non_in_estratto', 'bt-non-in-estratto:' || m.id, m.id,
         format('Il %s nel gestionale c''è %s di %s («%s»), ma nell''estratto %s non c''è. Cercalo nell''home banking a quella data. Se lo trovi scrivi «c''è»; se non lo trovi scrivi «non c''è» e lo segno come doppione.',
                to_char(m.transaction_date, 'DD/MM/YYYY'),
                CASE WHEN m.amount < 0 THEN 'un''uscita' ELSE 'un''entrata' END,
                public.fn_eur_it(abs(m.amount)),
                left(COALESCE(m.description, ''), 90), COALESCE(st.filename, '')),
         NULL) THEN v_domande := v_domande + 1; END IF;
  END LOOP;

  -- Quadratura. Sul documento: saldo iniziale + righe = saldo finale. Sul
  -- gestionale: somma dei movimenti del conto nel periodo contro somma delle righe.
  -- Quadratura: lo scarto e' quello che il gestionale ha in piu' (movimenti che
  -- l'estratto non contiene) meno quello che l'estratto ha e il gestionale no
  -- (righe rimaste senza movimento). Zero vuol dire che tornano al centesimo.
  v_sum_bt := v_sum_rows - v_unres_rows + v_extra_db;

  v_check := jsonb_build_object(
    'periodo_da', v_from, 'periodo_a', v_to,
    'saldo_iniziale', p_opening, 'saldo_finale', p_closing,
    'somma_righe', CASE WHEN v_all_signed THEN round(v_sum_rows, 2) END,
    'somma_gestionale', round(v_sum_bt, 2),
    'scarto_documento', CASE WHEN v_all_signed AND p_opening IS NOT NULL AND p_closing IS NOT NULL
                             THEN round(p_opening + v_sum_rows - p_closing, 2) END,
    'scarto_gestionale', CASE WHEN v_all_signed THEN round(v_sum_bt - v_sum_rows, 2) END
  );

  -- Lo scarto e' per costruzione la somma delle righe gia' chieste sopra: resta
  -- nel riepilogo (balance_check), non diventa una domanda in piu'.

  v_summary := jsonb_build_object(
    'righe', v_righe,
    'confermati', v_conf, 'corretti', v_corr, 'inseriti', v_ins,
    'ambigui', v_amb, 'altro_conto', v_altro, 'non_inseriti', v_noins,
    'domande_nuove', v_domande, 'dopo_estratto', v_dopo, 'quadratura', v_check
  );

  UPDATE public.bank_statements SET
    status = 'completed',
    period_from = COALESCE(period_from, v_from),
    period_to = COALESCE(period_to, v_to),
    opening_balance = COALESCE(p_opening, opening_balance),
    closing_balance = COALESCE(p_closing, closing_balance),
    transaction_count = v_righe,
    balance_check = v_check,
    applied_at = now(),
    applied_summary = v_summary
  WHERE id = st.id;

  RETURN v_summary;
END;
$function$;
REVOKE ALL ON FUNCTION public.apply_bank_statement(uuid, jsonb, numeric, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_bank_statement(uuid, jsonb, numeric, numeric, integer) TO authenticated;
