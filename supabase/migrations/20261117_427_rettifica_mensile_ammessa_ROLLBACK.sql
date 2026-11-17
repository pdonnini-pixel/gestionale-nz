-- ROLLBACK 427 — torna al vincolo senza 'rett_monthly'.
-- ATTENZIONE: fallisce se nel frattempo sono state salvate rettifiche mensili.
-- Prima di eseguirlo: SELECT * FROM public.budget_confronto WHERE entry_type = 'rett_monthly';
-- salvare il risultato e chiedere a Patrizio cosa fare di quelle righe (NO DATA LOSS).
BEGIN;

ALTER TABLE public.budget_confronto DROP CONSTRAINT IF EXISTS budget_confronto_entry_type_check;
ALTER TABLE public.budget_confronto ADD CONSTRAINT budget_confronto_entry_type_check
  CHECK (entry_type = ANY (ARRAY['consuntivo'::text, 'rettifica'::text, 'prev_monthly'::text, 'rev_monthly'::text, 'cons_monthly'::text]));

COMMIT;
