-- =====================================================================
-- NZ_ONLY 223 — Ricostruzione degli incassi giornalieri di AGOSTO 2026
-- ---------------------------------------------------------------------
-- Agosto era l'unico mese senza chiusure di cassa: daily_revenue aveva
-- tutti i mesi da agosto 2025 a luglio 2026 e poi settembre, agosto no.
-- Le 217 giornate (7 punti vendita x 31 giorni) sono state ricostruite
-- dagli specchietti incassi dei negozi su Drive (un file per outlet,
-- cartella <OUTLET>/AGOSTO) e riscontrate con l'estratto conto.
--
-- FONTI (Drive, cartella negozio/AGOSTO):
--   BARBERINO     Specchietto incassi AGOSTO 2026.xlsx
--   VALDICHIANA   Specchietto incassi AGOSTO 2026 - Copia - Copia.xlsx
--   PALMANOVA     SPECCHIETTO AGOSTO.xlsx
--   FRANCIACORTA  SPECCHIETTO INCASSI AGOSTO 2026.xlsx
--   VALMONTONE    Specchietto incassi 1.xlsx  (versione con i versamenti)
--   TORINO        INCASSI TORINO AGOSTO 2026.xlsx
--   BRUGNATO      08 SPECCHIETTI INCASSI 2026 AGOSTO NUOVO.xlsx
-- I totali calcolati riga per riga coincidono con la riga TOTALE di ogni foglio.
--
-- DECISIONI DOCUMENTATE (i dati si ricavano dai documenti, non si chiedono):
--  1. FRANCIACORTA: la riga datata 1/9 nel foglio e' il 31/08. Lo dice la
--     banca: l'accredito POS MPS del 31/08 (962,06 netto) corrisponde ai
--     970,58 dichiarati, mentre l'accredito dell'01/09 (1.302,96) e' gia'
--     sulla chiusura del 01/09 caricata a settembre.
--  2. Versamenti gia' registrati sulle chiusure di settembre non vengono
--     duplicati ad agosto: FRANCIACORTA 3.660,00 e PALMANOVA 2.560,65,
--     entrambi accreditati l'01/09. Sulla giornata del 31/08 restano a 0
--     con nota.
--  3. Due versamenti presenti in banca e ASSENTI dallo specchietto sono
--     stati aggiunti: PALMANOVA 11/08 3.045,00 (VERS. GDO CC PALMANOVA) e
--     TORINO 25/08 2.180,00 (ATM 9750 Intesa). Senza di loro la cassa dei
--     due negozi non tornava per lo stesso importo.
--  4. Le spese di cassa vanno in outlet_daily_closing_expenses: il trigger
--     fn_cash_closing_compute ricalcola cash_expenses da quella tabella.
--
-- ESITO DEL RISCONTRO BANCARIO (match_cash_closings_with_bank):
--   30 versamenti dichiarati su 30 trovati in banca (73.000,50 EUR);
--   310 righe POS accreditate, 19 Amex, 8 righe con differenza;
--   211 chiusure su 217 verificate.
--   I due versamenti unici dello specchietto che la banca ha spezzato in
--   due operazioni (BRUGNATO 17/08 4.250 = 2.120 + 2.130, VALMONTONE 03/08
--   2.400 = 1.365 + 1.035) sono stati agganciati a mano: il motore cerca
--   un solo movimento di pari importo.
--
-- NO DATA LOSS: solo INSERT. Nessuna riga esistente e' stata toccata; le
-- chiusure di settembre non sono state modificate.
-- Applicata su NZ il 15/09/2026 via connettore Supabase. Solo NZ: e' dato
-- reale di New Zago (Made e Zago hanno i propri incassi).
-- =====================================================================

BEGIN;

CREATE TEMP TABLE _stg_incassi_agosto_2026 (
  outlet text, giorno date, incasso numeric, contanti numeric, mps numeric, mpsx numeric,
  bcc numeric, bccx numeric, pbl numeric, fatture numeric, bonifico numeric,
  spese numeric, spese_note text, versamento numeric, vers_note text, nota text) ON COMMIT DROP;

