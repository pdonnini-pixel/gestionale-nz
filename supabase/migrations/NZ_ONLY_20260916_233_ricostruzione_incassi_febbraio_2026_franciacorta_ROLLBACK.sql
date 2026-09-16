-- =====================================================================
-- ROLLBACK della 233 — rimozione delle 28 giornate di Franciacorta
-- di febbraio 2026
-- ---------------------------------------------------------------------
-- ATTENZIONE: e' uno script DISTRUTTIVO su dati vivi. Da eseguire SOLO su
-- richiesta esplicita di Patrizio e dopo un SELECT di backup delle 28
-- chiusure (REGOLA GRANITICA NO DATA LOSS). Tocca solo Franciacorta e solo
-- febbraio 2026, lasciando intatte le 139 chiusure caricate dalla 232.
-- =====================================================================

-- BACKUP PRIMA DI TUTTO (da salvare fuori dal database):
-- SELECT c.*, o.name FROM outlet_daily_closings c JOIN outlets o ON o.id = c.outlet_id
--  WHERE o.name = 'FRANCIACORTA' AND c.closing_date BETWEEN '2026-02-01' AND '2026-02-28';

BEGIN;

WITH ric AS (
  SELECT c.id FROM public.outlet_daily_closings c JOIN public.outlets o ON o.id = c.outlet_id
   WHERE o.name = 'FRANCIACORTA' AND c.closing_date BETWEEN '2026-02-01' AND '2026-02-28'
     AND c.closed_by_name = 'ricostruzione da specchietto'
)
UPDATE public.bank_transactions
   SET is_reconciled = false, reconciled_at = NULL
 WHERE id IN (SELECT bank_transaction_id FROM public.closing_bank_matches WHERE closing_id IN (SELECT id FROM ric));

DELETE FROM public.closing_bank_matches
 WHERE closing_id IN (SELECT c.id FROM public.outlet_daily_closings c JOIN public.outlets o ON o.id = c.outlet_id
                       WHERE o.name = 'FRANCIACORTA' AND c.closing_date BETWEEN '2026-02-01' AND '2026-02-28'
                         AND c.closed_by_name = 'ricostruzione da specchietto');

DELETE FROM public.outlet_daily_closing_expenses
 WHERE closing_id IN (SELECT c.id FROM public.outlet_daily_closings c JOIN public.outlets o ON o.id = c.outlet_id
                       WHERE o.name = 'FRANCIACORTA' AND c.closing_date BETWEEN '2026-02-01' AND '2026-02-28'
                         AND c.closed_by_name = 'ricostruzione da specchietto');

DELETE FROM public.outlet_daily_closing_lines
 WHERE closing_id IN (SELECT c.id FROM public.outlet_daily_closings c JOIN public.outlets o ON o.id = c.outlet_id
                       WHERE o.name = 'FRANCIACORTA' AND c.closing_date BETWEEN '2026-02-01' AND '2026-02-28'
                         AND c.closed_by_name = 'ricostruzione da specchietto');

-- Le righe di daily_revenue esistevano gia' col medesimo gross_revenue:
-- NON si cancellano, si azzera solo il dettaglio che la 233 ha aggiunto.
UPDATE public.daily_revenue dr
   SET cash_amount = NULL, card_amount = NULL, other_amount = NULL,
       notes = 'Registro corrispettivi (import storico 2026-09-09)'
  FROM public.outlets o
 WHERE o.id = dr.outlet_id AND o.name = 'FRANCIACORTA'
   AND dr.date BETWEEN '2026-02-01' AND '2026-02-28'
   AND dr.notes LIKE 'Chiusura cassa %';

DELETE FROM public.outlet_daily_closings c
 USING public.outlets o
 WHERE o.id = c.outlet_id AND o.name = 'FRANCIACORTA'
   AND c.closing_date BETWEEN '2026-02-01' AND '2026-02-28'
   AND c.closed_by_name = 'ricostruzione da specchietto';

COMMIT;
