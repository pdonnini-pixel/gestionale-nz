-- ROLLBACK NZ_ONLY 429 — rimette i consuntivi 2026 com'erano prima del 17/11/2026, dalla copia.
UPDATE public.budget_confronto b SET amount = k.amount, stato = k.stato, updated_at = now()
  FROM public._bkp_20261117_budget_confronto_ricavi k
 WHERE k.id = b.id AND k.entry_type = 'cons_monthly';