INSERT INTO _stg_incassi_agosto_2026 VALUES
('BARBERINO','2026-08-01',2421.72,374.6,1757.12,0.0,290.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-02',3397.5,719.0,2068.8,275.4,334.3,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-03',697.44,18.1,679.34,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,1420.0,NULL,NULL),
('BARBERINO','2026-08-04',1185.63,95.7,1089.93,0.0,0.0,0.0,0.0,0.0,0.0,16.66,NULL,1110.0,NULL,NULL),
('BARBERINO','2026-08-05',806.74,146.6,660.14,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-06',2228.75,319.05,1689.3,80.4,0.0,0.0,0.0,0.0,140.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-07',1288.1,463.4,824.7,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-08',2882.85,639.35,1844.7,19.9,378.9,0.0,0.0,0.0,0.0,15.43,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-09',3149.5,891.3,1771.3,42.0,444.9,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-10',1679.25,67.9,1611.35,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-11',1574.6,405.2,1169.4,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,2590.0,NULL,NULL),
('BARBERINO','2026-08-12',2237.65,588.2,1556.95,92.5,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-13',1940.56,577.65,1362.91,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-14',1877.1,336.2,1486.1,54.8,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-15',1477.5,461.9,996.1,19.5,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-16',2303.1,496.0,1360.0,130.9,316.2,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-17',2417.55,716.3,1671.25,30.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-18',2117.3,82.5,2048.8,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,3580.0,NULL,NULL),
('BARBERINO','2026-08-19',917.05,358.45,543.65,14.95,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-20',2724.1,889.35,1834.75,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-21',1614.4,138.55,1324.75,151.1,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-22',1837.25,278.05,1369.45,30.0,159.75,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-23',1707.45,329.3,1276.4,0.0,101.75,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-24',1481.1,278.6,1202.5,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,2075.0,NULL,NULL),
('BARBERINO','2026-08-25',1435.0,256.3,1178.7,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-26',697.95,146.75,474.7,0.0,16.5,0.0,0.0,0.0,60.0,0.0,NULL,0.0,NULL,'BONIFICO DDT N.746'),
('BARBERINO','2026-08-27',915.95,87.0,828.95,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-28',1061.5,273.0,788.5,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-29',2178.05,254.15,1511.8,47.0,365.1,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-30',2909.25,526.65,2268.9,0.0,113.7,0.0,0.0,0.0,0.0,33.55,NULL,0.0,NULL,NULL),
('BARBERINO','2026-08-31',625.7,193.0,406.8,0.0,0.0,0.0,0.0,0.0,25.9,0.0,NULL,0.0,NULL,'bonifico di mattia sestini non scontrinato a luglio'),
('VALDICHIANA','2026-08-01',6152.53,1191.5,739.55,0.0,4042.28,179.2,0.0,0.0,0.0,0.0,NULL,1140.15,NULL,NULL),
('VALDICHIANA','2026-08-02',4350.9,933.45,3304.95,52.5,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-08-03',1038.95,122.4,916.55,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-08-04',2037.62,293.1,1744.52,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-08-05',2342.95,388.05,19.9,41.9,1893.1,0.0,0.0,0.0,0.0,0.0,NULL,2600.45,NULL,NULL),
('VALDICHIANA','2026-08-06',2159.32,457.25,1631.87,70.2,0.0,0.0,0.0,0.0,0.0,60.0,NULL,0.0,NULL,'CLIMASERVICE LAVORI BAGNO'),
('VALDICHIANA','2026-08-07',2286.99,562.0,1724.99,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-08-08',4827.95,817.55,4010.4,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-08-09',5893.9,1392.5,4340.1,161.3,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-08-10',4122.26,659.25,3434.21,28.8,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-08-11',2332.04,406.5,1925.54,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,4200.0,NULL,'16,6 NON VERSATI MESSI IN FODO CASSA'),
('VALDICHIANA','2026-08-12',3574.85,428.7,0.0,0.0,3060.65,209.0,0.0,123.5,0.0,0.0,NULL,0.0,NULL,'aggiunti 16,6 su versan'),
('VALDICHIANA','2026-08-13',2784.65,391.95,2392.7,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-08-14',3118.75,704.7,2414.05,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-08-15',2439.17,553.6,1772.77,112.8,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-08-16',3841.19,551.1,3161.69,128.4,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-08-17',3888.34,807.8,2924.44,129.65,0.0,0.0,0.0,0.0,0.0,26.45,NULL,0.0,NULL,'DX SRL FATT 628/2026'),
('VALDICHIANA','2026-08-18',3320.63,717.25,2603.38,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,3860.95,NULL,NULL),
('VALDICHIANA','2026-08-19',2780.72,583.15,2197.57,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-08-20',2179.44,445.0,1734.44,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-08-21',3741.23,710.8,0.0,0.0,2968.53,61.9,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-08-22',4374.17,1004.55,3369.62,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-08-23',3938.02,1065.65,2793.87,78.5,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-08-24',1810.5,212.55,1437.15,160.8,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-08-25',1967.05,200.45,1742.6,24.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,4738.95,NULL,NULL),
('VALDICHIANA','2026-08-26',1664.7,507.4,1157.3,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-08-27',1431.55,263.4,1168.15,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-08-28',2164.45,103.5,2060.95,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-08-29',3185.1,688.1,2497.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-08-30',3280.54,509.6,2752.94,18.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-08-31',1064.9,226.0,838.9,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-01',2988.6,382.4,2606.2,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-02',1768.58,437.2,1196.48,134.9,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-03',970.03,343.4,626.63,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,1160.0,NULL,NULL),
('PALMANOVA','2026-08-04',1547.1,209.3,1337.8,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-05',927.4,296.7,630.7,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-06',1014.12,160.7,853.42,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-07',2110.58,318.3,776.6,0.0,1015.68,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-08',2863.59,836.1,1974.99,0.0,52.5,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-09',2338.54,544.0,1630.7,163.84,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-10',2062.84,684.0,1378.84,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-11',2399.68,625.8,1773.88,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,3045.0,'da estratto conto MPS (VERS. GDO CC PALMANOVA 11/08): assente nello specchietto',NULL),
('PALMANOVA','2026-08-12',2527.72,577.8,1949.92,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-13',1346.96,211.5,1135.46,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-14',1663.27,484.3,1139.97,39.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-15',1257.15,188.3,929.35,139.5,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-16',1301.45,173.35,1128.1,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-17',2812.43,549.1,2263.33,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-18',1491.5,514.15,769.35,208.0,0.0,0.0,0.0,0,0.0,0.0,NULL,2810.0,NULL,NULL),
('PALMANOVA','2026-08-19',1260.65,340.55,920.1,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-20',1571.06,313.1,1257.96,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-21',3190.21,717.8,2472.41,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-22',2466.07,272.35,2159.22,34.5,0.0,0.0,0.0,0,0.0,118.8,NULL,0.0,NULL,'FT. N. 599/2026 RISPARMIOCASA'),
('PALMANOVA','2026-08-23',1752.63,397.95,1354.68,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-24',511.63,113.2,398.43,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-25',2157.1,598.2,1540.95,17.95,0.0,0.0,0.0,0,0.0,0.0,NULL,2560.0,NULL,NULL),
('PALMANOVA','2026-08-26',1042.85,116.6,926.25,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-27',1051.59,294.15,757.44,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-28',1820.65,453.1,1367.55,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-29',3517.0,681.6,2835.4,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-30',1580.79,372.6,1208.19,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-08-31',1391.53,44.4,1347.13,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,'versamento 2.560,65 del 01/09 gia'' registrato sulla chiusura del 01/09','VERSAMENTO EFFETTUATO 01/09/2026'),
('FRANCIACORTA','2026-08-01',3243.53,329.55,2740.06,0,0.0,173.92,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-02',3663.16,491.7,2969.46,0,202.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-03',1921.99,746.0,894.29,0,46.0,235.7,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-04',1544.38,191.8,1352.58,0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-05',2144.66,130.7,1618.06,0,395.9,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-06',1181.7,180.0,1001.7,0,0.0,0.0,0.0,0,0.0,23.2,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-07',2037.4,275.0,1762.4,0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-08',3149.6,608.6,2397.5,0,143.5,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-09',3138.6,742.4,2217.9,0,178.3,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-10',2036.2,242.5,1714.7,0,15.0,64.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-11',1907.9,490.4,1417.5,0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-12',2116.91,382.4,1734.51,0,0.0,0.0,0.0,0,0.0,16.57,NULL,3670.0,NULL,NULL),
('FRANCIACORTA','2026-08-13',2766.7,544.0,2106.5,0,0.0,116.2,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-14',2435.2,657.6,1625.2,0,84.4,68.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-15',932.0,158.0,774.0,0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-16',1618.5,294.6,1300.1,0,0.0,23.8,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-17',2188.2,557.3,1429.0,0,0.0,201.9,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-18',1844.25,191.0,1653.25,0,0.0,0.0,0.0,0,0.0,0.0,NULL,2755.0,NULL,NULL),
('FRANCIACORTA','2026-08-19',1299.9,291.9,961.1,0,46.9,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-20',1409.0,117.4,1137.8,0,153.8,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-21',1991.95,313.3,1595.95,0,0.0,82.7,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-22',2317.52,325.2,1611.82,0,278.7,101.8,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-23',2485.66,324.5,2161.16,0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-24',1276.6,411.9,864.7,0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-25',951.0,206.7,744.3,0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-26',1197.4,387.2,771.2,0,39.0,0.0,0.0,0,0.0,0.0,NULL,2120.0,NULL,NULL),
('FRANCIACORTA','2026-08-27',1394.04,150.3,1109.24,0,0.0,134.5,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-28',2373.82,434.45,1807.53,0,0.0,67.2,64.64,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-29',3006.48,464.0,2412.68,0,129.8,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-30',2988.22,1033.75,1939.47,0,15.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-08-31',1594.38,568.4,970.58,0,55.4,0.0,0.0,0,0.0,0.0,NULL,0.0,'versamento 3.660,00 del 01/09 gia'' registrato sulla chiusura del 01/09','riga datata 1/9 nello specchietto: e'' il 31/08 (accredito POS MPS del 31/08 in banca)'),
('VALMONTONE','2026-08-01',2127.15,437.05,0.0,0.0,1690.1,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-02',3085.14,602.1,0.0,0.0,2483.04,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-03',920.41,262.8,657.61,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,2400.0,NULL,NULL),
('VALMONTONE','2026-08-04',658.86,210.9,422.06,25.9,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-05',1136.64,334.8,801.84,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-06',3941.08,1002.5,2938.58,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-07',1166.45,159.4,1007.05,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-08',2371.83,371.5,2000.33,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-09',3601.24,358.9,3218.34,24.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-10',3809.81,411.4,49.95,0.0,3348.46,0.0,0.0,0.0,0.0,0.0,NULL,2705.0,NULL,NULL),
('VALMONTONE','2026-08-11',2245.92,369.35,1876.57,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-12',2061.27,552.15,1306.22,0.0,0.0,0.0,202.9,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-13',2509.75,533.7,1976.05,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-14',1742.65,240.0,1271.4,231.25,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-15',1681.88,246.6,0.0,0.0,945.78,489.5,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-16',3629.02,757.7,0.0,0.0,2871.32,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-17',2701.6,289.35,2379.85,32.4,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-18',1797.27,469.0,1310.27,18.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,3400.0,NULL,NULL),
('VALMONTONE','2026-08-19',2515.39,377.6,1975.84,161.95,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-20',2002.54,291.65,1585.29,125.6,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-21',2144.68,563.85,1383.36,197.47,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-22',1271.35,118.5,1249.65,33.8,0.0,0.0,0.0,130.6,0.0,0.0,NULL,0.0,NULL,'fattura 130,60'),
('VALMONTONE','2026-08-23',1915.34,167.3,0.0,0.0,1542.69,205.35,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-24',791.35,230.35,561.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,1985.0,NULL,NULL),
('VALMONTONE','2026-08-25',743.32,268.45,474.87,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-26',1310.35,464.55,757.3,88.5,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-27',881.52,302.5,579.02,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-28',1118.0,201.9,916.1,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-29',1664.7,477.35,37.9,0.0,1149.45,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-30',2402.5,667.05,0.0,0.0,1735.45,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-08-31',571.65,329.65,242.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-01',3064.65,744.25,2267.9,52.5,0.0,0.0,0.0,0.0,0.0,0.0,NULL,600.0,NULL,NULL),
('TORINO','2026-08-02',3144.78,391.7,873.1,0.0,1879.98,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-03',256.6,0.0,256.6,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-04',1470.5,457.5,955.6,57.4,0.0,0.0,0.0,0.0,0.0,0.0,NULL,1140.0,NULL,NULL),
('TORINO','2026-08-05',1127.78,19.8,1107.98,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-06',1054.75,395.55,659.2,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-07',961.0,114.5,902.4,0.0,0.0,0.0,0.0,0.0,0.0,22.75,NULL,0.0,NULL,NULL),
('TORINO','2026-08-08',3230.3,475.1,1964.4,0.0,790.8,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-09',3753.2,296.2,3457.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-10',1519.1,214.7,1304.4,52.5,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-11',1007.9,102.9,905.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,1890.0,NULL,NULL),
('TORINO','2026-08-12',1140.3,60.0,1080.3,0.0,0.0,0.0,0.0,0.0,0.0,54.22,NULL,0.0,NULL,NULL),
('TORINO','2026-08-13',871.95,79.5,736.05,0.0,0.0,0.0,56.4,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-14',755.1,13.5,741.6,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-15',1205.75,224.9,400.05,0.0,337.2,38.5,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-16',2320.31,364.4,1305.66,0.0,650.25,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-17',2026.0,115.85,1879.15,31.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-18',1201.9,104.55,1097.35,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,900.0,NULL,NULL),
('TORINO','2026-08-19',1884.35,137.4,1746.95,65.9,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-20',1407.8,347.9,1059.9,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-21',1528.1,399.8,1128.3,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-22',1757.35,488.95,608.55,0.0,728.85,0.0,0.0,69.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-23',2857.1,280.25,1958.7,208.0,410.15,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-24',1587.15,418.55,1168.6,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-25',1312.89,124.5,1188.39,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,2180.0,'da estratto conto Intesa (ATM 9750 del 25/08): assente nello specchietto',NULL),
('TORINO','2026-08-26',1097.45,222.4,875.05,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-27',1298.9,40.0,1258.9,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-28',1892.1,540.5,1215.9,135.7,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-29',2150.5,77.2,2073.3,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-30',2768.1,197.75,2570.35,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-08-31',1038.75,474.65,564.1,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-01',2542.64,259.5,161.36,0.0,2121.78,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-02',2320.77,479.4,353.12,0.0,1488.25,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-03',984.59,125.6,858.99,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,740.0,'VERSAM DAL 01/08 AL 02/08',NULL),
('BRUGNATO','2026-08-04',989.75,139.25,850.5,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-05',729.06,114.45,614.61,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-06',1663.5,307.0,1356.5,0.0,0.0,0.0,0.0,0.0,0.0,10.2,'TEDI',0.0,NULL,NULL),
('BRUGNATO','2026-08-07',2169.55,520.75,1698.8,0.0,0.0,0.0,0.0,0.0,0.0,50.0,'RESO',0.0,NULL,NULL),
('BRUGNATO','2026-08-08',2090.25,267.4,812.85,39.0,971.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-09',2276.85,708.9,623.95,0.0,884.0,60.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-10',1382.78,211.5,1171.28,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-11',3129.54,592.2,2495.34,42.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-12',2675.79,153.0,2522.79,0.0,0.0,0.0,0.0,0.0,0.0,126.05,'BUFFETTI',0.0,NULL,NULL),
('BRUGNATO','2026-08-13',1928.99,300.0,1628.99,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-14',2353.19,230.3,2122.89,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-15',1216.99,109.5,103.76,0.0,1003.73,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-16',2764.2,660.95,879.24,37.99,1186.02,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-17',4165.75,874.65,3212.2,78.9,0.0,0.0,0.0,0.0,0.0,0.0,NULL,4250.0,'VERSAM DAL 03/08 AL 16/08',NULL),
('BRUGNATO','2026-08-18',1743.74,238.2,1505.54,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-19',1416.67,184.15,1232.52,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-20',3588.27,793.55,2794.72,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-21',3668.7,912.55,2756.15,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-22',1131.35,351.25,221.0,0.0,559.1,0.0,0.0,0.0,0.0,46.28,'NUME SF_A5 FPZDG0002267',0.0,NULL,NULL),
('BRUGNATO','2026-08-23',1190.04,202.6,152.6,0.0,834.84,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-24',1186.87,67.0,1119.87,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,3515.0,'VERSAM DAL 17/08 AL 23/08',NULL),
('BRUGNATO','2026-08-25',1885.46,219.6,1626.46,0.0,0.0,0.0,0.0,0.0,39.4,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-26',852.65,172.55,680.1,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-27',978.0,65.5,912.5,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-28',1283.62,143.8,1000.32,139.5,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-29',2502.24,894.8,357.92,0.0,1206.52,43.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-30',2529.59,298.1,291.49,32.0,1908.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-08-31',799.69,305.6,494.09,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,1860.0,'VERSAM DAL 24/08 AL 30/08',NULL);

-- 1. Chiusure (bozza: il trigger calcola canali, quadrature e fondo cassa)
INSERT INTO public.outlet_daily_closings
  (company_id, outlet_id, closing_date, status, total_receipts, cash_expenses, cash_expenses_note,
   cash_deposit, cash_deposit_note, closed_by_name, notes)
SELECT o.company_id, o.id, s.giorno, 'bozza', s.incasso, s.spese, s.spese_note,
       s.versamento, s.vers_note, 'ricostruzione da specchietto',
       COALESCE(s.nota || ' | ', '') || 'ricostruzione agosto 2026 dallo specchietto incassi del punto vendita (Drive)'
FROM _stg_incassi_agosto_2026 s
JOIN public.outlets o ON o.name = s.outlet
WHERE NOT EXISTS (SELECT 1 FROM public.outlet_daily_closings c
                  WHERE c.outlet_id = o.id AND c.closing_date = s.giorno);

-- 2. Righe per canale (una per canale attivo, anche a zero, come a settembre)
WITH dati AS (
  SELECT c.id AS closing_id, c.company_id, c.outlet_id, x.label, x.amount
  FROM _stg_incassi_agosto_2026 s
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
WHERE NOT EXISTS (SELECT 1 FROM public.outlet_daily_closing_lines l
                  WHERE l.closing_id = d.closing_id AND l.channel_id = ch.id);

-- 3. Spese di cassa (il trigger ricalcola cash_expenses da qui)
INSERT INTO public.outlet_daily_closing_expenses (closing_id, company_id, outlet_id, amount, description, kind, sort_order)
SELECT c.id, c.company_id, c.outlet_id, s.spese,
       COALESCE(NULLIF(btrim(s.spese_note), ''), 'spesa di cassa da specchietto'), 'spesa', 1
FROM _stg_incassi_agosto_2026 s
JOIN public.outlets o ON o.name = s.outlet
JOIN public.outlet_daily_closings c ON c.outlet_id = o.id AND c.closing_date = s.giorno
WHERE s.spese > 0
  AND NOT EXISTS (SELECT 1 FROM public.outlet_daily_closing_expenses e WHERE e.closing_id = c.id);

-- 4. Ricalcolo dei derivati e conferma (la ricostruzione non ha le foto:
--    la conferma e' d'ufficio, la prova e' lo specchietto + l'estratto conto)
UPDATE public.outlet_daily_closings SET updated_at = now()
 WHERE closing_date BETWEEN '2026-08-01' AND '2026-08-31';

UPDATE public.outlet_daily_closings
   SET status = 'confermata', confirmed_at = now()
 WHERE closing_date BETWEEN '2026-08-01' AND '2026-08-31' AND status = 'bozza';

COMMIT;

-- 5. Riscontro bancario e proiezione in daily_revenue (fuori transazione)
SELECT public.match_cash_closings_with_bank((SELECT id FROM public.companies LIMIT 1), 65, 0.01);

SELECT count(*) FROM (
  SELECT public.project_cash_closing_to_daily_revenue(c.id)
  FROM public.outlet_daily_closings c
  WHERE c.closing_date BETWEEN '2026-08-01' AND '2026-08-31') t;

-- 6. I due versamenti che la banca ha spezzato in due operazioni
WITH casi AS (
  SELECT c.id closing_id, c.company_id, c.closing_date, o.name,
         CASE WHEN o.name = 'BRUGNATO'
              THEN ARRAY['%VERSAMENTO BRUGNATO DAL 03-08 AL 09-08%','%VERSAMENTO BRUGNATO DAL 10-08 AL 16-08%']
              ELSE ARRAY['%ATM 01030-1745-03.08.2026-12.49%','%ATM 01030-1745-03.08.2026-12.51%'] END pat
  FROM public.outlet_daily_closings c JOIN public.outlets o ON o.id = c.outlet_id
  WHERE c.deposit_bank_status = 'mancante' AND c.closing_date BETWEEN '2026-08-01' AND '2026-08-31'
), tx AS (
  SELECT k.closing_id, k.company_id, k.closing_date, bt.id tx_id, bt.amount
  FROM casi k JOIN public.bank_transactions bt
    ON bt.company_id = k.company_id AND bt.amount > 0
   AND bt.transaction_date BETWEEN k.closing_date AND k.closing_date + 6
   AND (bt.description ILIKE k.pat[1] OR bt.description ILIKE k.pat[2])
   AND NOT EXISTS (SELECT 1 FROM public.closing_bank_matches m WHERE m.bank_transaction_id = bt.id)
)
INSERT INTO public.closing_bank_matches (company_id, closing_id, line_id, bank_transaction_id, amount, match_type, reference_date, note)
SELECT company_id, closing_id, NULL, tx_id, amount, 'versamento', closing_date,
       'versamento unico dello specchietto accreditato in banca in due operazioni'
FROM tx;

WITH somme AS (
  SELECT m.closing_id, sum(m.amount) tot, (min(m.bank_transaction_id::text))::uuid tx
  FROM public.closing_bank_matches m
  JOIN public.outlet_daily_closings c ON c.id = m.closing_id
  WHERE m.match_type = 'versamento' AND c.deposit_bank_status = 'mancante'
    AND c.closing_date BETWEEN '2026-08-01' AND '2026-08-31'
  GROUP BY 1)
UPDATE public.outlet_daily_closings c
   SET deposit_bank_status = CASE WHEN abs(s.tot - c.cash_deposit) <= 0.01 THEN 'accreditato' ELSE 'differenza' END,
       deposit_bank_amount = s.tot, deposit_bank_transaction_id = s.tx, bank_verified_at = now()
  FROM somme s WHERE s.closing_id = c.id;

SELECT public.match_cash_closings_with_bank((SELECT id FROM public.companies LIMIT 1), 65, 0.01);

-- VERIFICA
-- SELECT o.name, count(*) giorni, sum(c.total_receipts) corrispettivi, sum(c.cash_deposit) versamenti,
--        count(*) FILTER (WHERE c.status = 'verificata') verificate
--   FROM outlet_daily_closings c JOIN outlets o ON o.id = c.outlet_id
--  WHERE c.closing_date BETWEEN '2026-08-01' AND '2026-08-31' GROUP BY 1;
