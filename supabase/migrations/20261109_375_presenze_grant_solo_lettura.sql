-- =====================================================================
-- Migrazione 375 — Presenze: le tabelle nuove in sola lettura per gli utenti
-- =====================================================================
-- Le tabelle della 372 e della 373 hanno ricevuto dai privilegi di default
-- anche INSERT/UPDATE/DELETE/TRUNCATE per authenticated. La RLS bloccava gia'
-- le scritture (ci sono solo policy di SELECT), ma le scritture passano solo
-- dalle funzioni presenze_* e timbrature_*: si tolgono i privilegi in piu'.
-- NO DATA LOSS: solo privilegi. Tenant: NZ e Zago.
-- Rollback: 20261109_375_presenze_grant_solo_lettura_ROLLBACK.sql
-- =====================================================================
BEGIN;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.attendance_confermatori FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.attendance_eventi FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.attendance_regole_dipendente FROM authenticated, anon;
GRANT SELECT ON public.attendance_confermatori, public.attendance_eventi, public.attendance_regole_dipendente TO authenticated;
REVOKE SELECT ON public.attendance_confermatori, public.attendance_eventi, public.attendance_regole_dipendente FROM anon;
COMMIT;
