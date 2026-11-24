-- ZAGO_ONLY 447 — categorie dei fornitori di Zago dal file di riconciliazione (23/11/2026)
-- Solo Zago (jxlwvzjreukscnswkbjx). Patrizio, 23/11/2026: «mettere a tutti questi fornitori la categoria».
-- Fonte: «Zago_riconciliazione_merci_e_categorie.xlsx», foglio Categorie (488 fatture, 61 fornitori):
-- categoria proposta e conto del commercialista per ogni fattura. Fornitori trovati per partita IVA.
--
-- Due campi, riempiti SOLO dove sono vuoti (un valore già presente non si tocca):
--   suppliers.category                → categoria merceologica (pagina Fornitori, grafico «Spesa per categoria»)
--   suppliers.default_cost_category_id → categoria di costo (Scadenzario, conto economico)
--   payables.cost_category_id          → solo le fatture di questi fornitori ancora senza categoria
-- Fornitore con più categorie nel file: quella prevalente. «Beni ammortizzabili» → ALLESTIMENTI
-- (Zago non ha una categoria di costo per i beni strumentali). Dove NZ ha già deciso lo stesso
-- fornitore (stessa P.IVA) si segue NZ: Verisure ALTRE_COMM, Giulio CONS_TEC, Indeed ALTRI_STRUTTURA.
-- Aurea SRL resta senza categoria: fattura da 34 € senza righe, il file dice «da verificare».
-- Ogni fornitore toccato riceve una nota datata. Idempotente.
-- Rollback: ZAGO_ONLY_20261123_447_categorie_fornitori_zago_ROLLBACK.sql

