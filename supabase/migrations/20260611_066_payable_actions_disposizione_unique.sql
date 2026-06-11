-- Migrazione 066 — Anti-doppione distinta: una sola disposizione "aperta" per payable
-- Bug: un retry inseriva 2 righe identiche payable_actions(action_type='disposizione')
-- per lo stesso payable. Indice unique PARZIALE su payable_id limitato alle disposizioni.
-- NB: con indice unique parziale, un eventuale ON CONFLICT lato client deve specificare
-- il predicato WHERE nel conflict target. Qui il frontend fa pre-check + cattura 23505.
-- Verificato: nessun duplicato esistente sui 3 tenant prima della creazione.

CREATE UNIQUE INDEX IF NOT EXISTS payable_actions_disposizione_unique
  ON public.payable_actions (payable_id)
  WHERE action_type = 'disposizione';
