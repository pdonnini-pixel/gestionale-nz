-- Rollback della migrazione 252 (referenti e decisione delle ferie).
--
-- ATTENZIONE: da eseguire solo se leave_approvers e' ancora vuota. Se
-- contiene referenti veri, questo script li perde (REGOLA GRANITICA NO
-- DATA LOSS). Prima di lanciarlo:
--   SELECT count(*) FROM public.leave_approvers;   -- deve essere 0
--
-- Nota: le richieste gia' decise restano decise. Questo script toglie la
-- porta per decidere, non annulla le decisioni prese.

BEGIN;

DROP FUNCTION IF EXISTS public.leave_decidi(uuid, uuid[], text);
DROP FUNCTION IF EXISTS public.posso_decidere_ferie();

DROP TABLE IF EXISTS public.leave_settings;
DROP TABLE IF EXISTS public.leave_approvers;

COMMIT;
