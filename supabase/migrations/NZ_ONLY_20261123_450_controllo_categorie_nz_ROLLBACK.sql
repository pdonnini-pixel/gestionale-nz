-- ROLLBACK NZ_ONLY 450 — rimette i valori di prima, riga per riga, dal backup
-- _bkp_20261123_categorie_nz (121 fatture, 11 categorie di costo, 33 merceologiche, 34 note).
-- Solo dove il valore è ancora quello scritto dalla 450 non serve controllare: il backup
-- contiene esattamente le righe toccate; una modifica fatta a mano dopo andrebbe persa,
-- quindi prima di lanciarlo confrontare con lo stato attuale.
UPDATE public.payables p
   SET cost_category_id = b.valore_prima::uuid
  FROM public._bkp_20261123_categorie_nz b
 WHERE b.tabella = 'payables' AND b.campo = 'cost_category_id' AND p.id = b.riga_id;

UPDATE public.suppliers s
   SET default_cost_category_id = b.valore_prima::uuid
  FROM public._bkp_20261123_categorie_nz b
 WHERE b.tabella = 'suppliers' AND b.campo = 'default_cost_category_id' AND s.id = b.riga_id;

UPDATE public.suppliers s
   SET category = b.valore_prima
  FROM public._bkp_20261123_categorie_nz b
 WHERE b.tabella = 'suppliers' AND b.campo = 'category' AND s.id = b.riga_id;

UPDATE public.suppliers s
   SET note = b.valore_prima
  FROM public._bkp_20261123_categorie_nz b
 WHERE b.tabella = 'suppliers' AND b.campo = 'note' AND s.id = b.riga_id;
