-- =====================================================================
-- ROLLBACK NZ_ONLY 226 — rimette il riscontro di settembre com'era
-- prima del ricalcolo del 15/09/2026, riga per riga, dalle tabelle di
-- backup create dalla migration.
-- =====================================================================

-- 1. Via i match nati dal ricalcolo
DELETE FROM public.closing_bank_matches m
 USING public.outlet_daily_closings c
 WHERE c.id = m.closing_id
   AND c.closing_date >= DATE '2026-09-01'
   AND m.match_type IN ('pos', 'amex');

-- 2. Rientrano quelli di prima
INSERT INTO public.closing_bank_matches
SELECT * FROM public._bkp_riscontro_sett_matches_20260915
ON CONFLICT (id) DO NOTHING;

-- 3. Righe di chiusura come prima
UPDATE public.outlet_daily_closing_lines l
   SET bank_amount = b.bank_amount, bank_status = b.bank_status, bank_matched_at = b.bank_matched_at
  FROM public._bkp_riscontro_sett_lines_20260915 b
 WHERE b.id = l.id;

-- 4. Chiusure come prima
UPDATE public.outlet_daily_closings c
   SET status = b.status, bank_verified_at = b.bank_verified_at
  FROM public._bkp_riscontro_sett_closings_20260915 b
 WHERE b.id = c.id;

-- 5. Movimenti bancari come prima
UPDATE public.bank_transactions bt
   SET is_reconciled = b.is_reconciled, reconciled_at = b.reconciled_at, category = b.category, note = b.note
  FROM public._bkp_riscontro_sett_bt_20260915 b
 WHERE b.id = bt.id;
