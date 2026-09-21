-- ROLLBACK 20260921_243 — rimette il Cassetto Fiscale alle 05:15 UTC,
-- cioè prima della sync delle fatture passive (comportamento fino al 21/09/2026).

SELECT cron.schedule(
  'acube-cf-sync-inbound-daily',
  '15 5 * * *',
  $$ SELECT public.acube_cf_sync_inbound_production('production','auto_cron', NULL); $$
);
