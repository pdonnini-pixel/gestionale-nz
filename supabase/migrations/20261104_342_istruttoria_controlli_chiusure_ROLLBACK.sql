-- ROLLBACK di 20261104_342_istruttoria_controlli_chiusure.sql
--
-- Toglie il cron, il dispatch e le impostazioni dell'istruttoria.
--
-- Le due tabelle NON vengono cancellate: contengono gli esiti veri delle
-- segnalazioni e i messaggi mandati ai negozi (regola NO DATA LOSS). Se
-- servisse davvero rimuoverle, va deciso con Patrizio dopo un backup.

BEGIN;

SELECT cron.unschedule('closing-checks-tick');

DROP FUNCTION IF EXISTS public.closing_checks_tick();
DROP FUNCTION IF EXISTS public.closing_checks_dispatch(uuid, date);

ALTER TABLE public.daily_report_settings
  DROP COLUMN IF EXISTS checks_enabled,
  DROP COLUMN IF EXISTS checks_recipients,
  DROP COLUMN IF EXISTS checks_store_messages,
  DROP COLUMN IF EXISTS checks_tolerance;

COMMIT;

-- Le tabelle restano. Per toglierle davvero, con backup fatto e conferma:
-- DROP TABLE public.closing_checks;
-- DROP TABLE public.closing_check_runs;
