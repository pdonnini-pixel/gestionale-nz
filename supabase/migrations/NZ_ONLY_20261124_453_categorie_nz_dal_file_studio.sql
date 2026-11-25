-- NZ_ONLY 453 — categorie di NZ dal file dello Studio (24/11/2026)
-- Solo NZ (xfvfxsvqpnpvibgeqpqp). Fonte: «New_Zago_riconciliazione_merci_e_categorie.xlsx»,
-- foglio Riclassifiche (360 fatture, conto del commercialista per ciascuna), inviato da Lilian il 24/11/2026.
-- Regole di Lilian:
--   * fornitore diviso su più conti → nessuna modifica, resta la categoria principale (17 fornitori);
--     non contano come «altro conto» bolli, trasporti su acquisti, spese d'incasso, imposte indeducibili;
--   * conto 272107 «Fatture da ricevere» → la categoria assegnata resta (è giusta, cambia solo la competenza);
--     restano anche le fatture chiuse su fatture da ricevere 2025 e quelle su depositi cauzionali.
-- Non applicato, in attesa di Patrizio: Realcart (merce per decisione 299), Caccia Agnese (allestimenti, 300),
-- A.B.N. e Graphic Report (ok di Patrizio del 15/10), Gladiotex (sposterebbe 38.000 euro fuori dal costo del venduto).
-- Senza categoria corrispondente, invariati: contratti di assistenza 630324 (GTN, Top Cash, A.D.P.E.),
-- noleggi 650111/650112 (Tognaccini, Friuli Antincendi), formazione 670909 (Labor Sicurezza), lavanderia 630365.
-- Beni ammortizzabili (031301, 050503, 05070101, 05070301, 030507, 610145) → ALLESTIMENTI, come su Zago,
-- finché non si decide se creare le categorie del commercialista.
--
-- 1. _sup: fornitori con un solo conto: categoria di costo e, se diversa, categoria merceologica;
--    le loro fatture ancora sulla categoria vecchia passano alla nuova.
--    Proprietari dei negozi (Westi, Shopinn, BMG, DWS, Valdichiana, Frankie, San Mauro), i due alberghi
--    (imposta di soggiorno) e Humatics (software capitalizzato) restano com'erano: cambia solo la fattura.
-- 2. _inv: ogni fattura del file prende la categoria del suo conto.
-- L'etichetta «fiscale» non si scrive mai sul fornitore (la usa lo Scadenzario): per le imposte si usa «Altro».
-- Backup riga per riga in _bkp_20261124_categorie_nz (senza GRANT). Rollback a fianco.

CREATE TABLE IF NOT EXISTS public._bkp_20261124_categorie_nz (
  tabella text NOT NULL,
  riga_id uuid NOT NULL,
  campo text NOT NULL,
  valore_prima text,
  PRIMARY KEY (tabella, riga_id, campo)
);
ALTER TABLE public._bkp_20261124_categorie_nz ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bkp_20261124_categorie_nz FROM anon, authenticated;

