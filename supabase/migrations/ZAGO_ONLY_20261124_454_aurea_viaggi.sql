-- ZAGO_ONLY 454 — Aurea SRL in Viaggi e trasferte (24/11/2026)
-- Solo Zago. Lilian, 24/11/2026: «Aurea srl va in viaggi e trasferte». Ultimo fornitore senza categoria.
-- Solo campi vuoti. Rollback: rimettere a NULL default_cost_category_id e category del fornitore
-- con P.IVA 01281660462 e cost_category_id della sua fattura 51, e togliere la nota datata.
UPDATE public.suppliers s
   SET default_cost_category_id = c.id,
       category = coalesce(nullif(s.category, ''), 'Viaggi e trasferte'),
       note = concat_ws(E'\n', nullif(s.note, ''), '24/11/2026: categoria Viaggi e trasferte (indicazione di Lilian).'),
       updated_at = now()
  FROM public.cost_categories c
 WHERE c.code = 'VIAGGI' AND c.company_id = s.company_id
   AND coalesce(s.partita_iva, s.vat_number) = '01281660462'
   AND s.default_cost_category_id IS NULL;

UPDATE public.payables p
   SET cost_category_id = s.default_cost_category_id
  FROM public.suppliers s
 WHERE p.supplier_id = s.id
   AND coalesce(s.partita_iva, s.vat_number) = '01281660462'
   AND p.cost_category_id IS NULL;
