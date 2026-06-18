-- 081 — Colonne contratto su employees (parità 3 tenant: NZ/Made/Zago).
-- Applicata via MCP il 2026-06-17. Additiva e idempotente. contratto_tipo (già text)
-- ospita i codici natura: indeterminato | determinato | a_chiamata | amministratore.
-- Il backfill dati reali (da "ELENCO CONTRATTI DIPENDENTI") è stato eseguito su NZ e ZAGO
-- via UPDATE/INSERT con match per nome normalizzato (vedi PR); backup NZ in
-- backup_20260617_employees. Made: solo colonne (nessun dipendente nel file).

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS qualifica text,
  ADD COLUMN IF NOT EXISTS part_time_pct numeric,
  ADD COLUMN IF NOT EXISTS filiale text,
  ADD COLUMN IF NOT EXISTS scadenza_td date,
  ADD COLUMN IF NOT EXISTS durata_mesi numeric,
  ADD COLUMN IF NOT EXISTS proroghe int,
  ADD COLUMN IF NOT EXISTS proroghe_disponibili int,
  ADD COLUMN IF NOT EXISTS mesi_disp_senza_causale numeric,
  ADD COLUMN IF NOT EXISTS mesi_disp_con_causale numeric,
  ADD COLUMN IF NOT EXISTS stato_td text;
