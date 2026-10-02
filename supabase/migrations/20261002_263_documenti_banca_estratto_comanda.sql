-- ============================================================================
-- 263 — Documenti banca: l'estratto conto comanda (R27) e le domande in chat (R28)
-- ============================================================================
-- Regole in RICONCILIAZIONE_REGOLE.md (R27, R28), fissate da Patrizio il 02/10/2026.
--
-- Cosa aggiunge (solo cose nuove, nessuna colonna tolta, nessun dato cancellato):
--   1. bank_statements: impronta del file (ricaricare non duplica), esito della
--      quadratura, riepilogo dell'applicazione.
--   2. bank_transactions.statement_confirmed_at: il movimento e' confermato da un
--      documento della banca (statement_id dice quale).
--   3. bank_statement_lines: le righe lette dall'estratto, con l'esito di ognuna.
--   4. document_corrections: ogni valore che un documento sovrascrive, col vecchio
--      e il nuovo. E' la traccia chiesta dalla R27.
--   5. bank_document_questions + bank_document_messages: la chat con Sabrina (R28).
--   6. apply_bank_statement(): applica un estratto conto corrente riga per riga.
--   7. trigger di adozione: quando l'open banking porta un movimento che l'estratto
--      aveva gia' inserito, non si crea un doppione, si completa la riga esistente.
--
-- Nota tecnica: niente DROP in questo file. Il connettore Supabase tratta ogni
-- istruzione con DROP come distruttiva e resta in attesa di una conferma.
--
-- Parita' tenant: NZ -> Made -> Zago, identica.
-- ============================================================================

BEGIN;

-- ── 1. bank_statements ──────────────────────────────────────────────────────
ALTER TABLE public.bank_statements
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS balance_check jsonb,
  ADD COLUMN IF NOT EXISTS applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS applied_summary jsonb;

COMMENT ON COLUMN public.bank_statements.content_hash IS
  'SHA-256 del file caricato: lo stesso file ricaricato si riconosce e non produce effetti doppi (R27).';
COMMENT ON COLUMN public.bank_statements.balance_check IS
  'Quadratura: saldo iniziale + movimenti = saldo finale, sul documento e sul gestionale (R27).';

CREATE UNIQUE INDEX IF NOT EXISTS bank_statements_content_hash_uq
  ON public.bank_statements (company_id, content_hash) WHERE content_hash IS NOT NULL;

-- ── 2. bank_transactions ────────────────────────────────────────────────────
ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS statement_confirmed_at timestamptz;

COMMENT ON COLUMN public.bank_transactions.statement_confirmed_at IS
  'Quando un documento della banca (statement_id) ha confermato questo movimento (R27).';

-- ── 3. righe dell'estratto ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bank_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  statement_id uuid NOT NULL REFERENCES public.bank_statements(id) ON DELETE CASCADE,
  row_no integer NOT NULL,
  booking_date date NOT NULL,
  value_date date,
  amount numeric(14,2) NOT NULL,
  sign_known boolean NOT NULL DEFAULT true,
  description text,
  flusso_cbi text,
  bank_transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE SET NULL,
  outcome text NOT NULL CHECK (outcome IN ('confermato', 'corretto', 'inserito', 'ambiguo', 'altro_conto', 'non_inserito')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (statement_id, row_no)
);
CREATE INDEX IF NOT EXISTS bank_statement_lines_bt_idx
  ON public.bank_statement_lines (bank_transaction_id) WHERE bank_transaction_id IS NOT NULL;

COMMENT ON TABLE public.bank_statement_lines IS
  'Righe lette da un estratto conto corrente e cosa ne e'' stato fatto (R27).';

-- ── 4. correzioni fatte da un documento ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.document_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  statement_id uuid REFERENCES public.bank_statements(id) ON DELETE SET NULL,
  document_label text,
  target_table text NOT NULL,
  target_id uuid NOT NULL,
  field text NOT NULL,
  old_value text,
  new_value text,
  reason text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_corrections_target_idx
  ON public.document_corrections (target_table, target_id);

COMMENT ON TABLE public.document_corrections IS
  'Ogni valore sovrascritto da un documento della banca, con il vecchio e il nuovo (R27). Mai cancellare.';

-- ── 5. chat con Sabrina ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bank_document_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  statement_id uuid REFERENCES public.bank_statements(id) ON DELETE SET NULL,
  kind text NOT NULL,
  subject_key text NOT NULL,
  bank_transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE SET NULL,
  question text NOT NULL,
  context jsonb,
  status text NOT NULL DEFAULT 'aperta' CHECK (status IN ('aperta', 'risolta', 'archiviata')),
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Una sola domanda aperta per lo stesso argomento: ricaricare non la ripete.
CREATE UNIQUE INDEX IF NOT EXISTS bank_document_questions_open_uq
  ON public.bank_document_questions (company_id, subject_key) WHERE status = 'aperta';
