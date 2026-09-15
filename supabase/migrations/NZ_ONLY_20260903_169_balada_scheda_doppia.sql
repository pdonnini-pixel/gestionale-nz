-- NZ_ONLY 169 — BALADA ANNALAURA: due schede diventano una.
-- Applicata su NZ (xfvfxsvqpnpvibgeqpqp) il 03/09/2026, su richiesta esplicita
-- di Patrizio. NON va applicata a Made e Zago: e' una correzione di dato di un
-- singolo tenant, non uno schema.
--
-- Contesto: nell'elenco netti di luglio 2026 la stessa persona compare con DUE
-- matricole (0000095 per 546,89 e 0000097 per 156,00) sulla stessa filiale. Il
-- carico ha creato due schede a 0,3 secondi di distanza, perche' registrava la
-- persona nuova solo con la matricola della riga che l'aveva creata. Luglio
-- risultava quindi di 44 teste invece di 43. Il codice che lo causava e' stato
-- corretto nello stesso intervento (indice per nome dei nuovi del file).
--
-- NO DATA LOSS: il netto non si perde, si somma sulla scheda che resta; la
-- matricola in piu' entra nel registro; la scheda doppia non viene cancellata,
-- viene disattivata con la nota che dice cosa e' successo.
--
-- Stato PRIMA (backup, letto in sessione):
--   employees 837c528e-… matricola 0000095, is_active=true
--   employees e43f6333-… matricola 0000097, is_active=true
--   employee_cost_slips 20a4b707-… (0000095) 2026-07 normale netto 546.89 FRANCIACORTA
--   employee_cost_slips ff325811-… (0000097) 2026-07 normale netto 156.00 FRANCIACORTA
--   employee_matricole: 0000095 -> 837c528e (corrente), 0000097 -> e43f6333 (corrente)
--   employee_outlet_allocations: FRANCIACORTA 100% su entrambe

BEGIN;

-- 1. Il netto della scheda doppia si somma su quella che resta.
UPDATE employee_cost_slips
   SET netto = 702.89, matricola = '0000095 + 0000097', updated_at = now()
 WHERE id = '20a4b707-306b-4bee-a111-89e3eae42955' AND netto = 546.89;

-- 2. Via il cedolino duplicato: la chiave (persona, mese, tipo) e' unica, quindi
--    i due non possono convivere sulla stessa scheda. L'importo e' salvo al punto 1.
DELETE FROM employee_cost_slips WHERE id = 'ff325811-0bdb-4ac8-b8ca-59f51bbcb9d2';

-- 3. La matricola in piu' resta nel registro, agganciata alla scheda che vive.
UPDATE employee_matricole
   SET employee_id = '837c528e-d106-4233-9654-0d5e915d86aa', is_current = false,
       note = 'seconda matricola della stessa persona nel file di luglio 2026'
 WHERE matricola = '0000097';

-- 4. La scheda doppia si disattiva, non si cancella.
UPDATE employees
   SET is_active = false, matricola = NULL,
       note = 'Scheda doppia di BALADA ANNALAURA (matricola 0000095): unificata il 03/09/2026, il cedolino di luglio e'' stato sommato sulla scheda corrente.',
       updated_at = now()
 WHERE id = 'e43f6333-268f-4777-9ea8-1bfac360766e';

COMMIT;

-- VERIFICA (eseguita, esito atteso):
--   luglio 2026 «normale»: 43 cedolini, 43 persone, netto 70.235,70 (invariato)
--   BALADA: una scheda attiva, registro «0000095 (corrente) · 0000097 (precedente)», netto 702,89
