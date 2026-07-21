-- ROLLBACK 097 — rimuove il cron e la RPC di sync Cassetto Fiscale.
-- NON tocca i dati importati (acube_sdi_invoices, electronic_invoices, payables,
-- sync_runs, sync_run_details restano). Puramente reversibile lato scheduling.

SELECT cron.unschedule('acube-cf-sync-inbound-daily');

DROP FUNCTION IF EXISTS public.acube_cf_sync_inbound_production(text,text,text);
