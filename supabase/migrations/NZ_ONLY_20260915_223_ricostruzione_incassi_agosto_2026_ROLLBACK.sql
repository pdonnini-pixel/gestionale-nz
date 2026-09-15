-- =====================================================================
-- ROLLBACK della 223 — rimozione della ricostruzione di agosto 2026
-- ---------------------------------------------------------------------
-- ATTENZIONE: e' uno script DISTRUTTIVO su dati vivi. Da eseguire SOLO su
-- richiesta esplicita di Patrizio e dopo un SELECT di backup delle 217
-- chiusure (REGOLA GRANITICA NO DATA LOSS). Tocca esclusivamente le
-- giornate di agosto 2026 create dalla ricostruzione, riconoscibili da
-- closed_by_name = 'ricostruzione da specchietto'.
-- =====================================================================

-- BACKUP PRIMA DI TUTTO (da salvare fuori dal database):
-- SELECT c.*, o.name FROM outlet_daily_closings c JOIN outlets o ON o.id = c.outlet_id
--  WHERE c.closing_date BETWEEN '2026-08-01' AND '2026-08-31';
-- SELECT l.* FROM outlet_daily_closing_lines l JOIN outlet_daily_closings c ON c.id = l.closing_id
--  WHERE c.closing_date BETWEEN '2026-08-01' AND '2026-08-31';

BEGIN;

WITH ric AS (
  SELECT id FROM public.outlet_daily_closings
   WHERE closing_date BETWEEN '2026-08-01' AND '2026-08-31'
     AND closed_by_name = 'ricostruzione da specchietto'
), tx AS (
  SELECT bank_transaction_id FROM public.closing_bank_matches WHERE closing_id IN (SELECT id FROM ric)
)
UPDATE public.bank_transactions
   SET is_reconciled = false, reconciled_at = NULL
 WHERE id IN (SELECT bank_transaction_id FROM tx);

DELETE FROM public.closing_bank_matches
 WHERE closing_id IN (SELECT id FROM public.outlet_daily_closings
                       WHERE closing_date BETWEEN '2026-08-01' AND '2026-08-31'
                         AND closed_by_name = 'ricostruzione da specchietto');

DELETE FROM public.outlet_daily_closing_expenses
 WHERE closing_id IN (SELECT id FROM public.outlet_daily_closings
                       WHERE closing_date BETWEEN '2026-08-01' AND '2026-08-31'
                         AND closed_by_name = 'ricostruzione da specchietto');

DELETE FROM public.outlet_daily_closing_lines
 WHERE closing_id IN (SELECT id FROM public.outlet_daily_closings
                       WHERE closing_date BETWEEN '2026-08-01' AND '2026-08-31'
                         AND closed_by_name = 'ricostruzione da specchietto');

DELETE FROM public.daily_revenue
 WHERE date BETWEEN '2026-08-01' AND '2026-08-31'
   AND notes LIKE 'Chiusura cassa %';

DELETE FROM public.outlet_daily_closings
 WHERE closing_date BETWEEN '2026-08-01' AND '2026-08-31'
   AND closed_by_name = 'ricostruzione da specchietto';

COMMIT;
