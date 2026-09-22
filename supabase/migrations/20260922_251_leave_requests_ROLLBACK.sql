-- Rollback della migrazione 251 (richieste di ferie e permessi).
--
-- ATTENZIONE: da eseguire solo se le tabelle sono ancora vuote. Se
-- contengono richieste vere, questo script le perde: in quel caso NON si
-- esegue (REGOLA GRANITICA NO DATA LOSS). Prima di lanciarlo:
--   SELECT count(*) FROM public.leave_requests;   -- deve essere 0

BEGIN;

DROP VIEW IF EXISTS public.v_leave_disponibilita;

DROP TRIGGER IF EXISTS trg_leave_requests_traccia_ins     ON public.leave_requests;
DROP TRIGGER IF EXISTS trg_leave_requests_traccia_upd     ON public.leave_requests;
DROP TRIGGER IF EXISTS trg_leave_requests_no_hard_delete  ON public.leave_requests;
DROP FUNCTION IF EXISTS public.leave_requests_traccia();
DROP FUNCTION IF EXISTS public.leave_requests_no_hard_delete();

DROP TABLE IF EXISTS public.leave_request_events;
DROP TABLE IF EXISTS public.leave_request_days;
DROP TABLE IF EXISTS public.leave_requests;

COMMIT;