CREATE TEMP TABLE _sup(piva text, vecchia text, nuova text, merc text) ON COMMIT DROP;
INSERT INTO _sup VALUES
  ('00434920484','MEZZI_E_CARBURANTE','ALLESTIMENTI','Beni ammortizzabili'),
  ('05257600287','ALTRI_STRUTTURA','SPEDIZ','Logistica'),
  ('02778770137','MANUT','CANCELL','Materiale di consumo e cancelleria'),
  ('04606790287','ALTRI_STRUTTURA','CANCELL','Materiale di consumo e cancelleria'),
  ('00892860511','ALTRI_STRUTTURA','CANCELL','Materiale di consumo e cancelleria'),
  ('07140920484','ALTRI_STRUTTURA','ASSICUR','Servizi'),
  ('02483980518','PULIZIA','ALLESTIMENTI','Beni ammortizzabili'),
  ('06971050486','MANUT','ALLESTIMENTI','Beni ammortizzabili'),
  ('02777490307','MANUT','ALLESTIMENTI','Beni ammortizzabili'),
  ('01543350522','PUBBLICITA','CANCELL','Materiale di consumo e cancelleria'),
  ('00876320409','CANCELL','ALLESTIMENTI','Beni ammortizzabili'),
  ('05805450482','COMM_CARTE','MANUT','Manutenzione'),
  ('01716620511','VIAGGI','ALTRE_COMM','Servizi'),
  ('02639570270','ALTRI_STRUTTURA','CANCELL','Materiale di consumo e cancelleria'),
  ('01156230458','','CANCELL','Materiale di consumo e cancelleria'),
  ('02466210289','ALTRI_STRUTTURA','PULIZIA','Materiale di consumo e cancelleria'),
  ('12292550014','PULIZIA','MANUT','Manutenzione'),
  ('12454611000','ALTRE_COMM','MANUT','Servizi'),
  ('04855090488','ONERI_DIV','IMPOSTE_TASSE','Altro'),
  ('03359880287','CONS_TEC','CONS_TEC','Consulenza'),
  ('09136730018','ALLESTIMENTI','ALLESTIMENTI','Beni ammortizzabili'),
  ('05921090964','ALTRE_COMM','ALTRE_COMM','Marketing'),
  ('05763200481','ALLESTIMENTI','ALLESTIMENTI','Beni ammortizzabili'),
  ('01589490521','ALLESTIMENTI','ALLESTIMENTI','Beni ammortizzabili'),
  ('09798060019','ALLESTIMENTI','ALLESTIMENTI','Beni ammortizzabili'),
  ('04211030962','ALLESTIMENTI','ALLESTIMENTI','Beni ammortizzabili'),
  ('00623410982','MEZZI_E_CARBURANTE','MEZZI_E_CARBURANTE','Carburante'),
  ('04676640487','MEZZI_E_CARBURANTE','MEZZI_E_CARBURANTE','Carburante'),
  ('02701740108','MEZZI_E_CARBURANTE','MEZZI_E_CARBURANTE','Carburante'),
  ('07011460487','CONS_TEC','CONS_TEC','Consulenza'),
  ('18384891000','ALLESTIMENTI','ALLESTIMENTI',NULL),
  ('17851171003','MEZZI_E_CARBURANTE','MEZZI_E_CARBURANTE',NULL),
  ('10232961002','MEZZI_E_CARBURANTE','MEZZI_E_CARBURANTE',NULL),
  ('04209680158','SPEDIZ','SPEDIZ',NULL),
  ('07103300484','MANUT','MANUT',NULL),
  ('05253951007','MANUT','MANUT',NULL),
  ('02605150974','ACQ_MERCE','ACQ_MERCE',NULL),
  ('15539261006','COMM_CARTE','COMM_CARTE',NULL),
  ('05729921006','VIAGGI','VIAGGI',NULL),
  ('02575920984','VIAGGI','VIAGGI',NULL),
  ('11024000967','VIAGGI','VIAGGI',NULL),
  ('02412960516','VIAGGI','VIAGGI',NULL),
  ('16995251002','VIAGGI','VIAGGI',NULL),
  ('11696900015','VIAGGI','VIAGGI',NULL),
  ('03973700960','CAN_SW','CAN_SW','IT'),
  ('02778460127','PULIZIA','PULIZIA','Pulizie'),
  ('01296390527','PULIZIA','PULIZIA','Pulizie'),
  ('14809951008','PULIZIA','PULIZIA','Pulizie'),
  ('01518400518','PULIZIA','PULIZIA','Pulizie'),
  ('01490500111','PULIZIA','PULIZIA','Pulizie'),
  ('09170611009','VIAGGI','VIAGGI','Viaggi e trasferte'),
  ('00542820485','VIAGGI','VIAGGI','Viaggi e trasferte'),
  ('09702670010','VIAGGI','VIAGGI','Viaggi e trasferte'),
  ('02538160033','VIAGGI','VIAGGI','Viaggi e trasferte'),
  ('06291950969','VIAGGI','VIAGGI','Viaggi e trasferte'),
  ('07359900482','VIAGGI','VIAGGI','Viaggi e trasferte'),
  ('05064530230','VIAGGI','VIAGGI','Viaggi e trasferte'),
  ('01484180391','PULIZIA','PULIZIA','Pulizie')