CREATE INDEX IF NOT EXISTS bank_document_questions_status_idx
  ON public.bank_document_questions (company_id, status, created_at);

CREATE TABLE IF NOT EXISTS public.bank_document_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  question_id uuid NOT NULL REFERENCES public.bank_document_questions(id) ON DELETE CASCADE,
  author text NOT NULL CHECK (author IN ('sistema', 'utente')),
  author_id uuid,
  body text NOT NULL,
  action jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bank_document_messages_q_idx
  ON public.bank_document_messages (question_id, created_at);

COMMENT ON TABLE public.bank_document_questions IS
  'Cose che dopo un caricamento non tornano e che solo una persona puo'' decidere: si chiedono in chat (R28).';

-- RLS: si legge la propria azienda; si scrive con i ruoli che lavorano la banca.
-- La traccia delle correzioni (document_corrections) non si scrive da client:
-- solo le funzioni SECURITY DEFINER qui sotto.
ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_document_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_document_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY bank_statement_lines_select ON public.bank_statement_lines FOR SELECT USING (company_id = public.get_my_company_id());
CREATE POLICY bank_statement_lines_write ON public.bank_statement_lines FOR ALL USING (company_id = public.get_my_company_id() AND public.get_my_role() IN ('super_advisor', 'cfo', 'contabile')) WITH CHECK (company_id = public.get_my_company_id() AND public.get_my_role() IN ('super_advisor', 'cfo', 'contabile'));
CREATE POLICY document_corrections_select ON public.document_corrections FOR SELECT USING (company_id = public.get_my_company_id());
CREATE POLICY bank_document_questions_select ON public.bank_document_questions FOR SELECT USING (company_id = public.get_my_company_id());
CREATE POLICY bank_document_questions_write ON public.bank_document_questions FOR ALL USING (company_id = public.get_my_company_id() AND public.get_my_role() IN ('super_advisor', 'cfo', 'contabile')) WITH CHECK (company_id = public.get_my_company_id() AND public.get_my_role() IN ('super_advisor', 'cfo', 'contabile'));
CREATE POLICY bank_document_messages_select ON public.bank_document_messages FOR SELECT USING (company_id = public.get_my_company_id());
CREATE POLICY bank_document_messages_write ON public.bank_document_messages FOR ALL USING (company_id = public.get_my_company_id() AND public.get_my_role() IN ('super_advisor', 'cfo', 'contabile')) WITH CHECK (company_id = public.get_my_company_id() AND public.get_my_role() IN ('super_advisor', 'cfo', 'contabile'));

-- ── 6. importi all'italiana nelle domande ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_eur_it(p numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN p IS NULL THEN NULL ELSE
    translate(to_char(p, 'FM999,999,990.00'), ',.', '.,') || ' €' END;
$function$;

