-- 20260715_093_distinta_email_recipients.sql
--
-- Distinta pagamenti — destinatari email.
-- I destinatari dell'email-distinta (Scadenzario → "Crea distinta" → "Apri in Gmail" / "Copia
-- testo") sono letti dal frontend da companies.settings->>'email_scadenzario'.
-- Finora il valore salvato era la mail personale (pdonnini@gmail.com): va sostituito con gli
-- indirizzi dell'amministrazione.
--
-- Nuovi destinatari richiesti:
--   amministrazione@miamor-shop.it, newzago@vicolo.it
--
-- Additivo e non distruttivo: aggiorna SOLO la chiave 'email_scadenzario' dentro il JSONB
-- settings (jsonb_set con create_missing = true), preservando ogni altra chiave esistente.
--
-- ⚠️ PARITÀ TENANT: applicare A MANO dal dashboard Supabase su TUTTI E 3 i tenant
--    NZ (xfvfxsvqpnpvibgeqpqp) / Made (wdgoebzvosspjqttitra) / Zago (jxlwvzjreukscnswkbjx).
--    Ogni DB tenant contiene la propria company: l'UPDATE senza WHERE aggiorna la company
--    del tenant su cui viene eseguito.

BEGIN;

UPDATE companies
SET settings = jsonb_set(
  COALESCE(settings, '{}'::jsonb),
  '{email_scadenzario}',
  '"amministrazione@miamor-shop.it, newzago@vicolo.it"'::jsonb,
  true
);

COMMIT;

-- Verifica (atteso: il nuovo valore su ogni riga companies):
--   SELECT id, name, settings->>'email_scadenzario' AS email_scadenzario FROM companies;
--
-- Rollback (ripristina il valore precedente, se serve):
--   UPDATE companies
--   SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{email_scadenzario}', '"pdonnini@gmail.com"'::jsonb, true);
