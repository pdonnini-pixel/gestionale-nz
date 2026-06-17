-- 077 — log_bank_sync_run: registra il sync bancario MANUALE in sync_runs
--
-- Problema: il badge "Dati aggiornati al…" (SyncStatusBadge feed="banche") legge
-- l'ultima riga di public.sync_runs, scritta SOLO dal cron 6h. Il sync manuale
-- "Aggiorna conti e movimenti" aggiornava i saldi (bank_accounts.balance_updated_at)
-- ma non sync_runs → badge fermo al vecchio cron mentre le card mostravano "Ora".
--
-- RLS su sync_runs concede solo SELECT all'utente, quindi l'INSERT passa da questa
-- funzione SECURITY DEFINER, chiamata dal frontend dopo un sync manuale riuscito.
-- Il cron continua a loggare con origine='auto_cron' (invariato).
--
-- Applicata su NZ, Made, Zago (parità tenant).

CREATE OR REPLACE FUNCTION public.log_bank_sync_run(p_items int DEFAULT 0, p_duration_ms int DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid := get_my_company_id();
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'Nessuna azienda per l''utente'; END IF;
  INSERT INTO public.sync_runs(company_id, feed, origine, status, items_downloaded, duration_ms, run_at)
  VALUES (v_company, 'banche', 'manuale', 'ok', COALESCE(p_items,0), p_duration_ms, now());
END $$;

REVOKE ALL ON FUNCTION public.log_bank_sync_run(int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_bank_sync_run(int,int) TO authenticated;
