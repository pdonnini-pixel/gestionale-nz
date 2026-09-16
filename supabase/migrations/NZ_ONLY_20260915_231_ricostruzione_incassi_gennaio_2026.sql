-- =====================================================================
-- NZ_ONLY 231 — Ricostruzione degli incassi giornalieri di GENNAIO 2026
-- ---------------------------------------------------------------------
-- Settimo mese ricostruito. 179 chiusure su 6 punti vendita: Torino non
-- esiste ancora (apre il 26/03). Il 1 gennaio e' chiuso ovunque e non
-- esiste nel registro; Barberino e' chiuso anche il 6 gennaio.
--
-- FONTI (Drive, cartella negozio/GENNAIO):
--   BARBERINO     Specchietto incassi GENNAIO 2026 BARBERINO.xlsx
--   VALDICHIANA   Specchietto incassi Valdichiana GENNAIO 2026.xlsx
--   PALMANOVA     SPECCHIETTO INCASSI FEBBRAIO 2026 PALMANOVA.xlsx (foglio GENNAIO)
--   BRUGNATO      SPECCHIETTO INCASSI GENNAIO 2026 BRUGNATO.xlsx
--   FRANCIACORTA  Specchietto incassi Franciacorta GENNAIO 2026.xlsx
--   VALMONTONE    SPECCHIETTI INCASSI VALMONTONE GENNAIO 2026.xlsx
--
-- DECISIONI DOCUMENTATE:
--  1. PRIMA VOLTA IN SETTE MESI: quattro giornate di Valdichiana hanno
--     corrispettivi diversi da daily_revenue (24 e 26 gennaio per 78,12,
--     30 e 31 gennaio per 48,50), a coppie che si compensano. Il negozio
--     attribuisce l'importo a una giornata, il registro a un'altra; il
--     totale del mese coincide. Vale il REGISTRO, che e' la fonte fiscale
--     e che la proiezione non deve toccare: total_receipts prende il
--     valore di daily_revenue e la nota della chiusura dice da dove viene.
--  2. Franciacorta 13/01 e 20/01: un solo versamento dichiarato, ma in
--     banca sono due operazioni allo stesso ATM a un paio di minuti di
--     distanza (5.100 + 830 e 3.000 + 900). Agganciate a mano.
--  3. Palmanova 31/01: i 1.290,00 del 27-31/01 non sono mai arrivati da
--     soli. Vanno in banca insieme agli 805,00 del 01-02/02 e la cassa
--     continua li accredita il 06/02 come unico importo di 2.095,00.
--     Qui la giornata resta a zero con la nota; i 2.095,00 andranno sulla
--     chiusura del 03/02.
--  4. Altri versamenti di fine gennaio che escono dalla cassa a febbraio,
--     lasciati a zero con la nota: Barberino 1.280,00 (03/02), Valdichiana
--     1.876,75 (01/02), Brugnato 1.030,00 (02/02), Valmontone 2.435,00
--     (02/02).
--  5. Sette giornate non quadrano sullo specchietto e restano dichiarate.
--     La piu' rilevante e' Palmanova 10/01 (-435,46); seguono Franciacorta
--     03/01 (+26,40, storno di uno scontrino errato), Palmanova 14/01
--     (-11,00), Valdichiana 31/01 (-0,03), Valmontone 30/01 (-0,02).
--  6. La colonna FATTURE resta un promemoria: l'importo viaggia dentro un
--     canale (Valmontone 02, 11 e 17/01; Valdichiana 17/01; Barberino 24/01).
--
-- ESITO: 21 versamenti dichiarati e riscontrabili a gennaio, 21 trovati in
--        banca, nessuna differenza. 173 chiusure su 179 verificate; le 6
--        che restano hanno una riga POS in differenza o mancante, quasi
--        tutte accrediti Amex di fine mese che arrivano a febbraio.
--
-- NO DATA LOSS: solo INSERT sulle chiusure. La proiezione in daily_revenue
-- riscrive righe esistenti con gli stessi gross_revenue (verificato prima,
-- dopo l'allineamento del punto 1).
-- Applicata su NZ il 15/09/2026. Solo NZ.
-- =====================================================================

BEGIN;

CREATE TEMP TABLE _stg_incassi_gennaio_2026 (
  outlet text, giorno date, incasso numeric, contanti numeric, mps numeric, mpsx numeric,
  bcc numeric, bccx numeric, pbl numeric, fatture numeric, bonifico numeric,
  spese numeric, spese_note text, versamento numeric, vers_note text, nota text) ON COMMIT DROP;

INSERT INTO _stg_incassi_gennaio_2026 VALUES
('BARBERINO','2026-01-02',3571.3,1172.1,2399.2,0,0,0,0,0,0,0,NULL,1235.0,'chiusura di dicembre',NULL),
('BARBERINO','2026-01-03',8313.4,1613.55,5477.65,34.65,1187.55,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-01-04',5806.15,865.05,3954.4,124.6,862.1,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-01-05',6105.9,1014.85,3879.8,166.0,1045.25,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-01-07',472.4,203.3,269.1,0,0,0,0,0,0,0,NULL,4665.0,'01-06/01/2026',NULL),
('BARBERINO','2026-01-08',685.6,28.0,657.6,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-01-09',1091.05,101.2,886.35,103.5,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-01-10',6811.05,1105.1,3983.45,298.3,1424.2,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-01-11',7002.75,1189.45,4661.0,43.4,1108.9,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-01-12',549.2,0.0,549.2,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-01-13',336.2,0.0,336.2,0,0,0,0,0,0,0,NULL,2630.0,'07-12/01/2026',NULL),
('BARBERINO','2026-01-14',928.9,248.0,680.9,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-01-15',1001.45,95.4,906.05,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-01-16',1190.9,53.5,1137.4,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-01-17',6563.3,948.9,4312.3,0,1302.1,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-01-18',5178.75,1022.7,3480.3,0,675.75,0,0,0,0,9.82,'SPESE IGIENE',0,NULL,NULL),
('BARBERINO','2026-01-19',1530.05,314.2,1163.1,0,0,0,0,0,52.75,0,NULL,0,NULL,NULL),
('BARBERINO','2026-01-20',549.4,0.0,549.4,0,0,0,0,0,0,0,NULL,2670.0,'13-19/01/2026',NULL),
('BARBERINO','2026-01-21',630.35,229.5,400.85,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-01-22',860.29,146.9,713.39,0,0,0,0,0,0,120.01,'A UFFICIO MODERNO SF_43',0,NULL,NULL),
('BARBERINO','2026-01-23',708.85,304.75,404.1,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-01-24',2643.43,405.9,2023.93,0,387.5,0,0,173.9,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-01-25',4105.2,1031.2,2434.6,0,639.4,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-01-26',795.3,293.4,327.2,174.7,0,0,0,0,0,71.45,'FAMILY CENTER SF_78 26,05 e rimborso Gallo 45,40',0,NULL,NULL),
('BARBERINO','2026-01-27',518.1,29.5,488.6,0,0,0,0,0,0,0,NULL,2220.0,'20-26/01/2026',NULL),
('BARBERINO','2026-01-28',179.25,0.0,179.25,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-01-29',509.2,121.5,320.7,0,0,0,0,0,67.0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-01-30',412.4,212.0,200.4,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-01-31',3479.89,938.75,2051.78,48.5,440.86,0,0,0,0,18.45,'rimborso cliente in contanti',0,'il versamento di 1.280,00 del 27-31/01 esce dalla cassa il 03/02: registrato sulla chiusura del 03/02',NULL),
('VALDICHIANA','2026-01-02',5141.24,603.5,4537.74,0,0,0,0,0,0,0,NULL,710.0,'ultimo versamento di dicembre',NULL),
('VALDICHIANA','2026-01-03',14640.55,2089.6,12275.24,275.71,0,0,0,0,0,13.8,'rimborso scontrino errato',0,NULL,NULL),
('VALDICHIANA','2026-01-04',13900.17,2898.45,10863.82,137.9,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-01-05',6843.25,1601.5,5162.75,79.0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-01-06',3179.4,595.25,2584.15,0,0,0,0,0,0,0,NULL,7275.0,'02-05/01/2026',NULL),
('VALDICHIANA','2026-01-07',1402.8,257.95,1092.25,52.6,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-01-08',2413.85,502.1,1911.75,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-01-09',2767.29,319.75,2447.54,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-01-10',6455.0,1010.15,5444.85,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-01-11',8670.05,1806.4,6863.65,0,0,0,0,0,0,20.0,'rimborso scontrino per errato sconto',0,NULL,NULL),
('VALDICHIANA','2026-01-12',1089.9,93.8,996.1,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-01-13',1647.9,219.1,1428.8,0,0,0,0,0,0,0,NULL,4569.65,'06-12/01/2026',NULL),
('VALDICHIANA','2026-01-14',1676.3,419.8,1105.2,0,0,0,151.3,0,0,79.3,'SPESE IGIENE',0,NULL,NULL),
('VALDICHIANA','2026-01-15',1850.0,853.15,996.85,0,0,0,0,0,0,5.7,'DX SRL SF_14',0,NULL,NULL),
('VALDICHIANA','2026-01-16',2061.7,269.4,1792.3,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-01-17',8285.02,410.0,6072.52,85.3,1586.9,430.3,0,300.0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-01-18',9494.85,1959.6,7258.35,276.9,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-01-19',1676.85,405.05,1271.8,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-01-20',1561.63,79.9,1481.73,0,0,0,0,0,0,0,NULL,4551.1,'13-19/01/2026',NULL),
('VALDICHIANA','2026-01-21',1261.5,222.0,1039.5,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-01-22',1456.15,66.0,1390.15,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-01-23',1330.65,28.2,1302.45,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-01-24',4202.59,660.25,3542.34,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-01-25',5048.85,940.1,4108.75,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-01-26',1291.6,65.2,1226.4,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-01-27',1358.05,122.9,1235.15,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-01-28',1258.9,119.45,1080.4,0,0,0,59.05,0,0,0,NULL,2204.35,'20-27/01/2026',NULL),
('VALDICHIANA','2026-01-29',1431.05,202.55,1228.5,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-01-30',3245.34,666.1,2627.74,0,0,0,0,0,0,48.5,'rimborso gonna difettosa',0,NULL,'giornata non quadrata sullo specchietto: canali 3293.84 contro corrispettivi+fatture 3245.34'),
('VALDICHIANA','2026-01-31',5278.41,1122.02,58.5,0,4019.74,0,78.12,0,0,184.9,'rimborso Gallo',0,'il versamento di 1.876,75 del 28-31/01 esce dalla cassa il 01/02: registrato sulla chiusura del 01/02','giornata non quadrata sullo specchietto: canali 5278.38 contro corrispettivi+fatture 5278.41'),
('PALMANOVA','2026-01-02',4592.5,1161.5,3431.0,0,0,0,0,0,0,0,NULL,280.0,'ultimo versamento di dicembre',NULL),
('PALMANOVA','2026-01-03',5131.6,1643.8,3487.8,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-01-04',2924.95,565.25,2359.7,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-01-05',3865.28,1048.3,2816.98,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-01-06',1691.6,614.9,1076.7,0,0,0,0,0,0,0,NULL,4420.0,'01-05/01/2026',NULL),
('PALMANOVA','2026-01-07',337.33,117.9,134.83,0,84.6,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-01-08',1310.95,552.1,0,0,758.85,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-01-09',1898.74,193.9,0,0,1704.84,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-01-10',5343.48,513.0,347.2,164.52,3883.3,0,0,0,0,0,NULL,0,NULL,'giornata non quadrata sullo specchietto: canali 4908.02 contro corrispettivi+fatture 5343.48'),
('PALMANOVA','2026-01-11',3784.44,661.4,1134.95,0,1988.09,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-01-12',1350.52,225.0,296.52,0,829.0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-01-13',989.82,118.5,0,0,871.32,0,0,0,0,89.49,'spesa di cassa da specchietto',2790.0,'06-12/01/2026',NULL),
('PALMANOVA','2026-01-14',582.34,111.0,44.8,0,415.54,0,0,0,0,0,NULL,0,NULL,'giornata non quadrata sullo specchietto: canali 571.34 contro corrispettivi+fatture 582.34'),
('PALMANOVA','2026-01-15',756.59,125.5,0,0,631.09,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-01-16',755.2,111.6,643.6,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-01-17',3274.3,608.3,1198.9,0,1467.1,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-01-18',3109.13,1021.5,2087.63,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-01-19',1108.05,251.25,856.8,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-01-20',1365.06,54.9,1310.16,0,0,0,0,0,0,0,NULL,2345.0,'13-19/01/2026',NULL),
('PALMANOVA','2026-01-21',261.6,0.0,261.6,0,0,0,0,0,0,12.9,'Risparmio Casa 52/2026',0,NULL,NULL),
('PALMANOVA','2026-01-22',743.06,0.0,632.06,111.0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-01-23',1075.25,83.0,992.25,0,0,0,0,0,0,23.8,'Buffetti FE000073',0,NULL,NULL),
('PALMANOVA','2026-01-24',2228.15,221.0,2007.15,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-01-25',1235.0,215.3,1019.7,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-01-26',598.54,111.7,486.84,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-01-27',645.7,46.0,599.7,0,0,0,0,0,0,0,NULL,650.0,'20-26/01/2026',NULL),
('PALMANOVA','2026-01-28',73.0,0.0,73.0,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-01-29',1133.68,505.05,628.63,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-01-30',1395.27,320.2,1075.07,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-01-31',4606.7,417.8,4188.9,0,0,0,0,0,0,0,NULL,1290.0,'27-31/01/2026',NULL),
('BRUGNATO','2026-01-02',1076.9,124.9,952.0,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-01-03',6395.2,1152.0,846.4,0,4349.2,47.6,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-01-04',6473.3,1204.8,938.3,0,4330.2,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-01-05',3910.6,573.6,3337.0,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-01-06',3008.57,354.4,2606.17,48.0,0,0,0,0,0,0,NULL,3055.0,'02-05/01/2026',NULL),
('BRUGNATO','2026-01-07',501.2,0.0,501.2,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-01-08',876.5,230.3,646.2,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-01-09',535.7,0.0,535.7,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-01-10',3626.9,724.7,514.1,0,2327.8,60.3,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-01-11',5033.18,895.6,508.28,0,3629.3,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-01-12',958.0,235.8,722.2,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-01-13',772.3,206.7,526.8,38.8,0,0,0,0,0,0,NULL,2205.0,'06-11/01/2026',NULL),
('BRUGNATO','2026-01-14',873.3,169.8,703.5,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-01-15',1058.0,90.0,968.0,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-01-16',860.5,97.8,762.7,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-01-17',2887.33,218.85,815.78,0,1852.7,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-01-18',4438.2,739.05,392.0,0,3307.15,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-01-19',575.5,0.0,575.5,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-01-20',613.7,0.0,613.7,0,0,0,0,0,0,0,NULL,1755.0,'12-19/01/2026',NULL),
('BRUGNATO','2026-01-21',325.7,0.0,325.7,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-01-22',888.42,328.3,560.12,0,0,0,0,0,0,47.47,'NUME SRL SF_162 38,67 e rimborso Gallo 8,80',0,NULL,NULL),
('BRUGNATO','2026-01-23',553.0,86.9,466.1,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-01-24',2351.55,264.95,627.6,0,1459.0,0,0,0,0,43.35,'A TEDI SF_2123000019',0,NULL,NULL),
('BRUGNATO','2026-01-25',2546.1,483.8,297.2,0,1597.65,167.45,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-01-26',403.4,0.0,403.4,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-01-27',338.1,233.6,104.5,0,0,0,0,0,0,0,NULL,1075.0,'20-26/01/2026',NULL),
('BRUGNATO','2026-01-28',178.6,48.5,102.4,27.7,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-01-29',307.9,0.0,307.9,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-01-30',1048.45,411.35,637.1,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-01-31',2655.8,349.85,228.0,64.4,1883.25,130.3,0,0,0,14.0,'A TEDI SF_2123000022',0,'il versamento di 1.030,00 del 27-31/01 esce dalla cassa il 02/02: registrato sulla chiusura del 02/02',NULL),
('FRANCIACORTA','2026-01-02',6543.54,1023.1,5164.94,0,0,355.5,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-03',7803.2,1444.3,6285.3,0,100.0,0,0,0,0,26.4,'storno cliente per scontrino errato 0062 del 03/01',0,NULL,'giornata non quadrata sullo specchietto: canali 7829.60 contro corrispettivi+fatture 7803.20'),
('FRANCIACORTA','2026-01-04',6185.2,864.0,5191.4,0,129.8,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-05',6037.8,1192.6,4761.7,0,83.5,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-06',4640.3,1098.6,3198.4,0,0,343.3,0,0,0,0,NULL,3305.0,'02-04/01/2026',NULL),
('FRANCIACORTA','2026-01-07',1229.2,647.1,582.1,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-08',867.0,278.3,588.7,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-09',1553.3,104.7,1258.9,0,189.7,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-10',3393.45,835.85,2504.4,0,0,53.2,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-11',6829.0,1346.7,5287.9,0,0,194.4,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-12',1326.1,423.4,902.7,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-13',1604.7,35.5,1403.2,0,0,166.0,0,0,0,0,NULL,5930.0,'05-12/01/2026',NULL),
('FRANCIACORTA','2026-01-14',1131.7,310.8,820.9,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-15',1328.7,615.4,713.3,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-16',1897.5,433.2,1464.3,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-17',7108.0,1375.8,5732.2,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-18',6983.4,1121.7,5791.4,0,24.8,45.5,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-19',870.0,98.1,771.9,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-20',669.8,290.0,379.8,0,0,0,0,0,0,0,NULL,3900.0,'13-18/01/2026',NULL),
('FRANCIACORTA','2026-01-21',561.6,375.1,186.5,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-22',1301.81,205.85,1095.96,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-23',1417.6,429.0,988.6,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-24',3325.75,494.6,2709.75,0,43.4,78.0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-25',4826.7,924.5,3863.2,0,39.0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-26',1600.0,464.1,1135.9,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-27',951.3,225.4,725.9,0,0,0,0,0,0,0,NULL,3280.0,'19-26/01/2026',NULL),
('FRANCIACORTA','2026-01-28',1197.1,257.0,940.1,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-29',883.1,478.3,291.6,0,0,113.2,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-30',2587.45,648.35,1735.1,0,204.0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-01-31',5455.45,522.7,4689.25,0,0,243.5,0,0,0,0,NULL,2130.0,'27-31/01/2026',NULL),
('VALMONTONE','2026-01-02',3313.8,419.5,3014.7,0,0,0,0,120.4,0,0,NULL,1405.0,'ultimo versamento di dicembre',NULL),
('VALMONTONE','2026-01-03',10759.25,1987.0,8591.25,181.0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-01-04',5990.35,766.6,5223.75,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-01-05',4611.45,576.2,3757.45,204.9,0,0,72.9,0,0,0,NULL,3170.0,'02-04/01/2026',NULL),
('VALMONTONE','2026-01-06',2136.25,309.0,1827.25,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-01-07',1673.04,548.1,1124.94,0,0,0,0,0,0,45.99,'SOGECO SRL SF_06/36',0,NULL,NULL),
('VALMONTONE','2026-01-08',1891.75,509.7,1382.05,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-01-09',791.9,272.7,519.2,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-01-10',4622.4,670.3,167.7,0,3694.8,89.6,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-01-11',8357.4,1494.8,199.0,0,6499.3,268.8,0,104.5,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-01-12',1569.6,47.9,1420.9,100.8,0,0,0,0,0,0,NULL,4335.0,'05-11/01/2026',NULL),
('VALMONTONE','2026-01-13',1791.6,292.0,1499.6,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-01-14',1332.5,143.9,1188.6,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-01-15',2063.26,486.2,1577.06,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-01-16',2370.4,504.5,1637.0,228.9,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-01-17',7624.55,1347.5,0,0,6510.35,69.0,0,302.3,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-01-18',8030.2,1830.3,361.4,0,5838.5,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-01-19',1640.3,261.0,1245.1,134.2,0,0,0,0,0,0,NULL,4655.0,'12-18/01/2026',NULL),
('VALMONTONE','2026-01-20',1227.4,176.5,959.9,91.0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-01-21',1283.2,258.6,1024.6,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-01-22',3518.65,665.9,2625.5,227.25,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-01-23',3765.15,660.8,3104.35,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-01-24',2895.0,375.7,2519.3,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-01-25',4631.45,605.5,100.8,0,3879.1,46.05,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-01-26',895.3,145.9,749.4,0,0,0,0,0,0,0,NULL,3005.0,'19-25/01/2026',NULL),
('VALMONTONE','2026-01-27',1254.4,309.7,944.7,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-01-28',435.4,298.1,137.3,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-01-29',1701.2,305.8,1395.4,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-01-30',1626.42,149.15,1477.25,0,0,0,0,0,0,0,NULL,0,NULL,'giornata non quadrata sullo specchietto: canali 1626.40 contro corrispettivi+fatture 1626.42'),
('VALMONTONE','2026-01-31',6921.54,1226.5,95.0,0,5387.04,213.0,0,0,0,0,NULL,0,'il versamento di 2.435,00 del 26-31/01 esce dalla cassa il 02/02: registrato sulla chiusura del 02/02',NULL);

-- Punto 1: i corrispettivi vengono dal registro, che e' la fonte fiscale
UPDATE _stg_incassi_gennaio_2026 s
   SET incasso = dr.gross_revenue,
       nota = 'corrispettivi presi dal registro (' || dr.gross_revenue || ') invece che dallo specchietto (' || s.incasso || '): il negozio attribuisce l''importo a una giornata diversa, il totale del mese coincide'
  FROM public.outlets o, public.daily_revenue dr
 WHERE o.name = s.outlet AND dr.outlet_id = o.id AND dr.date = s.giorno
   AND abs(dr.gross_revenue - s.incasso) > 0.01;

INSERT INTO public.outlet_daily_closings
  (company_id, outlet_id, closing_date, status, total_receipts, cash_expenses, cash_expenses_note,
   cash_deposit, cash_deposit_note, closed_by_name, notes)
SELECT o.company_id, o.id, s.giorno, 'bozza', s.incasso, s.spese, s.spese_note,
       s.versamento, s.vers_note, 'ricostruzione da specchietto',
       COALESCE(s.nota || ' | ', '') || 'ricostruzione gennaio 2026 dallo specchietto incassi del punto vendita (Drive)'
FROM _stg_incassi_gennaio_2026 s
JOIN public.outlets o ON o.name = s.outlet
WHERE NOT EXISTS (SELECT 1 FROM public.outlet_daily_closings c WHERE c.outlet_id = o.id AND c.closing_date = s.giorno);

WITH dati AS (
  SELECT c.id AS closing_id, c.company_id, c.outlet_id, x.label, x.amount
  FROM _stg_incassi_gennaio_2026 s
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
FROM _stg_incassi_gennaio_2026 s
JOIN public.outlets o ON o.name = s.outlet
JOIN public.outlet_daily_closings c ON c.outlet_id = o.id AND c.closing_date = s.giorno
WHERE s.spese > 0 AND NOT EXISTS (SELECT 1 FROM public.outlet_daily_closing_expenses e WHERE e.closing_id = c.id);

UPDATE public.outlet_daily_closings SET updated_at = now() WHERE closing_date BETWEEN '2026-01-01' AND '2026-01-31';
UPDATE public.outlet_daily_closings SET status = 'confermata', confirmed_at = now()
 WHERE closing_date BETWEEN '2026-01-01' AND '2026-01-31' AND status = 'bozza';

COMMIT;

SELECT public.match_cash_closings_with_bank((SELECT id FROM public.companies LIMIT 1), 265, 0.01);

-- Punto 2: versamenti spezzati in due operazioni allo stesso ATM
WITH casi(outlet, giorno, tx_date, tx_amount) AS (VALUES
  ('FRANCIACORTA','2026-01-13','2026-01-13',5100.00),
  ('FRANCIACORTA','2026-01-13','2026-01-13',830.00),
  ('FRANCIACORTA','2026-01-20','2026-01-20',3000.00),
  ('FRANCIACORTA','2026-01-20','2026-01-20',900.00)
), k AS (
  SELECT c.id closing_id, c.company_id, c.closing_date, casi.tx_date::date td, casi.tx_amount ta
  FROM casi JOIN public.outlets o ON o.name = casi.outlet
  JOIN public.outlet_daily_closings c ON c.outlet_id = o.id AND c.closing_date = casi.giorno::date
), tx AS (
  SELECT k.closing_id, k.company_id, k.closing_date, bt.id tx_id, bt.amount
  FROM k JOIN public.bank_transactions bt
    ON bt.company_id = k.company_id AND bt.transaction_date = k.td AND bt.amount = k.ta
   AND public.cash_bank_is_deposit(bt.description) AND bt.description ILIKE '%2121%'
   AND NOT EXISTS (SELECT 1 FROM public.closing_bank_matches m WHERE m.bank_transaction_id = bt.id)
)
INSERT INTO public.closing_bank_matches (company_id, closing_id, line_id, bank_transaction_id, amount, match_type, reference_date, note)
SELECT company_id, closing_id, NULL, tx_id, amount, 'versamento', closing_date,
       'versamento accreditato in banca in piu'' operazioni allo stesso ATM' FROM tx;

-- Punto 3: il versamento di Palmanova del 31/01 esce dalla cassa a febbraio
UPDATE public.outlet_daily_closings c
   SET cash_deposit = 0,
       cash_deposit_note = 'i 1.290,00 del 27-31/01 escono dalla cassa a febbraio: versati insieme agli 805,00 del 01-02/02 e accreditati il 06/02 in un unico importo di 2.095,00, registrati sulla chiusura del 03/02',
       deposit_bank_status = 'in_attesa', deposit_bank_amount = NULL, updated_at = now()
  FROM public.outlets o
 WHERE o.id = c.outlet_id AND o.name = 'PALMANOVA' AND c.closing_date = '2026-01-31';

WITH somme AS (
  SELECT m.closing_id, sum(m.amount) tot, (min(m.bank_transaction_id::text))::uuid tx
  FROM public.closing_bank_matches m JOIN public.outlet_daily_closings c ON c.id = m.closing_id
  WHERE m.match_type = 'versamento' AND c.closing_date BETWEEN '2026-01-01' AND '2026-01-31' GROUP BY 1)
UPDATE public.outlet_daily_closings c
   SET deposit_bank_status = CASE WHEN abs(s.tot - c.cash_deposit) <= 0.01 THEN 'accreditato' ELSE 'differenza' END,
       deposit_bank_amount = s.tot, deposit_bank_transaction_id = COALESCE(c.deposit_bank_transaction_id, s.tx),
       bank_verified_at = now()
  FROM somme s WHERE s.closing_id = c.id;

SELECT public.match_cash_closings_with_bank((SELECT id FROM public.companies LIMIT 1), 265, 0.01);

SELECT count(*) FROM (
  SELECT public.project_cash_closing_to_daily_revenue(c.id)
  FROM public.outlet_daily_closings c WHERE c.closing_date BETWEEN '2026-01-01' AND '2026-01-31') t;

-- VERIFICA
-- SELECT count(*) chiusure, sum(total_receipts) incassi, sum(cash_deposit) versamenti
--   FROM public.outlet_daily_closings WHERE closing_date BETWEEN '2026-01-01' AND '2026-01-31';
--   atteso: 179 | 501525.44 | 86420.10
