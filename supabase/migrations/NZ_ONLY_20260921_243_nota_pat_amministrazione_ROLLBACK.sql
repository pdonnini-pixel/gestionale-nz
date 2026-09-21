-- ROLLBACK di NZ_ONLY 243 — rimette la nota della 241.
BEGIN;
UPDATE inail_rates
   SET note = 'Voce 0722 (4,00 per mille). Dedotto per esclusione: la posizione 97211090 portava solo le voci 0722 e 9300, e il certificato INAIL assegna la 9300 al magazzino. In attesa della PEC di iscrizione dell''amministrazione.',
       updated_at = now()
 WHERE company_id = '00000000-0000-0000-0000-000000000001'
   AND pat_label IN ('MATASSINO-AMMINISTRAZIONE', 'PIAN DI RONA - AMMINISTRAZIONE');
COMMIT;
