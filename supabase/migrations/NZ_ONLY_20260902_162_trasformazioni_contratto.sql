-- Solo NZ — aggancio delle 5 trasformazioni di contratto trovate nei dati vivi:
-- la matricola vecchia entra nel registro insieme a quella attuale, e il costo
-- lordo rimasto «da assegnare» si riattacca alla persona.
WITH coppie(matricola_vecchia, matricola_attuale, persona) AS (VALUES
  ('0000080','0000064','CENI LORENZO'),
  ('0000075','0000072','DROZINA ALICE'),
  ('0000081','0000082','NANDESI IRENE'),
  ('0000055','0000073','ROSSETI VERONICA'),
  ('0000069','0000070','TONDON SARA'))
INSERT INTO employee_matricole (company_id, employee_id, matricola, is_current, note)
SELECT e.company_id, e.id, c.matricola_vecchia, false,
       'trasformazione contratto — collegata il 02/09/2026 alla matricola ' || c.matricola_attuale
FROM coppie c JOIN employees e ON btrim(e.matricola) = c.matricola_attuale
ON CONFLICT DO NOTHING;

UPDATE personnel_gross_cost_employee p
   SET employee_id = m.employee_id
  FROM employee_matricole m
 WHERE p.employee_id IS NULL
   AND m.company_id = p.company_id
   AND btrim(m.matricola) = btrim(p.matricola);
