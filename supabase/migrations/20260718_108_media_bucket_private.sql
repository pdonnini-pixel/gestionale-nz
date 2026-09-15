-- Migrazione 108 — Bucket 'media' (allegati ticket) PRIVATO + lettura solo autenticati
-- (audit 2026-07-17, finding: "Allegati ticket su bucket pubblico serviti con URL
--  pubblici senza autenticazione").
--
-- Prima: bucket 'media' pubblico + policy di lettura aperta a PUBLIC → chiunque
-- conoscesse l'URL (o il path) poteva vedere gli screenshot del gestionale senza
-- login. Ora: bucket privato + lettura riservata agli utenti autenticati. Il
-- frontend genera URL firmati a scadenza al momento della visualizzazione.
--
-- ⚠️ ORDINE: applicare DOPO che il frontend con gli URL firmati è in produzione
--    (altrimenti gli allegati dei ticket esistenti smettono di mostrarsi finché
--    il nuovo frontend non è deployato). Il nuovo frontend ricava il path anche
--    dai vecchi URL pubblici, quindi gli allegati storici continuano a funzionare.
--
-- ⚠️ REGOLA #0 — PARITÀ TENANT: applicare su NZ + Made + Zago.
-- CARATTERE: additivo/idempotente, nessun dato/file toccato.

BEGIN;

-- 1. Bucket privato (niente più accesso via URL pubblico)
UPDATE storage.buckets SET public = false WHERE id = 'media';

-- 2. Lettura riservata agli utenti AUTENTICATI (prima era aperta a public)
DROP POLICY IF EXISTS "auth_read_media" ON storage.objects;
CREATE POLICY "auth_read_media" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'media');

COMMIT;

-- Rollback (se serve tornare al bucket pubblico):
-- BEGIN;
--   UPDATE storage.buckets SET public = true WHERE id = 'media';
--   DROP POLICY IF EXISTS "auth_read_media" ON storage.objects;
--   CREATE POLICY "auth_read_media" ON storage.objects FOR SELECT USING (bucket_id = 'media');
-- COMMIT;
