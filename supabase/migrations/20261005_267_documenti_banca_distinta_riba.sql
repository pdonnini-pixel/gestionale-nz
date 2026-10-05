-- 267 · Documenti banca: la distinta RiBa MPS si applica da sola (R27)
--
-- Prima di questa migration la distinta si caricava da Scadenzario e si
-- confermava a mano riga per riga, e solo sulle rate ancora aperte: quelle chiuse
-- a mano o gia' agganciate restavano fuori, e le distinte vere del 31/08 e del
-- 30/09/2026 sono state applicate fuori dall'app. Ora `apply_riba_distinta`:
--
-- 1. salva le disposizioni lette dal documento (riba_distinta_lines), una volta
--    sola: ricaricare lo stesso file (stessa impronta o stesso numero di
--    supporto) non produce effetti doppi;
-- 2. per ogni effetto cerca le rate del fornitore per P.IVA con i numeri di
--    fattura e di nota di credito della causale («SALDO FATT N.3657 MENO NC
--    3797»). Le fatture hanno spesso tre rate: fra le combinazioni (una rata per
--    numero) che tornano con l'importo entro 2 centesimi sceglie quella con le
--    scadenze piu' vicine alla scadenza dell'effetto e, a parita', con piu' rate
--    gia' agganciate a un movimento (piani rate doppi). Due combinazioni alla pari:
--    non sceglie, chiede in chat. Senza numeri in causale vale solo una rata
--    unica con la stessa scadenza e lo stesso importo;
-- 3. la rata riconosciuta si allinea al documento (R27, anche se chiusa a mano):
--    pagata alla scadenza dell'effetto, non piu' provvisoria; una nota di credito
--    risulta compensata in quella RiBa. Ogni valore cambiato va in
--    document_corrections e payable_actions con una nota datata. Una rata gia'
--    agganciata a un movimento del conto si conferma e non si tocca;
-- 4. un effetto con scadenza futura si riconosce ma non chiude niente: si
--    applica al caricamento successivo, quando la data e' passata;
-- 5. l'addebito «effetti ritirati» sul conto della distinta si aggancia solo se
--    torna con il totale (fino a 1 € di commissione per effetto). La banca spesso
--    addebita piu' distinte insieme: in quel caso non si forza niente.
--
-- Non tocca nessun dato gia' presente: lavora solo sulle distinte caricate e
-- applicate da Documenti banca (decisione di Patrizio del 05/10/2026). Le 46
-- distinte gia' in riba_distinte restano come sono. Solo colonne aggiunte.
--
-- Collaudo su NZ il 05/10/2026, transazione annullata, con la distinta MPS vera
-- GRUPPO F.B. del 31/08 (5 effetti, 19.546,51): 5/5 riconosciuti e gia' a posto,
-- nessuna correzione, nessuna domanda; caso sintetico (rata aperta + nota di
-- credito): rata chiusa, nota compensata e collegata, 3 correzioni tracciate;
-- secondo caricamento senza effetti.
-- Applicata via MCP su NZ, Made, Zago: md5(prosrc) = ab34a4535f3ddbac4b3ce6e9bc401698 sui tre.

ALTER TABLE public.riba_distinte ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE public.riba_distinte ADD COLUMN IF NOT EXISTS supporto text;
ALTER TABLE public.riba_distinte ADD COLUMN IF NOT EXISTS doc_date date;
ALTER TABLE public.riba_distinte ADD COLUMN IF NOT EXISTS bank_stato text;
ALTER TABLE public.riba_distinte ADD COLUMN IF NOT EXISTS conto_testo text;
ALTER TABLE public.riba_distinte ADD COLUMN IF NOT EXISTS import_document_id uuid;
ALTER TABLE public.riba_distinte ADD COLUMN IF NOT EXISTS applied_at timestamptz;
ALTER TABLE public.riba_distinte ADD COLUMN IF NOT EXISTS applied_summary jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS riba_distinte_hash_uq ON public.riba_distinte (company_id, content_hash) WHERE content_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS riba_distinte_supporto_uq ON public.riba_distinte (company_id, supporto) WHERE supporto IS NOT NULL;

