-- 159 — Una matricola può esistere una volta sola dentro la stessa azienda.
-- Applicata sui 3 tenant il 02/09/2026 (NZ xfvfxsvqpnpvibgeqpqp, Made
-- wdgoebzvosspjqttitra, Zago jxlwvzjreukscnswkbjx).
--
-- Perché: employees non aveva alcun vincolo su matricola, solo la PK su id.
-- Due import netti falliti e ritentati hanno creato 4 dipendenti duplicati su NZ
-- senza che il database segnalasse nulla. Il controllo applicativo copre solo
-- l'import; questo indice copre ogni percorso di scrittura.
--
-- Pre-condizione verificata prima di applicare: nessuna matricola doppia su
-- nessuno dei 3 tenant (NZ 50 dipendenti, Made 0, Zago 12).

CREATE UNIQUE INDEX IF NOT EXISTS employees_company_matricola_uniq
  ON public.employees (company_id, btrim(matricola))
  WHERE matricola IS NOT NULL AND btrim(matricola) <> '';

-- Solo NZ — backup della pulizia doppioni del 02/09/2026: nessun accesso ai
-- ruoli applicativi (RLS già abilitata alla creazione).
-- REVOKE ALL ON public.backup_20260902_dup_employees FROM PUBLIC, anon, authenticated;
-- REVOKE ALL ON public.backup_20260902_dup_allocations FROM PUBLIC, anon, authenticated;
