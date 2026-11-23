-- NZ_ONLY 450 — controllo delle categorie dei fornitori di NZ (23/11/2026)
-- Solo NZ (xfvfxsvqpnpvibgeqpqp). Patrizio, 23/11/2026: «fai lo stesso controllo categorie anche su NZ».
-- Su NZ non c'è un file dello Studio: le categorie si ricavano dalle righe delle fatture.
--
-- 1. Fornitori senza categoria con fatture: categoria dalle righe (solo se vuota).
--      ADUEPRINT (insegna luminosa), JANO GRAFICA (insegna a bandiera) → ALLESTIMENTI
--      ANTICA CANTINA (pasti) → VIAGGI; ERMINI DANIELE, SIME (interruttore a Valmontone),
--      Il Chiodo Fisso (duplicato chiave) → MANUT; FRABONI (stampe), INGROS CARTA GIUSTACCHINI
--      (supporto plexiglas) → CANCELL; MPARTNER (attività professionali, Inarcassa) → CONS_TEC;
--      MULTITEC (router 4G) → TELEFON; TEXCART (etichette in pelle col logo) → ACCESSORI_ABB_TO.
-- 2. Solo la fattura, il fornitore resta com'è: Tari Franciacorta → IMPOSTE_TASSE;
--    rimborso a Sabrina Scanu (telefono MediaMarket per Roma) → TELEFON.
--    Le etichette «fiscale» e «interno» non si toccano: le usa lo Scadenzario.
-- 3. Fatture rimaste sul ripiego ALTRI_STRUTTURA mentre il fornitore oggi ha una categoria vera
--    (il fornitore è stato categorizzato dopo, la fattura no): prendono quella del fornitore.
--    Un ripiego non è una scelta umana (CLAUDE.md). Westi COND_MKT non si tocca.
-- 4. Categoria merceologica vuota: ricavata dalla categoria di costo del fornitore.
-- Backup in _bkp_20261123_categorie_nz (senza GRANT). Rollback a fianco.

CREATE TABLE IF NOT EXISTS public._bkp_20261123_categorie_nz (
  tabella text NOT NULL,
  riga_id uuid NOT NULL,
  campo text NOT NULL,
  valore_prima text,
  PRIMARY KEY (tabella, riga_id, campo)
);
ALTER TABLE public._bkp_20261123_categorie_nz ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bkp_20261123_categorie_nz FROM anon, authenticated;

CREATE TEMP TABLE _forn(piva text, code text, merc text) ON COMMIT DROP;
INSERT INTO _forn VALUES
  ('08602851217','ALLESTIMENTI','Beni ammortizzabili'),
  ('18384891000','ALLESTIMENTI','Beni ammortizzabili'),
  ('05729921006','VIAGGI','Viaggi e trasferte'),
  ('06908500488','MANUT','Manutenzione'),
  ('05253951007','MANUT','Manutenzione'),
  ('01050640570','MANUT','Manutenzione'),
  ('07290261002','CANCELL','Materiale di consumo e cancelleria'),
  ('01705680179','CANCELL','Materiale di consumo e cancelleria'),
  ('05018220961','CONS_TEC','Consulenza'),
  ('04228680486','TELEFON','IT'),
  ('02195980368','ACCESSORI_ABB_TO','Merci');

CREATE TEMP TABLE _merc(code text, merc text) ON COMMIT DROP;
INSERT INTO _merc VALUES
  ('ACQ_MERCE','Merci'),('ACCESSORI_ABB_TO','Merci'),('ACQUISTI_ON_LINE','Materiale di consumo e cancelleria'),
  ('ALLESTIMENTI','Beni ammortizzabili'),('ALTRE_COMM','Marketing'),('PUBBLICITA','Marketing'),
  ('ALTRI_STRUTTURA','Altro'),('ONERI_DIV','Altro'),('INT_PASS','Altro'),('IMPOSTE_TASSE','Altro'),
  ('ASS_SW','IT'),('CAN_SW','IT'),('VARIE_AMM','IT'),('ASSICUR','Servizi'),('COMM_CARTE','Servizi'),
  ('CANCELL','Materiale di consumo e cancelleria'),('CONS_CONT','Consulenza'),('CONS_LAV','Consulenza'),
  ('CONS_LEG','Consulenza'),('CONS_TEC','Consulenza'),('ENERG_GAS','Utenze'),('TELEFON','Utenze'),
  ('LOC_OUTLET','Affitti'),('COND_MKT','Affitti'),('MANUT','Manutenzione'),
  ('MEZZI_E_CARBURANTE','Carburante'),('PULIZIA','Pulizie'),('SPEDIZ','Logistica'),
  ('VIAGGI','Viaggi e trasferte'),('PERS_DIP','Personale');

