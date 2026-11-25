-- NZ_ONLY 456 — fatture e fornitori di NZ sulle categorie dei beni (24/11/2026)
-- Solo NZ (xfvfxsvqpnpvibgeqpqp). Dopo la 455. Fonte: conto del commercialista nel file dello Studio
-- (foglio Riclassifiche). Fornitori divisi su più conti esclusi (regola di Lilian)
-- e i cinque in attesa di Patrizio (Realcart, Caccia Agnese, A.B.N., Graphic Report, Gladiotex); Humatics: solo la fattura.
-- Ogni fattura prende la categoria del suo conto; il fornitore quella del conto con l'importo maggiore.
-- Backup riga per riga in _bkp_20261124_beni_nz (senza GRANT). Rollback a fianco.
CREATE TABLE IF NOT EXISTS public._bkp_20261124_beni_nz (
  tabella text NOT NULL, riga_id uuid NOT NULL, campo text NOT NULL, valore_prima text,
  PRIMARY KEY (tabella, riga_id, campo));
ALTER TABLE public._bkp_20261124_beni_nz ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bkp_20261124_beni_nz FROM anon, authenticated;

CREATE TEMP TABLE _inv(piva text, num text, code text) ON COMMIT DROP;
INSERT INTO _inv VALUES
  ('00434920484','500606 / 1310','BENI_OPERE_TERZI'),
  ('03268520230','26102826','BENI_SOFTWARE'),
  ('09136730018','170/00','BENI_OPERE_TERZI'),
  ('05763200481','84/2026','BENI_PICCOLI'),
  ('05763200481','292/2026','BENI_ATTREZZATURE'),
  ('01589490521','656','BENI_PICCOLI'),
  ('09798060019','FPR 49/26','BENI_ATTREZZATURE'),
  ('02483980518','5/FE','BENI_OPERE_TERZI'),
  ('02483980518','10/FE','BENI_OPERE_TERZI'),
  ('06971050486','8','BENI_MOBILI'),
  ('06971050486','18','BENI_OPERE_TERZI'),
  ('04211030962','98','BENI_MOBILI'),
  ('04211030962','193','BENI_OPERE_TERZI'),
  ('04211030962','578','BENI_OPERE_TERZI'),
  ('02777490307','192','BENI_OPERE_TERZI'),
  ('00876320409','412 00494','BENI_PICCOLI'),
  ('18384891000','56/FE','BENI_ATTREZZATURE');
CREATE TEMP TABLE _sup(piva text, code text) ON COMMIT DROP;
INSERT INTO _sup VALUES
  ('00434920484','BENI_OPERE_TERZI'),
  ('09136730018','BENI_OPERE_TERZI'),
  ('05763200481','BENI_PICCOLI'),
  ('01589490521','BENI_PICCOLI'),
  ('09798060019','BENI_ATTREZZATURE'),
  ('02483980518','BENI_OPERE_TERZI'),
  ('06971050486','BENI_MOBILI'),
  ('04211030962','BENI_OPERE_TERZI'),
  ('02777490307','BENI_OPERE_TERZI'),
  ('00876320409','BENI_PICCOLI'),
  ('18384891000','BENI_ATTREZZATURE');

INSERT INTO public._bkp_20261124_beni_nz
SELECT 'payables', p.id, 'cost_category_id', p.cost_category_id::text
  FROM _inv i
  JOIN public.suppliers s ON coalesce(s.partita_iva, s.vat_number) = i.piva
  JOIN public.payables p ON p.supplier_id = s.id AND p.invoice_number = i.num
ON CONFLICT DO NOTHING;
INSERT INTO public._bkp_20261124_beni_nz
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
