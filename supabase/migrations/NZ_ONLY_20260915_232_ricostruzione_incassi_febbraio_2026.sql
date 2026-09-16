-- =====================================================================
-- NZ_ONLY 232 — Ricostruzione degli incassi giornalieri di FEBBRAIO 2026
-- ---------------------------------------------------------------------
-- Ottavo e ultimo mese del recupero. 139 chiusure su CINQUE punti vendita
-- invece che sei: Torino non esiste ancora (apre il 26/03) e FRANCIACORTA
-- MANCA, perche' il suo specchietto di febbraio e' un file .xls nel
-- vecchio formato binario di Excel, che il connettore Drive non sa
-- leggere (tutti gli altri mesi sono .xlsx). Restano da caricare le 28
-- giornate di Franciacorta per 55.718,39 euro di corrispettivi: appena il
-- foglio e' disponibile in .xlsx bastera' una migration gemella di questa.
--
-- FONTI (Drive, cartella negozio/FEBBRAIO):
--   BARBERINO     Specchietto incassi FEBBRAIO 2026 Barberino.xlsx
--   VALDICHIANA   Specchietto incassi FEBBRAIO 2026 VALDICHIANA.xlsx
--   PALMANOVA     SPECCHIETTO INCASSI FEBBRAIO 2026 PALMANOVA.xlsx
--   BRUGNATO      SPECCHIETTO INCASSI FEBBRAIO 2026 Brugnato.xlsx
--   VALMONTONE    Specchietto incassi FEBBRAIO Valmontone Febbraio 2026.xlsx
--   FRANCIACORTA  Nuovo Specchietto incassi FEBBRAIO 2026 Franciacorta.XLS  <-- NON LEGGIBILE
--
-- DECISIONI DOCUMENTATE:
--  1. Brugnato non ha il 10 febbraio (corrispettivi zero, la giornata non
--     esiste nel registro): nessuna chiusura creata.
--  2. I versamenti di fine gennaio che escono dalla cassa a febbraio sono
--     registrati qui, sulla giornata in cui il denaro lascia il negozio:
--     Valdichiana 1.876,75 (01/02), Brugnato 1.030,00 e Valmontone
--     2.435,00 (02/02), Barberino 1.280,00 (03/02).
--  3. Palmanova 03/02 porta 2.095,00 e non 805,00: il versamento del
--     01-02/02 e quello del 27-31/01 vanno in banca insieme e la cassa
--     continua li accredita il 06/02 come unico importo.
--  4. Allo stesso modo, i versamenti di fine febbraio finiscono sulle
--     chiusure di MARZO: Brugnato 295,00 e Valmontone 2.415,00 (02/03),
--     Palmanova 1.190,00 (03/03), Valdichiana 1.837,30 e Franciacorta
--     1.895,00 (04/03). Barberino 2.285,00 era gia' sul 03/03 dalla 230.
--     Il versamento di Franciacorta e' l'unico dato del suo febbraio che
--     si ricava senza lo specchietto: lo dice l'estratto conto, con la
--     causale "VERSAMENTO CHIUSURA FEBBRAIO FRANCIACORTA".
--  5. Quattro giornate non quadrano sullo specchietto e restano dichiarate:
--     Valmontone 21/02 (+86,55, POS non contabilizzato e trasmesso dallo
--     studio il 16/03), Valdichiana 05/02 (+34,50, annullato uno scontrino
--     del 26/01), Palmanova 27/02 (-37,32, uno scontrino battuto due volte),
--     Barberino 10/02 (-0,35, arrotondamento).
--
-- ESITO: 22 versamenti dichiarati, 22 trovati in banca, nessuna differenza
--        e nessun aggancio manuale dentro il mese. 135 chiusure su 139
--        verificate.
--
-- NO DATA LOSS: solo INSERT sulle chiusure. La proiezione in daily_revenue
-- riscrive righe esistenti con gli stessi gross_revenue (verificato prima).
-- Applicata su NZ il 15/09/2026. Solo NZ.
-- =====================================================================