;
CREATE TEMP TABLE _inv(piva text, num text, code text) ON COMMIT DROP;
INSERT INTO _inv VALUES
  ('00434920484','500606 / 1310','ALLESTIMENTI'),
  ('06227950968','90','PUBBLICITA'),
  ('01392660112','26-0049','VARIE_AMM'),
  ('05176070489','26-0335','ENERG_GAS'),
  ('05176070489','26-0447','ENERG_GAS'),
  ('05176070489','26-0577','ENERG_GAS'),
  ('05176070489','26-0957','ENERG_GAS'),
  ('05176070489','26-1462','ENERG_GAS'),
  ('12650270155','26VAL-0695','IMPOSTE_TASSE'),
  ('12650270155','26VAL-1129','IMPOSTE_TASSE'),
  ('10738940963','B01826001893','IMPOSTE_TASSE'),
  ('01918380997','26-0512','IMPOSTE_TASSE'),
  ('08616300961','B01926001361','IMPOSTE_TASSE'),
  ('05257600287','171','SPEDIZ'),
  ('02778770137','6423/03','CANCELL'),
  ('04606790287','53/2026','CANCELL'),
  ('04606790287','90/2026','CANCELL'),
  ('04606790287','232/2026','CANCELL'),
  ('00892860511','40/2026','CANCELL'),
  ('00892860511','1/2026','CANCELL'),
  ('00892860511','73/2026','CANCELL'),
  ('00892860511','149/2026','CANCELL'),
  ('00892860511','208/2026','CANCELL'),
  ('07140920484','21','ASSICUR'),
  ('03268520230','26102826','ALLESTIMENTI'),
  ('02483980518','5/FE','ALLESTIMENTI'),
  ('02483980518','10/FE','ALLESTIMENTI'),
  ('06971050486','8','ALLESTIMENTI'),
  ('06971050486','18','ALLESTIMENTI'),
  ('02777490307','192','ALLESTIMENTI'),
  ('01543350522','36/1','CANCELL'),
  ('01543350522','68/1','CANCELL'),
  ('00876320409','412 00494','ALLESTIMENTI'),
  ('05805450482','433','MANUT'),
  ('01716620511','6','ALTRE_COMM'),
  ('01716620511','99','ALTRE_COMM'),
  ('02639570270','00000000171','CANCELL'),
  ('01156230458','10','CANCELL'),
  ('02466210289','604/F/819','PULIZIA'),
  ('12292550014','154','MANUT'),
  ('12454611000','2601C356713','MANUT'),
  ('12454611000','2602C358685','MANUT'),
  ('12454611000','2603C0365383','MANUT'),
  ('12454611000','2604C0374657','MANUT'),
  ('12454611000','2605C0373539','MANUT'),
  ('12454611000','2606C0351521','MANUT'),
  ('12454611000','2607C0342028','MANUT'),
  ('12454611000','2608C0349072','MANUT'),
  ('04855090488','442600376669','IMPOSTE_TASSE'),
  ('04855090488','442600686197','IMPOSTE_TASSE'),
  ('00908850480','003673/2026','IMPOSTE_TASSE'),
  ('03025120308','2747/2026-H01-F','IMPOSTE_TASSE'),
  ('03359880287','FPR 1/26','CONS_TEC'),
  ('03359880287','FPR 5/26','CONS_TEC'),
  ('03359880287','FPR 10/26','CONS_TEC'),
  ('09136730018','170/00','ALLESTIMENTI'),
  ('05921090964','703/ORD','ALTRE_COMM'),
  ('05763200481','84/2026','ALLESTIMENTI'),
  ('05763200481','292/2026','ALLESTIMENTI'),
  ('01589490521','656','ALLESTIMENTI'),
  ('09798060019','FPR 49/26','ALLESTIMENTI'),
  ('04211030962','98','ALLESTIMENTI'),
  ('04211030962','193','ALLESTIMENTI'),
  ('04211030962','578','ALLESTIMENTI'),
  ('00623410982','2026/FE11739/1662','MEZZI_E_CARBURANTE'),
  ('04676640487','2026/C/402','MEZZI_E_CARBURANTE'),
  ('04676640487','2026/C/2790','MEZZI_E_CARBURANTE'),
  ('04676640487','2026/C/2774','MEZZI_E_CARBURANTE'),
  ('04676640487','2026/C/2810','MEZZI_E_CARBURANTE'),
  ('04676640487','2026/C/3795','MEZZI_E_CARBURANTE'),
  ('04676640487','2026/C/3929','MEZZI_E_CARBURANTE'),
  ('04676640487','2026/C/4706','MEZZI_E_CARBURANTE'),
  ('04676640487','2026/C/4877','MEZZI_E_CARBURANTE'),
  ('04676640487','2026/C/4902','MEZZI_E_CARBURANTE'),
  ('04676640487','2026/C/4984','MEZZI_E_CARBURANTE'),
  ('04676640487','2026/C/5280','MEZZI_E_CARBURANTE'),
  ('04676640487','2026/C/5324','MEZZI_E_CARBURANTE'),
  ('04676640487','2026/C/5445','MEZZI_E_CARBURANTE'),
  ('04676640487','2026/C/6553','MEZZI_E_CARBURANTE'),
  ('04676640487','2026/C/6724','MEZZI_E_CARBURANTE'),
  ('04676640487','2026/C/6744','MEZZI_E_CARBURANTE'),
  ('02701740108','2026-FE06928-3170','MEZZI_E_CARBURANTE'),
  ('02701740108','2026/FE07429/4864','MEZZI_E_CARBURANTE'),
  ('02701740108','2026-FE4246-2356','MEZZI_E_CARBURANTE'),
  ('02701740108','2026/FE04645/4299','MEZZI_E_CARBURANTE'),
  ('07011460487','FPR 28/26','CONS_TEC'),
  ('18384891000','56/FE','ALLESTIMENTI'),
  ('17851171003','9601475441','MEZZI_E_CARBURANTE'),
  ('17851171003','9601539612','MEZZI_E_CARBURANTE'),
  ('10232961002','0007976/26','MEZZI_E_CARBURANTE'),
  ('04209680158','MILR001929410','SPEDIZ'),
  ('04209680158','MILR002029744','SPEDIZ'),
  ('07103300484','000387','MANUT'),
  ('05253951007','28','MANUT'),
  ('02605150974','562','ACQ_MERCE'),
  ('15539261006','429337-1CX X','COMM_CARTE'),
  ('05729921006','161','VIAGGI'),
  ('02575920984','500/7','VIAGGI'),
  ('02575920984','503/7','VIAGGI'),
  ('02575920984','558/7','VIAGGI'),
  ('11024000967','F/2026/00399','VIAGGI'),
  ('02412960516','BVDC-75','VIAGGI'),
  ('16995251002','1-A96','VIAGGI'),
  ('11696900015','93','VIAGGI'),
  ('03973700960','1018795','CAN_SW'),
  ('02778460127','001280','PULIZIA'),
  ('02778460127','002263','PULIZIA'),
  ('02778460127','003344','PULIZIA'),
  ('02778460127','004154','PULIZIA'),
  ('02778460127','007489','PULIZIA'),
  ('02778460127','009140','PULIZIA'),
  ('01296390527','339P','PULIZIA'),
  ('01296390527','422P','PULIZIA'),
  ('01296390527','583P','PULIZIA'),
  ('01296390527','729P','PULIZIA'),
  ('14809951008','FPR 24/26','PULIZIA'),
  ('14809951008','FPR 156/26','PULIZIA'),
  ('14809951008','FPR 232/26','PULIZIA'),
  ('14809951008','FPR 263/26','PULIZIA'),
  ('14809951008','FPR 399/26','PULIZIA'),
  ('14809951008','FPR 429/26','PULIZIA'),
  ('14809951008','FPR 506/26','PULIZIA'),
  ('14809951008','FPR 653/26','PULIZIA'),
  ('14809951008','FPR 670/26','PULIZIA'),
  ('14809951008','FPR 820/26','PULIZIA'),
  ('01518400518','370/01','PULIZIA'),
  ('01518400518','672/01','PULIZIA'),
  ('01490500111','13','PULIZIA'),
  ('01490500111','31','PULIZIA'),
  ('01490500111','63','PULIZIA'),
  ('01490500111','125','PULIZIA'),
  ('09170611009','11/2026/36','VIAGGI'),
  ('00542820485','24','VIAGGI'),
  ('00542820485','64','VIAGGI'),
  ('00542820485','131','VIAGGI'),
  ('00542820485','194','VIAGGI'),
  ('00542820485','349','VIAGGI'),
  ('00542820485','416','VIAGGI'),
  ('00542820485','646','VIAGGI'),
  ('00542820485','1092','VIAGGI'),
  ('00542820485','1160','VIAGGI'),
  ('00542820485','1284','VIAGGI'),
  ('00542820485','1445','VIAGGI'),
  ('00542820485','1520','VIAGGI'),
  ('00542820485','1575','VIAGGI'),
  ('00542820485','1636','VIAGGI'),
  ('00542820485','1807','VIAGGI'),
  ('00542820485','1976','VIAGGI'),
  ('00542820485','2562','VIAGGI'),
  ('09702670010','628','VIAGGI'),
  ('02538160033','0097/002/000322','VIAGGI'),
  ('06291950969','FT2720/26/6097','VIAGGI'),
  ('06291950969','FT2721/26/6097','VIAGGI'),
  ('06291950969','FT2737/26/6097','VIAGGI'),
  ('06291950969','FT2827/26/6097','VIAGGI'),
  ('06291950969','FT2977/26/6097','VIAGGI'),
  ('06291950969','FT1932/26/6006','VIAGGI'),
  ('06291950969','FT7775/26/6097','VIAGGI'),
  ('06291950969','FT7791/26/6097','VIAGGI'),
  ('06291950969','FT9208/26/6097','VIAGGI'),
  ('06291950969','FT9448/26/6097','VIAGGI'),
  ('06291950969','FT9767/26/6097','VIAGGI'),
  ('07359900482','78/1','VIAGGI'),
  ('07359900482','795/1','VIAGGI'),
  ('07359900482','1106/1','VIAGGI'),
  ('07359900482','1239/1','VIAGGI'),
  ('07359900482','2537/1','VIAGGI'),
  ('05064530230','B154-2-2026-5','VIAGGI'),
  ('05064530230','B154-1-2026-111','VIAGGI'),
  ('05064530230','B154-1-2026-246','VIAGGI'),
  ('01484180391','V070012600909','PULIZIA'),
  ('01484180391','V070012601915','PULIZIA'),
  ('01484180391','V070012602970','PULIZIA'),
  ('01484180391','V070012605133','PULIZIA')
