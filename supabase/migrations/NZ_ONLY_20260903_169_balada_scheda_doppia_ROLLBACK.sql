-- ROLLBACK di NZ_ONLY 169 — riporta BALADA ANNALAURA a due schede.
BEGIN;

UPDATE employees
   SET is_active = true, matricola = '0000097', note = NULL, updated_at = now()
 WHERE id = 'e43f6333-268f-4777-9ea8-1bfac360766e';

UPDATE employee_matricole
   SET employee_id = 'e43f6333-268f-4777-9ea8-1bfac360766e', is_current = true, note = NULL
 WHERE matricola = '0000097';

INSERT INTO employee_cost_slips
  (company_id, employee_id, year, month, tipo, netto, outlet_code, outlet_source, matricola, file_name, source, import_id, import_document_id)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'e43f6333-268f-4777-9ea8-1bfac360766e', 2026, 7, 'normale',
   156.00, 'FRANCIACORTA', 'file', '0000097', 'Elenco netti di 07-2026 Mensilità normale Filiale.pdf',
   'import_busta_paga', '1df41d5c-7915-4986-b338-9c9e62963c47', 'f2c9064f-06cd-403a-94da-de0efb8bc10e')
ON CONFLICT DO NOTHING;

UPDATE employee_cost_slips
   SET netto = 546.89, matricola = '0000095', updated_at = now()
 WHERE id = '20a4b707-306b-4bee-a111-89e3eae42955';

COMMIT;
