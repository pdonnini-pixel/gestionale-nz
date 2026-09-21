-- 20260921_243 — Il Cassetto Fiscale gira DOPO la sincronizzazione delle fatture passive
--
-- Problema osservato su NZ il 21/09/2026: il riquadro "Fatture passive" di
-- Fatturazione mostra 0 documenti scaricati dal 21/07/2026, per 390 run di fila,
-- mentre le fatture dei fornitori continuano ad arrivare regolarmente.
--
-- Causa: i due canali scrivono nella stessa tabella `acube_sdi_invoices` e si
-- deduplicano sullo stesso identificativo A-Cube (`acube_uuid`).
--   • acube-cf-sync-inbound-daily   (Cassetto)  girava alle 05:15
--   • acube-sdi-sync-inbound-every-6h (Passive) gira 00:30 / 06:30 / 12:30 / 18:30
-- A-Cube consegna i documenti verso le 03:45: il Cassetto passava per primo e
-- inseriva tutto, così alle 06:30 la sync passiva trovava ogni uuid già presente
-- e chiudeva la run con items_downloaded = 0.
--
-- Verifica fatta prima della modifica: pagina 1 del canale SDI (30 fatture reali)
-- risultava interamente già presente in tabella e interamente inserita dal
-- Cassetto (xml_content NULL su tutte).
--
-- Effetto collaterale che questa migration sana: il canale SDI scarica anche il
-- vero XML FatturaPA (`xml_content`), il Cassetto porta solo il payload JSON.
-- Dal 23/07/2026 le 350 fatture passive sono entrate senza XML originale.
-- Invertendo l'ordine, il canale SDI torna a prendere per primo i documenti che
-- gli arrivano, e il Cassetto resta la rete di sicurezza per tutto il resto
-- (fatture che allo SDI non arrivano: quelle recuperate dal cassetto AdE).
--
-- Nessun dato viene toccato: si riprogramma solo l'orario di un job pg_cron.
-- Il job mantiene id, nome e comando; cambia la sola schedule (05:15 → 07:15 UTC).

SELECT cron.schedule(
  'acube-cf-sync-inbound-daily',
  '15 7 * * *',
  $$ SELECT public.acube_cf_sync_inbound_production('production','auto_cron', NULL); $$
);

-- Verifica (attesa: schedule = '15 7 * * *', active = true, e il job SDI
-- passive resta a '30 0,6,12,18 * * *', cioè 45 minuti prima):
--   SELECT jobname, schedule, active FROM cron.job
--    WHERE jobname IN ('acube-cf-sync-inbound-daily','acube-sdi-sync-inbound-every-6h');
