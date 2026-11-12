-- Rollback della 403: si fermano i trigger e si tolgono le funzioni nuove.
-- La tabella attendance_rettifiche e le colonne di oscuramento restano (sono
-- lo storico: non si cancellano). Un motivo già oscurato resta oscurato.
BEGIN;
DROP TRIGGER IF EXISTS trg_rettifiche_timbratura ON public.attendance_punches;
DROP TRIGGER IF EXISTS trg_rettifiche_caso ON public.attendance_eventi;
DROP FUNCTION IF EXISTS public.presenze_storico(uuid);
DROP FUNCTION IF EXISTS public.timbrature_oscura_nota(uuid, text);
DROP FUNCTION IF EXISTS public.presenze_oscura_motivo(uuid, text);
DROP FUNCTION IF EXISTS public.attendance_rettifiche_caso();
DROP FUNCTION IF EXISTS public.attendance_rettifiche_timbratura();
COMMIT;
