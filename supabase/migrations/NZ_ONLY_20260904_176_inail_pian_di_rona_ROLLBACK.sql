-- ROLLBACK di NZ_ONLY 176 — riporta a NULL il tasso delle due PAT PIAN DI RONA,
-- solo se e' ancora quello stimato (nota intatta).
BEGIN;

UPDATE inail_rates
   SET rate_percent = NULL, note = NULL, updated_at = now()
 WHERE company_id = '00000000-0000-0000-0000-000000000001'
   AND pat_label IN ('PIAN DI RONA - MAGAZZINO', 'PIAN DI RONA - AMMINISTRAZIONE')
   AND note LIKE 'Stimato dai dati gennaio-aprile 2026%';

COMMIT;