;

-- fatture toccate: quelle del file con categoria diversa, e quelle dei fornitori di _sup ancora sulla vecchia
CREATE TEMP TABLE _pay ON COMMIT DROP AS
SELECT DISTINCT ON (p.id) p.id, c.id AS nuova_id
  FROM (
    SELECT p.id, i.code
      FROM _inv i
      JOIN public.suppliers s ON coalesce(s.partita_iva, s.vat_number) = i.piva
      JOIN public.payables p ON p.supplier_id = s.id AND p.invoice_number = i.num
    UNION ALL
    SELECT p.id, x.nuova
      FROM _sup x
      JOIN public.suppliers s ON coalesce(s.partita_iva, s.vat_number) = x.piva
      JOIN public.payables p ON p.supplier_id = s.id
      LEFT JOIN public.cost_categories pc ON pc.id = p.cost_category_id
     WHERE x.vecchia <> x.nuova
       AND coalesce(pc.code, '') = x.vecchia
       AND NOT EXISTS (SELECT 1 FROM _inv i2 WHERE i2.piva = x.piva AND i2.num = p.invoice_number)
  ) z
  JOIN public.payables p ON p.id = z.id
  JOIN public.cost_categories c ON c.code = z.code AND c.company_id = p.company_id
 WHERE p.cost_category_id IS DISTINCT FROM c.id
 ORDER BY p.id;

