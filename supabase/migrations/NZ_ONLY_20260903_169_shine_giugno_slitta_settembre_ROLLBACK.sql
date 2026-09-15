-- ROLLBACK di NZ_ONLY_20260903_169_shine_giugno_slitta_settembre.sql
-- Ripristina la scadenza originale delle 10 prime rate SHINE leggendo da
-- public._bkp_shine_slitta_20260903. Nessun dato inventato.

BEGIN;

UPDATE public.payables p
SET due_date          = b.due_date,
    original_due_date = b.original_due_date,
    postponed_to      = b.postponed_to,
    postpone_count    = b.postpone_count,
    status            = b.status,
    notes             = b.notes,
    updated_at        = now()
FROM public._bkp_shine_slitta_20260903 b
WHERE p.id = b.id;

COMMIT;

-- --- Verifica ---------------------------------------------------------------
-- SELECT count(*), round(sum(gross_amount),2) FROM public.payables p
--   JOIN public._bkp_shine_slitta_20260903 b ON b.id = p.id
--   WHERE p.due_date = date '2026-08-31';   -- atteso 10 / 14.893,35
