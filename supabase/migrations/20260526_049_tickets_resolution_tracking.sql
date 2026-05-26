-- Migration 049: tracking risoluzione AI + badge sidebar autore
--
-- Nuove colonne su tickets per Edge Function ticket-resolve-now:
-- - resolution_pr_url: URL della PR su GitHub creata dall'AI
-- - resolution_branch: nome branch hotfix usato (pattern: autofix-ticket-<short-id>)
-- - last_seen_by_author_at: ultima visualizzazione del ticket dall'autore,
--   usata per calcolare badge sidebar 'Segnalazioni' = numero ticket
--   dell'autore con aggiornato_il > last_seen_by_author_at

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS resolution_pr_url TEXT,
  ADD COLUMN IF NOT EXISTS resolution_branch TEXT,
  ADD COLUMN IF NOT EXISTS last_seen_by_author_at TIMESTAMPTZ;

COMMENT ON COLUMN public.tickets.resolution_pr_url IS
  'URL della PR su GitHub creata dall''edge function ticket-resolve-now. NULL se non risolto via AI o ancora in lavorazione.';

COMMENT ON COLUMN public.tickets.resolution_branch IS
  'Nome del branch hotfix creato dall''edge function. Pattern: autofix-ticket-<short-id>.';

COMMENT ON COLUMN public.tickets.last_seen_by_author_at IS
  'Timestamp ultima visualizzazione del ticket da parte dell''autore. Usato per badge sidebar Segnalazioni: COUNT(*) ticket dell''autore con aggiornato_il > last_seen_by_author_at = ticket risolti non visti.';

CREATE INDEX IF NOT EXISTS idx_tickets_autore_aggiornato
  ON public.tickets (autore_id, aggiornato_il DESC)
  WHERE autore_id IS NOT NULL;

-- RPC badge sidebar: numero ticket dell'utente con aggiornamenti non visti
CREATE OR REPLACE FUNCTION public.get_unseen_ticket_updates_count()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COUNT(*)::int FROM public.tickets
  WHERE autore_id = auth.uid()
    AND (last_seen_by_author_at IS NULL OR aggiornato_il > last_seen_by_author_at);
$$;

GRANT EXECUTE ON FUNCTION public.get_unseen_ticket_updates_count() TO authenticated;

-- RPC marca ticket come visto (chiamata all'apertura del dettaglio)
CREATE OR REPLACE FUNCTION public.mark_ticket_seen(p_ticket_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  UPDATE public.tickets
  SET last_seen_by_author_at = now()
  WHERE id = p_ticket_id
    AND autore_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.mark_ticket_seen(UUID) TO authenticated;
