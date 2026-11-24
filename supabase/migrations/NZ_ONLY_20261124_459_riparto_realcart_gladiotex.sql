-- NZ_ONLY 459 — Realcart e Gladiotex non si ripartiscono più come merce (24/11/2026)
-- Solo NZ. Segue la 458 (categoria Spese cancelleria, come lo Studio). Revisione del database:
-- in fn_riparto_automatico v_merce è vero anche se la regola attiva comincia con «Automatica: merce»,
-- quindi con la sola categoria cambiata i due fornitori restavano ripartiti come merce.
-- Si disattivano solo le loro regole automatiche «merce» (created_by NULL, mai una regola messa a mano);
-- il riparto notturno le rifà con la categoria nuova. Prova del 24/11/2026 (fn_riparto_automatico in prova):
--   Realcart  → le fatture nominano l'outlet (29 su 31), diviso fra gli 8 negozi;
--   Gladiotex → le fatture nominano l'outlet (9 su 9), 100% Sede / Magazzino.
-- Backup in _bkp_20261124_cinque_nz (tabella 'supplier_allocation_rules', campo is_active).
-- Rollback: rimettere is_active dal backup per quelle righe.
INSERT INTO public._bkp_20261124_cinque_nz
SELECT 'supplier_allocation_rules', r.id, 'is_active', r.is_active::text
  FROM public.supplier_allocation_rules r
  JOIN public.suppliers s ON s.id = r.supplier_id
 WHERE coalesce(s.partita_iva, s.vat_number) IN ('01715000343', '02403030360')
   AND r.is_active AND r.created_by IS NULL
   AND r.description LIKE 'Automatica: merce%'
ON CONFLICT DO NOTHING;

UPDATE public.supplier_allocation_rules r
   SET is_active = false
  FROM public.suppliers s
 WHERE s.id = r.supplier_id
   AND coalesce(s.partita_iva, s.vat_number) IN ('01715000343', '02403030360')
   AND r.is_active AND r.created_by IS NULL
   AND r.description LIKE 'Automatica: merce%';
