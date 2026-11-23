-- ROLLBACK ZAGO_ONLY 448 — rimette le categorie di prima, solo sulle fatture nel backup
-- della 449 (migration = 448) che hanno ancora la categoria scritta dalla 448.
UPDATE public.payables p
   SET cost_category_id = cv.id
  FROM public._bkp_20261123_categorie_zago b
  JOIN public.cost_categories cn ON cn.code = b.codice_dopo
  JOIN public.cost_categories cv ON cv.code = b.codice_prima AND cv.company_id = cn.company_id
 WHERE b.migration = 448
   AND p.id = b.payable_id
   AND cn.company_id = p.company_id
   AND p.cost_category_id = cn.id;

-- fornitori: solo quelli con la nota della 448 (GGZ non ce l'ha: era già ACQ_MERCE)
UPDATE public.suppliers s
   SET default_cost_category_id = cv.id
  FROM (VALUES ('12878470157','SPEDIZ'),('00892860511','SPEDIZ'),('13397910962','VIAGGI'),
               ('01481920468','LOC_OUTLET'),('03124500483','PULIZIA')) x(piva, vecchia)
  JOIN public.cost_categories cv ON cv.code = x.vecchia
 WHERE coalesce(s.partita_iva, s.vat_number) = x.piva
   AND cv.company_id = s.company_id
   AND s.note LIKE '%categoria di costo corretta da % (conto del commercialista, Patrizio).%';

UPDATE public.suppliers
   SET note = nullif(regexp_replace(note, E'\\n?23/11/2026: categoria di costo corretta da [^\\n]*\\(conto del commercialista, Patrizio\\)\\.', '', 'g'), '')
 WHERE note LIKE '%(conto del commercialista, Patrizio).%';
