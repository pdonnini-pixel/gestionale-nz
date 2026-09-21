-- 20260921_246 — Causali estese lette dall'estratto conto
--
-- PROBLEMA
-- Su MPS la disposizione di bonifico arriva dall'open banking senza il nome di
-- chi incassa: la causale finisce con «ORD.ORIG:» e dopo non c'e' niente, il
-- campo counterpart e' vuoto. Senza nome il motore non puo' agganciare il
-- movimento a una fattura e resta aperto per sempre. Al 21/09/2026 sono 10
-- bonifici per 127.809,44 EUR, il piu' grande da 56.031,89 del 13/07.
--
-- FONTE DEL DATO MANCANTE
-- L'estratto conto che la banca esporta in Excel (o stampa in PDF) la stessa
-- riga la scrive per esteso, beneficiario compreso. I file sono gia' in
-- archivio (bank_statements, doc_kind 'conto_corrente') ma nessuno li legge:
-- transaction_count sta a 0 su tutti.
--
-- COSA FA QUESTA MIGRATION
-- 1. Tre colonne su bank_transactions per tenere la causale estesa ACCANTO a
--    quella originale, senza mai sovrascriverla: il dato di A-Cube resta com'e'
--    ed e' sempre distinguibile da quello letto dal file.
-- 2. La RPC apply_statement_enrichment(), che scrive quelle colonne per i soli
--    movimenti dell'azienda di chi chiama. La controparte si scrive SOLO se
--    manca: un valore gia' presente, deciso da una persona, non si tocca.
-- 3. rerun_bijective_reconciliation() cerca il fornitore anche nella causale
--    estesa, cosi' l'arricchimento si traduce subito in abbinamenti.
--
-- Nessun movimento viene creato o cancellato: i movimenti li porta l'open
-- banking, qui si aggiunge il testo che alla banca dati mancava.

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS statement_description text,
  ADD COLUMN IF NOT EXISTS statement_enriched_at timestamptz,
  ADD COLUMN IF NOT EXISTS statement_source text;

COMMENT ON COLUMN public.bank_transactions.statement_description IS
  'Causale per esteso letta dall''estratto conto della banca. Affianca description (open banking), non la sostituisce.';
COMMENT ON COLUMN public.bank_transactions.statement_source IS
  'Nome del file di estratto conto da cui arriva la causale estesa.';

-- Indice parziale: le pagine cercano i movimenti ancora da arricchire.
CREATE INDEX IF NOT EXISTS idx_bank_tx_statement_enriched
  ON public.bank_transactions (company_id, transaction_date)
  WHERE statement_description IS NULL;

