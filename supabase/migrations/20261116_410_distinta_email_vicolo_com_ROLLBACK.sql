-- ROLLBACK di 20261116_410_distinta_email_vicolo_com.sql
-- Rimette l'indirizzo com'era prima (newzago@vicolo.it) nei destinatari della distinta.

BEGIN;

UPDATE companies
SET settings = jsonb_set(
  settings,
  '{email_scadenzario}',
  to_jsonb(replace(settings->>'email_scadenzario', 'newzago@vicolo.com', 'newzago@vicolo.it')),
  false
)
WHERE settings->>'email_scadenzario' LIKE '%newzago@vicolo.com%';

COMMIT;
