-- =====================================================================
-- NZ_ONLY 229 — Ricostruzione degli incassi giornalieri di APRILE 2026
-- ---------------------------------------------------------------------
-- Quinto mese ricostruito, dopo agosto (223), luglio (225), giugno (227)
-- e maggio (228). 203 giornate: 7 punti vendita x 29 giorni, perche' il
-- 5 aprile (Pasqua) i negozi sono chiusi e la giornata non esiste nemmeno
-- nel registro corrispettivi. I corrispettivi coincidono con daily_revenue
-- su tutte e 203 le giornate, al centesimo.
--
-- FONTI (Drive, cartella negozio/APRILE):
--   BARBERINO     Specchietto incassi APRILE 2026 BARBERINO.xlsx
--   VALDICHIANA   Specchietto incassi APRILE 2026 VALDICHIANA.xlsx
--   PALMANOVA     Specchietto incassi APRILE 2026 PALMANOVA.xlsx
--   BRUGNATO      Specchietto incassi APRILE 2026 BRUGNATO.xlsx
--   FRANCIACORTA  SPECCHIETTO INCASSI FRANCIACORTA APRILE 2026.xlsx
--   TORINO        Specchietto incassi APRILE 2026 TORINO.xlsx
--   VALMONTONE    Specchietto incassi VALMONTONE APRILE 2026.xlsx
--
-- DECISIONI DOCUMENTATE:
--  1. Ad aprile i fogli hanno la colonna CONTANTI: si usa quella, non il
--     calcolo per differenza. Dove il foglio non quadra la differenza resta
--     dichiarata invece di essere nascosta (punto 5).
--  2. La colonna FATTURE degli specchietti e' un promemoria, non un mezzo
--     di pagamento: l'importo della fattura viaggia dentro un canale (POS
--     Amex per Barberino il 10/04, POS MPS per Valdichiana il 12/04).
--     Coerente con il calcolo del trigger, dove channels_total esclude il
--     tipo 'fattura' e la regola e' corrispettivi + fatture = canali.
--  3. Quattro versamenti di inizio aprile sono in banca ma assenti dagli
--     specchietti: e' contante di fine marzo (Palmanova 1.690,00 il 01/04,
--     Valmontone 55,00 il 01/04, Torino 80,00 il 02/04, Franciacorta 85,00
--     il 08/04, quest'ultimo versato allo stesso ATM un minuto prima dei
--     1.210,00 dichiarati). Registrati sulla giornata in cui il denaro
--     esce dalla cassa. Resta fuori il versamento Barberino di 845,00
--     accreditato il 01/04: la cassa continua lo data 31/03, quindi e' di
--     marzo e si aggancera' ricostruendo marzo.
--  4. Brugnato 15/04 e 21/04: la banca data i versamenti il giorno PRIMA
--     di quello dichiarato dal negozio (14/04 e 20/04). Terzo e quarto
--     caso dopo Torino 17/06 e Franciacorta 14/05: agganciati a mano,
--     perche' il riscontro automatico cerca solo in avanti.
--  5. Tre giornate non quadrano sullo specchietto e restano dichiarate:
--     Barberino 12/04 (-43,35: due scontrini pagati con carta, annullati
--     e rimborsati in contanti), Torino 13/04 (-142,50) e Valmontone 10/04
--     (+254,30, la colonna CONTANTI e' vuota).
--  6. Valdichiana 18/04: lo specchietto mette 79,90 di Amex nella colonna
--     MPS, ma l'accredito del 20/04 vale 247,30 = 167,40 (17/04) + 79,90 e
--     arriva sul terminale BCC 00001, come tutto il resto della giornata.
--     L'importo e' stato spostato sul canale POS BCC Amex.
--  7. I versamenti di fine aprile sono registrati sulle chiusure di MAGGIO,
--     perche' il denaro esce dalla cassa a maggio: Torino 250,00 e
--     Palmanova 930,00 il 01/05; Barberino 465,00, Valdichiana 417,65,
--     Brugnato 165,00 e Valmontone 540,00 il 04/05; Franciacorta 2.755,00
--     il 06/05 (2.070,00 del 20-26/04 piu' 685,00 del 27-30/04, versati
--     allo stesso ATM dei 2.045,00 di maggio).
--
-- DUE VERSAMENTI DICHIARATI E MAI ARRIVATI IN BANCA: Palmanova 1.995,00 e
-- Valdichiana 2.875,25, entrambi sul 28/04, per 4.870,25 complessivi. Non
-- esiste nessun accredito di quegli importi in nessuna data, e la cassa
-- continua dei due negozi non registra alcun versamento fra il 24/04 e il
-- 04/05. Restano a 'mancante': e' una segnalazione vera, da chiarire con
-- i negozi, non un difetto del riscontro.
--
-- ESITO: 30 versamenti dichiarati, 28 trovati in banca; 198 chiusure su
--        203 verificate; 3 giornate non quadrate (punto 5). Restano
--        'differenza' tre righe POS: Barberino 14/04 (-1,80%) e Valmontone
--        11/04 (-1,65%), commissione oltre la tolleranza su importi
--        piccoli, e Palmanova 30/04 (-89,63, -6,4%), che non e'
--        commissione e va guardata.
--
-- NO DATA LOSS: solo INSERT sulle chiusure. La proiezione in daily_revenue
-- riscrive righe esistenti con gli stessi gross_revenue (verificato prima).
-- Applicata su NZ il 15/09/2026. Solo NZ.
-- =====================================================================

BEGIN;

CREATE TEMP TABLE _stg_incassi_aprile_2026 (
  outlet text, giorno date, incasso numeric, contanti numeric, mps numeric, mpsx numeric,
  bcc numeric, bccx numeric, pbl numeric, fatture numeric, bonifico numeric,
  spese numeric, spese_note text, versamento numeric, vers_note text, nota text) ON COMMIT DROP;

INSERT INTO _stg_incassi_aprile_2026 VALUES
('BARBERINO','2026-04-01',277.06,34.9,242.16,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-04-02',187.98,0.0,187.98,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-04-03',1348.16,266.45,1081.71,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-04-04',2960.24,516.95,2206.69,0,236.6,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-04-06',1417.38,54.85,1072.53,0,290.0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-04-07',1026.57,69.0,957.57,0,0,0,0,0,0,0,NULL,870.0,'01-06/04/2026',NULL),
('BARBERINO','2026-04-08',216.41,0.0,216.41,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-04-09',1624.73,531.65,1093.08,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-04-10',1924.96,464.15,1460.81,484.0,0,0,0,484.0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-04-11',4642.25,886.7,2824.35,0,931.2,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-04-12',14033.34,2601.85,8208.11,252.98,3013.75,0,0,0,0,43.35,'resi in contanti su due scontrini annullati pagati con carta (20,70 + 22,65)',0,NULL,'giornata non quadrata sullo specchietto: canali 14076.69 contro corrispettivi+fatture 14033.34'),
('BARBERINO','2026-04-13',658.75,0.0,658.75,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-04-14',89.6,0.0,89.6,0,0,0,0,0,0,0,NULL,4500.0,'07-13/04/2026',NULL),
('BARBERINO','2026-04-15',198.5,59.9,138.6,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-04-16',485.65,143.75,341.9,0,0,0,0,0,0,10.75,'FAMILY CENTER SF_329',0,NULL,NULL),
('BARBERINO','2026-04-17',1068.76,122.2,946.56,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-04-18',2716.41,509.75,2097.76,0,108.9,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-04-19',3356.42,57.9,2919.07,0,379.45,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-04-20',523.0,79.0,444.0,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-04-21',457.5,0.0,395.3,0,0,0,0,0,62.2,0,NULL,960.0,'14-20/04/2026',NULL),
('BARBERINO','2026-04-22',388.85,0.0,388.85,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-04-23',410.3,69.0,341.3,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-04-24',309.55,80.45,229.1,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-04-25',4101.9,786.4,2429.2,0,886.3,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-04-26',2441.9,372.6,1703.2,78.9,287.2,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-04-27',809.5,259.3,550.2,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-04-28',691.6,72.5,619.1,0,0,0,0,0,0,0,NULL,1565.0,'21-27/04/2026',NULL),
('BARBERINO','2026-04-29',486.5,162.4,324.1,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BARBERINO','2026-04-30',742.21,232.1,510.11,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-04-01',969.64,27.6,942.04,0,0,0,0,0,0,0,NULL,1724.8,'ultimo versamento di marzo',NULL),
('VALDICHIANA','2026-04-02',1456.78,124.4,1297.73,34.65,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-04-03',3163.12,634.15,2528.97,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-04-04',4611.99,478.0,4133.99,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-04-06',4071.04,948.5,3072.64,49.9,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-04-07',2044.47,205.75,1838.72,0,0,0,0,0,0,0,NULL,2212.65,'01-06/04/2026',NULL),
('VALDICHIANA','2026-04-08',744.1,172.95,571.15,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-04-09',1343.43,616.7,726.73,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-04-10',2156.43,280.3,1876.13,0,0,0,0,0,0,166.7,'RIMBORSO GALLO MAR 26',0,NULL,NULL),
('VALDICHIANA','2026-04-11',5639.7,1089.8,4471.11,78.79,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-04-12',6567.96,873.15,6015.7,29.0,0,0,0,349.89,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-04-13',784.25,163.65,620.6,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-04-14',1128.12,285.85,842.27,0,0,0,0,0,0,0,NULL,3235.6,'07-13/04/2026',NULL),
('VALDICHIANA','2026-04-15',1045.84,81.8,964.04,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-04-16',1857.99,145.95,1712.04,0,0,0,0,0,0,4.0,'LAVANDERIA LA PIUMA SF_16',0,NULL,NULL),
('VALDICHIANA','2026-04-17',831.1,19.9,0,0,643.8,167.4,0,0,0,40.9,'dx srl SF_255/2026',0,NULL,NULL),
('VALDICHIANA','2026-04-18',4533.42,185.35,0,79.9,4268.17,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-04-19',6027.48,1295.0,4364.88,0,367.6,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-04-20',1188.8,117.7,1071.1,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-04-21',891.55,0.0,891.55,0,0,0,0,0,0,0,NULL,2086.65,'14-20/04/2026',NULL),
('VALDICHIANA','2026-04-22',1962.13,158.9,1803.23,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-04-23',1827.91,246.95,1580.96,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-04-24',2127.04,852.9,0,0,1274.14,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-04-25',6479.3,881.7,0,0,5165.41,432.19,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-04-26',4439.85,663.3,0,0,3776.55,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-04-27',1931.19,71.5,1859.69,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-04-28',630.82,54.2,576.62,0,0,0,0,0,0,0,NULL,2875.25,'21-27/04/2026',NULL),
('VALDICHIANA','2026-04-29',1578.69,171.6,1263.59,143.5,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALDICHIANA','2026-04-30',2728.38,228.35,2500.03,0,0,0,0,0,0,36.5,'LAVANDERIA LA PIUMA SF_19',0,NULL,NULL),
('PALMANOVA','2026-04-01',992.59,92.7,899.89,0,0,0,0,0,0,0,NULL,1690.0,'versamento del 01/04 in cassa continua: contante di fine marzo, assente dallo specchietto',NULL),
('PALMANOVA','2026-04-02',1017.03,0.0,1017.03,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-04-03',2206.48,479.7,1726.78,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-04-04',1050.63,77.2,973.43,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-04-06',2472.31,724.05,1748.26,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-04-07',1128.88,264.25,722.23,0,142.4,0,0,0,0,0,NULL,1370.0,'01-06/04/2026',NULL),
('PALMANOVA','2026-04-08',674.66,259.65,415.01,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-04-09',1311.09,398.4,912.69,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-04-10',1802.41,582.65,1219.76,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-04-11',2273.61,334.3,1939.31,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-04-12',3582.47,485.75,3096.72,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-04-13',664.67,458.95,205.72,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-04-14',469.54,260.6,208.94,0,0,0,0,0,0,0,NULL,2780.0,'07-13/04/2026',NULL),
('PALMANOVA','2026-04-15',1075.89,166.6,909.29,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-04-16',592.2,0.0,592.2,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-04-17',1216.37,195.8,1020.57,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-04-18',2193.72,459.45,1698.47,35.8,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-04-19',1485.65,613.5,739.75,132.4,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-04-20',563.29,0.0,563.29,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-04-21',479.49,31.9,447.59,0,0,0,0,0,0,0,NULL,1695.0,'14-20/04/2026',NULL),
('PALMANOVA','2026-04-22',647.16,74.1,573.06,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-04-23',661.46,175.75,485.71,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-04-24',1244.0,397.55,846.45,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-04-25',2547.81,600.8,1749.37,197.64,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-04-26',3837.31,332.04,3505.27,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-04-27',1583.7,385.6,1198.1,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-04-28',323.79,191.5,132.29,0,0,0,0,0,0,0,NULL,1995.0,'dichiarato dallo specchietto, nessun accredito corrispondente in banca',NULL),
('PALMANOVA','2026-04-29',1692.65,670.3,1022.35,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('PALMANOVA','2026-04-30',1446.72,54.8,1391.92,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-01',310.19,93.5,216.69,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-02',525.09,0.0,525.09,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-03',1249.66,464.8,784.86,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-04',1357.37,186.65,125.76,0,1044.96,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-06',1315.04,120.5,1194.54,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-07',782.1,79.0,703.1,0,0,0,0,0,0,6.0,'SPESE CARTOLERIA',940.0,'01-08/04/2026',NULL),
('BRUGNATO','2026-04-08',200.44,0.0,200.44,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-09',946.06,157.65,788.41,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-10',1391.92,186.8,1118.46,86.66,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-11',4971.66,1097.95,680.96,0,3112.95,79.8,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-12',4737.42,1355.95,506.27,0,2674.88,200.32,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-13',441.58,160.9,280.68,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-14',297.7,0.0,297.7,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-15',764.69,278.65,486.04,0,0,0,0,0,0,12.0,'A TEDI COMMERCIO SF_2123000119',2960.0,'09-13/04/2026',NULL),
('BRUGNATO','2026-04-16',489.25,122.5,366.75,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-17',369.88,41.55,328.33,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-18',2894.59,164.25,721.38,0,2008.96,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-19',2712.28,723.8,415.01,0,1573.47,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-20',528.1,43.9,484.2,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-21',562.4,87.4,475.0,0,0,0,0,0,0,0,NULL,1315.0,'14-19/04/2026',NULL),
('BRUGNATO','2026-04-22',299.34,0.0,299.34,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-23',227.2,0.0,227.2,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-24',885.2,0.0,703.5,181.7,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-25',1122.0,136.7,96.8,0,888.5,0,0,0,0,54.91,'A NUME SRL SF_957',0,NULL,NULL),
('BRUGNATO','2026-04-26',3544.83,414.6,618.23,0,2512.0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-27',745.34,364.5,380.84,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-28',119.0,0.0,119.0,0,0,0,0,0,0,0,NULL,995.0,'20-27/04/2026',NULL),
('BRUGNATO','2026-04-29',674.98,0.0,674.98,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('BRUGNATO','2026-04-30',869.35,166.7,702.65,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-04-01',667.65,69.3,598.35,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-04-02',524.87,126.35,398.52,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-04-03',2791.08,258.55,2532.53,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-04-04',3728.36,497.25,3003.16,0,227.95,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-04-06',1487.88,85.3,1208.82,0,0,193.76,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-04-07',1037.42,184.2,853.22,0,0,0,0,0,0,11.0,'GIUSTACCHINI SF_1297',0,NULL,NULL),
('FRANCIACORTA','2026-04-08',1123.33,29.6,916.43,0,0,177.3,0,0,0,0,NULL,1295.0,'01-07/04/2026 (1.210,00 dichiarati + 85,00 di chiusura marzo versati allo stesso ATM un minuto prima)',NULL),
('FRANCIACORTA','2026-04-09',1477.35,91.3,1386.05,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-04-10',2106.37,375.5,1730.87,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-04-11',5305.07,648.85,4656.22,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-04-12',6553.71,1069.55,5400.93,0,34.93,48.3,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-04-13',407.95,183.95,224.0,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-04-14',536.93,170.0,366.93,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-04-15',769.3,329.65,439.65,0,0,0,0,0,0,0,NULL,2215.0,'08-12/04/2026',NULL),
('FRANCIACORTA','2026-04-16',1442.01,95.85,1346.16,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-04-17',788.23,38.25,552.68,0,197.3,0,0,0,0,11.4,'AM4 SRL SF_159',0,NULL,NULL),
('FRANCIACORTA','2026-04-18',2466.36,170.15,1974.52,0,321.69,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-04-19',3256.35,769.8,2103.26,0,383.29,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-04-20',1450.05,536.1,854.15,0,59.8,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-04-21',1281.88,343.1,758.52,0,180.26,0,0,0,0,0,NULL,1690.0,'13-19/04/2026 (lo specchietto annota 57,00 versati in meno, recuperati in una settimana precedente)',NULL),
('FRANCIACORTA','2026-04-22',855.67,175.6,680.07,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-04-23',911.71,52.0,647.31,0,212.4,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-04-24',2825.59,107.9,2717.69,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-04-25',3885.97,747.3,3088.77,0,0,49.9,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-04-26',2597.74,107.8,1908.44,0,539.5,42.0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-04-27',1184.63,24.9,1159.73,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-04-28',208.4,26.8,151.7,0,29.9,0,0,0,0,0,NULL,0,'i 2.070,00 del periodo 20-26/04 sono usciti dalla cassa il 06/05: registrati sulla chiusura del 06/05',NULL),
('FRANCIACORTA','2026-04-29',999.14,66.8,372.3,0,560.04,0,0,0,0,0,NULL,0,NULL,NULL),
('FRANCIACORTA','2026-04-30',1694.01,565.2,1087.71,0,8.2,32.9,0,0,0,0,NULL,0,NULL,NULL),
('TORINO','2026-04-01',1413.7,364.4,1049.3,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('TORINO','2026-04-02',719.28,93.3,625.98,0,0,0,0,0,0,0,NULL,80.0,'versamento allo sportello automatico del 02/04: contante di fine marzo, assente dallo specchietto',NULL),
('TORINO','2026-04-03',1270.11,207.15,1062.96,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('TORINO','2026-04-04',3419.82,107.7,3312.12,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('TORINO','2026-04-06',1446.3,288.6,1070.58,87.12,0,0,0,0,0,0,NULL,0,NULL,NULL),
('TORINO','2026-04-07',726.0,52.7,673.3,0,0,0,0,0,0,0,NULL,1060.0,'01-06/04/2026',NULL),
('TORINO','2026-04-08',752.19,0.0,752.19,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('TORINO','2026-04-09',823.2,116.6,588.6,118.0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('TORINO','2026-04-10',701.7,234.7,467.0,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('TORINO','2026-04-11',4623.03,1704.55,2918.48,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('TORINO','2026-04-12',2709.9,208.9,2501.0,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('TORINO','2026-04-13',595.72,114.1,624.12,0,0,0,0,0,0,0,NULL,0,NULL,'giornata non quadrata sullo specchietto: canali 738.22 contro corrispettivi+fatture 595.72'),
('TORINO','2026-04-14',949.6,196.6,753.0,0,0,0,0,0,0,0,NULL,2290.0,'07-13/04/2026',NULL),
('TORINO','2026-04-15',533.23,79.0,388.23,0,66.0,0,0,0,0,0,NULL,0,NULL,NULL),
('TORINO','2026-04-16',749.98,10.0,637.3,102.68,0,0,0,0,0,0,NULL,0,NULL,NULL),
('TORINO','2026-04-17',1375.0,34.3,962.6,378.1,0,0,0,0,0,0,NULL,0,NULL,NULL),
('TORINO','2026-04-18',2734.15,494.0,2240.15,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('TORINO','2026-04-19',2545.12,520.05,1890.27,134.8,0,0,0,0,0,23.9,'A TEDI COMMERCIO SF_21200000134',0,NULL,NULL),
('TORINO','2026-04-20',412.88,39.5,373.38,0,0,0,0,0,0,26.7,'A MF VOGUE SRL SF_222',0,NULL,NULL),
('TORINO','2026-04-21',568.0,33.0,535.0,0,0,0,0,0,0,0,NULL,1320.0,'14-20/04/2026',NULL),
('TORINO','2026-04-22',789.55,451.65,337.9,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('TORINO','2026-04-23',1391.4,402.0,989.4,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('TORINO','2026-04-24',1449.39,0.0,1449.39,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('TORINO','2026-04-25',6251.71,1160.8,5025.41,65.5,0,0,0,0,0,0,NULL,0,NULL,NULL),
('TORINO','2026-04-26',3946.72,491.65,3330.12,124.95,0,0,0,0,0,0,NULL,0,NULL,NULL),
('TORINO','2026-04-27',1378.53,142.15,1236.38,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('TORINO','2026-04-28',1247.71,161.4,1086.31,0,0,0,0,0,0,0,NULL,2680.0,'21-27/04/2026',NULL),
('TORINO','2026-04-29',934.91,86.25,764.71,83.95,0,0,0,0,0,0,NULL,0,NULL,NULL),
('TORINO','2026-04-30',903.38,0.05,903.33,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-04-01',836.25,0.0,836.25,0,0,0,0,0,0,0,NULL,55.0,'versamento all''ATM del 01/04: contante di fine marzo, assente dallo specchietto',NULL),
('VALMONTONE','2026-04-02',808.75,67.75,532.0,0,0,0,209.0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-04-03',1954.98,326.65,1628.33,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-04-04',3071.38,735.7,0,0,2335.68,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-04-06',1996.92,642.6,1097.58,256.74,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-04-07',741.17,29.9,678.02,33.25,0,0,0,0,0,0,NULL,1775.0,'01-06/04/2026',NULL),
('VALMONTONE','2026-04-08',1013.61,123.3,890.31,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-04-09',1831.17,523.9,1307.27,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-04-10',2001.74,0.0,1683.6,63.84,0,0,0,0,0,0,NULL,0,NULL,'giornata non quadrata sullo specchietto: canali 1747.44 contro corrispettivi+fatture 2001.74'),
('VALMONTONE','2026-04-11',6341.03,1143.9,121.56,0,4982.47,93.1,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-04-12',10569.3,3000.6,7316.27,252.43,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-04-13',366.03,69.9,296.13,0,0,0,0,0,0,0,NULL,5075.0,'07-12/04/2026',NULL),
('VALMONTONE','2026-04-14',637.74,98.4,539.34,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-04-15',1287.19,700.35,586.84,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-04-16',1573.65,310.7,1193.05,69.9,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-04-17',2085.78,506.0,1579.78,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-04-18',7109.8,1568.45,0,0,5415.04,126.31,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-04-19',5637.24,1263.6,4362.74,10.9,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-04-20',1517.44,565.1,952.34,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-04-21',1979.52,302.8,1676.72,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-04-22',640.37,0.0,640.37,0,0,0,0,0,0,0,NULL,5385.0,'13-21/04/2026',NULL),
('VALMONTONE','2026-04-23',1022.85,267.1,656.75,99.0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-04-24',875.55,303.2,572.35,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-04-25',6083.68,974.1,0,0,5073.88,35.7,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-04-26',4347.95,667.45,3354.7,325.8,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-04-27',574.34,0.0,507.54,0,0,0,66.8,0,0,0,NULL,2210.0,'22-26/04/2026',NULL),
('VALMONTONE','2026-04-28',625.18,11.8,613.38,0,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-04-29',1205.04,324.0,848.14,32.9,0,0,0,0,0,0,NULL,0,NULL,NULL),
('VALMONTONE','2026-04-30',1312.12,203.2,1108.92,0,0,0,0,0,0,0,NULL,0,NULL,NULL);

INSERT INTO public.outlet_daily_closings
  (company_id, outlet_id, closing_date, status, total_receipts, cash_expenses, cash_expenses_note,
   cash_deposit, cash_deposit_note, closed_by_name, notes)
SELECT o.company_id, o.id, s.giorno, 'bozza', s.incasso, s.spese, s.spese_note,
       s.versamento, s.vers_note, 'ricostruzione da specchietto',
       COALESCE(s.nota || ' | ', '') || 'ricostruzione aprile 2026 dallo specchietto incassi del punto vendita (Drive)'
FROM _stg_incassi_aprile_2026 s
JOIN public.outlets o ON o.name = s.outlet
WHERE NOT EXISTS (SELECT 1 FROM public.outlet_daily_closings c WHERE c.outlet_id = o.id AND c.closing_date = s.giorno);

WITH dati AS (
  SELECT c.id AS closing_id, c.company_id, c.outlet_id, x.label, x.amount
  FROM _stg_incassi_aprile_2026 s
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
FROM _stg_incassi_aprile_2026 s
JOIN public.outlets o ON o.name = s.outlet
JOIN public.outlet_daily_closings c ON c.outlet_id = o.id AND c.closing_date = s.giorno
WHERE s.spese > 0 AND NOT EXISTS (SELECT 1 FROM public.outlet_daily_closing_expenses e WHERE e.closing_id = c.id);

-- Punto 6: l'Amex del 18/04 di Valdichiana sta sul terminale BCC, non su MPS
WITH c AS (
  SELECT cl.id FROM public.outlet_daily_closings cl JOIN public.outlets o ON o.id = cl.outlet_id
   WHERE o.name = 'VALDICHIANA' AND cl.closing_date = '2026-04-18'
)
UPDATE public.outlet_daily_closing_lines l
   SET amount = CASE WHEN ch.label = 'POS BCC Amex' THEN 79.90 ELSE 0 END,
       bank_status = 'in_attesa', bank_amount = NULL
  FROM public.outlet_payment_channels ch
 WHERE ch.id = l.channel_id AND l.closing_id = (SELECT id FROM c)
   AND ch.label IN ('POS MPS Amex', 'POS BCC Amex');

UPDATE public.outlet_daily_closings SET updated_at = now() WHERE closing_date BETWEEN '2026-04-01' AND '2026-04-30';
UPDATE public.outlet_daily_closings SET status = 'confermata', confirmed_at = now()
 WHERE closing_date BETWEEN '2026-04-01' AND '2026-04-30' AND status = 'bozza';

COMMIT;

-- Riscontro automatico con la banca
SELECT public.match_cash_closings_with_bank((SELECT id FROM public.companies LIMIT 1), 175, 0.01);

-- Punto 4 (versamenti datati dalla banca il giorno prima) e versamento
-- doppio di Franciacorta l'08/04: agganci che il motore non puo' trovare
WITH casi(outlet, giorno, tx_date, tx_amount, nota) AS (VALUES
  ('BRUGNATO','2026-04-15','2026-04-14',2960.00,'versato il 14/04 all''ATM, dichiarato dal negozio sulla giornata del 15/04: il motore cerca solo in avanti'),
  ('BRUGNATO','2026-04-21','2026-04-20',1315.00,'versato il 20/04 all''ATM, dichiarato dal negozio sulla giornata del 21/04: il motore cerca solo in avanti'),
  ('FRANCIACORTA','2026-04-08','2026-04-08',1210.00,'versamento dichiarato 01-07/04/2026'),
  ('FRANCIACORTA','2026-04-08','2026-04-08',85.00,'secondo versamento allo stesso ATM un minuto prima: chiusura di marzo, non dichiarata dallo specchietto')
), k AS (
  SELECT c.id closing_id, c.company_id, casi.tx_date::date td, casi.tx_amount ta, casi.nota
  FROM casi JOIN public.outlets o ON o.name = casi.outlet
  JOIN public.outlet_daily_closings c ON c.outlet_id = o.id AND c.closing_date = casi.giorno::date
), tx AS (
  SELECT k.closing_id, k.company_id, k.td, k.nota, bt.id tx_id, bt.amount
  FROM k JOIN public.bank_transactions bt
    ON bt.company_id = k.company_id AND bt.transaction_date = k.td AND bt.amount = k.ta
   AND public.cash_bank_is_deposit(bt.description)
   AND NOT EXISTS (SELECT 1 FROM public.closing_bank_matches m WHERE m.bank_transaction_id = bt.id)
)
INSERT INTO public.closing_bank_matches (company_id, closing_id, line_id, bank_transaction_id, amount, match_type, reference_date, note)
SELECT company_id, closing_id, NULL, tx_id, amount, 'versamento', td, nota FROM tx;

-- Punto 7: il contante di fine aprile esce dalla cassa a maggio
WITH agg(outlet, giorno, aggiunta, nota) AS (VALUES
  ('TORINO','2026-05-01',250.00,'contante 28-30/04 versato il 01/05'),
  ('PALMANOVA','2026-05-01',930.00,'contante 28-30/04 versato il 01/05 in cassa continua'),
  ('BARBERINO','2026-05-04',465.00,'contante 28-30/04 versato il 04/05 in cassa continua'),
  ('VALDICHIANA','2026-05-04',417.65,'contante 28-30/04 versato il 04/05 in cassa continua'),
  ('BRUGNATO','2026-05-04',165.00,'contante 28-30/04 versato il 04/05 all''ATM'),
  ('VALMONTONE','2026-05-04',540.00,'contante 27-30/04 versato il 04/05 all''ATM, insieme ai 2.900,00 di maggio'),
  ('FRANCIACORTA','2026-05-06',2755.00,'contante di aprile (2.070,00 del 20-26/04 e 685,00 del 27-30/04) versato il 06/05 allo stesso ATM dei 2.045,00 di maggio')
)
UPDATE public.outlet_daily_closings c
   SET cash_deposit = c.cash_deposit + a.aggiunta,
       cash_deposit_note = COALESCE(NULLIF(btrim(c.cash_deposit_note),'') || ' + ', '') || a.nota,
       updated_at = now()
  FROM agg a JOIN public.outlets o ON o.name = a.outlet
 WHERE c.outlet_id = o.id AND c.closing_date = a.giorno::date;

WITH casi(outlet, giorno, tx_date, tx_amount) AS (VALUES
  ('TORINO','2026-05-01','2026-05-01',250.00),
  ('PALMANOVA','2026-05-01','2026-05-04',930.00),
  ('BARBERINO','2026-05-04','2026-05-06',465.00),
  ('VALDICHIANA','2026-05-04','2026-05-04',417.65),
  ('BRUGNATO','2026-05-04','2026-05-04',165.00),
  ('VALMONTONE','2026-05-04','2026-05-04',540.00),
  ('FRANCIACORTA','2026-05-06','2026-05-06',2070.00),
  ('FRANCIACORTA','2026-05-06','2026-05-06',685.00)
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
       'contante di fine aprile versato a maggio' FROM tx;

WITH somme AS (
  SELECT m.closing_id, sum(m.amount) tot, (min(m.bank_transaction_id::text))::uuid tx
  FROM public.closing_bank_matches m JOIN public.outlet_daily_closings c ON c.id = m.closing_id
  WHERE m.match_type = 'versamento' AND c.closing_date BETWEEN '2026-04-01' AND '2026-05-07' GROUP BY 1)
UPDATE public.outlet_daily_closings c
   SET deposit_bank_status = CASE WHEN abs(s.tot - c.cash_deposit) <= 0.01 THEN 'accreditato' ELSE 'differenza' END,
       deposit_bank_amount = s.tot, deposit_bank_transaction_id = COALESCE(c.deposit_bank_transaction_id, s.tx),
       bank_verified_at = now()
  FROM somme s WHERE s.closing_id = c.id;

-- Secondo giro: promuove le chiusure di aprile e chiude anche le due righe
-- Amex di Franciacorta del 01/05 e 03/05, rimaste 'mancante' finche' mancava aprile
SELECT public.match_cash_closings_with_bank((SELECT id FROM public.companies LIMIT 1), 175, 0.01);

SELECT count(*) FROM (
  SELECT public.project_cash_closing_to_daily_revenue(c.id)
  FROM public.outlet_daily_closings c WHERE c.closing_date BETWEEN '2026-04-01' AND '2026-04-30') t;

-- VERIFICA
-- SELECT count(*) chiusure, sum(total_receipts) incassi, sum(cash_deposit) versamenti
--   FROM public.outlet_daily_closings WHERE closing_date BETWEEN '2026-04-01' AND '2026-04-30';
--   atteso: 203 | 372705.73 | 62899.95
