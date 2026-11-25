-- ROLLBACK NZ_ONLY 453 — rimette i valori di prima riga per riga dal backup _bkp_20261124_categorie_nz.
-- Una modifica fatta a mano dopo il 24/11/2026 sulle stesse righe andrebbe persa: confrontare prima.
UPDATE public.payables p SET cost_category_id = b.valore_prima::uuid
  FROM public._bkp_20261124_categorie_nz b
 WHERE b.tabella = 'payables' AND b.campo = 'cost_category_id' AND p.id = b.riga_id;
UPDATE public.suppliers s SET default_cost_category_id = b.valore_prima::uuid
  FROM public._bkp_20261124_categorie_nz b
 WHERE b.tabella = 'suppliers' AND b.campo = 'default_cost_category_id' AND s.id = b.riga_id;
UPDATE public.suppliers s SET category = b.valore_prima
  FROM public._bkp_20261124_categorie_nz b
 WHERE b.tabella = 'suppliers' AND b.campo = 'category' AND s.id = b.riga_id;
UPDATE public.suppliers s SET note = b.valore_prima
  FROM public._bkp_20261124_categorie_nz b
 WHERE b.tabella = 'suppliers' AND b.campo = 'note' AND s.id = b.riga_id;
