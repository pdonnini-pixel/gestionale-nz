-- Migrazione 111 — RPC append_ticket_comment: aggiunta commenti atomica
-- (audit sezione Ticket 2026-07-19, finding #7: "Lost update sui commenti:
--  read-modify-write dell'intero array JSONB sia client sia edge function").
--
-- Problema: tutti i percorsi che aggiungono un commento (dettaglio ticket,
-- "Chiudi senza lavorare" admin, edge function ticket-resolve-now) riscrivono
-- l'INTERO array jsonb `commenti` a partire da uno snapshot: due scritture
-- concorrenti (es. utente + AutoFix, che tra lettura e scrittura tiene aperta
-- una chiamata AI di 10-60s) si sovrascrivono a vicenda e i commenti spariscono
-- in silenzio. Corollario: riscrivendo l'array un client può alterare o
-- cancellare commenti altrui.
--
-- Soluzione: RPC che fa l'append atomico lato DB (`commenti || nuovo`), usata da
-- frontend e edge function. SECURITY INVOKER: valgono le stesse policy RLS della
-- tabella tickets (chi oggi può aggiornare un ticket può commentarlo, come ora).
--
-- ⚠️ ORDINE: applicare PRIMA del deploy del frontend che la usa (il frontend
--    chiama la RPC appena Netlify deploya: senza questa migration i commenti
--    fallirebbero con "function not found").
-- ⚠️ REGOLA #0 — PARITÀ TENANT: applicare su NZ + Made + Zago, identica.
-- CARATTERE: additiva/idempotente, nessun dato toccato.

BEGIN;

CREATE OR REPLACE FUNCTION public.append_ticket_comment(p_ticket_id uuid, p_commento jsonb)
RETURNS SETOF public.tickets
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_commento IS NULL OR jsonb_typeof(p_commento) <> 'object' THEN
    RAISE EXCEPTION 'p_commento deve essere un oggetto JSON' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.tickets
  SET commenti = COALESCE(commenti, '[]'::jsonb) || jsonb_build_array(p_commento)
  WHERE id = p_ticket_id
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION public.append_ticket_comment(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_ticket_comment(uuid, jsonb) TO service_role;

COMMIT;

-- Verifica post-applicazione (deve restituire 1 riga):
--   SELECT proname FROM pg_proc
--   WHERE pronamespace = 'public'::regnamespace AND proname = 'append_ticket_comment';
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.append_ticket_comment(uuid, jsonb);
