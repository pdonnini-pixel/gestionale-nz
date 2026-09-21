-- NZ_ONLY 243 — nota corretta sulle due PAT «amministrazione».
--
-- La 241 diceva «in attesa della PEC di iscrizione dell'amministrazione». Non
-- esiste: Veronica conferma che amministrazione e magazzino stanno ENTRAMBI
-- sotto la PAT di Pian di Rona 97467211, il cui certificato riporta la voce 9300.
--
-- La domanda quindi non e' piu' «quale PAT», ma «quale voce dentro quella PAT»:
-- l'amministrazione segue la stessa 9300 a 16,28 per mille, oppure una 0722 a
-- 4,00 come nella vecchia posizione di Matassino? Il Prospetto continua a
-- stampare due righe distinte con imponibili diversi, il che fa pensare a due
-- voci, ma non lo dimostra.
--
-- Pesa: l'amministrazione ha l'imponibile piu' grosso dei due (a giugno 9.858
-- contro 4.151), quindi fra 0,400 e 1,628 ballano circa 120 euro al mese.
-- Domanda girata alla consulente del lavoro, che ha aperto le posizioni.
-- Finche' non risponde si resta su 0,400, per continuita' con Matassino, e la
-- scheda continua a marcare le due righe.
--
-- NO DATA LOSS: cambia solo il testo della nota, i tassi non si toccano.

BEGIN;

UPDATE inail_rates
   SET note = 'Voce 0722 (4,00 per mille). Dedotto dalla vecchia posizione di Matassino (97211090), che portava solo le voci 0722 e 9300 e separava amministrazione e magazzino come fa il Prospetto. Non esiste una PEC separata per l''amministrazione: amministrazione e magazzino stanno entrambi sotto la PAT di Pian di Rona 97467211, il cui certificato riporta la voce 9300. Resta da confermare con la consulente se l''amministrazione segua la stessa 9300 (1,628) oppure una 0722 della stessa posizione: fra le due ballano circa 120 euro al mese.',
       updated_at = now()
 WHERE company_id = '00000000-0000-0000-0000-000000000001'
   AND pat_label IN ('MATASSINO-AMMINISTRAZIONE', 'PIAN DI RONA - AMMINISTRAZIONE');

COMMIT;
