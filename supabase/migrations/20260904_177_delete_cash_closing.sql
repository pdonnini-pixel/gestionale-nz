-- =====================================================================
-- 177 — Cancellazione di una giornata di cassa (solo super_advisor)
--
-- Il super advisor deve poter cancellare una chiusura (in bozza o
-- confermata) per farla reinserire da zero: righe canali, spese/rimborsi,
-- foto (record; i file li toglie il frontend via Storage API) e la proiezione in daily_revenue che
-- quella chiusura aveva creato. Resta traccia in notifications (chi, quando,
-- outlet, giorno, totale, motivo). Il contabile NON puo' cancellare: puo'
-- solo riaprire (reopen_cash_closing).
--
-- Additiva: nessuna modifica a tabelle esistenti. Da applicare su NZ →
-- Made → Zago.
-- =====================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.delete_cash_closing(p_closing_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c        public.outlet_daily_closings%ROWTYPE;
  v_outlet text;
  v_paths  text[];
  v_photos integer := 0;
  v_dr     integer := 0;
BEGIN
  SELECT * INTO c FROM public.outlet_daily_closings WHERE id = p_closing_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Chiusura non trovata' USING ERRCODE = 'P0002'; END IF;
  IF c.company_id <> public.get_my_company_id()
     OR COALESCE(public.get_my_role()::text, '') <> 'super_advisor' THEN
    RAISE EXCEPTION 'Solo il super advisor puo'' cancellare una giornata di cassa' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO v_outlet FROM public.outlets WHERE id = c.outlet_id;
  SELECT COALESCE(array_agg(storage_path), '{}') INTO v_paths
    FROM public.outlet_daily_closing_attachments WHERE closing_id = c.id;
  v_photos := cardinality(v_paths);

  -- I file nel bucket li rimuove il frontend via Storage API PRIMA di
  -- chiamare questa funzione: storage.objects NON e' cancellabile da SQL
  -- (trigger storage.protect_delete). Qui si tolgono i record.
  DELETE FROM public.outlet_daily_closing_attachments WHERE closing_id = c.id;
  DELETE FROM public.outlet_daily_closing_expenses WHERE closing_id = c.id;
  DELETE FROM public.outlet_daily_closing_lines WHERE closing_id = c.id;

  -- Solo la riga di ricavo creata da QUESTA chiusura (mai altri dati di daily_revenue).
  DELETE FROM public.daily_revenue
   WHERE company_id = c.company_id AND outlet_id = c.outlet_id AND date = c.closing_date
     AND notes = 'Chiusura cassa ' || c.id::text;
  GET DIAGNOSTICS v_dr = ROW_COUNT;

  DELETE FROM public.outlet_daily_closings WHERE id = c.id;

  -- Traccia dell'operazione, visibile agli amministratori.
  INSERT INTO public.notifications
    (company_id, user_id, title, message, category, severity, action_url, action_label, reference_type, reference_id)
  VALUES
    (c.company_id, NULL,
     'Chiusura cassa cancellata: ' || COALESCE(v_outlet, '') || ' ' || to_char(c.closing_date, 'DD/MM/YYYY'),
     'Il super advisor ha cancellato la giornata (stato ' || c.status || ', totale ' || to_char(c.total_receipts, 'FM999G999G990D00') || ' €, '
       || v_photos::text || ' foto)' || COALESCE('. Motivo: ' || NULLIF(btrim(p_reason), ''), '') || '. La giornata va reinserita.',
     'info', 'warning',
     '/chiusura-cassa?outlet=' || c.outlet_id::text || '&date=' || to_char(c.closing_date, 'YYYY-MM-DD'),
     'Reinserisci la chiusura', 'cash_closing_deleted', c.id);

  RETURN jsonb_build_object('deleted', true, 'closing_id', c.id, 'outlet', v_outlet, 'date', c.closing_date,
                            'photos', v_photos, 'storage_paths', to_jsonb(v_paths), 'daily_revenue_rows', v_dr);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_cash_closing(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_cash_closing(uuid, text) TO authenticated, service_role;

COMMIT;
