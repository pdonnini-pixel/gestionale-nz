-- 20261116_410_distinta_email_vicolo_com.sql
--
-- Distinta pagamenti: l'indirizzo dell'amministrazione è newzago@vicolo.com, non .it
-- (Patrizio, 16/11/2026). La migration 093 aveva salvato «newzago@vicolo.it» in
-- companies.settings->>'email_scadenzario', l'elenco dei destinatari della distinta.
--
-- Tocca SOLO quell'indirizzo dentro la chiave 'email_scadenzario': gli altri destinatari
-- e le altre chiavi di settings restano come sono. Dove l'indirizzo sbagliato non c'è
-- (qualcuno l'ha già corretto a mano) non cambia niente.
--
-- Tenant: NZ + Zago (regola del 03/11/2026: Made non riceve più modifiche al database).
-- Valore prima della modifica, su entrambi:
--   amministrazione@miamor-shop.it, newzago@vicolo.it

BEGIN;

UPDATE companies
SET settings = jsonb_set(
  settings,
  '{email_scadenzario}',
  to_jsonb(replace(settings->>'email_scadenzario', 'newzago@vicolo.it', 'newzago@vicolo.com')),
  false
)
WHERE settings->>'email_scadenzario' LIKE '%newzago@vicolo.it%';

COMMIT;

-- Verifica (atteso: «amministrazione@miamor-shop.it, newzago@vicolo.com»):
--   SELECT id, name, settings->>'email_scadenzario' AS email_scadenzario FROM companies;