-- Parole (5+ caratteri) di a che compaiono in b: serve a scegliere fra movimenti
-- con lo stesso importo usando la causale (codice del bonifico, beneficiario).
CREATE OR REPLACE FUNCTION public.fn_text_overlap(a text, b text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT count(DISTINCT w)::int
  FROM regexp_split_to_table(upper(COALESCE(a, '')), '[^A-Z0-9]+') AS w
  WHERE length(w) >= 5 AND position(w IN upper(COALESCE(b, ''))) > 0;
$function$;

-- ── 6a. domanda in chat (uso interno) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bank_doc_ask(
  p_company uuid, p_statement uuid, p_kind text, p_key text, p_bt uuid, p_text text, p_context jsonb DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.bank_document_questions (company_id, statement_id, kind, subject_key, bank_transaction_id, question, context)
  VALUES (p_company, p_statement, p_kind, p_key, p_bt, p_text, p_context)
  ON CONFLICT (company_id, subject_key) WHERE status = 'aperta' DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN false; END IF;
  INSERT INTO public.bank_document_messages (company_id, question_id, author, body)
  VALUES (p_company, v_id, 'sistema', p_text);
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_bank_doc_ask(uuid, uuid, text, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ── 6b. applicazione di un estratto conto corrente ──────────────────────────
-- p_rows: [{row_no, date, value_date, amount, sign_known, description, flusso_cbi, beneficiario}]
--   amount col segno di conto (uscita negativa). sign_known=false quando il file
--   (PDF) non dice dare/avere: l'importo e' in valore assoluto.
-- p_opening / p_closing: saldi dichiarati dal documento, se letti.
-- p_edge_days: giorni ai bordi del periodo esclusi dal controllo «movimento che
--   l'estratto non contiene».
-- Collaudata su NZ il 02/10/2026 con i movimenti di agosto del conto Intesa, in
-- transazione annullata: conferma, correzione di data, inserimento, domanda sul
-- movimento assente, quadratura, ricaricamento senza effetti doppi.
CREATE OR REPLACE FUNCTION public.apply_bank_statement(
  p_statement_id uuid,
  p_rows jsonb,
  p_opening numeric DEFAULT NULL,
  p_closing numeric DEFAULT NULL,
  p_edge_days integer DEFAULT 0
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
        AND b.transaction_date BETWEEN r.d - 10 AND r.d + 10
        AND (regexp_match(COALESCE(b.description, ''), 'ID FLUSSO CBI:\s*(\d+)', 'i'))[1] = r.cbi
        AND NOT (b.id = ANY (v_used));
      IF COALESCE(array_length(v_ids, 1), 0) = 1 THEN v_match := v_ids[1]; END IF;
    END IF;

    -- 2) Stesso importo al centesimo, data entro 3 giorni. Il PDF perde il segno:
    --    in quel caso si confronta il valore assoluto.
    IF v_match IS NULL THEN
      SELECT array_agg(b.id ORDER BY abs(b.transaction_date - r.d), b.id) INTO v_ids FROM public.bank_transactions b
      WHERE b.company_id = v_company AND b.bank_account_id = st.bank_account_id
        AND b.transaction_date BETWEEN r.d - 3 AND r.d + 3
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
          SELECT array_agg(b.id) INTO v_ids FROM public.bank_transactions b
          WHERE b.id = ANY (v_cand) AND b.transaction_date = r.d;
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

    IF v_match IS NOT NULL THEN
      v_used := v_used || v_match;
      SELECT b.id, b.transaction_date, b.value_date, b.amount, b.is_reconciled INTO m
      FROM public.bank_transactions b WHERE b.id = v_match;
      v_outcome := 'confermato';

      -- L'estratto comanda: data e importo si allineano al documento. Prima si
      -- aggiorna, poi si scrive la traccia.
      v_amt_doc := CASE WHEN r.sk THEN r.amt ELSE sign(m.amount) * abs(r.amt) END;
      BEGIN
        UPDATE public.bank_transactions bt SET
          transaction_date = r.d,
          booking_date = r.d,
          value_date = COALESCE(r.vd, bt.value_date),
          amount = v_amt_doc,
          statement_id = st.id,
          statement_confirmed_at = now(),
          statement_source = st.filename,
          statement_description = CASE
            WHEN r.descr IS NOT NULL AND r.descr IS DISTINCT FROM bt.description THEN r.descr
            ELSE bt.statement_description END,
          statement_enriched_at = CASE
            WHEN r.descr IS NOT NULL AND r.descr IS DISTINCT FROM bt.description
             AND r.descr IS DISTINCT FROM bt.statement_description THEN now()
            ELSE bt.statement_enriched_at END,
          counterpart = COALESCE(NULLIF(btrim(bt.counterpart), ''), r.benef)
        WHERE bt.id = m.id;
      EXCEPTION WHEN unique_violation THEN
        v_outcome := 'ambiguo';
        v_note := 'la correzione la renderebbe identica a un altro movimento';
      END;

      IF v_outcome = 'confermato' THEN
        IF m.transaction_date <> r.d THEN
          INSERT INTO public.document_corrections (company_id, statement_id, document_label, target_table, target_id, field, old_value, new_value, reason)
          VALUES (v_company, st.id, v_label, 'bank_transactions', m.id, 'transaction_date', m.transaction_date::text, r.d::text, 'R27: data contabile dell''estratto conto');
          v_outcome := 'corretto';
        END IF;
        IF r.vd IS NOT NULL AND m.value_date IS DISTINCT FROM r.vd THEN
          INSERT INTO public.document_corrections (company_id, statement_id, document_label, target_table, target_id, field, old_value, new_value, reason)
          VALUES (v_company, st.id, v_label, 'bank_transactions', m.id, 'value_date', m.value_date::text, r.vd::text, 'R27: data valuta dell''estratto conto');
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
        AND b.transaction_date BETWEEN r.d - 3 AND r.d + 3
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
            v_company, st.bank_account_id, r.d, r.d, COALESCE(r.vd, r.d), r.amt, 'EUR',
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

  -- Movimenti del gestionale che l'estratto non contiene: mai cancellati, si chiede.
  FOR m IN
    SELECT b.id, b.transaction_date, b.amount, b.description FROM public.bank_transactions b
    WHERE b.company_id = v_company AND b.bank_account_id = st.bank_account_id
      AND b.transaction_date BETWEEN v_from + p_edge_days AND v_to - p_edge_days
      AND NOT (b.id = ANY (v_used))
      AND NOT (b.id = ANY (v_pending))
  LOOP
    IF public.fn_bank_doc_ask(v_company, st.id, 'movimento_non_in_estratto', 'bt-non-in-estratto:' || m.id, m.id,
         format('Nel gestionale c''e'' un movimento del %s di %s («%s») che l''estratto %s non contiene. Potrebbe essere un doppione arrivato dall''open banking. Lo conosci?',
                to_char(m.transaction_date, 'DD/MM/YYYY'), public.fn_eur_it(m.amount),
                left(COALESCE(m.description, ''), 120), COALESCE(st.filename, '')),
         NULL) THEN v_domande := v_domande + 1; END IF;
  END LOOP;

  -- Quadratura. Sul documento: saldo iniziale + righe = saldo finale. Sul
  -- gestionale: somma dei movimenti del conto nel periodo contro somma delle righe.
  SELECT COALESCE(sum(b.amount), 0) INTO v_sum_bt
  FROM public.bank_transactions b
  WHERE b.company_id = v_company AND b.bank_account_id = st.bank_account_id
    AND b.transaction_date BETWEEN v_from AND v_to;

  v_check := jsonb_build_object(
    'periodo_da', v_from, 'periodo_a', v_to,
    'saldo_iniziale', p_opening, 'saldo_finale', p_closing,
    'somma_righe', CASE WHEN v_all_signed THEN round(v_sum_rows, 2) END,
    'somma_gestionale', round(v_sum_bt, 2),
    'scarto_documento', CASE WHEN v_all_signed AND p_opening IS NOT NULL AND p_closing IS NOT NULL
                             THEN round(p_opening + v_sum_rows - p_closing, 2) END,
    'scarto_gestionale', CASE WHEN v_all_signed THEN round(v_sum_bt - v_sum_rows, 2) END
  );

  IF v_all_signed AND round(v_sum_bt - v_sum_rows, 2) <> 0 THEN
    IF public.fn_bank_doc_ask(v_company, st.id, 'quadratura', 'quadratura:' || st.id, NULL,
         format('Dopo aver letto l''estratto %s, i movimenti del gestionale dal %s al %s fanno %s, l''estratto %s. Scarto %s. Le righe che lo spiegano sono nelle altre domande di questo estratto.',
                COALESCE(st.filename, ''), to_char(v_from, 'DD/MM/YYYY'), to_char(v_to, 'DD/MM/YYYY'),
                public.fn_eur_it(v_sum_bt), public.fn_eur_it(v_sum_rows),
                public.fn_eur_it(v_sum_bt - v_sum_rows)),
         v_check) THEN v_domande := v_domande + 1; END IF;
  END IF;

  v_summary := jsonb_build_object(
    'righe', v_righe,
    'confermati', v_conf, 'corretti', v_corr, 'inseriti', v_ins,
    'ambigui', v_amb, 'altro_conto', v_altro, 'non_inseriti', v_noins,
    'domande_nuove', v_domande, 'quadratura', v_check
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

-- ── 7. adozione: l'open banking porta un movimento gia' inserito dall'estratto ──
-- Senza questo, la riga «estratto_conto» e quella «acube_ob» sarebbero due. La
-- riga dell'estratto resta (il documento comanda: data e importo restano i suoi)
-- e riceve l'identita' A-Cube, cosi' le sincronizzazioni successive la riconoscono.
CREATE OR REPLACE FUNCTION public.trg_bank_tx_adopt_estratto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF NEW.source IS DISTINCT FROM 'acube_ob' OR NEW.bank_account_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT b.id INTO v_id
  FROM public.bank_transactions b
  WHERE b.company_id = NEW.company_id
    AND b.bank_account_id = NEW.bank_account_id
    AND b.source = 'estratto_conto'
    AND b.acube_dedup_hash IS NULL
    AND b.acube_transaction_id IS NULL
    AND b.amount = NEW.amount
    AND abs(b.transaction_date - NEW.transaction_date) <= 4
  ORDER BY abs(b.transaction_date - NEW.transaction_date), b.created_at, b.id
  LIMIT 1
  FOR UPDATE;
  IF v_id IS NULL THEN
    RETURN NEW;
  END IF;
  UPDATE public.bank_transactions SET
    acube_dedup_hash = NEW.acube_dedup_hash,
    raw_data = COALESCE(raw_data, NEW.raw_data),
    counterpart_name = COALESCE(counterpart_name, NEW.counterpart_name),
    merchant_name = COALESCE(merchant_name, NEW.merchant_name),
    note = concat_ws(E'\n', note, 'Arrivato anche dall''open banking il ' || to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY') || ': tenuta la riga dell''estratto (R27).')
  WHERE id = v_id;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE TRIGGER trg_bank_tx_adopt_estratto
  BEFORE INSERT ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_bank_tx_adopt_estratto();

COMMIT;
