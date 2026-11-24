-- ROLLBACK NZ_ONLY 459 — riattiva le regole disattivate, dal backup.
UPDATE public.supplier_allocation_rules r SET is_active = b.valore_prima::boolean
  FROM public._bkp_20261124_cinque_nz b
 WHERE b.tabella = 'supplier_allocation_rules' AND b.campo = 'is_active' AND r.id = b.riga_id;
