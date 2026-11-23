-- ROLLBACK ZAGO_ONLY 448 — rimette le categorie di prima (backup di sessione del 23/11/2026).
-- Prima della 448: GGZ fornitore ACQ_MERCE, 217 fatture CANCELL e 1 ACQ_MERCE (quella resta);
-- gli altri cinque avevano fornitore e fatture tutti sulla categoria vecchia.
CREATE TEMP TABLE _corr(piva text, vecchia text, nuova text) ON COMMIT DROP;
INSERT INTO _corr VALUES
  ('12878470157','SPEDIZ','TELEFON'),
  ('00892860511','SPEDIZ','PUBBLICITA'),
  ('13397910962','VIAGGI','CANCELL'),
  ('01481920468','LOC_OUTLET','CONS_TEC'),
  ('03124500483','PULIZIA','MANUT');

UPDATE public.payables p SET cost_category_id = cv.id
  FROM public.suppliers s
  JOIN _corr x ON x.piva = coalesce(s.partita_iva, s.vat_number)
  JOIN public.cost_categories cv ON cv.code = x.vecchia AND cv.company_id = s.company_id
  JOIN public.cost_categories cn ON cn.code = x.nuova   AND cn.company_id = s.company_id
 WHERE p.supplier_id = s.id AND p.cost_category_id = cn.id;

UPDATE public.suppliers s SET default_cost_category_id = cv.id
  FROM _corr x
  JOIN public.cost_categories cv ON cv.code = x.vecchia
 WHERE coalesce(s.partita_iva, s.vat_number) = x.piva AND cv.company_id = s.company_id;

-- GGZ: le 217 fatture tornano in cancelleria (tutte tranne quella che era già ACQ_MERCE)
UPDATE public.payables SET cost_category_id = (SELECT c.id FROM public.cost_categories c JOIN public.suppliers s ON s.company_id = c.company_id
                                                 WHERE c.code = 'CANCELL' AND coalesce(s.partita_iva, s.vat_number) = '01767000282')
 WHERE supplier_id IN (SELECT id FROM public.suppliers WHERE coalesce(partita_iva, vat_number) = '01767000282')
   AND gross_amount <> 2564.99; -- la fattura da 2.564,99 € era già ACQ_MERCE prima della 448 (backup di sessione)

UPDATE public.suppliers
   SET note = nullif(regexp_replace(note, E'\\n?23/11/2026: categoria di costo corretta da [^\\n]*\\(conto del commercialista, Patrizio\\)\\.', '', 'g'), '')
 WHERE note LIKE '%(conto del commercialista, Patrizio).%';
