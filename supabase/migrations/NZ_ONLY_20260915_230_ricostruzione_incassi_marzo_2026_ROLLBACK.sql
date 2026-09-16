-- =====================================================================
-- ROLLBACK della 230 — rimozione della ricostruzione di marzo 2026
-- ---------------------------------------------------------------------
-- ATTENZIONE: e' uno script DISTRUTTIVO su dati vivi. Da eseguire SOLO su
-- richiesta esplicita di Patrizio e dopo un SELECT di backup delle 191
-- chiusure (REGOLA GRANITICA NO DATA LOSS). Tocca esclusivamente le
-- giornate di marzo 2026 create dalla ricostruzione, riconoscibili da
-- closed_by_name = 'ricostruzione da specchietto'.
-- =====================================================================

-- BACKUP PRIMA DI TUTTO (da salvare fuori dal database):
-- SELECT c.*, o.name FROM outlet_daily_closings c JOIN outlets o ON o.id = c.outlet_id
--  WHERE c.closing_date BETWEEN '2026-03-01' AND '2026-03-31';
-- SELECT l.* FROM outlet_daily_closing_lines l JOIN outlet_daily_closings c ON c.id = l.closing_id
--  WHERE c.closing_date BETWEEN '2026-03-01' AND '2026-03-31';

BEGIN;

WITH ric AS (
  SELECT id FROM public.outlet_daily_closings
   WHERE closing_date BETWEEN '2026-03-01' AND '2026-03-31'
     AND closed_by_name = 'ricostruzione da specchietto'
), tx AS (
  SELECT bank_transaction_id FROM public.closing_bank_matches WHERE closing_id IN (SELECT id FROM ric)
)
UPDATE public.bank_transactions
   SET is_reconciled = false, reconciled_at = NULL
 WHERE id IN (SELECT bank_transaction_id FROM tx);

DELETE FROM public.closing_bank_matches
 WHERE closing_id IN (SELECT id FROM public.outlet_daily_closings
                       WHERE closing_date BETWEEN '2026-03-01' AND '2026-03-31'
                         AND closed_by_name = 'ricostruzione da specchietto');

DELETE FROM public.outlet_daily_closing_expenses
 WHERE closing_id IN (SELECT id FROM public.outlet_daily_closings
                       WHERE closing_date BETWEEN '2026-03-01' AND '2026-03-31'
                         AND closed_by_name = 'ricostruzione da specchietto');

DELETE FROM public.outlet_daily_closing_lines
 WHERE closing_id IN (SELECT id FROM public.outlet_daily_closings
                       WHERE closing_date BETWEEN '2026-03-01' AND '2026-03-31'
                         AND closed_by_name = 'ricostruzione da specchietto');

-- Come per i mesi precedenti, le righe di daily_revenue di marzo ESISTEVANO GIA'
-- (registro corrispettivi) e la proiezione le ha riscritte con gli stessi
-- gross_revenue. NON si cancellano: si azzerano solo i campi aggiunti.
UPDATE public.daily_revenue
   SET cash_amount = NULL, card_amount = NULL, other_amount = NULL,
       notes = 'Registro corrispettivi (import storico 2026-09-09)'
 WHERE date BETWEEN '2026-03-01' AND '2026-03-31'
   AND notes LIKE 'Chiusura cassa %';

DELETE FROM public.outlet_daily_closings
 WHERE closing_date BETWEEN '2026-03-01' AND '2026-03-31'
   AND closed_by_name = 'ricostruzione da specchietto';

COMMIT;

