-- ZAGO_ONLY 457 — fatture e fornitori di Zago sulle categorie dei beni (24/11/2026)
-- Solo Zago (jxlwvzjreukscnswkbjx). Dopo la 455. Fonte: conto del commercialista nel file dello Studio
-- (foglio Categorie). Fornitori divisi su più conti esclusi (regola di Lilian)
-- (Amazon).
-- Ogni fattura prende la categoria del suo conto; il fornitore quella del conto con l'importo maggiore.
-- Backup riga per riga in _bkp_20261124_beni_zago (senza GRANT). Rollback a fianco.
CREATE TABLE IF NOT EXISTS public._bkp_20261124_beni_zago (
  tabella text NOT NULL, riga_id uuid NOT NULL, campo text NOT NULL, valore_prima text,
  PRIMARY KEY (tabella, riga_id, campo));
ALTER TABLE public._bkp_20261124_beni_zago ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bkp_20261124_beni_zago FROM anon, authenticated;

CREATE TEMP TABLE _inv(piva text, num text, code text) ON COMMIT DROP;
INSERT INTO _inv VALUES
  ('03129171207','966','BENI_PICCOLI'),
  ('06971050486','7','BENI_OPERE_TERZI'),
  ('01298610450','5','BENI_PICCOLI'),
  ('04589211210','38/00','BENI_PICCOLI'),
  ('02098450469','27/2026','BENI_PICCOLI'),
  ('02098450469','49/2026','BENI_PICCOLI'),
  ('02294630500','FPR 68/26','BENI_PICCOLI'),
  ('05095320288','20','BENI_MOBILI'),
  ('02630120166','334 01044','BENI_MACCHINE_UFFICIO'),
  ('03969640287','6','BENI_MOBILI'),
  ('05257600287','99','BENI_PICCOLI');
CREATE TEMP TABLE _sup(piva text, code text) ON COMMIT DROP;
INSERT INTO _sup VALUES
  ('03129171207','BENI_PICCOLI'),
  ('06971050486','BENI_OPERE_TERZI'),
  ('01298610450','BENI_PICCOLI'),
  ('04589211210','BENI_PICCOLI'),
  ('02098450469','BENI_PICCOLI'),
  ('02294630500','BENI_PICCOLI'),
  ('05095320288','BENI_MOBILI'),
  ('02630120166','BENI_MACCHINE_UFFICIO'),
  ('03969640287','BENI_MOBILI'),
  ('05257600287','BENI_PICCOLI');

INSERT INTO public._bkp_20261124_beni_zago
SELECT 'payables', p.id, 'cost_category_id', p.cost_category_id::text
  FROM _inv i
  JOIN public.suppliers s ON coalesce(s.partita_iva, s.vat_number) = i.piva
  JOIN public.payables p ON p.supplier_id = s.id AND p.invoice_number = i.num
ON CONFLICT DO NOTHING;
INSERT INTO public._bkp_20261124_beni_zago
SELECT 'suppliers', s.id, k.campo, k.valore
  FROM _sup x
  JOIN public.suppliers s ON coalesce(s.partita_iva, s.vat_number) = x.piva
  CROSS JOIN LATERAL (VALUES ('default_cost_category_id', s.default_cost_category_id::text), ('note', s.note)) k(campo, valore)
ON CONFLICT DO NOTHING;

UPDATE public.payables p
   SET cost_category_id = c.id
  FROM _inv i
  JOIN public.suppliers s ON coalesce(s.partita_iva, s.vat_number) = i.piva
  JOIN public.cost_categories c ON c.code = i.code AND c.company_id = s.company_id
 WHERE p.supplier_id = s.id AND p.invoice_number = i.num
   AND p.cost_category_id IS DISTINCT FROM c.id;

UPDATE public.suppliers s
   SET default_cost_category_id = c.id,
       note = concat_ws(E'\n', nullif(s.note, ''), '24/11/2026: categoria di costo ' || c.name || ' (categorie dei beni come il commercialista).'),
       updated_at = now()
  FROM _sup x JOIN public.cost_categories c ON c.code = x.code
 WHERE coalesce(s.partita_iva, s.vat_number) = x.piva
   AND c.company_id = s.company_id
   AND s.default_cost_category_id IS DISTINCT FROM c.id;
