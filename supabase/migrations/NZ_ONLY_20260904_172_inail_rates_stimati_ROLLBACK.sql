-- ROLLBACK di NZ_ONLY 170 — riporta a NULL i soli tassi stimati, riconosciuti
-- dalla nota. Un tasso riscritto a mano (nota azzerata dal salvataggio) resta.
BEGIN;

UPDATE inail_rates
   SET rate_percent = NULL, note = NULL, updated_at = now()
 WHERE company_id = '00000000-0000-0000-0000-000000000001'
   AND note LIKE 'Stimato dai dati gennaio-aprile 2026%';

COMMIT;
