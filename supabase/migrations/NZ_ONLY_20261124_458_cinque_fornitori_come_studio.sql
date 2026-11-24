-- NZ_ONLY 458 — cinque fornitori allineati allo Studio (24/11/2026)
-- Solo NZ (xfvfxsvqpnpvibgeqpqp). Patrizio, 24/11/2026: «allinea allo Studio». Sostituisce le decisioni
-- precedenti dove il file dello Studio diceva altro:
--   Realcart (01715000343)       Acquisto merce (NZ_ONLY 299)      → Spese cancelleria (610105 materie di consumo)
--   Gladiotex (02403030360)      Accessori Abb.to                  → Spese cancelleria (610105 materie di consumo)
--   Caccia Agnese (17910331002)  Allestimenti e aperture (300)     → Consulenze professionali (630723)
--     per questi tre: fornitore e tutte le sue fatture sulla categoria vecchia.
--   A.B.N. (10812390960)         fattura 495/2 → Beni sotto 516,46 € (610145); il fornitore e le altre fatture,
--     che lo Studio non riclassifica (materiale di consumo), da «Altri costi di struttura» (ripiego) a Spese cancelleria.
--   Graphic Report (01327790281) fattura FI0000083 → Pubblicità (630351); il fornitore resta Allestimenti
--     (l'altra fattura è un bene per lo Studio).
-- Realcart e Gladiotex escono dal costo del venduto: il riparto automatico notturno non li ripartirà più
-- come merce (le loro regole sono automatiche, nessuna messa a mano).
-- Backup riga per riga in _bkp_20261124_cinque_nz (senza GRANT). Rollback a fianco.
CREATE TABLE IF NOT EXISTS public._bkp_20261124_cinque_nz (
  tabella text NOT NULL, riga_id uuid NOT NULL, campo text NOT NULL, valore_prima text,
  PRIMARY KEY (tabella, riga_id, campo));
ALTER TABLE public._bkp_20261124_cinque_nz ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bkp_20261124_cinque_nz FROM anon, authenticated;

-- fornitori: categoria vecchia attesa, nuova, merceologica
CREATE TEMP TABLE _sup(piva text, vecchia text, nuova text, merc text) ON COMMIT DROP;
INSERT INTO _sup VALUES
  ('01715000343','ACQ_MERCE','CANCELL','Materiale di consumo e cancelleria'),
  ('02403030360','ACCESSORI_ABB_TO','CANCELL','Materiale di consumo e cancelleria'),
  ('17910331002','ALLESTIMENTI','CONS_TEC','Consulenza'),
  ('10812390960','ALTRI_STRUTTURA','CANCELL','Materiale di consumo e cancelleria');
-- fatture singole
CREATE TEMP TABLE _inv(piva text, num text, code text) ON COMMIT DROP;
INSERT INTO _inv VALUES
  ('10812390960','495/2','BENI_PICCOLI'),
  ('01327790281','FI0000083','PUBBLICITA');

CREATE TEMP TABLE _pay ON COMMIT DROP AS
SELECT DISTINCT ON (p.id) p.id, c.id AS nuova_id
  FROM (
    SELECT p.id, i.code, 1 AS prio
      FROM _inv i
      JOIN public.suppliers s ON coalesce(s.partita_iva, s.vat_number) = i.piva
      JOIN public.payables p ON p.supplier_id = s.id AND p.invoice_number = i.num
    UNION ALL
    SELECT p.id, x.nuova, 2
      FROM _sup x
      JOIN public.suppliers s ON coalesce(s.partita_iva, s.vat_number) = x.piva
      JOIN public.payables p ON p.supplier_id = s.id
      JOIN public.cost_categories pc ON pc.id = p.cost_category_id AND pc.code = x.vecchia
  ) z
  JOIN public.payables p ON p.id = z.id
  JOIN public.cost_categories c ON c.code = z.code AND c.company_id = p.company_id
 WHERE p.cost_category_id IS DISTINCT FROM c.id
 ORDER BY p.id, z.prio;

INSERT INTO public._bkp_20261124_cinque_nz
SELECT 'payables', p.id, 'cost_category_id', p.cost_category_id::text FROM public.payables p JOIN _pay t ON t.id = p.id
ON CONFLICT DO NOTHING;
INSERT INTO public._bkp_20261124_cinque_nz
SELECT 'suppliers', s.id, k.campo, k.valore
  FROM _sup x JOIN public.suppliers s ON coalesce(s.partita_iva, s.vat_number) = x.piva
  CROSS JOIN LATERAL (VALUES ('default_cost_category_id', s.default_cost_category_id::text),
                             ('category', s.category), ('note', s.note)) k(campo, valore)
ON CONFLICT DO NOTHING;

UPDATE public.payables p SET cost_category_id = t.nuova_id FROM _pay t WHERE p.id = t.id;

UPDATE public.suppliers s
   SET default_cost_category_id = c.id,
       category = x.merc,
       note = concat_ws(E'\n', nullif(s.note, ''), '24/11/2026: categoria ' || c.name || ' come il conto del commercialista (Patrizio: «allinea allo Studio»).'),
       updated_at = now()
  FROM _sup x
  JOIN public.cost_categories cv ON cv.code = x.vecchia
  JOIN public.cost_categories c ON c.code = x.nuova AND c.company_id = cv.company_id
 WHERE coalesce(s.partita_iva, s.vat_number) = x.piva
   AND cv.company_id = s.company_id
   AND s.default_cost_category_id = cv.id;
