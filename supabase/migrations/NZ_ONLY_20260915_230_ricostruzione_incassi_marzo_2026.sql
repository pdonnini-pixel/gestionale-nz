-- =====================================================================
-- NZ_ONLY 230 — Ricostruzione degli incassi giornalieri di MARZO 2026
-- ---------------------------------------------------------------------
-- Sesto mese ricostruito, dopo agosto (223), luglio (225), giugno (227),
-- maggio (228) e aprile (229). 191 chiusure, non 7x31: Torino apre il
-- 26/03 (6 giornate), Brugnato non ha il 19/03 e Barberino non ha il
-- 31/03 nel registro corrispettivi. I corrispettivi coincidono con
-- daily_revenue su tutte le 190 giornate che il registro conosce.
--
-- FONTI (Drive, cartella negozio/MARZO):
--   BARBERINO     SPECCHIETTO INCASSI MARZO 2026 BARBERINO.xlsx
--   VALDICHIANA   SPECCHIETTO INCASSI MARZO 2026 VALDICHIANA 1.xlsx
--   PALMANOVA     SPECCHIETTO INCASSI MARZO 2026 PALMANOVA.xlsx
--   BRUGNATO      SPECCHIETTO INCASSI MARZO 2026 BRUGNATO.xlsx
--   FRANCIACORTA  SPECCHIETTO INCASSI MARZO 2026 FRANCIACORTA.xlsx
--   TORINO        SPECCHIETTO INCASSI TORINO MARZO 2026.xlsx
--   VALMONTONE    Specchietto incassi MARZO 2026 VALMONTONE.xlsx
--
-- DECISIONI DOCUMENTATE:
--  1. Barberino 31/03 e' una giornata senza corrispettivi ma con un
--     versamento di 845,00: viene creata come is_closed_day, cosi' il
--     denaro che esce dalla cassa ha dove stare, e resta fuori dalla
--     proiezione in daily_revenue (nel registro quel giorno non esiste).
--  2. Brugnato 19/03 ha corrispettivi zero e non esiste nel registro:
--     non viene creata alcuna chiusura.
--  3. Lo specchietto di Brugnato ha le intestazioni sfalsate di una
--     colonna: quella etichettata VERSAMENTI contiene i contanti e quella
--     etichettata CONTANTI i versamenti. Verificato sui totali di riga e
--     sulla riga TOTALE del foglio.
--  4. Cinque versamenti di fine marzo escono dalla cassa ad aprile e sono
--     gia' registrati sulle chiusure di aprile create dalla 229:
--     Valdichiana 1.724,80 e Palmanova 1.690,00 (01/04), Valmontone 55,00
--     (01/04), Torino 80,00 (02/04), Franciacorta 85,00 (08/04). Qui
--     restano a zero, con la nota che dice dove sono.
--     Fa eccezione Barberino: la cassa continua data il suo versamento
--     31/03, quindi resta a marzo (punto 1).
--  5. Nove giornate non quadrano sullo specchietto e restano dichiarate.
--     Quattro sono di Brugnato (02, 07, 14, 18/03): in quel foglio, nei
--     giorni con una spesa, la colonna dei contanti e' gia' al netto
--     della spesa stessa, tranne il 07/03 dove il divario e' 85,00 contro
--     5,00 di spesa e non si spiega. Le altre: Barberino 27/03 (-46,55),
--     Franciacorta 12/03 (+57,12, annullato uno scontrino del 07/02),
--     Valmontone 18/03 (-86,55, incasso del 21/02 fiscalizzato il 18/03),
--     Palmanova 14/03 (-0,02) e 21/03 (-0,10), arrotondamenti.
--
-- ESITO: 25 versamenti dichiarati, 25 trovati in banca, nessuna
--        differenza. 185 chiusure su 191 verificate; le 6 che restano
--        hanno una riga POS in 'differenza' per sola commissione fra
--        l'1,6% e l'1,7% su importi piccoli (Barberino 30/03, Franciacorta
--        16/03, Palmanova 13/03, Valmontone 15/03 e 22/03): accrediti
--        veri, non ammanchi.
--
-- NO DATA LOSS: solo INSERT sulle chiusure. La proiezione in daily_revenue
-- riscrive righe esistenti con gli stessi gross_revenue (verificato prima)
-- e salta la giornata che nel registro non c'e'.
-- Applicata su NZ il 15/09/2026. Solo NZ.
-- =====================================================================

