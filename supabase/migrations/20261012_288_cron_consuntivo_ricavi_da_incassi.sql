-- Migrazione 288 — consuntivo ricavi dagli incassi, ogni notte
--
-- Confermato da Patrizio il 12/10/2026. Alle 02:20 UTC (04:20 a Roma con l'ora
-- legale, 03:20 con l'ora solare), prima del riparto notturno delle 02:40
-- (che usa i ricavi per dividere i costi di struttura).
-- Per fermarlo: SELECT cron.unschedule('consuntivo-ricavi-da-incassi');

SELECT cron.schedule('consuntivo-ricavi-da-incassi', '20 2 * * *',
  $cron$SELECT public.fn_consuntivo_ricavi_da_incassi_tutte();$cron$);
