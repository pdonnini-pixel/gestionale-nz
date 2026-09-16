-- =====================================================================
-- NZ_ONLY 227 — Ricostruzione degli incassi giornalieri di GIUGNO 2026
-- ---------------------------------------------------------------------
-- Terzo mese ricostruito (dopo agosto con la 223 e luglio con la 225).
-- 210 giornate (7 punti vendita x 30 giorni) dagli specchietti dei negozi.
-- I corrispettivi coincidono con il registro gia' in daily_revenue su
-- tutti e 210 i giorni, al centesimo.
--
-- FONTI (Drive, cartella negozio/GIUGNO):
--   BARBERINO     SPECCHIETTI INCASSI GIUGNO 2026 BARBERINO.xlsx
--   VALDICHIANA   SPECCHIETTI INCASSI GIUGNO 2026 VALDICHIANA Copia.xlsx
--   PALMANOVA     SPECCHIETTO INCASSI GIUGNO 2026 PALMANOVA.xlsx
--   BRUGNATO      SPECCHIETTO INCASSI GIUGNO 2026 BRUGNATO.xlsx
--   FRANCIACORTA  SPECCHIETTO INCASSI GIUGNO 2026 FRANCIACORTA
--   TORINO        SPECCHIETTO INCASSI GIUGNO 2026 TORINO.xlsx
--   VALMONTONE    SPECCHIETTO INCASSI GIUGNO 2026 VALMONTONE
--
-- DECISIONI DOCUMENTATE:
--  1. A giugno NESSUN foglio ha la colonna CONTANTI: il contante e' stato
--     ricavato per differenza (corrispettivi + fatture - altri canali).
--     Tutti i totali per canale coincidono con la riga TOTALE dei fogli.
--  2. Sei versamenti di inizio giugno sono in banca ma assenti dagli
--     specchietti: sono il contante di fine maggio, portato in banca il
--     01/06 e il 03/06 (Barberino 1.580, Valdichiana 1.901,25, Palmanova
--     1.610, Franciacorta 1.835, Valmontone 3.275, Brugnato 550). Sono
--     stati registrati sulla giornata in cui il denaro esce dalla cassa.
--  3. Torino 17/06: quattro versamenti allo stesso ATM in cinque minuti
--     (470 + 1.590 + 2.300 + 1.090). Il negozio ne dichiara tre, su tre
--     giornate diverse (16, 17, 18) secondo il periodo coperto; il quarto
--     (1.090,00) non e' dichiarato ed e' stato aggiunto sul 17/06.
--     Il 2.300,00 e' stato agganciato alla giornata del 18/06 come vuole
--     lo specchietto, anche se in banca risulta il giorno prima: il
--     riscontro automatico non lo trova mai, perche' cerca solo in avanti.
--  4. Versamenti di fine giugno accreditati a luglio, registrati sul 30/06:
--     Valdichiana 4.107,10 (3.810,70 + 296,40), Franciacorta 3.960,00
--     (3.355,00 del 01/07 + 605,00 dell'08/07), Torino 2.200,00
--     (1.750,00 + 450,00), Valmontone 3.565,00, Brugnato 90,00.
--     Il 605,00 dell'08/07 era stato agganciato per errore alla chiusura
--     del 08/07 di Franciacorta quando mancava giugno: e' stato staccato
--     e rimesso al 30/06, e il 08/07 torna accreditato esatto.
--
-- ESITO: 38 versamenti dichiarati, 38 trovati in banca, nessuna differenza;
--        194 chiusure su 210 verificate; zero giornate non quadrate.
--
-- NO DATA LOSS: solo INSERT. La proiezione in daily_revenue riscrive righe
-- esistenti con gli stessi identici gross_revenue (verificato prima).
-- Applicata su NZ il 15/09/2026. Solo NZ.
-- =====================================================================

BEGIN;

CREATE TEMP TABLE _stg_incassi_giugno_2026 (
  outlet text, giorno date, incasso numeric, contanti numeric, mps numeric, mpsx numeric,
  bcc numeric, bccx numeric, pbl numeric, fatture numeric, bonifico numeric,
  spese numeric, spese_note text, versamento numeric, vers_note text, nota text) ON COMMIT DROP;

INSERT INTO _stg_incassi_giugno_2026 VALUES
('BARBERINO','2026-06-01',2232.65,398.4,1042.25,0.0,792.0,0.0,0.0,0.0,0.0,0.0,NULL,1580.0,'da estratto conto Banco Fiorentino del 03/06 (causale 1.6.26): assente nello specchietto, e'' contante di fine maggio',NULL),
('BARBERINO','2026-06-02',4438.6,864.8,2459.9,143.85,970.05,0.0,0.0,0.0,0.0,0.0,NULL,420.0,'01-01/06/2026',NULL),
('BARBERINO','2026-06-03',292.4,78.75,213.65,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-06-04',749.93,0.0,749.93,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-06-05',805.1,0.0,805.1,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-06-06',2500.95,62.8,1804.2,0.0,633.95,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-06-07',2956.1,188.8,2142.8,0.0,624.5,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-06-08',406.66,0.0,406.66,0.0,0.0,0.0,0.0,0.0,0.0,3.99,'ACQUISTO PILE',0.0,NULL,NULL),
('BARBERINO','2026-06-09',576.5,205.5,371.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,1190.0,'02-08/06/2026',NULL),
('BARBERINO','2026-06-10',629.45,0.0,629.45,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-06-11',1075.4,169.8,905.6,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-06-12',980.16,474.5,446.66,59.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-06-13',2311.74,546.3,1765.44,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-06-14',3129.01,773.25,1476.04,513.92,365.8,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-06-15',596.85,160.0,298.55,69.3,0.0,0.0,0.0,0.0,69.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-06-16',854.4,51.9,802.5,0.0,0.0,0.0,0.0,0.0,0.0,3.95,'ACQUISTO CANCELL.',2325.0,'09-15/06/2026',NULL),
('BARBERINO','2026-06-17',1670.2,330.0,1340.2,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-06-18',486.05,118.15,246.6,77.5,0.0,0.0,0.0,0.0,43.8,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-06-19',1147.05,258.75,888.3,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-06-20',2793.5,746.3,1505.1,0.0,542.1,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-06-21',2801.8,281.9,2021.2,0.0,498.7,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-06-22',643.4,100.0,543.4,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-06-23',405.5,73.5,292.8,39.2,0.0,0.0,0.0,0.0,0.0,0.0,NULL,1880.0,'16-22/06/2026',NULL),
('BARBERINO','2026-06-24',3009.2,545.3,2463.9,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-06-25',205.6,102.8,102.8,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-06-26',1176.8,343.1,788.9,44.8,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-06-27',4024.2,307.8,3555.6,30.4,130.4,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-06-28',2127.8,721.7,1054.2,0.0,351.9,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-06-29',907.4,158.0,749.4,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-06-30',1037.4,0.0,908.8,128.6,0.0,0.0,0.0,0.0,0.0,0.0,NULL,2250.0,'23-29/06/2026',NULL),
('VALDICHIANA','2026-06-01',3939.09,739.5,0.0,0.0,3164.79,131.12,0.0,96.32,0.0,0.0,NULL,1901.25,'da estratto conto MPS del 01/06 (CC FOIANO): assente nello specchietto, e'' contante di fine maggio',NULL),
('VALDICHIANA','2026-06-02',5756.06,660.1,0.0,0.0,4548.16,547.8,0.0,0.0,0.0,0.0,NULL,739.5,'01/06/2026',NULL),
('VALDICHIANA','2026-06-03',1509.54,178.85,24.72,0.0,1248.27,57.7,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-06-04',1266.61,49.9,1216.71,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-06-05',1396.92,225.5,1171.42,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-06-06',4393.85,996.55,3397.3,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-06-07',4393.52,853.35,3540.17,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-06-08',1310.0,342.3,967.7,0.0,0.0,0.0,0.0,0.0,0.0,120.6,'rimborso massimo maggio 2026',0.0,NULL,NULL),
('VALDICHIANA','2026-06-09',694.67,100.0,594.67,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,3185.95,'02/06-08/06/2026',NULL),
('VALDICHIANA','2026-06-10',1319.97,285.15,1034.82,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-06-11',1075.83,83.3,992.53,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-06-12',1337.69,547.35,896.54,0.0,0.0,0.0,0.0,106.2,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-06-13',4449.58,668.65,3645.89,0.0,135.04,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-06-14',4844.72,615.75,4228.97,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-06-15',1291.94,256.9,1035.04,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-06-16',1312.69,354.95,957.74,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,2557.1,'09/06-15/06/2026',NULL),
('VALDICHIANA','2026-06-17',2360.14,556.7,1803.44,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-06-18',1923.7,242.35,1681.35,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-06-19',1517.5,246.3,1271.2,0.0,0.0,0.0,0.0,0.0,0.0,15.9,'DX SF_445',0.0,NULL,NULL),
('VALDICHIANA','2026-06-20',5137.93,543.15,4594.78,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-06-21',5171.49,279.6,4891.89,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-06-22',2381.86,829.15,1552.71,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-06-23',1519.15,232.75,1286.4,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-06-24',2048.83,452.2,1596.63,0.0,0.0,0.0,0.0,0.0,0.0,10.0,'SPESE CANCELLERIA',0.0,NULL,NULL),
('VALDICHIANA','2026-06-25',1610.5,538.7,1071.8,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,3711.25,'16/06-24/06/2026',NULL),
('VALDICHIANA','2026-06-26',2653.91,640.4,2013.51,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-06-27',5025.97,1063.8,3444.82,0.0,517.35,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-06-28',4588.69,861.8,3584.99,141.9,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-06-29',1511.03,706.0,805.03,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-06-30',1039.49,296.4,743.09,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,4107.1,'3.810,70 (25/06-29/06) piu'' 296,40 del 30/06, accreditati entrambi il 01/07',NULL),
('PALMANOVA','2026-06-01',3319.25,324.4,2994.85,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-02',2145.86,411.8,1734.06,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,1610.0,'da estratto conto MPS del 03/06 (CC PALMANOVA, DT 02-06): assente nello specchietto, e'' contante di fine maggio',NULL),
('PALMANOVA','2026-06-03',1749.76,97.3,1652.46,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-04',2031.19,153.9,1686.44,190.85,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-05',2102.56,259.05,1843.51,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-06',2024.54,244.25,1780.29,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-07',1465.19,517.85,947.34,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-08',474.95,0.0,474.95,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-09',448.5,66.8,381.7,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,2005.0,'01/06-08/06/2026',NULL),
('PALMANOVA','2026-06-10',788.1,303.7,484.4,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-11',1128.45,440.05,478.7,209.7,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-12',1068.3,295.5,772.8,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-13',2352.16,464.8,1837.46,0.0,49.9,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-14',1225.6,265.95,883.65,0.0,76.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-15',1052.3,0.0,1052.3,0.0,0.0,0.0,0.0,0,0.0,34.95,'SME SPA SF_E082481',0.0,NULL,NULL),
('PALMANOVA','2026-06-16',360.83,87.9,272.93,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,1805.0,'09/06-15/06/2026',NULL),
('PALMANOVA','2026-06-17',1439.84,118.0,1321.84,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-18',510.05,105.55,404.5,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-19',1422.0,527.7,854.4,39.9,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-20',3286.65,1078.5,2124.15,0.0,84.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-21',3571.4,548.6,3022.8,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-22',1308.4,204.2,1104.2,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-23',1621.6,213.0,1408.6,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,2670.0,'16/06-22/06/2026',NULL),
('PALMANOVA','2026-06-24',1521.0,179.9,1341.1,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-25',1582.7,418.8,1076.5,87.4,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-26',1103.6,252.2,851.4,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-27',1965.85,281.9,1606.05,77.9,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-28',1295.84,219.5,1076.34,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-29',1133.4,199.6,933.8,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-06-30',1122.0,214.7,795.9,111.4,0.0,0.0,0.0,0,0.0,0.0,NULL,1980.0,'23/06-30/06/2026',NULL),
('BRUGNATO','2026-06-01',3435.83,349.8,1414.7,206.84,1464.49,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-06-02',3038.35,699.65,118.69,0.0,2188.01,32.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-06-03',676.67,29.9,646.77,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,550.0,'da estratto conto MPS del 03/06 (ATM 01030-3651): assente nello specchietto, e'' contante di fine maggio',NULL),
('BRUGNATO','2026-06-04',561.99,41.9,520.09,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-06-05',533.54,0.0,533.54,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-06-06',2113.61,419.2,468.99,49.9,1003.6,171.92,0.0,0,0.0,62.85,'NUME SF_1403',0.0,NULL,NULL),
('BRUGNATO','2026-06-07',1554.66,147.8,319.02,0.0,1087.84,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-06-08',547.96,49.9,498.06,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-06-09',152.96,132.8,20.16,0.0,0.0,0.0,0.0,0,0.0,11.1,'TEDI SF_2123000185',1675.0,'01-08/06/2026',NULL),
('BRUGNATO','2026-06-10',677.38,47.7,629.68,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-06-11',921.67,69.0,852.67,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-06-12',677.16,105.3,571.86,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-06-13',1375.4,59.0,889.08,0.0,388.32,39.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-06-14',2130.93,165.3,355.29,0.0,1610.34,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-06-15',1462.1,0.0,1462.1,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,570.0,'09-14/06/2026',NULL),
('BRUGNATO','2026-06-16',758.9,99.0,659.9,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-06-17',226.43,78.0,148.43,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-06-18',681.2,76.7,604.5,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-06-19',578.2,51.6,526.6,0.0,0.0,0.0,0.0,0,0.0,12.85,'FELICE CASA SF_84',0.0,NULL,NULL),
('BRUGNATO','2026-06-20',1766.28,399.3,247.98,0.0,1119.0,0.0,0.0,0,0.0,23.1,'TEDI SF_2123000198',0.0,NULL,NULL),
('BRUGNATO','2026-06-21',2773.14,813.1,189.4,0.0,1770.64,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-06-22',670.31,245.2,425.11,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,1480.0,'15-21/06/2026',NULL),
('BRUGNATO','2026-06-23',1216.75,145.65,1071.1,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-06-24',1229.08,674.4,554.68,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-06-25',638.73,205.3,393.63,39.8,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-06-26',232.14,48.9,183.24,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-06-27',1337.3,67.9,275.2,0.0,994.2,0.0,0.0,0,0.0,1.0,'TEDI SF_2123000202',0.0,NULL,NULL),
('BRUGNATO','2026-06-28',1498.8,489.6,199.5,0.0,809.7,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-06-29',1122.12,44.6,1077.52,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,1875.0,'22-28/06/2026',NULL),
('BRUGNATO','2026-06-30',1157.2,44.0,1113.2,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,90.0,'versamento 29-30/06 effettuato il 02/07',NULL),
('FRANCIACORTA','2026-06-01',4616.24,734.85,3881.39,0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-06-02',3873.07,711.2,3001.97,0,0.0,159.9,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-06-03',1042.2,437.3,604.9,0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,1835.0,'da estratto conto MPS del 03/06 (ATM 01030-2121): assente nello specchietto, e'' contante di fine maggio',NULL),
('FRANCIACORTA','2026-06-04',980.9,229.7,356.8,0,234.7,159.7,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-06-05',1344.54,172.3,1172.24,0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-06-06',1751.4,291.2,1460.2,0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-06-07',2533.02,421.65,2111.37,0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-06-08',573.82,229.8,344.02,0,0.0,0.0,0.0,0.0,0.0,12.5,'AM4 SRL SF_226',0.0,NULL,NULL),
('FRANCIACORTA','2026-06-09',294.66,0.0,294.66,0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,2995.0,'01/06-07/06/2026',NULL),
('FRANCIACORTA','2026-06-10',405.6,0.0,405.6,0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-06-11',1474.7,182.0,1123.3,0,169.4,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-06-12',1129.94,323.1,806.84,0,0.0,0.0,0.0,0.0,0.0,40.55,'AM4 SRL SF_233',0.0,NULL,NULL),
('FRANCIACORTA','2026-06-13',2375.12,274.85,1495.87,0,604.4,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-06-14',4173.39,939.85,2743.78,0,429.44,60.32,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-06-15',1206.3,708.1,498.2,0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-06-16',1560.79,258.3,894.72,0,0.0,407.77,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-06-17',729.34,27.0,603.44,0,98.9,0.0,0.0,0.0,0.0,20.0,'KIK TESSILI SF_2062',0.0,NULL,NULL),
('FRANCIACORTA','2026-06-18',1449.02,195.5,1253.52,0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,1910.0,'08/06-14/06/2026',NULL),
('FRANCIACORTA','2026-06-19',1667.98,249.5,1418.48,0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-06-20',3942.22,584.5,3357.72,0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-06-21',3527.5,290.6,2740.0,0,288.9,208.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-06-22',2011.31,932.7,854.4,0,224.21,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-06-23',1573.3,291.7,1075.5,0,94.7,111.4,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-06-24',923.8,214.7,557.0,0,152.1,0.0,0.0,0.0,0.0,0.0,NULL,2280.0,'15/06-21/06/2026',NULL),
('FRANCIACORTA','2026-06-25',1783.3,496.5,1009.0,0,277.8,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-06-26',1749.5,295.3,1240.7,0,553.9,0.0,0.0,340.4,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-06-27',3133.83,70.6,2182.73,0,588.3,292.2,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-06-28',3205.1,1050.2,1966.3,0,0.0,188.6,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-06-29',1796.77,408.8,1346.07,0,41.9,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-06-30',912.55,194.2,718.35,0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,3960.0,'3.355,00 (22/06-28/06) accreditati il 01/07 piu'' 605,00 (29-30/06) accreditati il 08/07',NULL),
('TORINO','2026-06-01',3483.14,487.0,2996.14,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-06-02',4972.6,402.5,4517.1,53.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-06-03',510.82,0.0,510.82,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-06-04',931.78,50.0,881.78,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-06-05',1821.5,518.5,1303.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-06-06',4203.3,345.8,3486.9,0.0,370.6,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-06-07',3319.4,214.5,3104.9,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-06-08',663.02,49.9,613.12,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-06-09',557.3,235.4,321.9,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-06-10',1254.9,49.0,1205.9,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-06-11',513.9,0.0,513.9,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-06-12',1399.31,162.7,1236.61,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-06-13',4410.57,627.3,3783.27,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-06-14',5138.64,1019.15,2893.14,0.0,1530.83,0.0,0.0,304.48,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-06-15',1009.3,196.0,813.3,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-06-16',736.82,228.5,508.32,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,470.0,'01/06-01/06/2026',NULL),
('TORINO','2026-06-17',1067.17,11.0,1056.17,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,2680.0,'1.590,00 dichiarati piu'' 1.090,00 versati lo stesso giorno allo stesso ATM e assenti nello specchietto',NULL),
('TORINO','2026-06-18',932.0,360.1,571.9,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,2300.0,'09/06-15/06/2026',NULL),
('TORINO','2026-06-19',1384.5,160.6,948.9,275.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-06-20',3742.71,369.2,1488.34,0.0,1885.17,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-06-21',4289.6,431.6,3626.0,0.0,232.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-06-22',1087.6,177.0,851.7,58.9,0.0,0.0,0.0,0.0,0.0,23.35,'TEDI SF_393686',0.0,NULL,NULL),
('TORINO','2026-06-23',1123.7,0.0,1123.7,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,1700.0,'16/06-22/06/2026',NULL),
('TORINO','2026-06-24',2471.6,447.5,2092.8,0.0,0.0,0.0,0.0,68.7,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-06-25',937.25,128.3,678.95,130.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-06-26',1567.0,139.1,1427.9,0.0,0.0,0.0,0.0,0.0,0.0,100.0,'A.B.N. SRL SF_482',0.0,NULL,NULL),
('TORINO','2026-06-27',2863.3,65.8,917.2,159.5,1720.8,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-06-28',4685.64,746.2,3663.54,275.9,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-06-29',1097.7,327.9,704.9,0.0,0.0,0.0,64.9,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-06-30',2040.4,438.1,1602.3,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,2200.0,'1.750,00 (23/06-29/06) del 30/06 piu'' 450,00 del 30/06 accreditati il 01/07',NULL),
('VALMONTONE','2026-06-01',3247.44,71.9,3175.54,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-02',2214.0,150.1,2063.9,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-03',340.17,0.0,340.17,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,3275.0,'da estratto conto MPS del 03/06 (ATM 01030-1745): assente nello specchietto, e'' contante di fine maggio',NULL),
('VALMONTONE','2026-06-04',761.44,313.5,447.94,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-05',880.61,40.0,840.61,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-06',2890.54,670.0,2220.54,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-07',5502.96,1036.85,163.9,0.0,3854.76,447.45,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-08',922.25,141.1,781.15,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,2285.0,'01/06-07/06/2026',NULL),
('VALMONTONE','2026-06-09',942.48,92.35,850.13,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-10',1198.67,141.0,1057.67,0.0,0.0,0.0,0.0,0.0,0.0,69.99,'unieuro sf_41200833',0.0,NULL,NULL),
('VALMONTONE','2026-06-11',1696.13,90.1,1606.03,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-12',448.72,231.6,217.12,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-13',2202.98,558.9,0.0,0.0,1644.08,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-14',2532.82,492.0,99.92,0.0,1940.9,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-15',439.6,151.1,288.5,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,1675.0,'08/06-14/06/2026',NULL),
('VALMONTONE','2026-06-16',584.33,34.8,549.53,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-17',990.89,52.6,938.29,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-18',2044.44,371.5,1672.94,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-19',1984.31,321.75,1662.56,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-20',4039.96,791.2,3248.76,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-21',5173.22,642.8,169.9,0.0,4018.39,342.13,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-22',646.58,0.0,646.58,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,2365.0,'15/06-21/06/2026',NULL),
('VALMONTONE','2026-06-23',1576.16,262.7,1313.46,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-24',2367.51,633.65,1629.06,104.8,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-25',1343.66,358.6,813.86,80.5,0.0,0.0,90.7,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-26',1713.79,428.0,1250.86,34.93,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-27',3353.46,330.8,0.0,0.0,2768.23,254.43,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-28',3413.13,726.05,2571.68,115.4,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-29',2998.33,697.8,2300.53,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-06-30',747.73,127.1,620.63,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,3565.0,'versamento 22/06-30/06 effettuato il 01/07',NULL);

INSERT INTO public.outlet_daily_closings
  (company_id, outlet_id, closing_date, status, total_receipts, cash_expenses, cash_expenses_note,
   cash_deposit, cash_deposit_note, closed_by_name, notes)
SELECT o.company_id, o.id, s.giorno, 'bozza', s.incasso, s.spese, s.spese_note,
       s.versamento, s.vers_note, 'ricostruzione da specchietto',
       COALESCE(s.nota || ' | ', '') || 'ricostruzione giugno 2026 dallo specchietto incassi del punto vendita (Drive); contante ricavato per differenza'
FROM _stg_incassi_giugno_2026 s
JOIN public.outlets o ON o.name = s.outlet
WHERE NOT EXISTS (SELECT 1 FROM public.outlet_daily_closings c WHERE c.outlet_id = o.id AND c.closing_date = s.giorno);

WITH dati AS (
  SELECT c.id AS closing_id, c.company_id, c.outlet_id, x.label, x.amount
  FROM _stg_incassi_giugno_2026 s
  JOIN public.outlets o ON o.name = s.outlet
  JOIN public.outlet_daily_closings c ON c.outlet_id = o.id AND c.closing_date = s.giorno
  CROSS JOIN LATERAL (VALUES ('Contanti', s.contanti), ('POS MPS', s.mps), ('POS MPS Amex', s.mpsx),
                             ('POS BCC', s.bcc), ('POS BCC Amex', s.bccx), ('Pay by link', s.pbl),
                             ('Fatture', s.fatture), ('Bonifico', s.bonifico)) AS x(label, amount)
)
INSERT INTO public.outlet_daily_closing_lines (closing_id, company_id, outlet_id, channel_id, amount)
SELECT d.closing_id, d.company_id, d.outlet_id, ch.id, d.amount
FROM dati d
JOIN public.outlet_payment_channels ch ON ch.outlet_id = d.outlet_id AND ch.label = d.label AND ch.is_active
WHERE NOT EXISTS (SELECT 1 FROM public.outlet_daily_closing_lines l WHERE l.closing_id = d.closing_id AND l.channel_id = ch.id);

INSERT INTO public.outlet_daily_closing_expenses (closing_id, company_id, outlet_id, amount, description, kind, sort_order)
SELECT c.id, c.company_id, c.outlet_id, s.spese,
       COALESCE(NULLIF(btrim(s.spese_note), ''), 'spesa di cassa da specchietto'), 'spesa', 1
FROM _stg_incassi_giugno_2026 s
JOIN public.outlets o ON o.name = s.outlet
JOIN public.outlet_daily_closings c ON c.outlet_id = o.id AND c.closing_date = s.giorno
WHERE s.spese > 0 AND NOT EXISTS (SELECT 1 FROM public.outlet_daily_closing_expenses e WHERE e.closing_id = c.id);

UPDATE public.outlet_daily_closings SET updated_at = now() WHERE closing_date BETWEEN '2026-06-01' AND '2026-06-30';
UPDATE public.outlet_daily_closings SET status = 'confermata', confirmed_at = now()
 WHERE closing_date BETWEEN '2026-06-01' AND '2026-06-30' AND status = 'bozza';

COMMIT;

-- Il 605,00 dell'08/07 e' il contante 29-30 giugno: staccato dalla chiusura del 08/07
DELETE FROM public.closing_bank_matches m USING public.bank_transactions bt
 WHERE m.bank_transaction_id = bt.id AND m.match_type = 'versamento'
   AND bt.transaction_date = '2026-07-08' AND bt.amount = 605.00;
UPDATE public.outlet_daily_closings c SET deposit_bank_amount = 2455.00, deposit_bank_status = 'accreditato'
  FROM public.outlets o WHERE o.id = c.outlet_id AND o.name = 'FRANCIACORTA' AND c.closing_date = '2026-07-08';

SELECT public.match_cash_closings_with_bank((SELECT id FROM public.companies LIMIT 1), 110, 0.01);

-- Versamenti accreditati in piu' operazioni (vedi decisioni 3 e 4)
WITH casi(outlet, giorno, pat1, pat2) AS (VALUES
   ('VALDICHIANA','2026-06-30','%DATA PR: 01-07-26%FOIANO%','%'),
   ('FRANCIACORTA','2026-06-30','%ATM 01030-2121-01.07.2026%','%ATM 01030-2121-08.07.2026-09.23%'),
   ('TORINO','2026-06-30','%ATM 9750 il 30.06.2026%','%ATM 9750 il 01.07.2026%'),
   ('TORINO','2026-06-17','%ATM 9750 il 17.06.2026%','%')
), k AS (
  SELECT c.id closing_id, c.company_id, c.closing_date, casi.pat1, casi.pat2
  FROM casi JOIN public.outlets o ON o.name = casi.outlet
  JOIN public.outlet_daily_closings c ON c.outlet_id = o.id AND c.closing_date = casi.giorno::date
  WHERE c.deposit_bank_status <> 'accreditato'
), tx AS (
  SELECT k.closing_id, k.company_id, k.closing_date, bt.id tx_id, bt.amount
  FROM k JOIN public.bank_transactions bt
    ON bt.company_id = k.company_id AND bt.amount > 0 AND public.cash_bank_is_deposit(bt.description)
   AND (bt.description ILIKE k.pat1 OR (k.pat2 <> '%' AND bt.description ILIKE k.pat2))
   AND bt.transaction_date BETWEEN k.closing_date AND k.closing_date + 8
   AND NOT EXISTS (SELECT 1 FROM public.closing_bank_matches m WHERE m.bank_transaction_id = bt.id)
)
INSERT INTO public.closing_bank_matches (company_id, closing_id, line_id, bank_transaction_id, amount, match_type, reference_date, note)
SELECT company_id, closing_id, NULL, tx_id, amount, 'versamento', closing_date,
       'versamento accreditato in banca in piu'' operazioni' FROM tx;

UPDATE public.closing_bank_matches m
   SET closing_id = (SELECT c.id FROM public.outlet_daily_closings c JOIN public.outlets o ON o.id = c.outlet_id
                      WHERE o.name = 'TORINO' AND c.closing_date = '2026-06-18'),
       reference_date = '2026-06-18',
       note = 'versato il 17/06 insieme agli altri, dichiarato dal negozio sulla giornata del 18/06'
  FROM public.bank_transactions bt
 WHERE m.bank_transaction_id = bt.id AND m.match_type = 'versamento'
   AND bt.transaction_date = '2026-06-17' AND bt.amount = 2300.00;

WITH somme AS (
  SELECT m.closing_id, sum(m.amount) tot, (min(m.bank_transaction_id::text))::uuid tx
  FROM public.closing_bank_matches m JOIN public.outlet_daily_closings c ON c.id = m.closing_id
  WHERE m.match_type = 'versamento' AND c.closing_date BETWEEN '2026-06-01' AND '2026-06-30' GROUP BY 1)
UPDATE public.outlet_daily_closings c
   SET deposit_bank_status = CASE WHEN abs(s.tot - c.cash_deposit) <= 0.01 THEN 'accreditato' ELSE 'differenza' END,
       deposit_bank_amount = s.tot, deposit_bank_transaction_id = COALESCE(c.deposit_bank_transaction_id, s.tx),
       bank_verified_at = now()
  FROM somme s WHERE s.closing_id = c.id;

SELECT public.match_cash_closings_with_bank((SELECT id FROM public.companies LIMIT 1), 110, 0.01);

SELECT count(*) FROM (
  SELECT public.project_cash_closing_to_daily_revenue(c.id)
  FROM public.outlet_daily_closings c WHERE c.closing_date BETWEEN '2026-06-01' AND '2026-06-30') t;
