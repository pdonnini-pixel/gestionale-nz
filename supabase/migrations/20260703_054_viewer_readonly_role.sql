-- 20260703_054_viewer_readonly_role.sql
--
-- Ruolo 'viewer' = SOLA LETTURA. Vede tutti i dati (le policy SELECT sono
-- company-only) ma non può scrivere: non è incluso in nessuna policy di
-- scrittura role-gated (super_advisor/contabile/cfo).
--
-- Questa migrazione:
--   1. Aggiunge 'viewer' all'enum user_role.
--   2. Chiude le poche policy di scrittura NON role-gated (aperte a qualsiasi
--      utente autenticato) escludendo esplicitamente il viewer, così è
--      read-only al 100% anche lì.
--
-- Nota: usiamo il confronto ::text <> 'viewer' per non dipendere dal fatto che
-- il nuovo valore enum sia già "committato" nella stessa transazione.
--
-- PARITÀ TENANT (Regola #0): applicare su NZ + Made + Zago.

-- 1. Nuovo ruolo enum (idempotente)
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'viewer';

-- 2. Chiusura falle di scrittura per il viewer -------------------------------
--    (mantiene invariato il comportamento per tutti gli altri ruoli)

-- reconciliation_log: riconciliazione pagamenti — era aperta a authenticated
DROP POLICY IF EXISTS reclog_authenticated_write ON public.reconciliation_log;
CREATE POLICY reclog_authenticated_write ON public.reconciliation_log
  FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role()::text <> 'viewer');

DROP POLICY IF EXISTS reclog_authenticated_update ON public.reconciliation_log;
CREATE POLICY reclog_authenticated_update ON public.reconciliation_log
  FOR UPDATE TO authenticated
  USING (public.get_my_role()::text <> 'viewer');

-- fiscal_deadlines: scadenze fiscali — erano company-only
DROP POLICY IF EXISTS fiscal_deadlines_insert ON public.fiscal_deadlines;
CREATE POLICY fiscal_deadlines_insert ON public.fiscal_deadlines
  FOR INSERT
  WITH CHECK (company_id = public.get_my_company_id() AND public.get_my_role()::text <> 'viewer');

DROP POLICY IF EXISTS fiscal_deadlines_update ON public.fiscal_deadlines;
CREATE POLICY fiscal_deadlines_update ON public.fiscal_deadlines
  FOR UPDATE
  USING (company_id = public.get_my_company_id() AND public.get_my_role()::text <> 'viewer');

-- notifications: erano company-only in insert
DROP POLICY IF EXISTS notifications_insert ON public.notifications;
CREATE POLICY notifications_insert ON public.notifications
  FOR INSERT
  WITH CHECK (company_id = public.get_my_company_id() AND public.get_my_role()::text <> 'viewer');

-- storage.objects (bucket 'media'): upload/modifica/cancellazione file
DROP POLICY IF EXISTS "auth_write_media" ON storage.objects;
CREATE POLICY "auth_write_media" ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'media' AND auth.role() = 'authenticated' AND public.get_my_role()::text <> 'viewer');

DROP POLICY IF EXISTS "auth_update_media" ON storage.objects;
CREATE POLICY "auth_update_media" ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'media' AND auth.role() = 'authenticated' AND public.get_my_role()::text <> 'viewer');

DROP POLICY IF EXISTS "auth_del_media" ON storage.objects;
CREATE POLICY "auth_del_media" ON storage.objects
  FOR DELETE
  USING (bucket_id = 'media' AND auth.role() = 'authenticated' AND public.get_my_role()::text <> 'viewer');
