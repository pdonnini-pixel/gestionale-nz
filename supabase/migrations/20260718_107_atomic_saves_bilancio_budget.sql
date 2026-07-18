-- =====================================================================
-- Migrazione 107 — Salvataggi ATOMICI di bilancio e budget_confronto
-- (audit 2026-07-17, finding critico C1 / regola granitica NO DATA LOSS)
-- =====================================================================
--
-- CONTESTO
-- Oggi il frontend salva bilancio (balance_sheet_data) e celle budget
-- (budget_confronto) con un pattern DELETE-poi-INSERT eseguito lato client in
-- due chiamate separate: se l'INSERT fallisce a metà (rete, vincolo, RLS), le
-- righe già cancellate NON vengono riscritte → perdita di dati inseriti a mano
-- da Lilian. Questa migration introduce due funzioni che eseguono DELETE+INSERT
-- nella STESSA transazione (tutto-o-niente), riproducendo ESATTAMENTE la logica
-- attuale. Il frontend passerà a chiamarle al posto delle due operazioni sciolte.
--
-- CARATTERE: additiva e NON distruttiva.
--   - NESSUNA modifica di schema, NESSUN dato toccato.
--   - Solo 2 nuove funzioni (CREATE OR REPLACE).
--   - SECURITY INVOKER: le funzioni girano con i permessi del chiamante, quindi
--     le policy RLS di balance_sheet_data e budget_confronto continuano ad
--     applicarsi IDENTICHE (stessa azienda, stessi ruoli super_advisor/contabile,
--     + budget_approver su budget_confronto). Nessun bypass di sicurezza.
--   - company_id forzato da get_my_company_id(): un payload con azienda diversa
--     non può scrivere fuori dal proprio tenant (difesa in profondità, oltre RLS).
--
-- IDEMPOTENTE: CREATE OR REPLACE, riapplicabile senza effetti collaterali.
--
-- ⚠️ REGOLA #0 — PARITÀ TENANT: applicare A MANO e IDENTICA su NZ + Made + Zago.
--   NZ   = xfvfxsvqpnpvibgeqpqp
--   Made = wdgoebzvosspjqttitra
--   Zago = jxlwvzjreukscnswkbjx
-- Rollback + test in transazione (sola verifica) in coda al file.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) save_balance_sheet(p_records, p_replace_sections)
--    Riproduce, in un'unica transazione, i 3 salvataggi di ContoEconomico:
--      - commitBilancio       → p_replace_sections = sezioni con dati nuovi
--                               (cancella l'intera sezione, poi reinserisce)
--      - commitImportedData   → p_replace_sections = ARRAY['conto_economico']
--      - handleSaveManualChanges → p_replace_sections = ARRAY[] (vuoto):
--                               MODO "per chiave", cancella solo le righe con la
--                               stessa (year,period_type,section,account_code)
--                               dei record in ingresso, poi le reinserisce.
--    Forma record attesa (come oggi): { year, period_type, section,
--      account_code, account_name, amount, sort_order }.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_balance_sheet(
  p_records          jsonb,
  p_replace_sections text[] DEFAULT '{}'::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company  uuid := get_my_company_id();
  v_deleted  int  := 0;
  v_inserted int  := 0;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nessuna azienda associata all''utente';
  END IF;
  IF p_records IS NULL OR jsonb_typeof(p_records) <> 'array' OR jsonb_array_length(p_records) = 0 THEN
    RAISE EXCEPTION 'Nessun record da salvare';
  END IF;

  -- Validazione: campi chiave obbligatori
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_records)
      AS x(year int, section text, account_code text)
    WHERE x.year IS NULL OR x.section IS NULL OR x.account_code IS NULL
  ) THEN
    RAISE EXCEPTION 'Record incompleti: year, section e account_code sono obbligatori';
  END IF;

  IF array_length(p_replace_sections, 1) IS NOT NULL THEN
    -- MODO "sostituisci sezione": cancella l'intera sezione per ogni (year,period_type)
    -- presente nei record. Riproduce commitBilancio / commitImportedData.
    DELETE FROM public.balance_sheet_data b
    USING (
      SELECT DISTINCT x.year, COALESCE(x.period_type, 'annuale') AS period_type
      FROM jsonb_to_recordset(p_records) AS x(year int, period_type text)
    ) k
    WHERE b.company_id = v_company
      AND b.year = k.year
      AND b.period_type = k.period_type
      AND b.section = ANY(p_replace_sections);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  ELSE
    -- MODO "aggiorna per chiave": cancella solo le righe con la stessa chiave
    -- dei record in ingresso. Riproduce handleSaveManualChanges (campi modificati).
    DELETE FROM public.balance_sheet_data b
    USING jsonb_to_recordset(p_records)
      AS i(year int, period_type text, section text, account_code text)
    WHERE b.company_id = v_company
      AND b.year = i.year
      AND b.period_type = COALESCE(i.period_type, 'annuale')
      AND b.section = i.section
      AND b.account_code = i.account_code;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  -- INSERT dei nuovi record. company_id SEMPRE dal JWT (mai dal payload).
  INSERT INTO public.balance_sheet_data
    (company_id, year, period_type, section, account_code, account_name, amount, sort_order, cost_center, parent_account)
  SELECT
    v_company,
    x.year,
    COALESCE(x.period_type, 'annuale'),
    x.section,
    x.account_code,
    x.account_name,
    x.amount,
    x.sort_order,
    x.cost_center,
    x.parent_account
  FROM jsonb_to_recordset(p_records)
    AS x(year int, period_type text, section text, account_code text,
         account_name text, amount numeric, sort_order int,
         cost_center text, parent_account text);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'deleted', v_deleted, 'inserted', v_inserted);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.save_balance_sheet(jsonb, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_balance_sheet(jsonb, text[]) TO authenticated;

-- ---------------------------------------------------------------------
-- 2) save_budget_confronto_cell(...) — salvataggio atomico di UNA cella.
--    Riproduce saveCell di BudgetControl: valore 0 → cancella la riga; valore
--    non-zero → upsert sull'indice unico (company_id, cost_center, account_code,
--    year, month, entry_type). In un'unica transazione.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_budget_confronto_cell(
  p_cost_center  text,
  p_account_code text,
  p_year         int,
  p_month        int,
  p_entry_type   text,
  p_amount       numeric,
  p_stato        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := get_my_company_id();
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Nessuna azienda associata all''utente';
  END IF;

  IF p_amount IS NULL OR p_amount = 0 THEN
    DELETE FROM public.budget_confronto
    WHERE company_id = v_company
      AND cost_center = p_cost_center
      AND account_code = p_account_code
      AND year = p_year
      AND month = p_month
      AND entry_type = p_entry_type;
    RETURN jsonb_build_object('ok', true, 'action', 'deleted');
  END IF;

  INSERT INTO public.budget_confronto
    (company_id, cost_center, account_code, year, month, entry_type, amount, stato, updated_at)
  VALUES
    (v_company, p_cost_center, p_account_code, p_year, p_month, p_entry_type, p_amount, p_stato, now())
  ON CONFLICT (company_id, cost_center, account_code, year, month, entry_type)
  DO UPDATE SET amount = EXCLUDED.amount, stato = EXCLUDED.stato, updated_at = now();

  RETURN jsonb_build_object('ok', true, 'action', 'upserted');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.save_budget_confronto_cell(text, text, int, int, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_budget_confronto_cell(text, text, int, int, text, numeric, text) TO authenticated;

COMMIT;

-- =====================================================================
-- ROLLBACK (eseguire a mano se serve tornare indietro)
-- =====================================================================
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.save_balance_sheet(jsonb, text[]);
--   DROP FUNCTION IF EXISTS public.save_budget_confronto_cell(text, text, int, int, text, numeric, text);
-- COMMIT;

-- =====================================================================
-- VERIFICHE (sola lettura) + TEST in transazione da ANNULLARE
-- =====================================================================
-- 1) Funzioni presenti:
--    SELECT proname FROM pg_proc WHERE proname IN ('save_balance_sheet','save_budget_confronto_cell');
--
-- 2) TEST NON DISTRUTTIVO (BEGIN ... ROLLBACK): verifica che un salvataggio
--    reale lasci i totali IDENTICI alla baseline. Eseguire da un utente con
--    ruolo super_advisor/contabile del tenant. NON fa COMMIT.
--
--    BEGIN;
--      -- checksum PRIMA
--      SELECT count(*), round(coalesce(sum(amount),0),2) FROM balance_sheet_data;
--      -- ri-salva la sezione conto_economico con i SUOI stessi dati attuali:
--      SELECT public.save_balance_sheet(
--        (SELECT jsonb_agg(to_jsonb(t) - 'id' - 'company_id' - 'created_at' - 'import_id')
--           FROM balance_sheet_data t
--          WHERE company_id = get_my_company_id()
--            AND section = 'conto_economico'),
--        ARRAY['conto_economico']
--      );
--      -- checksum DOPO (deve coincidere con PRIMA)
--      SELECT count(*), round(coalesce(sum(amount),0),2) FROM balance_sheet_data;
--    ROLLBACK;
-- =====================================================================