-- backup prima di ogni scrittura
INSERT INTO public._bkp_20261123_categorie_nz
SELECT 'suppliers', s.id, 'default_cost_category_id', s.default_cost_category_id::text
  FROM public.suppliers s JOIN _forn x ON x.piva = coalesce(s.partita_iva, s.vat_number)
 WHERE s.default_cost_category_id IS NULL
ON CONFLICT DO NOTHING;
INSERT INTO public._bkp_20261123_categorie_nz
SELECT 'suppliers', s.id, 'category', s.category
  FROM public.suppliers s
 WHERE (s.category IS NULL OR s.category = '')
   AND (coalesce(s.partita_iva, s.vat_number) IN (SELECT piva FROM _forn) OR s.default_cost_category_id IS NOT NULL)
ON CONFLICT DO NOTHING;
INSERT INTO public._bkp_20261123_categorie_nz
SELECT 'suppliers', s.id, 'note', s.note
  FROM public.suppliers s
 WHERE s.id IN (SELECT riga_id FROM public._bkp_20261123_categorie_nz WHERE tabella = 'suppliers')
ON CONFLICT DO NOTHING;
INSERT INTO public._bkp_20261123_categorie_nz
SELECT 'payables', p.id, 'cost_category_id', p.cost_category_id::text
  FROM public.payables p
  JOIN public.suppliers s ON s.id = p.supplier_id
  LEFT JOIN public.cost_categories pc ON pc.id = p.cost_category_id
  LEFT JOIN public.cost_categories sc ON sc.id = s.default_cost_category_id
 WHERE (p.cost_category_id IS NULL AND (coalesce(s.partita_iva, s.vat_number) IN (SELECT piva FROM _forn)
                                       OR s.name IN ('Tari Franciacorta', 'SCANU SABRINA')))
    OR (pc.code = 'ALTRI_STRUTTURA' AND sc.code IS NOT NULL AND sc.code <> 'ALTRI_STRUTTURA')
ON CONFLICT DO NOTHING;

-- 1. fornitori senza categoria di costo
UPDATE public.suppliers s
   SET default_cost_category_id = c.id,
       note = concat_ws(E'\n', nullif(s.note, ''), '23/11/2026: categoria di costo ' || c.name || ' dalle righe delle fatture (controllo categorie NZ, Patrizio).'),
       updated_at = now()
  FROM _forn x JOIN public.cost_categories c ON c.code = x.code
 WHERE coalesce(s.partita_iva, s.vat_number) = x.piva
   AND c.company_id = s.company_id
   AND s.default_cost_category_id IS NULL;

-- 2. fatture senza categoria: dal fornitore, oppure le due decise sulla singola fattura
UPDATE public.payables p
   SET cost_category_id = s.default_cost_category_id
  FROM public.suppliers s JOIN _forn x ON x.piva = coalesce(s.partita_iva, s.vat_number)
 WHERE p.supplier_id = s.id AND p.cost_category_id IS NULL AND s.default_cost_category_id IS NOT NULL;

UPDATE public.payables p
   SET cost_category_id = c.id
  FROM public.suppliers s, public.cost_categories c
 WHERE p.supplier_id = s.id AND p.cost_category_id IS NULL AND c.company_id = s.company_id
   AND ((s.name = 'Tari Franciacorta' AND c.code = 'IMPOSTE_TASSE')
     OR (s.name = 'SCANU SABRINA' AND c.code = 'TELEFON'));

-- 3. fatture rimaste sul ripiego ALTRI_STRUTTURA
UPDATE public.payables p
   SET cost_category_id = s.default_cost_category_id
  FROM public.suppliers s
  JOIN public.cost_categories sc ON sc.id = s.default_cost_category_id
  JOIN public.cost_categories pa ON pa.company_id = s.company_id AND pa.code = 'ALTRI_STRUTTURA'
 WHERE p.supplier_id = s.id
   AND p.cost_category_id = pa.id
   AND sc.code <> 'ALTRI_STRUTTURA';

-- 4. categoria merceologica vuota: per i fornitori del punto 1 quella decisa lì,
--    per gli altri ricavata dalla categoria di costo
UPDATE public.suppliers s
   SET category = x.merc,
       note = concat_ws(E'\n', nullif(s.note, ''), '23/11/2026: categoria merceologica ' || x.merc || ' dalle righe delle fatture (controllo categorie NZ, Patrizio).'),
       updated_at = now()
  FROM _forn x
 WHERE coalesce(s.partita_iva, s.vat_number) = x.piva
   AND (s.category IS NULL OR s.category = '');

UPDATE public.suppliers s
   SET category = m.merc,
       note = concat_ws(E'\n', nullif(s.note, ''), '23/11/2026: categoria merceologica ' || m.merc || ' dalla categoria di costo (controllo categorie NZ, Patrizio).'),
       updated_at = now()
  FROM public.cost_categories c
  JOIN _merc m ON m.code = c.code
 WHERE c.id = s.default_cost_category_id
   AND (s.category IS NULL OR s.category = '');