CREATE TEMP TABLE _scelte(piva text, merceologica text, code text) ON COMMIT DROP;
INSERT INTO _scelte VALUES
  ('01769810464','Manutenzione','MANUT'),                       -- AURORA
  ('13397910962','Materiale di consumo e cancelleria',NULL),     -- Amazon (costo già VIAGGI)
  ('02590880973','Merci','ACQ_MERCE'),                           -- BELLA BIJOUX
  ('03129171207','Beni ammortizzabili','ALLESTIMENTI'),          -- Best Tool
  ('01777150465','Viaggi e trasferte','VIAGGI'),                 -- CAFFE' ROMA FDM
  ('05175900280','Affitti',NULL),                                -- CARLO'S
  ('02292130461','Pulizie','PULIZIA'),                           -- CENTRO IMPIANTI
  ('03714400540','Materiale di consumo e cancelleria',NULL),     -- CONSTRUCTA
  ('03124500483','Manutenzione',NULL),                           -- Calosi
  ('02602630978','Materiale di consumo e cancelleria','PULIZIA'),-- DREAM MERCATONE (materiale di pulizia)
  ('07359250482','Manutenzione','MANUT'),                        -- Delta Impianti
  ('06017420487','Utenze',NULL),                                 -- ENEGAN
  ('07355140489','Consulenza',NULL),                             -- EPPI
  ('01340880457','Manutenzione','MANUT'),                        -- Elettroworks
  ('04676130489','Materiale di consumo e cancelleria',NULL),     -- FERRAMENTA MASINI
  ('12878470157','Utenze',NULL),                                 -- Fastweb
  ('04441540483','Manutenzione',NULL),                           -- Firenze Ascensori
  ('06971050486','Beni ammortizzabili','ALLESTIMENTI'),          -- GABRIEL (opere su beni di terzi)
  ('01318250469','Materiale di consumo e cancelleria','PULIZIA'),-- GENERAL (materiale di pulizia)
  ('01767000282','Merci',NULL),                                  -- GGZ
  ('01298610450','Beni ammortizzabili','ALLESTIMENTI'),          -- GIADA
  ('02403030360','Marketing','PUBBLICITA'),                      -- GLADIOTEX
  ('03973700960','Servizi',NULL),                                -- GLOBAL BLUE
  ('04589211210','Beni ammortizzabili','ALLESTIMENTI'),          -- GLORIA
  ('04102770965','Logistica','SPEDIZ'),                          -- GLS
  ('03359880287','Consulenza','CONS_TEC'),                       -- Giulio
  ('02098450469','Beni ammortizzabili','ALLESTIMENTI'),          -- Gou snc
  ('01616750467','Viaggi e trasferte',NULL),                     -- Hotel da filiè
  ('03268520230','IT','ASS_SW'),                                 -- Humatics (assistenza software)
  ('04039960481','Viaggi e trasferte',NULL),                     -- IL FORNO
  ('02863660359','Utenze','ENERG_GAS'),                          -- IREN
  ('01460010455','Materiale di consumo e cancelleria',NULL),     -- K7
  ('00392780482','Manutenzione',NULL),                           -- ESTINTORI NUTI
  ('01243000468','Viaggi e trasferte','VIAGGI'),                 -- MADA
  ('02294630500','Beni ammortizzabili','ALLESTIMENTI'),          -- MANICHINI MODA
  ('01481920468','Consulenza',NULL),                             -- MARIA LUISA SEVESO
  ('02619640465','Materiale di consumo e cancelleria',NULL),     -- MENCHINI
  ('05269340286','Manutenzione','MANUT'),                        -- MICRO II
  ('05095320288','Beni ammortizzabili','ALLESTIMENTI'),          -- MINGARDO (mobili e arredi)
  ('02630120166','Beni ammortizzabili','ALLESTIMENTI'),          -- MediaMarket (macchine d'ufficio)
  ('00913070116','Logistica','SPEDIZ'),                          -- NATIONAL EXPRESS
  ('10542790968','Servizi',NULL),                                -- NEXI
  ('15539261006','Servizi','COMM_CARTE'),                        -- NUMIA (commissioni POS)
  ('03969640287','Beni ammortizzabili','ALLESTIMENTI'),          -- PAOLO (mobili e arredi)
  ('05040110487','Utenze','ENERG_GAS'),                          -- Publiacqua (come NZ)
  ('01715000343','Materiale di consumo e cancelleria',NULL),     -- REALCART
  ('00987061009','Servizi',NULL),                                -- SIAE
  ('03916040656','Utenze',NULL),                                 -- SALERNO ENERGIA
  ('06511620483','Consulenza','CONS_LAV'),                       -- SIGNORINI (consulenza del lavoro)
  ('04135490482','Consulenza',NULL),                             -- SP CONTABILE
  ('06875150481','Consulenza',NULL),                             -- STUDIO POLI
  ('02206840395','Merci','ACQ_MERCE'),                           -- TANESINI
  ('00407780485','Marketing','ALTRE_COMM'),                      -- UNICOOP (rappresentanza e omaggi, come NZ)
  ('08537690151','Logistica','SPEDIZ'),                          -- UPS
  ('00917430464','Viaggi e trasferte',NULL),                     -- VALE'
  ('05257600287','Beni ammortizzabili','ALLESTIMENTI'),          -- VETRERIA DI MONTAGNANA
  ('06172420967','Servizi',NULL),                                -- VISIONAREA
  ('12454611000','Servizi','ALTRE_COMM'),                        -- Verisure (vigilanza, come NZ)
  ('13378520152','Utenze',NULL),                                 -- Wind Tre
  ('00892860511','Marketing',NULL),                              -- faliero grafica
  ('9820958W','Personale','ALTRI_STRUTTURA');                    -- Indeed (come NZ; non nel file)

-- 1. categoria di costo del fornitore (solo se vuota)
UPDATE public.suppliers s
   SET default_cost_category_id = c.id,
       note = concat_ws(E'\n', nullif(s.note, ''), '23/11/2026: categoria di costo ' || c.name || ' dal file di riconciliazione Zago (Patrizio).'),
       updated_at = now()
  FROM _scelte x
  JOIN public.cost_categories c ON c.code = x.code
 WHERE x.code IS NOT NULL
   AND c.company_id = s.company_id
   AND coalesce(s.partita_iva, s.vat_number) = x.piva
   AND s.default_cost_category_id IS NULL;

-- 2. categoria merceologica (solo se vuota)
UPDATE public.suppliers s
   SET category = x.merceologica,
       note = concat_ws(E'\n', nullif(s.note, ''), '23/11/2026: categoria merceologica ' || x.merceologica || ' dal file di riconciliazione Zago (Patrizio).'),
       updated_at = now()
  FROM _scelte x
 WHERE coalesce(s.partita_iva, s.vat_number) = x.piva
   AND (s.category IS NULL OR s.category = '');

-- 3. fatture di questi fornitori ancora senza categoria: prendono quella del fornitore
UPDATE public.payables p
   SET cost_category_id = s.default_cost_category_id
  FROM public.suppliers s
  JOIN _scelte x ON x.piva = coalesce(s.partita_iva, s.vat_number)
 WHERE p.supplier_id = s.id
   AND p.cost_category_id IS NULL
   AND s.default_cost_category_id IS NOT NULL;
