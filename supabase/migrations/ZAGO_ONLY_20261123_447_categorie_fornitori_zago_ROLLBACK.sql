-- ROLLBACK ZAGO_ONLY 447 — toglie solo ciò che la 447 ha scritto (riconosciuto dalla nota datata).
-- Le fatture: si azzera la categoria solo su quelle che, prima della 447, erano vuote
-- (elenco degli id nel backup di sessione del 23/11/2026; qui per fornitore toccato dalla 447).
UPDATE public.payables p
   SET cost_category_id = NULL
  FROM public.suppliers s
 WHERE p.supplier_id = s.id
   AND s.note LIKE '%23/11/2026: categoria di costo % dal file di riconciliazione Zago%';

UPDATE public.suppliers
   SET default_cost_category_id = NULL
 WHERE note LIKE '%23/11/2026: categoria di costo % dal file di riconciliazione Zago%';

UPDATE public.suppliers
   SET category = NULL
 WHERE note LIKE '%23/11/2026: categoria merceologica % dal file di riconciliazione Zago%';

UPDATE public.suppliers
   SET note = nullif(regexp_replace(note, E'\\n?23/11/2026: categoria [^\\n]* dal file di riconciliazione Zago \\(Patrizio\\)\\.', '', 'g'), '')
 WHERE note LIKE '%dal file di riconciliazione Zago (Patrizio).%';
