-- 427 — Budget e Controllo, Confronto mensile: la rettifica mensile si salva davvero
--
-- La pagina scrive le rettifiche mensili in budget_confronto con entry_type = 'rett_monthly'
-- (onCommitRett e saveConfronto in src/pages/BudgetControl.tsx), ma il vincolo della
-- tabella ammetteva solo consuntivo, rettifica, prev_monthly, rev_monthly, cons_monthly:
-- ogni rettifica mensile veniva rifiutata dal database e la pagina non lo diceva.
-- Verifica del 17/11/2026: zero righe 'rett_monthly' (e zero 'rettifica') su NZ e Zago.
--
-- Il vincolo si allarga: nessuna riga esistente cambia, nessun dato si perde.
-- Applicata su NZ → Zago (Made fuori dal 03/11/2026).
BEGIN;

ALTER TABLE public.budget_confronto DROP CONSTRAINT IF EXISTS budget_confronto_entry_type_check;
ALTER TABLE public.budget_confronto ADD CONSTRAINT budget_confronto_entry_type_check
  CHECK (entry_type = ANY (ARRAY['consuntivo'::text, 'rettifica'::text, 'prev_monthly'::text, 'rev_monthly'::text, 'cons_monthly'::text, 'rett_monthly'::text]));

COMMIT;

-- Verifica:
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'public.budget_confronto'::regclass AND conname = 'budget_confronto_entry_type_check';
