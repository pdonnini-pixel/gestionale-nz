-- NZ_ONLY 162 — FALCHI MARTINA: la matricola vera e' 0000086, non 0000088.
-- Applicata su NZ (xfvfxsvqpnpvibgeqpqp) il 03/09/2026, su richiesta esplicita
-- di Patrizio. NON va applicata a Made e Zago: e' una correzione di dato di un
-- singolo tenant (gli altri due non hanno dati del personale), non uno schema.
--
-- Contesto: il file paghe di maggio 2026 la chiama 0000086, l'anagrafica diceva
-- 0000088. La riga di costo lordo di maggio (149,88 EUR) restava orfana, senza
-- dipendente e quindi senza punto vendita.
--
-- NO DATA LOSS: nessuna cancellazione. La matricola vecchia resta nel registro
-- `employee_matricole` come precedente, quindi un file paghe che la usa ancora
-- continua ad agganciarsi alla persona giusta.
--
-- Stato PRIMA (backup, letto in sessione):
--   employees        id=1fac560e-2c18-4065-85be-be640214a03a matricola='0000088'
--   employee_matricole  0000088 is_current=true (unica riga)
--   personnel_gross_cost_employee  matricola='0000086' employee_id=NULL lordo=149.88 (2026-05)

BEGIN;

UPDATE employees SET matricola = '0000086', updated_at = now()
 WHERE id = '1fac560e-2c18-4065-85be-be640214a03a' AND matricola = '0000088';

UPDATE employee_matricole
   SET is_current = false, valid_to = current_date,
       note = 'sostituita da 0000086 (file paghe maggio 2026)'
 WHERE employee_id = '1fac560e-2c18-4065-85be-be640214a03a' AND matricola = '0000088';

INSERT INTO employee_matricole (company_id, employee_id, matricola, is_current, note)
SELECT company_id, id, '0000086', true, 'matricola in uso nel file paghe'
  FROM employees WHERE id = '1fac560e-2c18-4065-85be-be640214a03a'
ON CONFLICT DO NOTHING;

UPDATE personnel_gross_cost_employee
   SET employee_id = '1fac560e-2c18-4065-85be-be640214a03a', updated_at = now()
 WHERE matricola = '0000086' AND employee_id IS NULL;

COMMIT;

-- VERIFICA (eseguita, esito atteso):
--   registro = '0000086 (corrente) · 0000088 (precedente)'
--   righe di personnel_gross_cost_employee senza dipendente = 0
