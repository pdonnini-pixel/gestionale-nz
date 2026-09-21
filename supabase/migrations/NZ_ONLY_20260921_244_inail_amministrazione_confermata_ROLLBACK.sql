-- ROLLBACK di NZ_ONLY 244/245 — rimette le note di deduzione della 241/243.
BEGIN;

UPDATE inail_rates
   SET note = 'Voce 0722 (4,00 per mille). Dedotto dalla vecchia posizione di Matassino (97211090), che portava solo le voci 0722 e 9300 e separava amministrazione e magazzino come fa il Prospetto. Non esiste una PEC separata per l''amministrazione: amministrazione e magazzino stanno entrambi sotto la PAT di Pian di Rona 97467211, il cui certificato riporta la voce 9300. Resta da confermare con la consulente se l''amministrazione segua la stessa 9300 (1,628) oppure una 0722 della stessa posizione: fra le due ballano circa 120 euro al mese.',
       updated_at = now()
 WHERE company_id = '00000000-0000-0000-0000-000000000001'
   AND pat_label IN ('MATASSINO-AMMINISTRAZIONE', 'PIAN DI RONA - AMMINISTRAZIONE');

UPDATE inail_rates
   SET note = 'Voce 9300 (16,28 per mille). Dedotto: e'' la stessa unita'' di PIAN DI RONA - MAGAZZINO, che il certificato INAIL colloca su questa voce, e la vecchia posizione 97211090 portava solo le voci 0722 e 9300.',
       updated_at = now()
 WHERE company_id = '00000000-0000-0000-0000-000000000001'
   AND pat_label = 'MATASSINO-MAGAZZINO';

COMMIT;