ALTER TABLE public.riba_distinta_lines ADD COLUMN IF NOT EXISTS row_no integer;
ALTER TABLE public.riba_distinta_lines ADD COLUMN IF NOT EXISTS raw_causale text;
ALTER TABLE public.riba_distinta_lines ADD COLUMN IF NOT EXISTS note text;
CREATE UNIQUE INDEX IF NOT EXISTS riba_distinta_lines_row_uq ON public.riba_distinta_lines (distinta_id, row_no) WHERE row_no IS NOT NULL;

ALTER TABLE public.document_corrections ADD COLUMN IF NOT EXISTS riba_distinta_id uuid REFERENCES public.riba_distinte(id) ON DELETE SET NULL;
ALTER TABLE public.bank_document_questions ADD COLUMN IF NOT EXISTS riba_distinta_id uuid REFERENCES public.riba_distinte(id) ON DELETE SET NULL;

-- p_lines: [{row_no, beneficiario, vat, amount, due_date, causale, fatture: ["2548"], note_credito: ["3797"]}]
-- p_conto: «Conto Corrente» della distinta (ABI CAB numero), per l'addebito.
CREATE OR REPLACE FUNCTION public.apply_riba_distinta(
  p_distinta_id uuid,
  p_lines jsonb,
  p_conto text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_role text := public.get_my_role()::text;
  v_uid uuid := auth.uid();
  d record;
  r record;
  p record;
  c record;
  v_label text;
  v_line_id uuid;
  v_vat text;
  v_nums jsonb;
  v_n int;
  v_best uuid[];
  v_best_dist int;
  v_best_diff numeric;
  v_second_dist int;
  v_second_diff numeric;
  v_best_unl int;
  v_second_unl int;
  v_used uuid[] := ARRAY[]::uuid[];
  v_closed uuid[] := ARRAY[]::uuid[];
  v_first_inv uuid;
  v_note text;
  v_key text;
  v_conto text;
  v_account uuid;
  v_ids uuid[];
  v_debit record;
  v_debit_date date;
  v_debit_amt numeric;
  v_debit_id uuid;
  v_total numeric := 0;
  v_disp int := 0;
  v_abb int := 0;
  v_conf int := 0;
  v_corr int := 0;
  v_amb int := 0;
  v_nf int := 0;
  v_fut int := 0;
  v_dom int := 0;
  v_agg int := 0;
  v_summary jsonb;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nessuna azienda associata all''utente';
  END IF;
  IF COALESCE(v_role, '') NOT IN ('super_advisor', 'cfo', 'contabile') THEN
    RAISE EXCEPTION 'Ruolo % non abilitato a caricare documenti della banca', v_role;
  END IF;
  SELECT * INTO d FROM public.riba_distinte WHERE id = p_distinta_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Distinta % non trovata', p_distinta_id; END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Nessuna disposizione da applicare';
  END IF;

  v_label := 'distinta RiBa ' || COALESCE(d.supporto, d.file_name, '') || ' (' || to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY') || ')';

  FOR r IN
    SELECT (x->>'row_no')::int AS row_no,
           NULLIF(btrim(x->>'beneficiario'), '') AS benef,
           regexp_replace(upper(COALESCE(x->>'vat', '')), '[^0-9]', '', 'g') AS vat,
           round((x->>'amount')::numeric, 2) AS amt,
           (x->>'due_date')::date AS due,
           NULLIF(btrim(x->>'causale'), '') AS causale,
           COALESCE(x->'fatture', '[]'::jsonb) AS fatt,
           COALESCE(x->'note_credito', '[]'::jsonb) AS nc
    FROM jsonb_array_elements(p_lines) x
    ORDER BY 1
  LOOP
    v_disp := v_disp + 1;
    v_total := v_total + r.amt;

    -- 1) La riga, una volta sola. Una riga gia' applicata non si rifa'.
    SELECT id INTO v_line_id FROM public.riba_distinta_lines WHERE distinta_id = d.id AND row_no = r.row_no;
    IF v_line_id IS NULL THEN
      INSERT INTO public.riba_distinta_lines (distinta_id, company_id, row_no, raw_supplier, raw_vat, raw_invoice, raw_causale, raw_amount, raw_due_date, match_status)
      VALUES (d.id, v_company, r.row_no, r.benef, r.vat, r.causale, r.causale, r.amt, r.due, 'unmatched')
      RETURNING id INTO v_line_id;
    ELSIF EXISTS (SELECT 1 FROM public.riba_distinta_lines WHERE id = v_line_id AND match_status = 'confirmed') THEN
      SELECT array_agg(u) INTO v_ids FROM (SELECT unnest(matched_payable_ids) u FROM public.riba_distinta_lines WHERE id = v_line_id) z;
      v_used := v_used || COALESCE(v_ids, ARRAY[]::uuid[]);
      v_conf := v_conf + 1;
      CONTINUE;
    END IF;

    -- 2) Le rate candidate: una lista di numeri (fatture col +, note di credito col -).
    SELECT jsonb_agg(jsonb_build_object('ord', o, 'num', num, 'sgn', sgn) ORDER BY o) INTO v_nums
    FROM (
      SELECT row_number() OVER () AS o, num, sgn FROM (
        SELECT ltrim(f #>> '{}', '0') AS num, 1 AS sgn FROM jsonb_array_elements(r.fatt) f
        UNION ALL
        SELECT ltrim(f #>> '{}', '0') AS num, -1 AS sgn FROM jsonb_array_elements(r.nc) f
      ) a WHERE num ~ '^\d+$'
    ) b;
    v_n := COALESCE(jsonb_array_length(v_nums), 0);
    v_best := NULL; v_best_dist := NULL; v_best_diff := NULL; v_second_dist := NULL; v_second_diff := NULL;
    v_best_unl := 0; v_second_unl := 0;

    IF v_n > 0 AND v_n <= 6 THEN
      FOR c IN
        WITH RECURSIVE nums AS (
          SELECT (e->>'ord')::int AS ord, e->>'num' AS num, (e->>'sgn')::int AS sgn FROM jsonb_array_elements(v_nums) e
        ), cand AS (
          SELECT n.ord, py.id, py.gross_amount::numeric AS g, abs(COALESCE(py.due_date, r.due) - r.due)::int AS dist,
                 (py.bank_transaction_id IS NULL)::int AS unl
          FROM nums n
          JOIN public.payables py ON py.company_id = v_company
           AND COALESCE(py.status::text, '') <> 'annullato'
           AND NOT COALESCE(py.is_placeholder, false)
           AND sign(COALESCE(py.gross_amount, 0)) = n.sgn
           AND COALESCE(py.invoice_number, '') ~ ('(^|[^0-9])0*' || n.num || '([^0-9]|$)')
           AND (regexp_replace(upper(COALESCE(py.supplier_vat, '')), '[^0-9]', '', 'g') = r.vat
                OR py.supplier_id IN (SELECT s.id FROM public.suppliers s
                                      WHERE s.company_id = v_company
                                        AND r.vat <> ''
                                        AND (regexp_replace(upper(COALESCE(s.vat_number, '')), '[^0-9]', '', 'g') = r.vat
                                             OR regexp_replace(upper(COALESCE(s.partita_iva, '')), '[^0-9]', '', 'g') = r.vat)))
           AND NOT (py.id = ANY (v_used))
        ), combo AS (
          SELECT c1.ord, ARRAY[c1.id] AS ids, c1.g AS total, c1.dist AS dist, c1.unl AS unl FROM cand c1 WHERE c1.ord = 1
          UNION ALL
          SELECT c2.ord, combo.ids || c2.id, combo.total + c2.g, combo.dist + c2.dist, combo.unl + c2.unl
          FROM combo JOIN cand c2 ON c2.ord = combo.ord + 1
        )
        -- A parita' di scadenza vince la combinazione con piu' rate gia' agganciate a un
        -- movimento della banca: due rate identiche (piani rate doppi) sono la stessa rata.
        SELECT ids, dist, unl, abs(total - r.amt) AS diff FROM combo
        WHERE ord = v_n AND abs(total - r.amt) <= 0.02
        ORDER BY dist, unl, abs(total - r.amt)
        LIMIT 2
      LOOP
        IF v_best IS NULL THEN
          v_best := c.ids; v_best_dist := c.dist; v_best_diff := c.diff; v_best_unl := c.unl;
        ELSE
          v_second_dist := c.dist; v_second_diff := c.diff; v_second_unl := c.unl;
        END IF;
      END LOOP;
    ELSIF v_n = 0 THEN
      -- Senza numeri: una sola rata del fornitore con la stessa scadenza e lo stesso importo.
      SELECT array_agg(py.id) INTO v_ids
      FROM public.payables py
      WHERE py.company_id = v_company
        AND COALESCE(py.status::text, '') <> 'annullato'
        AND NOT COALESCE(py.is_placeholder, false)
        AND abs(COALESCE(py.gross_amount, 0) - r.amt) <= 0.01
        AND py.due_date = r.due
        AND regexp_replace(upper(COALESCE(py.supplier_vat, '')), '[^0-9]', '', 'g') = r.vat
        AND r.vat <> ''
        AND NOT (py.id = ANY (v_used));
      IF COALESCE(array_length(v_ids, 1), 0) = 1 THEN
        v_best := v_ids; v_best_dist := 0; v_best_diff := 0;
      ELSIF COALESCE(array_length(v_ids, 1), 0) > 1 THEN
        v_best := NULL; v_second_dist := 0;
      END IF;
    END IF;

    -- Due combinazioni alla pari: non si sceglie.
    IF v_best IS NOT NULL AND v_second_dist IS NOT NULL
       AND v_second_dist = v_best_dist AND v_second_unl = v_best_unl AND v_second_diff = v_best_diff THEN
      v_best := NULL;
    END IF;

    IF v_best IS NULL THEN
      IF v_second_dist IS NOT NULL THEN
        v_amb := v_amb + 1;
        UPDATE public.riba_distinta_lines SET match_status = 'ambiguous', note = 'piu'' rate tornano con l''importo' WHERE id = v_line_id;
        v_key := 'riba-ambigua:' || d.id || ':' || r.row_no;
        IF public.fn_bank_doc_ask(v_company, NULL, 'riba_ambigua', v_key, NULL,
             format('Nella distinta %s c''e'' un effetto di %s a favore di %s con scadenza %s («%s»). Nel gestionale piu'' rate tornano con quell''importo e non so quali siano. Sai quali rate ha pagato?',
                    COALESCE(d.supporto, d.file_name, ''), public.fn_eur_it(r.amt), COALESCE(r.benef, '?'), to_char(r.due, 'DD/MM/YYYY'), left(COALESCE(r.causale, ''), 120)),
             jsonb_build_object('riba_distinta_id', d.id, 'row_no', r.row_no)) THEN
          v_dom := v_dom + 1;
          UPDATE public.bank_document_questions SET riba_distinta_id = d.id WHERE company_id = v_company AND subject_key = v_key AND status = 'aperta';
        END IF;
      ELSE
        v_nf := v_nf + 1;
        UPDATE public.riba_distinta_lines SET match_status = 'unmatched', note = 'rate non trovate' WHERE id = v_line_id;
        v_key := 'riba-non-trovata:' || d.id || ':' || r.row_no;
        IF public.fn_bank_doc_ask(v_company, NULL, 'riba_non_trovata', v_key, NULL,
             format('Nella distinta %s c''e'' un effetto di %s a favore di %s (P.IVA %s) con scadenza %s («%s»), ma nel gestionale non trovo rate che tornino. Le fatture sono registrate?',
                    COALESCE(d.supporto, d.file_name, ''), public.fn_eur_it(r.amt), COALESCE(r.benef, '?'), COALESCE(NULLIF(r.vat, ''), '?'),
                    to_char(r.due, 'DD/MM/YYYY'), left(COALESCE(r.causale, ''), 120)),
             jsonb_build_object('riba_distinta_id', d.id, 'row_no', r.row_no)) THEN
          v_dom := v_dom + 1;
          UPDATE public.bank_document_questions SET riba_distinta_id = d.id WHERE company_id = v_company AND subject_key = v_key AND status = 'aperta';
        END IF;
      END IF;
      CONTINUE;
    END IF;

    v_used := v_used || v_best;
    v_abb := v_abb + 1;

    -- 4) Effetto non ancora scaduto: riconosciuto, non applicato.
    IF r.due > (now() AT TIME ZONE 'Europe/Rome')::date THEN
      v_fut := v_fut + 1;
      UPDATE public.riba_distinta_lines SET match_status = 'matched', matched_payable_ids = v_best,
        matched_payable_id = v_best[1], note = 'in scadenza il ' || to_char(r.due, 'DD/MM/YYYY') WHERE id = v_line_id;
      CONTINUE;
    END IF;

    -- 3) Le rate riconosciute si allineano al documento.
    v_first_inv := NULL;
    FOR p IN SELECT * FROM public.payables WHERE id = ANY (v_best) ORDER BY gross_amount DESC LOOP
      IF p.gross_amount > 0 AND v_first_inv IS NULL THEN v_first_inv := p.id; END IF;
      v_note := to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY') || ': ' || v_label
                || ': effetto RiBa pagato il ' || to_char(r.due, 'DD/MM/YYYY') || ' (R27).';

      IF p.bank_transaction_id IS NOT NULL THEN
        CONTINUE;  -- gia' agganciata a un movimento: confermata, non si tocca
      END IF;

      IF p.gross_amount < 0 THEN
        -- Nota di credito compensata nell'effetto.
        IF NOT COALESCE(p.closed_manually, false) THEN
          UPDATE public.payables SET closed_manually = true,
            manual_close_reason = 'Compensata nella RiBa del ' || to_char(r.due, 'DD/MM/YYYY') || ' (' || v_label || ')',
            notes = CASE WHEN COALESCE(btrim(notes), '') = '' THEN v_note ELSE notes || E'\n' || v_note END
          WHERE id = p.id;
          INSERT INTO public.document_corrections (company_id, riba_distinta_id, document_label, target_table, target_id, field, old_value, new_value, reason)
          VALUES (v_company, d.id, v_label, 'payables', p.id, 'closed_manually', 'false', 'true', 'R27: nota di credito compensata nella distinta RiBa');
          INSERT INTO public.payable_actions (payable_id, action_type, old_status, new_status, amount, note, performed_by)
          VALUES (p.id, 'conferma_distinta_riba', p.status, p.status, p.gross_amount, v_note, v_uid);
          v_closed := v_closed || p.id;
        END IF;
        CONTINUE;
      END IF;

      IF COALESCE(p.amount_paid, 0) >= p.gross_amount AND p.payment_date = r.due AND NOT COALESCE(p.is_provisional_paid, false) THEN
        CONTINUE;  -- gia' come dice il documento
      END IF;

      UPDATE public.payables SET
        amount_paid = GREATEST(COALESCE(amount_paid, 0), gross_amount),
        payment_date = r.due,
        is_provisional_paid = false,
        notes = CASE WHEN COALESCE(btrim(notes), '') = '' THEN v_note ELSE notes || E'\n' || v_note END
      WHERE id = p.id;
      IF COALESCE(p.amount_paid, 0) < p.gross_amount THEN
        INSERT INTO public.document_corrections (company_id, riba_distinta_id, document_label, target_table, target_id, field, old_value, new_value, reason)
        VALUES (v_company, d.id, v_label, 'payables', p.id, 'amount_paid', COALESCE(p.amount_paid, 0)::text, p.gross_amount::text, 'R27: effetto pagato secondo la distinta RiBa');
      END IF;
      IF p.payment_date IS DISTINCT FROM r.due THEN
        INSERT INTO public.document_corrections (company_id, riba_distinta_id, document_label, target_table, target_id, field, old_value, new_value, reason)
        VALUES (v_company, d.id, v_label, 'payables', p.id, 'payment_date', p.payment_date::text, r.due::text, 'R27: scadenza dell''effetto nella distinta RiBa');
      END IF;
      IF COALESCE(p.is_provisional_paid, false) THEN
        INSERT INTO public.document_corrections (company_id, riba_distinta_id, document_label, target_table, target_id, field, old_value, new_value, reason)
        VALUES (v_company, d.id, v_label, 'payables', p.id, 'is_provisional_paid', 'true', 'false', 'R27: chiusura provvisoria confermata dalla distinta RiBa');
      END IF;
      INSERT INTO public.payable_actions (payable_id, action_type, old_status, new_status, amount, note, performed_by)
      SELECT p.id, 'conferma_distinta_riba', p.status, py.status, py.gross_amount, v_note, v_uid FROM public.payables py WHERE py.id = p.id;
      v_closed := v_closed || p.id;
    END LOOP;

    -- Note di credito: collegamento alla fattura dell'effetto.
    IF v_first_inv IS NOT NULL THEN
      INSERT INTO public.payable_credit_note_links (company_id, payable_id, credit_note_payable_id, amount, status, created_by, applied_at, origin)
      SELECT v_company, v_first_inv, py.id, abs(py.gross_amount), 'applied', v_uid, now(), 'distinta_riba'
      FROM public.payables py WHERE py.id = ANY (v_best) AND py.gross_amount < 0
      ON CONFLICT (payable_id, credit_note_payable_id) DO NOTHING;
    END IF;

    IF EXISTS (SELECT 1 FROM public.payables WHERE id = ANY (v_best) AND id = ANY (v_closed)) THEN
      v_corr := v_corr + 1;
    ELSE
      v_conf := v_conf + 1;
    END IF;
    UPDATE public.riba_distinta_lines SET match_status = 'confirmed', matched_payable_ids = v_best,
      matched_payable_id = v_best[1], matched_supplier_id = (SELECT supplier_id FROM public.payables WHERE id = v_best[1]),
      note = CASE WHEN v_best_diff > 0 THEN 'arrotondamento rate ' || v_best_diff::text || ' €' ELSE NULL END
    WHERE id = v_line_id;
  END LOOP;

  -- 5) L'addebito «effetti ritirati» sul conto della distinta.
  v_conto := regexp_replace(COALESCE(p_conto, d.conto_testo, ''), '[^0-9]', '', 'g');
  IF length(v_conto) >= 22 AND array_length(v_closed, 1) > 0 THEN
    SELECT ba.id INTO v_account FROM public.bank_accounts ba
    WHERE ba.company_id = v_company
      AND right(regexp_replace(upper(COALESCE(NULLIF(ba.iban, ''), ba.account_name, '')), '[^0-9A-Z]', '', 'g'), 22) = right(v_conto, 22)
    ORDER BY (ba.acube_account_uuid IS NOT NULL) DESC, COALESCE(ba.is_active, true) DESC LIMIT 1;
    IF v_account IS NOT NULL THEN
      SELECT array_agg(bt.id) INTO v_ids FROM public.bank_transactions bt
      WHERE bt.company_id = v_company AND bt.bank_account_id = v_account AND bt.amount < 0
        AND bt.transaction_date BETWEEN (SELECT min((x->>'due_date')::date) FROM jsonb_array_elements(p_lines) x) - 1
                                    AND (SELECT max((x->>'due_date')::date) FROM jsonb_array_elements(p_lines) x) + 7
        AND bt.description ~* '(EFFETT|RI\.? ?BA|RITIRO)'
        AND -bt.amount >= v_total - 0.005 AND -bt.amount <= v_total + v_disp * 1.00;
      IF COALESCE(array_length(v_ids, 1), 0) = 1 THEN
        v_debit_id := v_ids[1];
        SELECT * INTO v_debit FROM public.bank_transactions WHERE id = v_debit_id;
        v_debit_date := v_debit.transaction_date;
        v_debit_amt := -v_debit.amount;
        FOR p IN SELECT * FROM public.payables WHERE id = ANY (v_closed) AND bank_transaction_id IS NULL AND gross_amount > 0 LOOP
          UPDATE public.payables SET bank_transaction_id = v_debit_id WHERE id = p.id;
          INSERT INTO public.document_corrections (company_id, riba_distinta_id, document_label, target_table, target_id, field, old_value, new_value, reason)
          VALUES (v_company, d.id, v_label, 'payables', p.id, 'bank_transaction_id', NULL, v_debit_id::text, 'R27: addebito effetti ritirati della distinta');
          INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, notes, performed_by, confirmed_at, applied_amount)
          VALUES (v_company, v_debit_id, p.id, 'auto_exact', 1, 'applied', v_label || ': effetto RiBa (R27)', v_uid, now(), p.gross_amount);
          v_agg := v_agg + 1;
        END LOOP;
        UPDATE public.reconciliation_log rl SET status = 'rejected',
          notes = COALESCE(rl.notes, '') || ' | archiviata il ' || to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY') || ': addebito della distinta RiBa (R27)'
        WHERE rl.bank_transaction_id = v_debit_id AND rl.status = 'to_confirm';
        UPDATE public.bank_transactions SET is_reconciled = true, reconciled_at = COALESCE(reconciled_at, now())
        WHERE id = v_debit_id AND NOT COALESCE(is_reconciled, false);
      END IF;
    END IF;
  END IF;

  v_summary := jsonb_build_object(
    'disposizioni', v_disp, 'totale', v_total,
    'riconosciute', v_abb, 'confermate', v_conf, 'corrette', v_corr,
    'in_scadenza', v_fut, 'ambigue', v_amb, 'non_trovate', v_nf, 'domande_nuove', v_dom,
    'addebito', CASE WHEN v_debit_id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', v_debit_id, 'data', v_debit_date, 'importo', v_debit_amt, 'rate_agganciate', v_agg) END
  );

  UPDATE public.riba_distinte SET
    status = 'confermata',
    bank_account_id = COALESCE(bank_account_id, v_account),
    conto_testo = COALESCE(conto_testo, NULLIF(p_conto, '')),
    declared_total = COALESCE(declared_total, v_total),
    line_count = v_disp,
    matched_count = (SELECT count(*) FROM public.riba_distinta_lines WHERE distinta_id = d.id AND match_status IN ('confirmed', 'matched')),
    matched_total = (SELECT sum(raw_amount) FROM public.riba_distinta_lines WHERE distinta_id = d.id AND match_status = 'confirmed'),
    confirmed_at = COALESCE(confirmed_at, now()),
    applied_at = now(),
    applied_summary = v_summary
  WHERE id = d.id;

  RETURN v_summary;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_riba_distinta(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_riba_distinta(uuid, jsonb, text) TO authenticated;