CREATE OR REPLACE FUNCTION public.apply_statement_enrichment(p_rows jsonb, p_source text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_causali INT := 0;
  v_controparti INT := 0;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nessuna azienda associata all''utente';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('causali_scritte', 0, 'controparti_scritte', 0);
  END IF;

  WITH righe AS (
    SELECT (r->>'id')::uuid AS id,
           nullif(btrim(r->>'statement_description'), '') AS descr,
           nullif(btrim(r->>'counterpart'), '') AS controparte
    FROM jsonb_array_elements(p_rows) r
  ),
  upd AS (
    UPDATE public.bank_transactions bt
    SET statement_description = righe.descr,
        statement_enriched_at = now(),
        statement_source = p_source,
        -- La controparte si scrive solo dove manca: quello che ha deciso una
        -- persona, o che il motore ha gia' riconosciuto, resta.
        counterpart = COALESCE(nullif(btrim(bt.counterpart), ''), righe.controparte)
    FROM righe
    WHERE bt.id = righe.id
      AND bt.company_id = v_company
      AND righe.descr IS NOT NULL
      AND bt.statement_description IS DISTINCT FROM righe.descr
    RETURNING bt.id, righe.controparte, bt.counterpart
  )
  SELECT count(*),
         count(*) FILTER (WHERE upd.controparte IS NOT NULL AND upd.counterpart = upd.controparte)
  INTO v_causali, v_controparti
  FROM upd;

  RETURN jsonb_build_object('causali_scritte', v_causali, 'controparti_scritte', v_controparti);
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_statement_enrichment(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_statement_enrichment(jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_statement_enrichment(jsonb, text) TO authenticated, service_role;

-- Il motore cerca il fornitore anche nella causale estesa ------------------
CREATE OR REPLACE FUNCTION public.rerun_bijective_reconciliation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_pay RECORD;
  v_bt RECORD;
  v_applied NUMERIC;
  v_pairs INT := 0;
  v_inv_date DATE;
  v_floor DATE;
BEGIN
  FOR v_pay IN
    SELECT * FROM public.payables
    WHERE bank_transaction_id IS NULL
      AND gross_amount > 0
      AND supplier_name IS NOT NULL
      AND status IN ('da_pagare', 'in_scadenza', 'scaduto', 'pagato')
      AND NOT EXISTS (
        SELECT 1 FROM public.payable_credit_note_links l
        WHERE l.payable_id = payables.id AND l.status = 'pending')
    ORDER BY company_id, supplier_name, gross_amount,
             COALESCE(invoice_date, due_date, created_at::date)
  LOOP
    v_inv_date := COALESCE(v_pay.invoice_date, v_pay.due_date, v_pay.created_at::date);
    v_floor := COALESCE(v_pay.invoice_date, v_inv_date - INTERVAL '15 days');

    SELECT bt.* INTO v_bt
    FROM public.bank_transactions bt
    WHERE bt.company_id = v_pay.company_id
      AND bt.amount < 0
      AND COALESCE(bt.is_reconciled, false) = false
      AND bt.status IN ('posted', 'booked')
      AND abs(abs(bt.amount) - v_pay.gross_amount) <= GREATEST(0.02, v_pay.gross_amount * 0.01)
      AND bt.transaction_date >= v_floor
      AND public.supplier_confirmed_in_text(
            v_pay.supplier_name, v_pay.supplier_vat,
            coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '') || ' '
            || coalesce(bt.merchant_name, '') || ' ' || coalesce(bt.statement_description, ''))
    ORDER BY abs(bt.transaction_date - v_inv_date) ASC, bt.transaction_date DESC
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_pay.status = 'pagato' THEN
      UPDATE public.payables SET bank_transaction_id = v_bt.id, updated_at = now() WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_pay.company_id, v_bt.id, v_pay.id, 'auto_exact', 100, 'applied', v_pay.gross_amount,
              'auto: abbinamento per data — stesso fornitore/importo (già pagata)');
    ELSE
      v_applied := COALESCE(v_pay.amount_remaining, v_pay.gross_amount - COALESCE(v_pay.amount_paid, 0), v_pay.gross_amount);
      UPDATE public.payables
      SET amount_paid = COALESCE(amount_paid, 0) + v_applied,
          payment_date = v_bt.transaction_date,
          bank_transaction_id = v_bt.id,
          updated_at = now()
      WHERE id = v_pay.id;
      INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_pay.company_id, v_bt.id, v_pay.id, 'auto_exact', 100, 'applied', v_applied,
              'auto: abbinamento per data — stesso fornitore/importo');
    END IF;

    UPDATE public.bank_transactions
    SET is_reconciled = true, reconciled_at = now(), reconciled_invoice_id = v_pay.id
    WHERE id = v_bt.id;

    v_pairs := v_pairs + 1;
  END LOOP;

  RETURN jsonb_build_object('coppie_abbinate', v_pairs);
END;
$function$;

REVOKE ALL ON FUNCTION public.rerun_bijective_reconciliation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rerun_bijective_reconciliation() FROM anon;
GRANT EXECUTE ON FUNCTION public.rerun_bijective_reconciliation() TO authenticated, service_role;

-- Verifica:
--   SELECT count(*) FROM bank_transactions WHERE statement_description IS NOT NULL;
--   SELECT pg_get_functiondef(oid) ILIKE '%statement_description%'
--   FROM pg_proc WHERE proname = 'rerun_bijective_reconciliation';
