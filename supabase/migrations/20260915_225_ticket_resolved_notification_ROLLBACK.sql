-- Rollback 225 — avviso alla risoluzione della segnalazione.
-- Non tocca le notifiche gia' create (dati). La colonna emailed_at resta:
-- toglierla cancellerebbe una traccia, si puo' fare solo con conferma.
BEGIN;
DROP TRIGGER IF EXISTS trg_notify_ticket_resolved ON public.tickets;
DROP FUNCTION IF EXISTS public.notify_ticket_resolved();
DROP FUNCTION IF EXISTS public.ticket_notify_endpoint();
-- Il vincolo torna senza 'ticket' solo se non esistono notifiche di quella categoria.
-- ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
-- ALTER TABLE public.notifications ADD CONSTRAINT notifications_category_check CHECK (category = ANY (ARRAY['scadenza_fiscale','scadenza_fornitore','anomalia','riconciliazione','fattura_sdi','sistema','info']));
COMMIT;
