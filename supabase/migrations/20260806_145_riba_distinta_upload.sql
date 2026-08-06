-- ============================================================================
-- 20260806_145_riba_distinta_upload.sql
-- FASE 2 — RiBa: upload distinta con VERIFICA al centesimo (non "a fiducia")
-- ----------------------------------------------------------------------------
-- Regola (Patrizio): quando si carica la distinta della ricevuta bancaria, il
-- sistema deve VERIFICARE il contenuto e gli IMPORTI e chiudere SOLO cio' che
-- riscontra AL CENTESIMO (match esatto importo per importo), mai a fiducia. Le
-- righe che non quadrano restano da verificare e NON chiudono nulla.
--
-- Flusso: upload file (PDF/CSV/XLSX) -> righe distinta (fornitore/fattura/
-- importo/scadenza) -> automatch alle scadenze RiBa (provvisorie o aperte) per
-- IMPORTO ESATTO (+ numero fattura / fornitore per disambiguare) -> conferma:
-- ogni riga confermata rende DEFINITIVA la RiBa provvisoria (o chiude la RiBa
-- aperta), tracciata nel partitario. La distinta e le sue righe restano storiche.
--
-- Additiva, idempotente, non distruttiva. Applicare su NZ + Made + Zago.
-- ============================================================================

BEGIN;

-- 1) Storage bucket per i file distinta (privato) ----------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('riba-distinte', 'riba-distinte', false)
ON CONFLICT (id) DO NOTHING;

-- Policy: lettura/scrittura ai soli autenticati (come pattern bucket 'media').
DO $policies$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='riba_distinte_read') THEN
    CREATE POLICY "riba_distinte_read" ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'riba-distinte');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='riba_distinte_write') THEN
    CREATE POLICY "riba_distinte_write" ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'riba-distinte');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='riba_distinte_del') THEN
    CREATE POLICY "riba_distinte_del" ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'riba-distinte');
  END IF;
END
$policies$;

-- 2) Tabella testata distinta ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.riba_distinte (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NOT NULL,
  file_path text,                         -- path nel bucket riba-distinte
  file_name text,
  source_kind text NOT NULL DEFAULT 'pdf' CHECK (source_kind IN ('pdf','csv','xlsx','manual')),
  bank_account_id uuid REFERENCES public.bank_accounts(id),
  declared_total numeric(14,2),           -- totale dichiarato in distinta (se noto)
  matched_total numeric(14,2) NOT NULL DEFAULT 0,
  line_count integer NOT NULL DEFAULT 0,
  matched_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'bozza' CHECK (status IN ('bozza','confermata')),
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_riba_distinte_company ON public.riba_distinte (company_id, created_at DESC);

-- 3) Tabella righe distinta --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.riba_distinta_lines (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  distinta_id uuid NOT NULL REFERENCES public.riba_distinte(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  raw_supplier text,
  raw_invoice text,
  raw_amount numeric(14,2),
  raw_due_date date,
  matched_payable_id uuid REFERENCES public.payables(id) ON DELETE SET NULL,
  -- unmatched: nessuna scadenza esatta; matched: candidato unico al centesimo;
  -- ambiguous: piu' candidati al centesimo; confirmed: confermata e chiusa.
  match_status text NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched','matched','ambiguous','confirmed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_riba_distinta_lines_distinta ON public.riba_distinta_lines (distinta_id);

-- 4) RLS ---------------------------------------------------------------------
ALTER TABLE public.riba_distinte ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.riba_distinta_lines ENABLE ROW LEVEL SECURITY;

DO $rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='riba_distinte' AND policyname='riba_distinte_company_sel') THEN
    CREATE POLICY "riba_distinte_company_sel" ON public.riba_distinte FOR SELECT TO authenticated
      USING (company_id = public.get_my_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='riba_distinte' AND policyname='riba_distinte_company_ins') THEN
    CREATE POLICY "riba_distinte_company_ins" ON public.riba_distinte FOR INSERT TO authenticated
      WITH CHECK (company_id = public.get_my_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='riba_distinte' AND policyname='riba_distinte_company_upd') THEN
    CREATE POLICY "riba_distinte_company_upd" ON public.riba_distinte FOR UPDATE TO authenticated
      USING (company_id = public.get_my_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='riba_distinte' AND policyname='riba_distinte_company_del') THEN
    CREATE POLICY "riba_distinte_company_del" ON public.riba_distinte FOR DELETE TO authenticated
      USING (company_id = public.get_my_company_id());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='riba_distinta_lines' AND policyname='riba_distinta_lines_company_sel') THEN
    CREATE POLICY "riba_distinta_lines_company_sel" ON public.riba_distinta_lines FOR SELECT TO authenticated
      USING (company_id = public.get_my_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='riba_distinta_lines' AND policyname='riba_distinta_lines_company_ins') THEN
    CREATE POLICY "riba_distinta_lines_company_ins" ON public.riba_distinta_lines FOR INSERT TO authenticated
      WITH CHECK (company_id = public.get_my_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='riba_distinta_lines' AND policyname='riba_distinta_lines_company_upd') THEN
    CREATE POLICY "riba_distinta_lines_company_upd" ON public.riba_distinta_lines FOR UPDATE TO authenticated
      USING (company_id = public.get_my_company_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='riba_distinta_lines' AND policyname='riba_distinta_lines_company_del') THEN
    CREATE POLICY "riba_distinta_lines_company_del" ON public.riba_distinta_lines FOR DELETE TO authenticated
      USING (company_id = public.get_my_company_id());
  END IF;
