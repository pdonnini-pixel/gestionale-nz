-- ROLLBACK Migrazione 136 — ripristina il vincolo UNIQUE (una disposizione per payable)
--
-- ATTENZIONE: ripristinare l'unicità fallisce se nel frattempo esistono fatture con
-- più disposizioni (acconto + residuo). In tal caso vanno prima ridotte a una sola
-- disposizione per payable. Verifica preliminare consigliata:
--   SELECT payable_id, count(*) FROM public.payable_actions
--   WHERE action_type='disposizione' GROUP BY payable_id HAVING count(*) > 1;

BEGIN;

DROP INDEX IF EXISTS public.payable_actions_disposizione_payable_idx;

CREATE UNIQUE INDEX IF NOT EXISTS payable_actions_disposizione_unique
  ON public.payable_actions (payable_id)
  WHERE action_type = 'disposizione';

COMMIT;
