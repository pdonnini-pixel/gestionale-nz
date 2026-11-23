-- ZAGO_ONLY 448 — correzione di sei categorie di costo sbagliate su Zago (23/11/2026)
-- Solo Zago (jxlwvzjreukscnswkbjx). Patrizio, 23/11/2026: «sì, correggi tutte e sei».
-- Fonte: conti del commercialista nel file «Zago_riconciliazione_merci_e_categorie.xlsx».
--   GGZ SRL (01767000282)            CANCELL    → ACQ_MERCE  (218 fatture di merce, conto 610131)
--   Fastweb (12878470157)            SPEDIZ     → TELEFON    (conto 630369 spese telefoniche)
--   faliero grafica (00892860511)    SPEDIZ     → PUBBLICITA (conto 630351 pubblicità)
--   Amazon Business (13397910962)    VIAGGI     → CANCELL    (conti 630715 / 610139)
--   Maria Luisa Seveso (01481920468) LOC_OUTLET → CONS_TEC   (conto 630723 altre consulenze)
--   Calosi (03124500483)             PULIZIA    → MANUT      (conto 630319 manutenzione)
-- Cambia la categoria del fornitore (se è ancora quella vecchia) e delle sue fatture
-- che hanno la categoria vecchia. Nessun importo cambia. Backup di sessione del 23/11/2026.
-- Rollback: ZAGO_ONLY_20261123_448_correzione_sei_categorie_zago_ROLLBACK.sql

CREATE TEMP TABLE _corr(piva text, vecchia text, nuova text) ON COMMIT DROP;
INSERT INTO _corr VALUES
  ('01767000282','CANCELL','ACQ_MERCE'),
  ('12878470157','SPEDIZ','TELEFON'),
  ('00892860511','SPEDIZ','PUBBLICITA'),
  ('13397910962','VIAGGI','CANCELL'),
  ('01481920468','LOC_OUTLET','CONS_TEC'),
  ('03124500483','PULIZIA','MANUT');

-- fatture: dalla categoria vecchia alla nuova
UPDATE public.payables p
   SET cost_category_id = cn.id
  FROM public.suppliers s
  JOIN _corr x ON x.piva = coalesce(s.partita_iva, s.vat_number)
  JOIN public.cost_categories cv ON cv.code = x.vecchia AND cv.company_id = s.company_id
  JOIN public.cost_categories cn ON cn.code = x.nuova   AND cn.company_id = s.company_id
 WHERE p.supplier_id = s.id
   AND p.cost_category_id = cv.id;

-- fornitore: categoria di costo (GGZ è già ACQ_MERCE e resta)
UPDATE public.suppliers s
   SET default_cost_category_id = cn.id,
       note = concat_ws(E'\n', nullif(s.note, ''), '23/11/2026: categoria di costo corretta da ' || cv.name || ' a ' || cn.name || ' (conto del commercialista, Patrizio).'),
       updated_at = now()
  FROM _corr x
  JOIN public.cost_categories cv ON cv.code = x.vecchia
  JOIN public.cost_categories cn ON cn.code = x.nuova AND cn.company_id = cv.company_id
 WHERE coalesce(s.partita_iva, s.vat_number) = x.piva
   AND cv.company_id = s.company_id
   AND s.default_cost_category_id = cv.id;
