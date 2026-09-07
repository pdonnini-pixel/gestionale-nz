-- =====================================================================
-- ROLLBACK migrazione 173 — chiusura di cassa giornaliera
-- =====================================================================
-- ⚠️ NO DATA LOSS: questo script CANCELLA le chiusure di cassa, le righe per
-- canale, la configurazione dei canali e i riferimenti alle foto (i file nel
-- bucket restano). Usarlo SOLO se la funzione viene ritirata prima dell'uso
-- reale, e solo dopo:
--   1. SELECT * FROM public.outlet_daily_closings;            -- backup
--   2. SELECT * FROM public.outlet_daily_closing_lines;       -- backup
--   3. SELECT * FROM public.outlet_daily_closing_attachments; -- backup
--   4. SELECT * FROM public.outlet_payment_channels;          -- backup
--   5. conferma binaria di Patrizio.
-- Le righe proiettate in daily_revenue (source='manuale', note 'Chiusura
-- cassa ...') NON vengono toccate qui.
-- =====================================================================

BEGIN;

DROP POLICY IF EXISTS "cash_closings_read"   ON storage.objects;
DROP POLICY IF EXISTS "cash_closings_insert" ON storage.objects;
DROP POLICY IF EXISTS "cash_closings_delete" ON storage.objects;
-- Il bucket e i file restano (NO DATA LOSS): DELETE FROM storage.buckets solo a mano.

DROP FUNCTION IF EXISTS public.cash_closing_storage_outlet(text);
DROP FUNCTION IF EXISTS public.request_cash_closing_reopen(uuid, text);
DROP FUNCTION IF EXISTS public.reopen_cash_closing(uuid, text);
DROP FUNCTION IF EXISTS public.confirm_cash_closing(uuid, text);
DROP FUNCTION IF EXISTS public.project_cash_closing_to_daily_revenue(uuid);

DROP TRIGGER IF EXISTS trg_cash_closing_lines_touch ON public.outlet_daily_closing_lines;
DROP FUNCTION IF EXISTS public.fn_cash_closing_lines_touch();
DROP TRIGGER IF EXISTS trg_cash_closing_compute ON public.outlet_daily_closings;
DROP FUNCTION IF EXISTS public.fn_cash_closing_compute();

DROP TABLE IF EXISTS public.outlet_daily_closing_attachments;
DROP TABLE IF EXISTS public.outlet_daily_closing_lines;
DROP TABLE IF EXISTS public.outlet_daily_closings;
DROP TABLE IF EXISTS public.outlet_payment_channels;

DROP FUNCTION IF EXISTS public.can_write_cash_closing(uuid);

COMMIT;
