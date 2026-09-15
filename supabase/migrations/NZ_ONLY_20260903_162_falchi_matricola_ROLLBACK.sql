-- ROLLBACK di NZ_ONLY 162 — riporta FALCHI MARTINA a matricola 0000088.
BEGIN;

UPDATE personnel_gross_cost_employee SET employee_id = NULL, updated_at = now()
 WHERE matricola = '0000086' AND employee_id = '1fac560e-2c18-4065-85be-be640214a03a';

DELETE FROM employee_matricole
 WHERE employee_id = '1fac560e-2c18-4065-85be-be640214a03a' AND matricola = '0000086';

UPDATE employee_matricole SET is_current = true, valid_to = NULL, note = NULL
 WHERE employee_id = '1fac560e-2c18-4065-85be-be640214a03a' AND matricola = '0000088';

UPDATE employees SET matricola = '0000088', updated_at = now()
 WHERE id = '1fac560e-2c18-4065-85be-be640214a03a' AND matricola = '0000086';

COMMIT;