-- backup prima delle scritture
INSERT INTO public._bkp_20261124_categorie_nz
SELECT 'payables', p.id, 'cost_category_id', p.cost_category_id::text
  FROM public.payables p JOIN _pay t ON t.id = p.id
ON CONFLICT DO NOTHING;
INSERT INTO public._bkp_20261124_categorie_nz
SELECT 'suppliers', s.id, k.campo, k.valore
  FROM _sup x
  JOIN public.suppliers s ON coalesce(s.partita_iva, s.vat_number) = x.piva
  CROSS JOIN LATERAL (VALUES ('default_cost_category_id', s.default_cost_category_id::text),
                             ('category', s.category), ('note', s.note)) k(campo, valore)
ON CONFLICT DO NOTHING;

UPDATE public.payables p SET cost_category_id = t.nuova_id FROM _pay t WHERE p.id = t.id;

UPDATE public.suppliers s
   SET default_cost_category_id = c.id,
       note = concat_ws(E'\n', nullif(s.note, ''), '24/11/2026: categoria di costo ' || c.name || ' dal conto del commercialista (file dello Studio, Lilian).'),
       updated_at = now()
  FROM _sup x JOIN public.cost_categories c ON c.code = x.nuova
 WHERE coalesce(s.partita_iva, s.vat_number) = x.piva
   AND c.company_id = s.company_id
   AND s.default_cost_category_id IS DISTINCT FROM c.id;

UPDATE public.suppliers s
   SET category = x.merc,
       note = concat_ws(E'\n', nullif(s.note, ''), '24/11/2026: categoria merceologica ' || x.merc || ' dal file dello Studio (Lilian).'),
       updated_at = now()
  FROM _sup x
 WHERE coalesce(s.partita_iva, s.vat_number) = x.piva
   AND x.merc IS NOT NULL
   AND s.category IS DISTINCT FROM x.merc
   AND coalesce(s.category, '') NOT IN ('fiscale', 'interno');
