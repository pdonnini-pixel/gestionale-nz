-- NZ_ONLY 241 — tassi INAIL delle PAT della sede e di Torino, dalle PEC di iscrizione.
--
-- Veronica ha recuperato due certificati INAIL:
--   PIAN DI RONA magazzino  PAT 97467211  voce 9300  tasso 16,28 per mille
--   SETTIMO TORINESE        PAT 97420599  voce 0111  tasso  7,31 per mille, dal 20/03/2026
--
-- I due valori combaciano con le voci di tariffa delle basi di calcolo 2025/26,
-- dove 9300 vale 16,28 e 0111 vale 7,31: due fonti indipendenti, stesso numero.
--
-- COSA SCIOGLIE. La vecchia posizione di Matassino (97211090) portava ESATTAMENTE
-- due voci, 0722 a 4,00 e 9300 a 16,28, e non si sapeva quale coprisse il magazzino
-- e quale l'amministrazione. Ora che la PEC dice magazzino = 9300, l'amministrazione
-- non puo' che essere la 0722. Per Pian di Rona amministrazione vale lo stesso
-- ragionamento (stessa attivita', PAT nuova per il trasloco), ma la sua PEC non e'
-- ancora arrivata: resta con la nota, quindi la scheda continua a marcarla.
--
-- TORINO perde la nota: non e' piu' un'inferenza sulla ditta, e' il suo certificato.
--
-- EFFETTO: l'INAIL della sede passa da quasi zero (stima 0,1859) al valore vero.
-- Su giugno il magazzino da solo vale 4.151 x 1,628% = 67,58 euro.
--
-- NO DATA LOSS: solo UPDATE di quattro righe. Backup: tutte e quattro erano a
-- 0,1859 con la nota della stima (NZ_ONLY 172 e 176).

BEGIN;

-- Dalla PEC, certi.
UPDATE inail_rates SET rate_percent = 1.6280, note = NULL, updated_at = now()
 WHERE company_id = '00000000-0000-0000-0000-000000000001'
   AND pat_label = 'PIAN DI RONA - MAGAZZINO';

UPDATE inail_rates SET rate_percent = 0.7310, note = NULL, updated_at = now()
 WHERE company_id = '00000000-0000-0000-0000-000000000001'
   AND pat_label = 'TORINO';

-- Stessa unita' produttiva prima del trasloco: stessa voce 9300.
UPDATE inail_rates
   SET rate_percent = 1.6280,
       note = 'Voce 9300 (16,28 per mille). Dedotto: e'' la stessa unita'' di PIAN DI RONA - MAGAZZINO, che il certificato INAIL colloca su questa voce, e la vecchia posizione 97211090 portava solo le voci 0722 e 9300.',
       updated_at = now()
 WHERE company_id = '00000000-0000-0000-0000-000000000001'
   AND pat_label = 'MATASSINO-MAGAZZINO';

-- Per esclusione sulle due voci della posizione 97211090.
UPDATE inail_rates
   SET rate_percent = 0.4000,
       note = 'Voce 0722 (4,00 per mille). Dedotto per esclusione: la posizione 97211090 portava solo le voci 0722 e 9300, e il certificato INAIL assegna la 9300 al magazzino. In attesa della PEC di iscrizione dell''amministrazione.',
       updated_at = now()
 WHERE company_id = '00000000-0000-0000-0000-000000000001'
   AND pat_label IN ('MATASSINO-AMMINISTRAZIONE', 'PIAN DI RONA - AMMINISTRAZIONE');

COMMIT;
