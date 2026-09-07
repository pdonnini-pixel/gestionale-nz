-- NZ_ONLY 176 — tasso INAIL per le due PAT «PIAN DI RONA» (New Zago).
--
-- Col prospetto di giugno 2026 la sede ha cambiato indirizzo e con lei le due PAT:
-- MATASSINO-MAGAZZINO e MATASSINO-AMMINISTRAZIONE sono diventate
-- PIAN DI RONA - MAGAZZINO e PIAN DI RONA - AMMINISTRAZIONE. Sono le stesse unita'
-- con un nome nuovo, quindi prendono lo stesso tasso stimato delle vecchie (0,1859),
-- ricavato come da NZ_ONLY 172. Senza questo, l'INAIL di SEDE / MAGAZZINO restava a
-- zero su giugno e luglio.
--
-- Verifica dopo l'applicazione: v_personnel_gross_cost per SEDE / MAGAZZINO segna
-- 26,04 EUR di INAIL a giugno e 20,65 a luglio, e inail_incompleto e' falso.
--
-- NO DATA LOSS: scrive solo dove rate_percent e' NULL.

BEGIN;

UPDATE inail_rates r
   SET rate_percent = 0.1859,
       note = 'Stimato dai dati gennaio-aprile 2026 (INAIL della Statistica costo orario diviso imponibile PAT del Prospetto paghe). PAT rinominata: e'' la stessa unita'' delle vecchie MATASSINO, stesso tasso. Non e'' il tasso dell''autoliquidazione INAIL: sovrascrivilo appena disponibile.',
       updated_at = now()
 WHERE r.company_id = '00000000-0000-0000-0000-000000000001'
   AND r.pat_label IN ('PIAN DI RONA - MAGAZZINO', 'PIAN DI RONA - AMMINISTRAZIONE')
   AND r.rate_percent IS NULL;

COMMIT;
