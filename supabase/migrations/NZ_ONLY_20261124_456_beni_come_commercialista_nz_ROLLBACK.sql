-- ROLLBACK NZ_ONLY 456 — valori di prima dal backup _bkp_20261124_beni_nz.
UPDATE public.payables p SET cost_category_id = b.valore_prima::uuid FROM public._bkp_20261124_beni_nz b
 WHERE b.tabella = 'payables' AND b.campo = 'cost_category_id' AND p.id = b.riga_id;
UPDATE public.suppliers s SET default_cost_category_id = b.valore_prima::uuid FROM public._bkp_20261124_beni_nz b
 WHERE b.tabella = 'suppliers' AND b.campo = 'default_cost_category_id' AND s.id = b.riga_id;
UPDATE public.suppliers s SET note = b.valore_prima FROM public._bkp_20261124_beni_nz b
 WHERE b.tabella = 'suppliers' AND b.campo = 'note' AND s.id = b.riga_id;
