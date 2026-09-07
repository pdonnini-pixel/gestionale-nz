-- =============================================================================
-- Il cron notturno riparte: il SET va nel comando, non dentro la funzione
-- Applicato su NZ il 04/09/2026, dopo il fix del gate (174 e 175).
-- =============================================================================
--
-- La 171 metteva `SET LOCAL statement_timeout` DENTRO run_daily_reconciliation.
-- Non funziona, ed è stato verificato: il job è morto di nuovo a 120 secondi
-- netti. PostgreSQL arma il timer all'inizio dello statement, quindi cambiare
-- `statement_timeout` mentre quello statement è già in esecuzione non ha effetto.
--
-- Il SET deve precedere la chiamata, e il posto giusto è il comando del job.
-- Con questo comando il giro è arrivato in fondo in 430,8 secondi (7 minuti e 11).
--
-- Si riattiva SOLO ORA, dopo il fix del gate di identità: farlo prima avrebbe
-- rifatto ogni notte gli stessi quattro agganci sbagliati su tutto l'arretrato.
--
-- Su Made e Zago il job non è mai fallito (meno arretrato) e il comando resta
-- quello: il SET non serve dove il giro dura pochi secondi. Se un domani anche
-- lì il volume crescerà, si applica la stessa riga.
-- =============================================================================

SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'reconcile-recurring-daily'),
  command := 'SET statement_timeout = ''20min''; SELECT public.run_daily_reconciliation();'
);

-- --- Verifica ---------------------------------------------------------------
-- select jobid, jobname, schedule, command from cron.job where jobname = 'reconcile-recurring-daily';
-- select status, start_time, round(extract(epoch from (end_time-start_time))::numeric,1) durata
--   from cron.job_run_details where jobid = (select jobid from cron.job where jobname='reconcile-recurring-daily')
--   order by start_time desc limit 3;