BEGIN;

CREATE TEMP TABLE _stg_incassi_marzo_2026 (
  outlet text, giorno date, incasso numeric, contanti numeric, mps numeric, mpsx numeric,
  bcc numeric, bccx numeric, pbl numeric, fatture numeric, bonifico numeric,
  spese numeric, spese_note text, versamento numeric, vers_note text, nota text) ON COMMIT DROP;

INSERT INTO _stg_incassi_marzo_2026 VALUES
('BARBERINO','2026-03-01',3802.4,886.5,2103.25,200.05,612.6,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-03-02',479.0,107.5,371.5,0,0,0,0,0,0,9.5,'SPESE IGIENE',0,NULL,NULL),
('BARBERINO','2026-03-03',527.4,175.7,351.7,0,0,0,0,0,0,0,NULL,2285.0,'24/02-02/03/2026 (1.299,80 contanti di febbraio + 985,20 contanti 1-2 marzo)',NULL),
('BARBERINO','2026-03-04',159.3,0.0,159.3,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-03-05',326.1,10.8,315.3,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-03-06',437.9,19.9,418.0,0,0,0,0,0,0,7.14,'FAMILY CENTER SF_194',0,NULL,NULL),
('BARBERINO','2026-03-07',1662.35,283.3,1046.05,0,333.0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-03-08',1275.18,127.9,975.58,0,171.7,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-03-09',418.45,0.0,418.45,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-03-10',414.9,128.5,286.4,0,0,0,0,0,0,0,NULL,610.0,'03-09/03/2026',NULL),
('BARBERINO','2026-03-11',248.2,57.4,190.8,0,0,0,0,0,0,36.01,'A UFFICIO MODERNO SF_170',0,NULL,NULL),
('BARBERINO','2026-03-12',74.1,6.9,67.2,0,0,0,0,0,0,5.57,'SPESE ORNAMENTALI',0,NULL,NULL),
('BARBERINO','2026-03-13',391.25,94.25,297.0,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-03-14',1832.03,79.8,1216.14,28.5,507.59,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-03-15',2029.26,665.35,1141.21,42.8,179.9,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-03-16',204.2,16.2,188.0,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-03-17',505.6,142.5,363.1,0,0,0,0,0,0,0,NULL,1070.0,'10-16/03/2026 (1.040,00 piu'' 30,00 di contanti in piu'' in cassa)',NULL),
('BARBERINO','2026-03-18',75.05,53.0,22.05,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-03-19',255.73,133.65,122.08,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-03-20',420.0,208.85,211.15,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-03-21',2451.65,264.55,1979.55,0,207.55,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-03-22',2812.84,433.7,1667.4,0,711.74,0,0,0,0,15.15,'A FAMILY CENTER SF_236',0,NULL,NULL),
('BARBERINO','2026-03-23',629.55,412.8,114.1,0,0,0,0,0,102.65,8.83,'SPESE ORNAMENTALI',0,NULL,NULL),
('BARBERINO','2026-03-24',341.8,65.8,110.5,0,0,0,0,0,165.5,0,NULL,1625.0,'17-23/03/2026',NULL),
('BARBERINO','2026-03-25',181.62,38.5,143.12,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-03-26',213.4,27.5,185.9,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-03-27',651.26,187.05,417.66,0,0,0,0,0,0,46.55,'A TEDI SF_2128000107',0,NULL,'giornata non quadrata sullo specchietto: canali 604.71 contro corrispettivi+fatture 651.26'),
('BARBERINO','2026-03-28',1315.95,231.45,933.05,0,151.45,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-03-29',2049.62,331.8,1158.02,82.0,477.8,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-03-30',185.65,0.0,315.55,0,0,0,0,129.9,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-03-31',0.0,0.0,0,0,0,0,0,0,0,0,NULL,845.0,'24-31/03/2026',NULL),
('VALDICHIANA','2026-03-01',5332.92,1180.75,4002.77,149.4,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-03-02',1041.48,416.6,624.88,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-03-03',853.72,21.9,831.82,0,0,0,0,0,0,0,NULL,1597.35,'01-02/03/2026',NULL),
('VALDICHIANA','2026-03-04',398.45,147.0,251.45,0,0,0,0,0,0,85.1,'DX SRL SF_152',0,NULL,NULL),
('VALDICHIANA','2026-03-05',873.87,130.1,743.77,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-03-06',1040.91,89.3,951.61,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-03-07',1933.33,127.2,1806.13,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-03-08',2870.37,572.1,2366.86,124.26,0,0,0,192.85,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-03-09',625.48,172.4,453.08,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-03-10',417.47,0.0,417.47,0,0,0,0,0,0,0,NULL,1174.9,'03-09/03/2026',NULL),
('VALDICHIANA','2026-03-11',710.8,0.0,710.8,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-03-12',2077.5,222.3,1855.2,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-03-13',334.0,122.0,212.0,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-03-14',2335.23,512.1,1680.81,142.32,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-03-15',2925.23,452.2,2473.03,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-03-16',656.05,228.5,427.55,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-03-17',705.85,77.1,628.75,0,0,0,0,0,0,0,NULL,1537.1,'10-16/03/2026',NULL),
('VALDICHIANA','2026-03-18',346.1,90.5,255.6,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-03-19',1049.53,286.7,762.83,0,0,0,0,0,0,27.7,'DX SRL SF_190',0,NULL,NULL),
('VALDICHIANA','2026-03-20',1357.17,100.0,1257.17,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-03-21',3674.42,611.05,3063.37,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-03-22',2725.65,456.25,2269.4,0,0,0,0,0,0,230.7,'RIMBORSO GALLO FEBBRAIO',0,NULL,NULL),
('VALDICHIANA','2026-03-23',1154.07,371.85,782.22,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-03-24',1045.67,100.0,945.67,0,0,0,0,0,0,0,NULL,1735.05,'17-23/03/2026',NULL),
('VALDICHIANA','2026-03-25',860.67,81.9,778.77,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-03-26',274.88,0.0,274.88,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-03-27',876.73,26.1,850.63,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-03-28',4009.52,256.3,3753.22,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-03-29',4327.44,520.85,3806.59,0,0,0,0,0,0,34.25,'DX SRL SF_209',0,NULL,NULL),
('VALDICHIANA','2026-03-30',936.12,641.2,294.92,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-03-31',749.75,132.7,617.05,0,0,0,0,0,0,0,NULL,0,'il versamento di 1.724,80 del 24-31/03 esce dalla cassa il 01/04: registrato sulla chiusura del 01/04',NULL),
('PALMANOVA','2026-03-01',1873.21,407.95,1443.56,21.7,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-03-02',297.9,85.2,212.7,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-03-03',324.07,52.8,271.27,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-03-04',473.94,59.4,414.54,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-03-05',731.0,283.55,447.45,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-03-06',970.31,0.0,970.31,0,0,0,0,0,0,40.55,'TEDI SF_2062000039',0,NULL,NULL),
('PALMANOVA','2026-03-07',1622.22,203.1,1394.22,0,24.9,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-03-08',1335.53,283.5,1052.03,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-03-09',570.19,379.95,190.24,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-03-10',556.57,210.6,345.97,0,0,0,0,0,0,0,NULL,1710.0,'01-09/03/2026',NULL),
('PALMANOVA','2026-03-11',114.8,19.9,94.9,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-03-12',281.89,84.6,197.29,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-03-13',767.2,238.9,528.3,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-03-14',950.54,14.8,852.37,0,83.35,0,0,0,0,0,NULL,0,NULL,'giornata non quadrata sullo specchietto: canali 950.52 contro corrispettivi+fatture 950.54'),
('PALMANOVA','2026-03-15',1614.23,54.6,1559.63,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-03-16',560.11,103.55,456.56,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-03-17',774.92,221.3,553.62,0,0,0,0,0,0,0,NULL,725.0,'10-16/03/2026',NULL),
('PALMANOVA','2026-03-18',387.41,228.9,158.51,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-03-19',629.72,141.3,488.42,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-03-20',889.12,160.5,728.62,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-03-21',1500.89,398.8,1101.99,0,0,0,0,0,0,0,NULL,0,NULL,'giornata non quadrata sullo specchietto: canali 1500.79 contro corrispettivi+fatture 1500.89'),
('PALMANOVA','2026-03-22',1857.0,511.9,1345.1,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-03-23',435.6,223.9,211.7,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-03-24',346.28,156.65,189.63,0,0,0,0,0,0,0,NULL,1885.0,'17-23/03/2026',NULL),
('PALMANOVA','2026-03-25',286.2,36.9,249.3,0,0,0,0,0,0,13.1,'TEDI SF_2062000059',0,NULL,NULL),
('PALMANOVA','2026-03-26',226.27,0.0,226.27,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-03-27',790.12,144.5,645.62,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-03-28',2049.31,706.95,1174.22,168.14,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-03-29',1228.93,74.75,1154.18,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-03-30',681.31,543.95,0,0,137.36,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-03-31',451.26,29.9,0,0,421.36,0,0,0,0,0,NULL,0,'il versamento di 1.690,00 del 24-31/03 e'' stato effettuato il 01/04: registrato sulla chiusura del 01/04',NULL),
('BRUGNATO','2026-03-01',3606.28,581.95,868.98,0,2155.35,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-03-02',570.44,82.65,382.44,0,0,0,0,0,0,105.35,'A SEGESAC SRL SF_515',0,NULL,'giornata non quadrata sullo specchietto: canali 465.09 contro corrispettivi+fatture 570.44'),
('BRUGNATO','2026-03-03',240.3,0.0,240.3,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-03-04',326.4,164.8,161.6,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-03-05',615.37,0.0,615.37,0,0,0,0,0,0,80.0,'A ELETTROMATIC SF_4',0,NULL,NULL),
('BRUGNATO','2026-03-06',266.23,24.5,241.73,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-03-07',1721.66,653.85,231.4,0,751.41,0,0,0,0,5.0,'A TEDI SF_2123000076',0,NULL,'giornata non quadrata sullo specchietto: canali 1636.66 contro corrispettivi+fatture 1721.66'),
('BRUGNATO','2026-03-08',1626.05,381.6,165.5,0,944.35,134.6,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-03-09',92.0,0.0,92.0,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-03-10',399.3,59.4,339.9,0,0,0,0,0,0,0,NULL,1890.0,'01-09/03/2026',NULL),
('BRUGNATO','2026-03-11',146.9,0.0,146.9,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-03-12',81.6,0.0,81.6,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-03-13',1146.88,0.0,1054.89,91.99,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-03-14',984.45,236.9,98.15,0,637.4,0,0,0,0,12.0,'A TEDI SF_2123000083',0,NULL,'giornata non quadrata sullo specchietto: canali 972.45 contro corrispettivi+fatture 984.45'),
('BRUGNATO','2026-03-15',1128.29,19.95,126.55,0,981.79,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-03-16',456.5,54.2,402.3,0,0,0,0,0,0,0,NULL,315.0,'10-15/03/2026',NULL),
('BRUGNATO','2026-03-17',87.39,0.0,87.39,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-03-18',471.0,72.93,356.8,0,0,0,0,0,0,41.28,'NUME SRL SF_A5 FPZDG0000606',0,NULL,'giornata non quadrata sullo specchietto: canali 429.73 contro corrispettivi+fatture 471.00'),
('BRUGNATO','2026-03-20',473.72,0.0,299.32,174.4,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-03-21',1567.14,378.2,368.41,0,820.53,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-03-22',1796.96,41.75,109.78,0,1645.43,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-03-23',353.9,0.0,353.9,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-03-24',241.6,159.7,81.9,0,0,0,0,0,0,0,NULL,545.0,'16-23/03/2026',NULL),
('BRUGNATO','2026-03-25',111.2,0.0,111.2,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-03-26',68.4,0.0,234.3,0,0,0,0,165.9,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-03-27',894.2,265.95,628.25,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-03-28',1750.91,245.55,111.22,0,1394.14,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-03-29',2412.59,963.2,349.96,0,1099.43,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-03-30',316.44,0.0,316.44,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-03-31',91.2,0.0,91.2,0,0,0,0,0,0,0,NULL,1635.0,'24-31/03/2026',NULL),
('FRANCIACORTA','2026-03-01',3651.63,378.4,3196.83,0,76.4,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-02',845.5,166.2,679.3,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-03',1036.3,270.6,765.7,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-04',793.1,26.3,766.8,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-05',631.9,48.9,583.0,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-06',863.12,15.0,821.72,0,0,26.4,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-07',3960.11,630.3,3329.81,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-08',4212.46,655.55,3415.77,0,0,141.14,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-09',269.1,102.25,166.85,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-10',631.97,105.8,526.17,0,0,0,0,0,0,0,NULL,2190.0,'01-08/03/2026',NULL),
('FRANCIACORTA','2026-03-11',287.58,69.3,218.28,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-12',660.29,53.3,664.11,0,0,0,0,0,0,0,NULL,0,NULL,'giornata non quadrata sullo specchietto: canali 717.41 contro corrispettivi+fatture 660.29 (annullato uno scontrino del 07/02 da 57,12)'),
('FRANCIACORTA','2026-03-13',663.69,0.0,663.69,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-14',1425.72,136.45,1289.27,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-15',2698.42,356.0,2342.42,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-16',298.2,0.0,298.2,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-17',995.94,0.0,995.94,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-18',432.7,294.45,138.25,0,0,0,0,0,0,11.02,'SPESE ORNAMENTALI',820.0,'09-16/03/2026',NULL),
('FRANCIACORTA','2026-03-19',594.21,133.0,461.21,0,0,0,0,0,0,27.9,'AM4 SRL SF_113',0,NULL,NULL),
('FRANCIACORTA','2026-03-20',1534.49,78.4,1368.1,0,87.99,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-21',1681.92,462.9,1219.03,0,0,0,0,0,0,0,NULL,0,NULL,'giornata non quadrata sullo specchietto: canali 1681.93 contro corrispettivi+fatture 1681.92'),
('FRANCIACORTA','2026-03-22',3640.94,519.0,3067.06,0,0,54.88,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-23',698.55,0.0,698.55,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-24',439.28,109.3,329.98,0,0,0,0,0,0,0,NULL,1450.0,'17-22/03/2026',NULL),
('FRANCIACORTA','2026-03-25',439.1,217.6,221.5,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-26',113.94,0.0,113.94,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-27',1025.48,254.55,770.93,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-28',2720.7,582.55,1982.07,0,0,156.08,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-29',2604.32,746.9,1672.78,0,184.64,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-30',753.87,108.75,513.72,0,0,131.4,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-03-31',329.47,84.2,210.97,0,34.3,0,0,0,0,0,NULL,2020.0,'23-30/03/2026',NULL),
('TORINO','2026-03-26',411.82,33.8,378.02,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('TORINO','2026-03-27',1963.54,295.75,1667.79,0,0,0,0,0,0,32.56,'A MF VOGUE SRL SF_176',0,NULL,NULL),
('TORINO','2026-03-28',4961.69,982.9,3784.5,194.29,0,0,0,0,0,79.55,'A TEDI COMMERCIO SF_2120000105',0,NULL,NULL),
('TORINO','2026-03-29',5165.68,733.35,4334.61,97.72,0,0,0,0,0,0,NULL,0,NULL,NULL),
('TORINO','2026-03-30',385.0,0.0,385.0,0,0,0,0,0,0,66.6,'A.B.N SRL SF_236 30,60 e TACCO E RIFATTO SF_5 36,00',0,NULL,NULL),
('TORINO','2026-03-31',900.9,83.9,817.0,0,0,0,0,0,0,0,NULL,1870.0,'26-30/03/2026',NULL),
('VALMONTONE','2026-03-01',2583.4,506.0,0,0,2077.4,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-02',521.55,240.05,281.5,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-03',873.4,271.0,602.4,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-04',379.11,217.4,161.71,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-05',991.79,12.9,948.99,29.9,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-06',368.07,46.5,321.57,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-07',1595.75,157.1,0,0,1438.65,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-08',1684.17,330.4,0,0,1353.77,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-09',408.1,59.8,348.3,0,0,0,0,0,0,0,NULL,1785.0,'01-08/03/2026',NULL),
('VALMONTONE','2026-03-10',193.7,86.9,106.8,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-11',451.21,0.0,121.21,330.0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-12',225.04,0.0,225.04,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-13',481.9,23.2,458.7,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-14',3499.8,834.2,2665.6,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-15',2512.8,330.9,25.0,0,1835.2,321.7,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-16',582.0,0.0,582.0,0,0,0,0,0,0,0,NULL,1335.0,'09-15/03/2026',NULL),
('VALMONTONE','2026-03-17',868.2,0.0,868.2,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-18',180.71,0.0,94.16,0,0,0,0,0,0,0,NULL,0,NULL,'giornata non quadrata sullo specchietto: canali 94.16 contro corrispettivi 180.71 (86,55 fiscalizzati il 18/03 ma incassati il 21/02)'),
('VALMONTONE','2026-03-19',830.38,326.6,503.78,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-20',495.68,267.7,227.98,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-21',1187.02,0.0,1187.02,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-22',1959.7,503.9,100.0,0,1355.8,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-23',1055.68,91.05,964.63,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-24',216.6,0.0,216.6,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-25',612.41,220.2,392.21,0,0,0,0,0,0,0,NULL,1190.0,'16-24/03/2026',NULL),
('VALMONTONE','2026-03-26',462.86,104.2,358.66,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-27',1773.21,742.1,1031.11,0,0,0,0,0,0,40.14,'UNIEURO SF_412 00494',0,NULL,NULL),
('VALMONTONE','2026-03-28',4666.92,1213.9,300.0,0,3028.07,124.95,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-29',4237.75,1014.05,168.27,0,3055.43,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-03-30',232.7,54.6,178.1,0,0,0,0,0,0,0,NULL,3250.0,'25-29/03/2026',NULL),
('VALMONTONE','2026-03-31',482.0,0.0,482.0,0,0,0,0,0,0,0,NULL,0,'il versamento di 55,00 del 30-31/03 esce dalla cassa il 01/04: registrato sulla chiusura del 01/04',NULL);

INSERT INTO public.outlet_daily_closings
  (company_id, outlet_id, closing_date, status, is_closed_day, total_receipts, cash_expenses, cash_expenses_note,
   cash_deposit, cash_deposit_note, closed_by_name, notes)
SELECT o.company_id, o.id, s.giorno, 'bozza',
       (s.incasso = 0 AND s.versamento > 0), s.incasso, s.spese, s.spese_note,
       s.versamento, s.vers_note, 'ricostruzione da specchietto',
       COALESCE(s.nota || ' | ', '') || 'ricostruzione marzo 2026 dallo specchietto incassi del punto vendita (Drive)'
FROM _stg_incassi_marzo_2026 s
JOIN public.outlets o ON o.name = s.outlet
WHERE NOT EXISTS (SELECT 1 FROM public.outlet_daily_closings c WHERE c.outlet_id = o.id AND c.closing_date = s.giorno);

WITH dati AS (
  SELECT c.id AS closing_id, c.company_id, c.outlet_id, x.label, x.amount
  FROM _stg_incassi_marzo_2026 s
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
FROM _stg_incassi_marzo_2026 s
JOIN public.outlets o ON o.name = s.outlet
JOIN public.outlet_daily_closings c ON c.outlet_id = o.id AND c.closing_date = s.giorno
WHERE s.spese > 0 AND NOT EXISTS (SELECT 1 FROM public.outlet_daily_closing_expenses e WHERE e.closing_id = c.id);

UPDATE public.outlet_daily_closings SET updated_at = now() WHERE closing_date BETWEEN '2026-03-01' AND '2026-03-31';
UPDATE public.outlet_daily_closings SET status = 'confermata', confirmed_at = now()
 WHERE closing_date BETWEEN '2026-03-01' AND '2026-03-31' AND status = 'bozza';

COMMIT;

-- Riscontro con la banca: a marzo il motore trova tutto da solo, nessun
-- aggancio manuale da fare
SELECT public.match_cash_closings_with_bank((SELECT id FROM public.companies LIMIT 1), 205, 0.01);

-- Proiezione nel registro corrispettivi. La JOIN su daily_revenue tiene
-- fuori Barberino 31/03, che nel registro non esiste (punto 1)
SELECT count(*) FROM (
  SELECT public.project_cash_closing_to_daily_revenue(c.id)
  FROM public.outlet_daily_closings c
  JOIN public.daily_revenue dr ON dr.outlet_id = c.outlet_id AND dr.date = c.closing_date
  WHERE c.closing_date BETWEEN '2026-03-01' AND '2026-03-31') t;

-- VERIFICA
-- SELECT count(*) chiusure, sum(total_receipts) incassi, sum(cash_deposit) versamenti
--   FROM public.outlet_daily_closings WHERE closing_date BETWEEN '2026-03-01' AND '2026-03-31';
--   atteso: 191 | 215851.71 | 37094.40
