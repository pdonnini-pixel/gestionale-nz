-- =====================================================================
-- NZ_ONLY 225 — Ricostruzione degli incassi giornalieri di LUGLIO 2026
-- ---------------------------------------------------------------------
-- Secondo passo della ricostruzione (dopo la 223 su agosto): serve a
-- chiudere il conto del contante, perche' i versamenti dei primi giorni
-- di agosto portavano in banca il contante di fine luglio.
--
-- A differenza di agosto, luglio ha un riscontro in piu': daily_revenue
-- conteneva gia' i corrispettivi di luglio da «Registro corrispettivi
-- (import storico 2026-09-09)». Gli specchietti dei negozi coincidono con
-- quel registro su TUTTI E 217 I GIORNI, al centesimo: la proiezione non
-- cambia un solo gross_revenue, aggiunge solo contanti/carte/altro.
--
-- FONTI (Drive, cartella negozio/LUGLIO):
--   BARBERINO     SPECCHIETTO INCASSI LUGLIO 2026 BARBERINO
--   FRANCIACORTA  SPECCHIETTO INCASSI LUGLIO 2026 FRANCIACORTA.xlsx
--   VALDICHIANA   SPECCHIETTO INCASSI LUGLIO 2026 VALDICHIANA - Copia - Copia.xlsx
--   PALMANOVA     SPECCHIETTI INCASSI LUGLIO 2026 PALMANOVA.xlsx
--   TORINO        SPECCHIETTO INCASSI TORINO LUGLIO 2026.xlsx
--   BRUGNATO      SPECCHIETTO INCASSI LUGLIO 26 BRUGNATO.xlsx
--   VALMONTONE    SPECCHIETTI INCASSI LUGLIO 2026 VALMONTONExlsx
--
-- DECISIONI DOCUMENTATE:
--  1. BRUGNATO non ha la colonna CONTANTI a luglio: il contante e' stato
--     ricavato per differenza (corrispettivi + fatture - altri canali).
--     Il 28/07 viene -4,90 per l'annullo scontrino annotato nel foglio:
--     scritto 0 e la differenza resta visibile in receipts_difference.
--  2. FRANCIACORTA: nel foglio due righe sono datate 9/6 e 27/6, ma stanno
--     in sequenza fra l'8/7 e il 10/7 e fra il 26/7 e il 28/7: sono il 9 e
--     il 27 luglio.
--  3. Versamenti di fine luglio accreditati a inizio agosto: quelli gia'
--     registrati sulle chiusure di agosto NON sono stati duplicati
--     (BARBERINO 1.420,00 del 03/08, VALDICHIANA 1.140,15 del 03/08,
--     TORINO 600,00 del 01/08, VALMONTONE 1.365,00 dentro i 2.400,00 del
--     03/08). Restano scritti nella nota della giornata del 31/07.
--     BRUGNATO 1.135,00 (27-31/07, accreditato il 03/08) era invece ancora
--     orfano e viene registrato sul 31/07.
--  4. FRANCIACORTA 08/07 e 22/07: la banca accredita piu' del dichiarato
--     (3.060,00 contro 2.455,00 e 3.035,00 contro 2.995,00). Il movimento
--     viene agganciato ma lo stato resta «differenza»: il dato del negozio
--     non si corregge d'ufficio.
--
-- ESITO DEL RISCONTRO BANCARIO:
--   31 versamenti dichiarati, 31 trovati in banca (29 esatti, 2 in
--   differenza su Franciacorta); 311 righe POS accreditate, 18 Amex,
--   6 righe con differenza; 211 chiusure su 217 verificate.
--   Tre versamenti erano spezzati in due operazioni allo stesso sportello
--   (TORINO 10/07 = 1.470 + 100, TORINO 21/07 = 2.880 + 100,
--   FRANCIACORTA 08/07 = 2.455 + 605) e sono stati agganciati a mano.
--
-- NO DATA LOSS: solo INSERT sulle chiusure. La proiezione in daily_revenue
-- riscrive righe gia' esistenti con gli stessi identici gross_revenue
-- (verificato giorno per giorno prima di eseguirla).
-- Applicata su NZ il 15/09/2026 via connettore Supabase. Solo NZ.
-- =====================================================================

BEGIN;

