-- 095 — nasconde il saldo "storico" (non del giorno) nelle run banche ricostruite
--
-- Sulle run banche PRE-tracciamento (ricostruite da 093/094) il campo saldo in
-- sync_run_details è il saldo CORRENTE del conto (lo storico giorno-per-giorno
-- non esiste), quindi NON è il saldo di quella data. Lo azzeriamo: l'UI mostra
-- "—" invece di un valore fuorviante. Le run NUOVE (dal tracciamento in poi)
-- mantengono il saldo reale al momento della sincronizzazione.
--
-- Cutoff run_at < 2026-07-15 10:00 UTC = tutte le run esistenti alla data di
-- questa fix (ricostruite). Le run forward successive NON vengono toccate.
--
-- Additivo/reversibile: solo UPDATE su tabella derivata sync_run_details.
-- IDEMPOTENTE (ri-eseguibile senza effetti).
--
-- ⚠️ PARITÀ TENANT: NZ + Made + Zago. Richiede 092 + 093 + 094.

UPDATE public.sync_run_details d
SET amount = NULL
WHERE d.feed = 'banche'
  AND d.detail_type = 'banca'
  AND d.amount IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.sync_runs s
    WHERE s.id = d.sync_run_id
      AND s.run_at < timestamptz '2026-07-15 10:00:00+00'
  );
