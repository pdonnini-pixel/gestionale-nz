-- 20260703_055_drop_golive_backup_tables.sql
--
-- Rimuove 8 tabelle di backup/lavoro residue dal go-live + dedup del 17/06/2026,
-- segnalate dal linter Supabase come esposte in `public` senza RLS (alcune con
-- colonne sensibili: iban). Go-live (28/05) e dedup ormai stabili → i backup non
-- servono più. Autorizzato da Patrizio 2026-07-03.
--
-- NB: DROP distruttivo. IF EXISTS per tollerare tenant dove non esistono.
-- PARITÀ TENANT (Regola #0): eseguire su NZ + Made + Zago.

DROP TABLE IF EXISTS
  public.payables_bkp_golive_20260617,
  public.payables_bkp_dedup_20260617,
  public.payables_bkp_mp08_20260617,
  public.payables_dedup_review_20260617,
  public.backup_20260617_employees,
  public._golive_keep,
  public._golive_plan,
  public._golive_clones
  CASCADE;
