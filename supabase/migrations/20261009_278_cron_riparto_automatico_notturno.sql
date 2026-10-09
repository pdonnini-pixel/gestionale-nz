-- Migrazione 278 — riparto automatico ogni notte
--
-- Confermato da Patrizio il 09/10/2026. Alle 02:40 UTC (04:40 a Roma con
-- l'ora legale, 03:40 con l'ora solare), dopo la sincronizzazione delle
-- fatture delle 00:30 UTC, esegue fn_riparto_automatico_tutte() (migrazione
-- 274): regole nuove per i fornitori nuovi, quote aggiornate per le regole
-- automatiche quando cambiano fatture o preventivo. Le regole messe a mano
-- non vengono mai toccate.
-- Per fermarlo: SELECT cron.unschedule('riparto-automatico-notturno');

SELECT cron.schedule('riparto-automatico-notturno', '40 2 * * *',
  $cron$SET statement_timeout = '15min'; SELECT public.fn_riparto_automatico_tutte();$cron$);
