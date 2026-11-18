-- ROLLBACK di 20261118_432_tetto_tolleranza_controlli.sql
--
-- Toglie il tetto e rimette il commento della colonna come l'aveva scritto la
-- migration 342. Nessun dato viene toccato: il vincolo non ha mai cambiato un
-- valore, ha solo impedito di scriverne uno fuori scala.
--
-- Da fare solo se Patrizio vuole una tolleranza sopra i 5,00 EUR. In quel caso
-- e' meglio cambiare il numero nel vincolo che togliere il vincolo.

BEGIN;

ALTER TABLE public.daily_report_settings
  DROP CONSTRAINT IF EXISTS daily_report_settings_checks_tolerance_range;

COMMENT ON COLUMN public.daily_report_settings.checks_tolerance IS
  'Sotto questa cifra una differenza di cassa è un arrotondamento e non si segnala a nessuno (deciso da Patrizio il 04/11/2026: 1,00 EUR).';

COMMIT;
