-- ROLLBACK ZAGO_ONLY 447 — toglie solo ciò che la 447 ha scritto.
-- Fatture: solo quelle nel backup della 449 (migration = 447) e solo se hanno ancora
-- la categoria scritta dalla 447. Fornitori: riconosciuti dalla nota datata.
-- Se si annullano tutte e due, prima il rollback della 448, poi questo.
UPDATE public.payables p
   SET cost_category_id = NULL
  FROM public._bkp_20261123_categorie_zago b
  JOIN public.cost_categories c ON c.code = b.codice_dopo
 WHERE b.migration = 447
   AND p.id = b.payable_id
   AND c.company_id = p.company_id
   AND p.cost_category_id = c.id;

UPDATE public.suppliers
   SET default_cost_category_id = NULL
 WHERE note LIKE '%23/11/2026: categoria di costo % dal file di riconciliazione Zago%';

UPDATE public.suppliers
   SET category = NULL
 WHERE note LIKE '%23/11/2026: categoria merceologica % dal file di riconciliazione Zago%';

UPDATE public.suppliers
   SET note = nullif(regexp_replace(note, E'\\n?23/11/2026: categoria [^\\n]* dal file di riconciliazione Zago \\(Patrizio\\)\\.', '', 'g'), '')
 WHERE note LIKE '%dal file di riconciliazione Zago (Patrizio).%';