CREATE TEMP TABLE _stg_incassi_luglio_2026 (
  outlet text, giorno date, incasso numeric, contanti numeric, mps numeric, mpsx numeric,
  bcc numeric, bccx numeric, pbl numeric, fatture numeric, bonifico numeric,
  spese numeric, spese_note text, versamento numeric, vers_note text, nota text) ON COMMIT DROP;

INSERT INTO _stg_incassi_luglio_2026 VALUES
('BARBERINO','2026-07-01',832.15,306.5,525.65,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-07-02',2032.7,223.8,1808.9,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-07-03',1142.85,320.0,822.85,0.0,0.0,0.0,0.0,0.0,0.0,4.39,'SPESE IGIENE',0.0,NULL,NULL),
('BARBERINO','2026-07-04',5838.6,920.5,3889.6,101.9,926.6,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-07-05',7005.9,1251.9,4332.3,102.8,1318.9,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-07-06',1460.6,76.0,1336.6,48.0,0.0,0.0,0.0,0.0,0.0,3.98,'SPESE IGIENE',0.0,NULL,NULL),
('BARBERINO','2026-07-07',1112.0,203.9,793.7,0.0,0.0,0.0,0.0,0.0,114.4,0.0,NULL,3090.0,'30/06-06/07/2026',NULL),
('BARBERINO','2026-07-08',916.05,200.7,557.35,0.0,0.0,0.0,0.0,0.0,158.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-07-09',2489.2,346.5,2142.7,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-07-10',1883.95,541.95,1342.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-07-11',5802.41,663.7,4275.91,28.0,834.8,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-07-12',4767.25,666.7,3235.45,35.0,830.1,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-07-13',1262.5,165.6,1096.9,0.0,0.0,0.0,0.0,0.0,0.0,28.05,'FAMILY CENTER SF_666',0.0,NULL,NULL),
('BARBERINO','2026-07-14',698.85,88.9,609.95,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,2760.0,'07-13/07/2026',NULL),
('BARBERINO','2026-07-15',889.2,80.2,774.4,34.6,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-07-16',1453.2,364.75,1034.7,53.75,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-07-17',883.2,265.2,618.0,0.0,0.0,0.0,0.0,0.0,0.0,21.0,'MESTICHERIA E FERRAMENTA SF_252',0.0,NULL,NULL),
('BARBERINO','2026-07-18',4167.65,1064.1,2425.55,122.0,556.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-07-19',4060.6,878.0,3067.2,0.0,259.2,0.0,0.0,143.8,0.0,0.0,NULL,0.0,NULL,'Wasabi Srl'),
('BARBERINO','2026-07-20',1421.65,164.3,1257.35,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-07-21',1051.3,360.3,691.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,2884.0,'14-20/07/2026',NULL),
('BARBERINO','2026-07-22',1094.85,169.1,925.75,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-07-23',1522.41,264.75,1257.66,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-07-24',1462.1,436.3,943.9,81.9,0.0,0.0,0.0,0.0,0.0,8.75,'RESO A CLIENTE PER ERRORE SCONTRINO',0.0,NULL,NULL),
('BARBERINO','2026-07-25',5164.16,872.0,3155.22,178.84,958.1,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-07-26',6308.4,795.65,4523.8,76.7,1008.25,0.0,0.0,96.0,0.0,0.0,NULL,0.0,NULL,'Marco leather srl'),
('BARBERINO','2026-07-27',1105.4,157.7,947.7,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,2900.0,'21-26/07/2026',NULL),
('BARBERINO','2026-07-28',1135.32,315.6,819.72,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-07-29',786.5,244.3,542.2,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-07-30',1560.08,581.1,978.98,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('BARBERINO','2026-07-31',814.2,110.6,703.6,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,'contante 27-31/07 versato 1.420,00 il 03/08: gia'' registrato sulla chiusura del 03/08',NULL),
('FRANCIACORTA','2026-07-01',891.5,299.3,429.3,0,162.9,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-02',1254.1,62.7,1127.7,0,63.7,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-03',1483.44,383.3,986.7,0,113.44,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-04',8319.4,917.0,5691.4,0,1502.3,208.7,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-05',6123.2,790.9,4300.2,0,903.3,128.8,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-06',1444.65,259.75,1001.3,0,183.6,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-07',2447.37,736.5,1681.37,0,0.0,29.5,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-08',1677.4,612.4,965.4,0,99.6,0.0,0.0,0,0.0,0.0,NULL,2455.0,'01-05/07/2026',NULL),
('FRANCIACORTA','2026-07-09',1362.7,86.9,1275.8,0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-10',2285.41,190.0,2095.41,0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-11',5985.42,1203.1,4384.72,0,184.96,212.64,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-12',3336.85,1099.55,1887.0,0,350.3,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-13',1401.8,190.6,1211.2,0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-14',1224.6,393.5,659.4,0,171.7,0.0,0.0,0,0.0,0.0,NULL,4190.0,'06-12/07/2026',NULL),
('FRANCIACORTA','2026-07-15',767.4,57.6,580.9,0,41.9,87.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-16',2326.2,347.3,1978.9,0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-17',3012.1,594.6,2355.5,0,62.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-18',4899.5,676.2,3765.2,0,189.7,268.4,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-19',2655.61,734.8,1511.81,0,409.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-20',1997.7,473.2,1524.5,0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-21',1895.55,165.9,1729.65,0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-22',1906.65,148.3,1715.45,0,0.0,42.9,0.0,0,0.0,0.0,NULL,2995.0,'13-19/07/2026',NULL),
('FRANCIACORTA','2026-07-23',1499.6,431.6,1068.0,0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-24',2277.3,462.9,1636.7,0,177.7,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-25',4160.1,493.2,3576.0,0,90.9,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-26',4028.18,590.7,2948.28,0,335.3,153.9,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-27',2088.6,597.3,637.0,0,777.3,77.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-28',830.2,120.8,709.4,0,0.0,0.0,0.0,0,0.0,0.0,NULL,2740.0,'20-26/07/2026',NULL),
('FRANCIACORTA','2026-07-29',880.7,284.0,0.0,0,596.7,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-30',960.7,32.9,0.0,0,927.8,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('FRANCIACORTA','2026-07-31',1621.9,59.2,192.0,0,1370.7,0.0,0.0,0,0.0,0.0,NULL,1120.0,'27-31/07/2026',NULL),
('VALDICHIANA','2026-07-01',1771.45,214.2,1557.25,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-07-02',2336.3,614.6,1721.7,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-07-03',3059.57,209.8,2849.77,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-07-04',8078.97,1446.6,6583.47,48.9,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-07-05',8610.87,1196.35,4920.12,0.0,2320.4,174.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-07-06',2691.53,541.6,2149.93,0.0,0.0,0.0,0.0,0.0,0.0,25.05,'494/2026 dx srl',0.0,NULL,NULL),
('VALDICHIANA','2026-07-07',2759.4,537.2,2174.2,0.0,0.0,0.0,48.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-07-08',2722.6,333.1,2231.8,27.9,129.8,0.0,0.0,0.0,0.0,22.0,'errore scontrino',4735.3,'01-07/07/2026',NULL),
('VALDICHIANA','2026-07-09',2727.74,513.25,2144.59,69.9,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-07-10',3497.23,340.95,3047.26,109.02,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-07-11',8475.82,1993.15,6165.85,316.82,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-07-12',6796.1,962.0,5834.1,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-07-13',1684.5,283.8,1366.2,34.5,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-07-14',2573.5,354.1,1927.0,292.4,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-07-15',2328.1,268.8,1864.3,134.9,0.0,0.0,60.1,0.0,0.0,0.0,NULL,4758.35,'08-14/07/2026',NULL),
('VALDICHIANA','2026-07-16',1908.38,363.0,0.0,0.0,1835.98,0.0,0.0,290.6,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-07-17',3828.8,358.0,0.0,0.0,3470.8,0.0,0.0,0.0,0.0,120.0,'3zeta',0.0,NULL,NULL),
('VALDICHIANA','2026-07-18',4920.2,629.0,462.1,0.0,3732.5,96.6,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-07-19',5870.01,1190.4,2177.0,285.2,2217.41,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-07-20',1582.0,132.6,1449.4,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-07-21',1513.65,289.3,1272.25,0.0,0.0,0.0,0.0,47.9,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-07-22',2677.7,234.7,2443.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,3111.1,'15-21/07/2026',NULL),
('VALDICHIANA','2026-07-23',3218.95,552.8,2666.15,0.0,0.0,0.0,0.0,0.0,0.0,158.3,'fatt 550 dx srl',0.0,NULL,NULL),
('VALDICHIANA','2026-07-24',3275.77,821.9,2453.87,0.0,0.0,0.0,0.0,0.0,0.0,32.85,'fat 553 dx srl',0.0,NULL,NULL),
('VALDICHIANA','2026-07-25',5570.55,1180.5,4370.15,19.9,0.0,0.0,0.0,0.0,0.0,20.7,'FATT 558 DX SRL',0.0,NULL,NULL),
('VALDICHIANA','2026-07-26',8873.33,1822.9,7002.43,48.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-07-27',1782.4,391.9,1390.5,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-07-28',2181.16,259.7,1729.56,191.9,0.0,0.0,0.0,0.0,0.0,0.0,NULL,4792.85,'22-27/07/2026',NULL),
('VALDICHIANA','2026-07-29',1194.0,207.0,987.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-07-30',2254.8,356.95,1897.85,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALDICHIANA','2026-07-31',1181.25,316.5,86.3,0.0,778.45,0.0,0.0,0.0,0.0,0.0,NULL,0.0,'contante 28-31/07 versato 1.140,15: accreditato il 03/08 e gia'' registrato sulla chiusura del 01/08',NULL),
('PALMANOVA','2026-07-01',1808.5,372.6,1435.9,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-02',1437.9,160.1,1277.8,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-03',1934.1,263.8,1386.6,283.7,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-04',5264.62,1016.7,4247.92,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-05',3818.39,469.55,3348.84,0.0,0.0,0.0,0.0,0,0.0,9.8,'restituiti alla cliente in contanti per errore battitura scontrino',0.0,NULL,NULL),
('PALMANOVA','2026-07-06',2429.59,623.95,1805.64,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-07',1674.56,348.1,1326.46,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,2895.0,NULL,NULL),
('PALMANOVA','2026-07-08',2080.2,186.4,1893.8,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-09',1256.5,67.9,1188.6,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-10',3000.44,496.0,2504.44,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-11',3998.0,557.3,3440.7,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-12',3217.51,227.5,2951.01,39.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-13',1825.1,778.6,1046.5,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-14',1536.4,478.2,1058.2,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,2665.0,NULL,NULL),
('PALMANOVA','2026-07-15',884.22,206.4,677.82,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-16',1983.81,401.6,1582.21,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-17',2178.2,179.6,1998.6,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-18',2581.72,312.4,2269.32,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-19',2866.4,233.3,2633.1,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-20',2449.7,435.6,2014.1,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-21',1472.3,330.8,1141.5,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,2245.0,NULL,NULL),
('PALMANOVA','2026-07-22',1975.65,566.3,1409.35,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-23',2132.47,456.65,1675.82,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-24',1265.3,221.0,957.3,87.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-25',1709.1,95.2,1613.9,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-26',5022.55,1091.35,3931.2,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-27',1609.1,243.5,1365.6,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-28',665.99,0.0,771.99,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,3000.0,NULL,NULL),
('PALMANOVA','2026-07-29',1322.79,228.55,988.24,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-30',1398.2,376.7,790.1,231.4,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('PALMANOVA','2026-07-31',1606.03,153.55,1452.48,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,760.0,NULL,'versamento fine mese effettuato il 01/08/2026'),
('TORINO','2026-07-01',1298.4,156.7,1141.7,0.0,0.0,0.0,0.0,0.0,0.0,432.0,'A.B.N. SF_495',0.0,NULL,NULL),
('TORINO','2026-07-02',1189.9,14.1,1175.8,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-03',974.1,0.0,890.3,83.8,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-04',8240.8,425.2,1390.4,0.0,6425.2,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-05',8894.81,1248.5,7335.41,546.8,0.0,0.0,0.0,235.9,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-06',1386.0,158.4,1227.6,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-07',2208.5,215.4,1993.1,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-08',2253.9,618.3,1500.8,134.8,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-09',2884.5,255.5,2629.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-10',2007.8,290.5,1717.3,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,1570.0,'01-06/07/2026',NULL),
('TORINO','2026-07-11',6209.3,628.4,1080.6,48.9,4451.4,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-12',4910.21,717.8,4192.41,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-13',1478.0,677.1,800.9,0.0,0.0,0.0,0.0,0.0,0.0,54.25,'MF VOGUE SF_388',0.0,NULL,NULL),
('TORINO','2026-07-14',1066.16,205.2,860.96,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,3350.0,'07-13/07/2026',NULL),
('TORINO','2026-07-15',1479.6,179.4,1300.2,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-16',1529.2,86.8,1442.4,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-17',1367.05,198.6,1168.45,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-18',5962.6,1097.1,2768.2,296.9,1800.4,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-19',7102.0,1068.3,1455.8,0.0,4462.1,115.8,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-20',997.3,156.8,840.5,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-21',1552.4,242.8,1309.6,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,2980.0,'14-20/07/2026',NULL),
('TORINO','2026-07-22',1400.65,233.75,1166.9,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-23',2240.76,458.3,1667.96,114.5,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-24',2563.6,426.1,2080.8,164.4,0.0,0.0,0.0,107.7,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-25',3497.6,804.7,2409.1,230.8,0.0,0.0,53.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-26',6409.7,1193.2,5216.5,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-27',1521.8,96.3,1383.7,0.0,0.0,0.0,41.8,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-28',965.74,46.7,698.34,220.7,0.0,0.0,0.0,0.0,0.0,0.0,NULL,3470.0,'21-27/07/2026',NULL),
('TORINO','2026-07-29',957.62,225.95,655.57,76.1,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-30',1678.94,171.8,1401.62,105.52,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('TORINO','2026-07-31',1554.05,158.7,1395.35,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,'contante 28-31/07 versato 600,00 il 01/08: gia'' registrato sulla chiusura del 01/08',NULL),
('BRUGNATO','2026-07-01',522.21,78.0,444.21,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-07-02',1912.1,421.9,1490.2,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-07-03',339.1,0.0,339.1,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-07-04',3722.37,157.8,817.85,0.0,2746.72,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-07-05',5220.7,740.4,513.0,0.0,3733.5,233.8,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-07-06',2900.54,367.0,2533.54,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-07-07',1599.7,242.9,1356.8,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,1400.0,'01-05/07/2026',NULL),
('BRUGNATO','2026-07-08',2509.29,267.1,2242.19,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-07-09',1692.0,125.6,1518.4,48.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-07-10',1687.0,296.5,1390.5,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-07-11',2334.2,211.0,625.05,0.0,1414.65,83.5,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-07-12',3050.5,952.6,246.3,0.0,1851.6,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-07-13',1642.3,412.2,1126.1,104.0,0.0,0.0,0.0,0,0.0,0.0,NULL,2460.0,'06-12/07/2026',NULL),
('BRUGNATO','2026-07-14',858.92,112.1,678.22,68.6,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-07-15',1141.9,234.1,907.8,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-07-16',1631.59,182.0,1299.69,149.9,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-07-17',914.5,224.5,690.0,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-07-18',2422.8,848.1,287.9,0.0,1286.8,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-07-19',3119.37,508.4,222.17,0.0,2388.8,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-07-20',1053.0,174.6,717.7,160.7,0.0,0.0,0.0,0,0.0,0.0,NULL,2525.0,'13-19/07/2026',NULL),
('BRUGNATO','2026-07-21',2005.4,316.0,1689.4,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-07-22',904.09,84.8,819.29,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-07-23',1776.5,180.5,1547.1,48.9,0.0,0.0,0.0,0,0.0,15.45,'TEDI COMMERCIO SF_2123000234',0.0,NULL,NULL),
('BRUGNATO','2026-07-24',2603.2,600.7,2002.5,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-07-25',3741.15,449.0,705.36,0.0,2586.79,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-07-26',3801.9,656.6,496.3,0.0,2649.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-07-27',1282.0,314.5,967.5,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,2445.0,'20-26/07/2026',NULL),
('BRUGNATO','2026-07-28',320.9,0.0,325.8,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,'28/07: ANNULLO SCONTRINO 372,80 DEL 25/07'),
('BRUGNATO','2026-07-29',768.75,268.3,500.45,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,NULL),
('BRUGNATO','2026-07-30',1012.5,52.5,845.4,114.6,0.0,0.0,0.0,0,0.0,0.0,NULL,0.0,NULL,'29/07: 59,90 SEGNATO CONTANTE SU MODA - INVECE CARTA (ERRORE SELEZIONE)'),
('BRUGNATO','2026-07-31',990.9,452.1,538.8,0.0,0.0,0.0,0.0,0,0.0,0.0,NULL,1135.0,'versamento 27-31/07 effettuato il 03/08 (ATM 01030-3651)',NULL),
('VALMONTONE','2026-07-01',1505.55,226.8,1278.75,0.0,0.0,0.0,0.0,0.0,0.0,22.42,'SOGECO SRL SF_6',0.0,NULL,NULL),
('VALMONTONE','2026-07-02',990.48,15.9,974.58,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-03',2718.17,134.9,2406.67,176.6,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-04',6762.86,968.0,5639.06,155.8,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-05',8226.4,1474.7,6751.7,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-06',2002.84,452.3,1550.54,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,2800.0,'01-05/07/2026',NULL),
('VALMONTONE','2026-07-07',2385.28,301.8,0.0,0.0,1842.38,241.1,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-08',2421.28,330.55,0.0,0.0,2018.88,71.85,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-09',5123.99,811.8,4073.03,239.16,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-10',1566.15,423.95,1413.8,202.6,0.0,0.0,0.0,474.2,0.0,65.0,'IL CENTRO UFFICIO SF_570',0.0,NULL,NULL),
('VALMONTONE','2026-07-11',5727.44,661.9,5065.54,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-12',5822.61,632.6,5190.01,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-13',1564.56,232.9,1331.66,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,3550.0,'06-12/07/2026',NULL),
('VALMONTONE','2026-07-14',1952.26,200.45,1751.81,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-15',1898.56,406.9,1491.66,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-16',3539.38,814.2,2725.18,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-17',1275.19,48.0,1227.19,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-18',2979.41,30.0,0.0,0.0,2949.41,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-19',3741.54,642.05,3099.49,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-20',967.53,82.3,885.23,137.2,0.0,0.0,0.0,137.2,0.0,0.0,NULL,2375.0,'13-19/07/2026',NULL),
('VALMONTONE','2026-07-21',1357.18,606.3,750.88,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-22',1428.85,189.3,1184.75,54.8,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-23',4117.49,875.55,3170.78,71.16,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-24',1096.19,157.8,938.39,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-25',3617.28,357.75,3172.53,87.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-26',7345.95,1245.0,20.7,0.0,5644.86,435.39,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-27',1457.38,146.0,101.5,0.0,1074.18,135.7,0.0,0.0,0.0,72.9,'UNIEURO SF_412 01084',3515.0,'20-26/07/2026',NULL),
('VALMONTONE','2026-07-28',1108.66,73.45,1035.21,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-29',1205.97,135.8,1070.17,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-30',3365.39,933.6,2386.36,45.43,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,NULL,NULL),
('VALMONTONE','2026-07-31',1642.76,149.7,1493.06,0.0,0.0,0.0,0.0,0.0,0.0,0.0,NULL,0.0,'contante 27-31/07 versato 1.365,00 il 03/08: dentro i 2.400,00 della chiusura del 03/08',NULL);

-- 1. Chiusure
INSERT INTO public.outlet_daily_closings
  (company_id, outlet_id, closing_date, status, total_receipts, cash_expenses, cash_expenses_note,
   cash_deposit, cash_deposit_note, closed_by_name, notes)
SELECT o.company_id, o.id, s.giorno, 'bozza', s.incasso, s.spese, s.spese_note,
       s.versamento, s.vers_note, 'ricostruzione da specchietto',
       COALESCE(s.nota || ' | ', '') || 'ricostruzione luglio 2026 dallo specchietto incassi del punto vendita (Drive)'
FROM _stg_incassi_luglio_2026 s
JOIN public.outlets o ON o.name = s.outlet
WHERE NOT EXISTS (SELECT 1 FROM public.outlet_daily_closings c
                  WHERE c.outlet_id = o.id AND c.closing_date = s.giorno);

-- 2. Righe per canale
WITH dati AS (
  SELECT c.id AS closing_id, c.company_id, c.outlet_id, x.label, x.amount
  FROM _stg_incassi_luglio_2026 s
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

-- 3. Spese di cassa
INSERT INTO public.outlet_daily_closing_expenses (closing_id, company_id, outlet_id, amount, description, kind, sort_order)
SELECT c.id, c.company_id, c.outlet_id, s.spese,
       COALESCE(NULLIF(btrim(s.spese_note), ''), 'spesa di cassa da specchietto'), 'spesa', 1
FROM _stg_incassi_luglio_2026 s
JOIN public.outlets o ON o.name = s.outlet
JOIN public.outlet_daily_closings c ON c.outlet_id = o.id AND c.closing_date = s.giorno
WHERE s.spese > 0
  AND NOT EXISTS (SELECT 1 FROM public.outlet_daily_closing_expenses e WHERE e.closing_id = c.id);

UPDATE public.outlet_daily_closings SET updated_at = now()
 WHERE closing_date BETWEEN '2026-07-01' AND '2026-07-31';

UPDATE public.outlet_daily_closings
   SET status = 'confermata', confirmed_at = now()
 WHERE closing_date BETWEEN '2026-07-01' AND '2026-07-31' AND status = 'bozza';

COMMIT;

-- 4. Riscontro bancario
SELECT public.match_cash_closings_with_bank((SELECT id FROM public.companies LIMIT 1), 80, 0.01);

-- 5. I tre versamenti spezzati in piu' operazioni allo stesso sportello
WITH casi(outlet, giorno, pat) AS (VALUES
   ('TORINO','2026-07-10','%ATM 9750 il 10.07.2026%'),
   ('TORINO','2026-07-21','%ATM 9750 il 21.07.2026%'),
   ('FRANCIACORTA','2026-07-22','%ATM 01030-2121-22.07.2026%'),
   ('FRANCIACORTA','2026-07-08','%ATM 01030-2121-08.07.2026%')
), k AS (
  SELECT c.id closing_id, c.company_id, c.closing_date, casi.pat
  FROM casi JOIN public.outlets o ON o.name = casi.outlet
  JOIN public.outlet_daily_closings c ON c.outlet_id = o.id AND c.closing_date = casi.giorno::date
), tx AS (
  SELECT k.closing_id, k.company_id, k.closing_date, bt.id tx_id, bt.amount
  FROM k JOIN public.bank_transactions bt
    ON bt.company_id = k.company_id AND bt.amount > 0 AND bt.description ILIKE k.pat
   AND public.cash_bank_is_deposit(bt.description)
   AND NOT EXISTS (SELECT 1 FROM public.closing_bank_matches m WHERE m.bank_transaction_id = bt.id)
)
INSERT INTO public.closing_bank_matches (company_id, closing_id, line_id, bank_transaction_id, amount, match_type, reference_date, note)
SELECT company_id, closing_id, NULL, tx_id, amount, 'versamento', closing_date,
       'versamento accreditato in banca in piu'' operazioni allo stesso sportello'
FROM tx;

WITH somme AS (
  SELECT m.closing_id, sum(m.amount) tot, (min(m.bank_transaction_id::text))::uuid tx
  FROM public.closing_bank_matches m
  JOIN public.outlet_daily_closings c ON c.id = m.closing_id
  WHERE m.match_type = 'versamento' AND c.closing_date BETWEEN '2026-07-01' AND '2026-07-31'
  GROUP BY 1)
UPDATE public.outlet_daily_closings c
   SET deposit_bank_status = CASE WHEN abs(s.tot - c.cash_deposit) <= 0.01 THEN 'accreditato' ELSE 'differenza' END,
       deposit_bank_amount = s.tot, deposit_bank_transaction_id = COALESCE(c.deposit_bank_transaction_id, s.tx),
       bank_verified_at = now()
  FROM somme s WHERE s.closing_id = c.id;

SELECT public.match_cash_closings_with_bank((SELECT id FROM public.companies LIMIT 1), 80, 0.01);

-- 6. Proiezione in daily_revenue — SOLO dopo aver verificato che i corrispettivi
--    coincidano con il registro gia' presente (zero scarti su 217 giorni):
--    SELECT count(*) FROM _stg_incassi_luglio_2026 s
--      JOIN outlets o ON o.name = s.outlet
--      LEFT JOIN daily_revenue dr ON dr.outlet_id = o.id AND dr.date = s.giorno
--     WHERE dr.id IS NULL OR abs(s.incasso - dr.gross_revenue) > 0.005;   -- deve dare 0
SELECT count(*) FROM (
  SELECT public.project_cash_closing_to_daily_revenue(c.id)
  FROM public.outlet_daily_closings c
  WHERE c.closing_date BETWEEN '2026-07-01' AND '2026-07-31') t;
