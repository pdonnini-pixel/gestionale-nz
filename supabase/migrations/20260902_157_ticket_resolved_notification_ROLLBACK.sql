-- =====================================================================
-- ROLLBACK migrazione 157 — notifica risoluzione ticket
-- =====================================================================
-- Toglie trigger, funzioni e cron. La colonna notifications.emailed_at NON
-- viene droppata (dato già scritto: droppandola si perderebbe la traccia
-- degli invii e si rischierebbe una raffica di mail doppie se la 157
-- venisse riapplicata). Le notifiche già create restano: sono legittime.
-- =====================================================================

-- 1. Cron (fuori transazione, ignora l'errore se il job non c'è)
-- SELECT cron.unschedule('ticket-notify-resolved-10min');

BEGIN;

DROP TRIGGER IF EXISTS trg_notify_ticket_resolved ON public.tickets;
DROP FUNCTION IF EXISTS public.notify_ticket_resolved();
DROP FUNCTION IF EXISTS public.ticket_notifications_send_pending(text, text);

COMMIT;

-- Se si vuole davvero togliere anche la colonna (sconsigliato, vedi sopra):
-- ALTER TABLE public.notifications DROP COLUMN IF EXISTS emailed_at;