END
$rls$;

-- 5) Helper: una payable e' RiBa? (fattura o piano fornitore) -----------------
CREATE OR REPLACE FUNCTION public.fn_payable_is_riba(p_payable_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(p.payment_method::text, s.payment_method::text, s.default_payment_method::text) LIKE 'riba%'
  FROM public.payables p
  LEFT JOIN public.suppliers s ON s.id = p.supplier_id
  WHERE p.id = p_payable_id;
$function$;

-- 6) Automatch: aggancia ogni riga a una scadenza RiBa AL CENTESIMO -----------
--    Candidati = RiBa aperte o provvisorie, stessa azienda, senza movimento
--    reale, con gross_amount == importo riga AL CENTESIMO. Disambiguazione per
--    numero fattura, poi per nome fornitore. 1 candidato -> matched; >1 -> ambiguous.
CREATE OR REPLACE FUNCTION public.rpc_automatch_riba_distinta(p_distinta_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid;
  v_role text;
  v_line RECORD;
  v_match uuid;
  v_cnt_all integer;
  v_cnt integer;
  v_matched integer := 0;
  v_ambiguous integer := 0;
  v_unmatched integer := 0;
BEGIN
  SELECT company_id, role INTO v_company, v_role FROM public.user_profiles WHERE id = auth.uid();
  IF COALESCE(v_role,'') NOT IN ('super_advisor','contabile') THEN
    RAISE EXCEPTION 'Non autorizzato: serve il ruolo contabile o super_advisor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.riba_distinte d WHERE d.id = p_distinta_id AND d.company_id = v_company) THEN
    RAISE EXCEPTION 'Distinta non trovata o non accessibile';
  END IF;

  FOR v_line IN
    SELECT * FROM public.riba_distinta_lines
    WHERE distinta_id = p_distinta_id AND match_status <> 'confirmed'
  LOOP
    v_match := NULL;
    v_cnt_all := 0;

    IF v_line.raw_amount IS NOT NULL THEN
      -- candidati RiBa (aperte o provvisorie), importo ESATTO al centesimo,
      -- materializzati in una temp per riusarli nei passi di disambiguazione.
      CREATE TEMP TABLE _riba_cand ON COMMIT DROP AS
        SELECT p.id,
               upper(regexp_replace(COALESCE(p.invoice_number,''), '\s', '', 'g')) AS inv_norm,
               upper(COALESCE(s.name, p.supplier_name, '')) AS sup_name
        FROM public.payables p
        LEFT JOIN public.suppliers s ON s.id = p.supplier_id
        WHERE p.company_id = v_company
          AND p.gross_amount > 0
          AND COALESCE(p.is_placeholder,false) = false
          AND p.bank_transaction_id IS NULL
          AND (p.status IN ('da_pagare','in_scadenza','scaduto') OR COALESCE(p.is_provisional_paid,false))
          AND COALESCE(p.payment_method::text, s.payment_method::text, s.default_payment_method::text) LIKE 'riba%'
          AND round(p.gross_amount * 100)::bigint = round(v_line.raw_amount * 100)::bigint;

      SELECT count(*) INTO v_cnt_all FROM _riba_cand;

      IF v_cnt_all = 1 THEN
        SELECT id INTO v_match FROM _riba_cand;
      ELSIF v_cnt_all > 1 THEN
        -- disambigua per numero fattura esatto
        IF v_line.raw_invoice IS NOT NULL THEN
          SELECT count(*) INTO v_cnt FROM _riba_cand
          WHERE inv_norm = upper(regexp_replace(v_line.raw_invoice, '\s', '', 'g')) AND inv_norm <> '';
          IF v_cnt = 1 THEN
            SELECT id INTO v_match FROM _riba_cand
            WHERE inv_norm = upper(regexp_replace(v_line.raw_invoice, '\s', '', 'g')) AND inv_norm <> '';
          END IF;
        END IF;
        -- se ancora ambiguo, prova per prima parola del nome fornitore
        IF v_match IS NULL AND v_line.raw_supplier IS NOT NULL AND length(trim(v_line.raw_supplier)) > 0 THEN
          SELECT count(*) INTO v_cnt FROM _riba_cand
          WHERE sup_name LIKE '%' || upper(split_part(trim(v_line.raw_supplier), ' ', 1)) || '%';
          IF v_cnt = 1 THEN
            SELECT id INTO v_match FROM _riba_cand
            WHERE sup_name LIKE '%' || upper(split_part(trim(v_line.raw_supplier), ' ', 1)) || '%';
          END IF;
        END IF;
      END IF;

      DROP TABLE _riba_cand;
    END IF;

    IF v_match IS NOT NULL THEN
      UPDATE public.riba_distinta_lines SET matched_payable_id = v_match, match_status = 'matched' WHERE id = v_line.id;
      v_matched := v_matched + 1;
    ELSIF v_cnt_all > 1 THEN
      UPDATE public.riba_distinta_lines SET matched_payable_id = NULL, match_status = 'ambiguous' WHERE id = v_line.id;
      v_ambiguous := v_ambiguous + 1;
    ELSE
      UPDATE public.riba_distinta_lines SET matched_payable_id = NULL, match_status = 'unmatched' WHERE id = v_line.id;
      v_unmatched := v_unmatched + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('matched', v_matched, 'ambiguous', v_ambiguous, 'unmatched', v_unmatched);
END;
$function$;

-- 7) Conferma UNA riga: rende definitiva la RiBa, SOLO se importo esatto -------
CREATE OR REPLACE FUNCTION public.rpc_confirm_riba_distinta_line(p_line_id uuid, p_payable_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid;
  v_role text;
  v_line RECORD;
  v_pay RECORD;
BEGIN
  SELECT company_id, role INTO v_company, v_role FROM public.user_profiles WHERE id = auth.uid();
  IF COALESCE(v_role,'') NOT IN ('super_advisor','contabile') THEN
    RAISE EXCEPTION 'Non autorizzato: serve il ruolo contabile o super_advisor';
  END IF;

  SELECT * INTO v_line FROM public.riba_distinta_lines WHERE id = p_line_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Riga distinta non trovata o non accessibile'; END IF;

  SELECT * INTO v_pay FROM public.payables WHERE id = p_payable_id AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scadenza non trovata o non accessibile'; END IF;

  -- VERIFICA AL CENTESIMO (non a fiducia): importo distinta == dovuto scadenza.
  IF v_line.raw_amount IS NULL
     OR round(v_pay.gross_amount * 100)::bigint <> round(v_line.raw_amount * 100)::bigint THEN
    RAISE EXCEPTION 'IMPORTO_NON_QUADRA: distinta % vs dovuto %', v_line.raw_amount, v_pay.gross_amount;
  END IF;

  IF NOT public.fn_payable_is_riba(p_payable_id) THEN
    RAISE EXCEPTION 'NON_RIBA: la scadenza non e'' a ricevuta bancaria';
  END IF;

  -- Se ha gia' un movimento reale agganciato e' gia' definitiva: solo link riga.
  IF v_pay.bank_transaction_id IS NULL THEN
    UPDATE public.payables
    SET amount_paid = gross_amount,
        payment_date = COALESCE(payment_date, v_line.raw_due_date, due_date),
        is_provisional_paid = false,
        payment_bank_account_id = COALESCE(
          payment_bank_account_id,
          (SELECT bank_account_id FROM public.riba_distinte WHERE id = v_line.distinta_id)
        )
    WHERE id = p_payable_id;

    INSERT INTO public.payable_actions (payable_id, action_type, amount, note, performed_at)
    VALUES (p_payable_id, 'conferma_distinta_riba', v_pay.gross_amount,
            'Confermata da distinta RiBa (riscontro importo al centesimo)', now());
  END IF;

  UPDATE public.riba_distinta_lines
  SET matched_payable_id = p_payable_id, match_status = 'confirmed'
  WHERE id = p_line_id;

  RETURN jsonb_build_object('ok', true, 'payable_id', p_payable_id, 'amount', v_pay.gross_amount);
END;
$function$;

-- 8) Conferma DISTINTA: conferma tutte le righe 'matched' (esatte) in blocco ---
CREATE OR REPLACE FUNCTION public.rpc_confirm_riba_distinta(p_distinta_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid;
  v_role text;
  v_line RECORD;
  v_confirmed integer := 0;
  v_total numeric(14,2) := 0;
  v_skipped integer := 0;
BEGIN
  SELECT company_id, role INTO v_company, v_role FROM public.user_profiles WHERE id = auth.uid();
  IF COALESCE(v_role,'') NOT IN ('super_advisor','contabile') THEN
    RAISE EXCEPTION 'Non autorizzato: serve il ruolo contabile o super_advisor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.riba_distinte WHERE id = p_distinta_id AND company_id = v_company) THEN
    RAISE EXCEPTION 'Distinta non trovata o non accessibile';
  END IF;

  FOR v_line IN
    SELECT * FROM public.riba_distinta_lines
    WHERE distinta_id = p_distinta_id AND match_status = 'matched' AND matched_payable_id IS NOT NULL
  LOOP
    BEGIN
      PERFORM public.rpc_confirm_riba_distinta_line(v_line.id, v_line.matched_payable_id);
      v_confirmed := v_confirmed + 1;
      v_total := v_total + COALESCE(v_line.raw_amount, 0);
    EXCEPTION WHEN OTHERS THEN
      -- riga che non quadra piu' al centesimo: saltata, resta da verificare.
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  UPDATE public.riba_distinte
  SET status = 'confermata', confirmed_at = now(),
      matched_count = v_confirmed, matched_total = v_total
  WHERE id = p_distinta_id;

  RETURN jsonb_build_object('confirmed', v_confirmed, 'skipped', v_skipped, 'total', v_total);
END;
$function$;

-- 9) Grants ------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.rpc_automatch_riba_distinta(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_confirm_riba_distinta_line(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_confirm_riba_distinta(uuid) TO authenticated;

COMMIT;
