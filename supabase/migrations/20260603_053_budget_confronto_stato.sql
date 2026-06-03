-- 053 — budget_confronto.stato: marcatore esplicito granitico/preventivo
--
-- Distingue in modo esplicito un valore PREVISIONALE da uno GRANITICO
-- (consuntivo reale dei mesi chiusi), oggi deducibile solo dall'entry_type
-- (cons_monthly vs rev_monthly) in modo fragile.
--
-- Additiva: ADD COLUMN con DEFAULT 'preventivo'. Nessun valore esistente
-- modificato dalla migration. Idempotente (rieseguibile sui 3 tenant).
-- Backfill SOLO NZ (cons_monthly->granitico, rev_monthly->preventivo): vedi
-- script di backfill separato, NON in questa migration (Made/Zago hanno
-- budget_confronto vuoto → nessun backfill là).

ALTER TABLE public.budget_confronto
  ADD COLUMN IF NOT EXISTS stato text NOT NULL DEFAULT 'preventivo';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'budget_confronto_stato_chk'
  ) THEN
    ALTER TABLE public.budget_confronto
      ADD CONSTRAINT budget_confronto_stato_chk CHECK (stato IN ('preventivo','granitico'));
  END IF;
END $$;