BEGIN;

CREATE TEMP TABLE _stg_incassi_febbraio_2026 (
  outlet text, giorno date, incasso numeric, contanti numeric, mps numeric, mpsx numeric,
  bcc numeric, bccx numeric, pbl numeric, fatture numeric, bonifico numeric,
  spese numeric, spese_note text, versamento numeric, vers_note text, nota text) ON COMMIT DROP;

INSERT INTO _stg_incassi_febbraio_2026 VALUES
('BARBERINO','2026-02-01',5306.09,1200.4,3348.69,91.8,665.2,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-02-02',659.9,12.9,542.0,105.0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-02-03',596.25,509.25,70.0,0,0,0,0,0,17.0,0,NULL,1280.0,'contante 27-31/01 versato il 03/02',NULL),
('BARBERINO','2026-02-04',493.5,0.0,493.5,0,0,0,0,0,0,0,NULL,1210.0,'01-02/02/2026',NULL),
('BARBERINO','2026-02-05',812.81,149.15,481.66,67.2,114.8,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-02-06',977.6,187.8,789.8,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-02-07',2763.22,382.9,2298.32,0,82.0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-02-08',2502.5,216.9,1613.28,0,672.32,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-02-09',775.69,307.5,468.19,0,0,0,0,0,0,16.15,'SF_124',0,NULL,NULL),
('BARBERINO','2026-02-10',536.66,400.15,136.16,0,0,0,0,0,0,0,NULL,1735.0,'03-09/02/2026','giornata non quadrata sullo specchietto: canali 536.31 contro corrispettivi+fatture 536.66'),
('BARBERINO','2026-02-11',484.95,44.8,440.15,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-02-12',561.4,136.5,424.9,0,0,0,0,0,0,12.36,'SPESE IGIENE',0,NULL,NULL),
('BARBERINO','2026-02-13',408.55,29.5,379.05,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-02-14',2772.55,390.1,1899.35,0,483.1,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-02-15',3409.35,592.85,2312.9,0,503.6,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-02-16',591.3,195.2,396.1,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-02-17',784.4,132.6,521.8,0,0,0,0,0,130.0,0,NULL,1780.0,'10-16/02/2026',NULL),
('BARBERINO','2026-02-18',882.25,182.75,699.5,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-02-19',592.95,235.2,357.75,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-02-20',1212.8,94.8,1118.0,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-02-21',4056.65,913.1,2292.7,159.95,690.9,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-02-22',4541.25,869.3,2921.6,25.8,724.55,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-02-23',547.5,125.2,422.3,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-02-24',1248.75,256.6,620.85,49.3,0,0,0,0,322.0,0,NULL,2550.0,'17-23/02/2026',NULL),
('BARBERINO','2026-02-25',518.0,217.5,300.5,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-02-26',628.4,330.6,297.8,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-02-27',932.65,195.2,737.45,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-02-28',2608.34,299.9,1893.69,104.9,309.85,0,0,0,0,0,NULL,0,'il versamento di 2.285,00 del 24/02-02/03 esce dalla cassa il 03/03: registrato sulla chiusura del 03/03',NULL),
('VALDICHIANA','2026-02-01',8213.93,884.3,7281.63,48.0,0,0,0,0,0,0,NULL,1876.75,'contante 28-31/01 versato il 01/02',NULL),
('VALDICHIANA','2026-02-02',1425.65,395.9,1029.75,0,0,0,0,0,0,120.0,'FISCO MICHELE SF_4',0,NULL,NULL),
('VALDICHIANA','2026-02-03',1130.52,16.9,1069.12,44.5,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-02-04',1408.1,276.3,1131.8,0,0,0,0,0,0,0,NULL,1177.1,'01-03/02/2026',NULL),
('VALDICHIANA','2026-02-05',1439.24,175.9,1297.84,0,0,0,0,0,0,203.7,'rimborso Gallo gennaio 2026',0,NULL,'giornata non quadrata sullo specchietto: canali 1473.74 contro corrispettivi+fatture 1439.24'),
('VALDICHIANA','2026-02-06',1517.81,360.35,1157.46,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-02-07',4763.44,852.5,3846.64,64.3,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-02-08',5458.61,1125.85,4212.32,120.44,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-02-09',1367.84,181.5,1186.34,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-02-10',1431.42,245.3,1186.12,0,0,0,0,0,0,0,NULL,2768.7,'04-09/02/2026',NULL),
('VALDICHIANA','2026-02-11',1630.89,202.0,1428.89,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-02-12',1145.08,54.6,1090.48,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-02-13',2411.71,423.2,1988.51,0,0,0,0,0,0,10.0,'SPESE ORNAMENTALI',0,NULL,NULL),
('VALDICHIANA','2026-02-14',3511.51,429.6,2971.3,162.85,0,0,0,52.24,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-02-15',5580.25,676.9,4889.35,14.0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-02-16',1756.86,666.4,1090.46,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-02-17',926.72,106.8,819.92,0,0,0,0,0,0,0,NULL,2688.0,'10-16/02/2026',NULL),
('VALDICHIANA','2026-02-18',1787.19,386.7,1400.49,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-02-19',1700.77,128.3,1572.47,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-02-20',1824.92,181.2,0,0,1643.72,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-02-21',5438.54,836.0,4602.54,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-02-22',7782.24,1728.9,6033.64,19.7,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-02-23',1705.36,138.7,1546.76,19.9,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-02-24',1405.53,468.95,936.58,0,0,0,0,0,0,0,NULL,3506.6,'17-23/02/2026',NULL),
('VALDICHIANA','2026-02-25',1042.6,79.3,963.3,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-02-26',745.93,490.15,255.78,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-02-27',1949.9,300.6,1649.3,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-02-28',3426.77,498.3,2846.47,82.0,0,0,0,0,0,0,NULL,0,'il versamento di 1.837,30 del 24-28/02 esce dalla cassa il 04/03: registrato sulla chiusura del 04/03',NULL),
('PALMANOVA','2026-02-01',2564.06,561.0,2003.06,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-02-02',807.34,246.4,560.94,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-02-03',1029.01,243.9,785.11,0,0,0,0,0,0,0,NULL,2095.0,'805,00 del 01-02/02 piu'' 1.290,00 del 27-31/01: un unico accredito il 06/02',NULL),
('PALMANOVA','2026-02-04',685.7,535.4,150.3,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-02-05',398.3,63.2,335.1,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-02-06',1028.86,65.8,963.06,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-02-07',2562.98,333.3,2229.68,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-02-08',2019.72,362.8,1656.92,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-02-09',268.43,215.15,53.28,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-02-10',603.57,407.75,195.82,0,0,0,0,0,0,0,NULL,1825.0,'03-09/02/2026',NULL),
('PALMANOVA','2026-02-11',293.2,26.0,267.2,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-02-12',629.74,186.0,443.74,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-02-13',1346.02,117.3,1228.72,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-02-14',1781.1,529.7,1251.4,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-02-15',3186.55,863.65,1713.48,0,609.42,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-02-16',1531.5,770.0,0,0,761.5,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-02-17',1070.2,405.0,0,0,665.2,0,0,0,0,0,NULL,2900.0,'10-17/02/2026',NULL),
('PALMANOVA','2026-02-18',1426.57,372.35,57.2,0,997.02,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-02-19',800.7,253.0,547.7,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-02-20',2097.3,207.0,1890.3,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-02-21',3625.7,1036.0,2481.4,108.3,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-02-22',3327.18,1252.4,2074.78,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-02-23',562.5,168.9,0,0,393.6,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-02-24',1233.62,132.9,81.6,0,1019.12,0,0,0,0,0,NULL,3765.0,'17-23/02/2026',NULL),
('PALMANOVA','2026-02-25',465.7,124.0,341.7,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-02-26',634.25,52.8,581.45,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-02-27',1435.5,298.0,918.0,0,182.18,0,0,0,0,0,NULL,0,NULL,'giornata non quadrata sullo specchietto: canali 1398.18 contro corrispettivi+fatture 1435.50'),
('PALMANOVA','2026-02-28',2580.9,641.95,1938.95,0,0,0,0,0,0,58.03,'RICAGEST SF_128',0,'il versamento di 1.190,00 del 24-28/02 esce dalla cassa il 02/03: registrato sulla chiusura del 02/03',NULL),
('BRUGNATO','2026-02-01',4051.5,869.65,261.8,0,2920.05,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-02-02',875.5,248.0,627.5,0,0,0,0,0,0,0,NULL,1030.0,'contante 27-31/01 versato il 02/02',NULL),
('BRUGNATO','2026-02-03',720.35,304.6,415.75,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-02-04',146.0,0.0,146.0,0,0,0,0,0,0,62.75,'A TEDI SF_2123000031',2070.0,'01-08/02/2026',NULL),
('BRUGNATO','2026-02-05',431.78,65.9,305.76,60.12,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-02-06',426.02,0.0,426.02,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-02-07',1876.98,107.6,912.22,0,857.16,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-02-08',3284.68,537.8,409.88,0,2337.0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-02-09',413.38,110.9,302.48,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-02-11',240.7,0.0,240.7,0,0,0,0,0,0,21.1,'A TEDI SF_212300040',0,NULL,NULL),
('BRUGNATO','2026-02-12',838.07,63.35,774.72,0,0,0,0,0,0,10.0,'A TEDI SF_212300042_43',0,NULL,NULL),
('BRUGNATO','2026-02-13',542.93,88.4,454.53,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-02-14',1023.29,278.8,59.1,0,685.39,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-02-15',2044.28,143.65,164.34,0,1656.28,80.01,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-02-16',637.62,19.9,617.72,0,0,0,0,0,0,0,NULL,655.0,'09-15/02/2026',NULL),
('BRUGNATO','2026-02-17',244.26,0.0,244.26,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-02-18',528.2,163.0,365.2,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-02-19',504.3,101.5,264.9,137.9,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-02-20',407.22,58.0,317.42,31.8,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-02-21',1755.22,893.7,238.72,0,622.8,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-02-22',3269.2,925.3,450.2,0,1893.7,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-02-23',456.1,0.0,456.1,0,0,0,0,0,0,0,NULL,2160.0,'16-22/02/2026',NULL),
('BRUGNATO','2026-02-24',535.7,19.9,515.8,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-02-25',367.9,27.6,340.3,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-02-26',183.3,0.0,167.4,15.9,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-02-27',840.9,50.0,790.9,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-02-28',2376.1,195.7,206.0,0,1974.4,0,0,0,0,0,NULL,0,'il versamento di 295,00 del 23-28/02 esce dalla cassa il 02/03: registrato sulla chiusura del 02/03',NULL),
('VALMONTONE','2026-02-01',7957.8,1154.15,0,0,6412.35,453.8,0,62.5,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-02-02',2382.9,496.1,1886.8,0,0,0,0,0,0,0,NULL,2435.0,'contante 26-31/01 versato il 02/02',NULL),
('VALMONTONE','2026-02-03',758.3,223.3,535.0,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-02-04',1063.1,585.9,477.2,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-02-05',3218.65,620.3,2545.15,53.2,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-02-06',1222.42,258.8,963.62,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-02-07',3818.65,747.95,0,0,2931.18,139.52,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-02-08',6153.7,1363.9,0,0,4407.96,431.74,0,49.9,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-02-09',1121.97,628.0,493.97,0,0,0,0,0,0,0,NULL,5450.0,'01-08/02/2026',NULL),
('VALMONTONE','2026-02-10',1036.62,128.8,907.82,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-02-11',949.84,88.8,861.04,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-02-12',893.13,50.4,475.38,0,0,0,367.35,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-02-13',2506.57,366.8,2139.77,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-02-14',2145.57,128.0,0,0,1629.77,387.8,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-02-15',5014.49,679.2,4105.19,230.1,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-02-16',1352.07,592.65,0,0,759.42,0,0,0,0,0,NULL,2070.0,'09-15/02/2026',NULL),
('VALMONTONE','2026-02-17',598.06,106.1,491.96,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-02-18',1839.04,253.7,1585.34,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-02-19',1098.1,347.5,750.6,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-02-20',1707.15,402.1,1234.15,70.9,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-02-21',5290.71,669.65,1054.35,0,3268.36,384.9,0,0,0,0,NULL,0,NULL,'giornata non quadrata sullo specchietto: canali 5377.26 contro corrispettivi 5290.71 (86,55 di POS non contabilizzati il 21/02, trasmessi dallo studio il 16/03)'),
('VALMONTONE','2026-02-22',6439.02,1636.8,0,0,4783.32,18.9,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-02-23',742.45,85.3,657.15,0,0,0,0,0,0,0,NULL,4005.0,'16-22/02/2026',NULL),
('VALMONTONE','2026-02-24',1109.5,496.5,613.0,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-02-25',1205.5,663.1,542.4,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-02-26',608.82,284.8,324.02,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-02-27',754.6,338.3,416.3,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-02-28',2803.62,547.55,0,0,2256.07,0,0,0,0,0,NULL,0,'il versamento di 2.415,00 del 22-28/02 esce dalla cassa il 02/03: registrato sulla chiusura del 02/03',NULL);

INSERT INTO public.outlet_daily_closings
  (company_id, outlet_id, closing_date, status, total_receipts, cash_expenses, cash_expenses_note,
   cash_deposit, cash_deposit_note, closed_by_name, notes)
SELECT o.company_id, o.id, s.giorno, 'bozza', s.incasso, s.spese, s.spese_note,
       s.versamento, s.vers_note, 'ricostruzione da specchietto',
       COALESCE(s.nota || ' | ', '') || 'ricostruzione febbraio 2026 dallo specchietto incassi del punto vendita (Drive)'
FROM _stg_incassi_febbraio_2026 s
JOIN public.outlets o ON o.name = s.outlet
WHERE NOT EXISTS (SELECT 1 FROM public.outlet_daily_closings c WHERE c.outlet_id = o.id AND c.closing_date = s.giorno);

WITH dati AS (
  SELECT c.id AS closing_id, c.company_id, c.outlet_id, x.label, x.amount
  FROM _stg_incassi_febbraio_2026 s
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
FROM _stg_incassi_febbraio_2026 s
JOIN public.outlets o ON o.name = s.outlet
JOIN public.outlet_daily_closings c ON c.outlet_id = o.id AND c.closing_date = s.giorno
WHERE s.spese > 0 AND NOT EXISTS (SELECT 1 FROM public.outlet_daily_closing_expenses e WHERE e.closing_id = c.id);

UPDATE public.outlet_daily_closings SET updated_at = now() WHERE closing_date BETWEEN '2026-02-01' AND '2026-02-28';
UPDATE public.outlet_daily_closings SET status = 'confermata', confirmed_at = now()
 WHERE closing_date BETWEEN '2026-02-01' AND '2026-02-28' AND status = 'bozza';

COMMIT;

-- Riscontro con la banca: dentro febbraio il motore trova tutto da solo
SELECT public.match_cash_closings_with_bank((SELECT id FROM public.companies LIMIT 1), 240, 0.01);

-- Punto 4: il contante di fine febbraio esce dalla cassa a marzo
WITH agg(outlet, giorno, aggiunta, nota) AS (VALUES
  ('BRUGNATO','2026-03-02',295.00,'contante 23-28/02 versato il 02/03 all''ATM'),
  ('VALMONTONE','2026-03-02',2415.00,'contante 22-28/02 versato il 02/03 all''ATM'),
  ('VALDICHIANA','2026-03-04',1837.30,'contante 24-28/02 versato in cassa continua il 02/03 e accreditato il 04/03'),
  ('FRANCIACORTA','2026-03-04',1895.00,'contante di chiusura febbraio versato il 04/03 all''ATM (causale "VERSAMENTO CHIUSURA FEBBRAIO FRANCIACORTA")'),
  ('PALMANOVA','2026-03-03',1190.00,'contante 24-28/02 versato in cassa continua il 03/03 e accreditato il 06/03')
)
UPDATE public.outlet_daily_closings c
   SET cash_deposit = c.cash_deposit + a.aggiunta,
       cash_deposit_note = COALESCE(NULLIF(btrim(c.cash_deposit_note),'') || ' + ', '') || a.nota,
       updated_at = now()
  FROM agg a JOIN public.outlets o ON o.name = a.outlet
 WHERE c.outlet_id = o.id AND c.closing_date = a.giorno::date;

WITH casi(outlet, giorno, tx_date, tx_amount) AS (VALUES
  ('BRUGNATO','2026-03-02','2026-03-02',295.00),
  ('VALMONTONE','2026-03-02','2026-03-02',2415.00),
  ('VALDICHIANA','2026-03-04','2026-03-04',1837.30),
  ('FRANCIACORTA','2026-03-04','2026-03-04',1895.00),
  ('PALMANOVA','2026-03-03','2026-03-06',1190.00)
), k AS (
  SELECT c.id closing_id, c.company_id, c.closing_date, casi.tx_date::date td, casi.tx_amount ta
  FROM casi JOIN public.outlets o ON o.name = casi.outlet
  JOIN public.outlet_daily_closings c ON c.outlet_id = o.id AND c.closing_date = casi.giorno::date
), tx AS (
  SELECT k.closing_id, k.company_id, k.closing_date, bt.id tx_id, bt.amount
  FROM k JOIN public.bank_transactions bt
    ON bt.company_id = k.company_id AND bt.transaction_date = k.td AND bt.amount = k.ta
   AND public.cash_bank_is_deposit(bt.description)
   AND NOT EXISTS (SELECT 1 FROM public.closing_bank_matches m WHERE m.bank_transaction_id = bt.id)
)
INSERT INTO public.closing_bank_matches (company_id, closing_id, line_id, bank_transaction_id, amount, match_type, reference_date, note)
SELECT company_id, closing_id, NULL, tx_id, amount, 'versamento', closing_date,
       'contante di fine febbraio versato a marzo' FROM tx;

WITH somme AS (
  SELECT m.closing_id, sum(m.amount) tot, (min(m.bank_transaction_id::text))::uuid tx
  FROM public.closing_bank_matches m JOIN public.outlet_daily_closings c ON c.id = m.closing_id
  WHERE m.match_type = 'versamento' AND c.closing_date BETWEEN '2026-03-01' AND '2026-03-06' GROUP BY 1)
UPDATE public.outlet_daily_closings c
   SET deposit_bank_status = CASE WHEN abs(s.tot - c.cash_deposit) <= 0.01 THEN 'accreditato' ELSE 'differenza' END,
       deposit_bank_amount = s.tot, deposit_bank_transaction_id = COALESCE(c.deposit_bank_transaction_id, s.tx),
       bank_verified_at = now()
  FROM somme s WHERE s.closing_id = c.id;

SELECT public.match_cash_closings_with_bank((SELECT id FROM public.companies LIMIT 1), 265, 0.01);

SELECT count(*) FROM (
  SELECT public.project_cash_closing_to_daily_revenue(c.id)
  FROM public.outlet_daily_closings c WHERE c.closing_date BETWEEN '2026-02-01' AND '2026-02-28') t;

-- VERIFICA
-- SELECT count(*) chiusure, sum(total_receipts) incassi, sum(cash_deposit) versamenti
--   FROM public.outlet_daily_closings WHERE closing_date BETWEEN '2026-02-01' AND '2026-02-28';
--   atteso (senza Franciacorta): 139 | 250945.62 | 51032.15
