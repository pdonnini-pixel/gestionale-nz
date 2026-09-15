-- =====================================================================
-- NZ_ONLY 222 — Seed commissioni di incasso 2026 (New Zago)
-- ---------------------------------------------------------------------
-- Contratti Amex (11 codici AX) e Nexi (7 Payment Contract) con il loro
-- regime di accredito, piu' il costo per mese ricavato da:
--   * 8 estratti conto Amex, gennaio-agosto 2026  -> source 'documento'
--   * 32 estratti conto Nexi, gennaio-luglio 2026 -> source 'documento'
--   * 3 addebiti SDD per Valdichiana gen-mar      -> source 'banca'
--     (i PDF di quei mesi su Drive sono scansioni senza testo, richiesti
--      a Nexi in formato nativo: quando arrivano sostituiscono queste righe)
--
-- Nessun valore di tenant nel codice: gli outlet si risolvono per `code`.
-- Idempotente (ON CONFLICT DO NOTHING). Solo NZ: Made e Zago non hanno
-- punti vendita con POS.
--
-- Il bollo Amex (2,00 per estratto da aprile, 10,00 nel periodo) non e'
-- attribuito ai singoli punti vendita: viaggia dentro l'SDD di uno solo e
-- per i mesi precedenti ad agosto non si sa quale.
--
-- Verifica in fondo al file.
-- =====================================================================

-- 1. contratti
INSERT INTO public.acquirer_contracts (company_id, outlet_id, acquirer, merchant_code, payment_contract, sdd_mandate, settlement_mode, terminal_code, label, valid_to, is_active)
SELECT o.company_id, o.id, v.acq, v.code, v.pc, v.sdd, v.mode, v.term, v.label, v.vto, v.act
FROM (VALUES
('VDC','amex','7373035260',NULL,'7043090000007373035260','lordo',NULL,'Vicolo Foiano della Chiana',NULL,true),
('BRB','amex','7377153036',NULL,'7043090000007377153036','lordo','00004','Vicolo Barberino di Mugello',NULL,true),
('FRC','amex','7377511100',NULL,'7043090000007377511100','lordo','00006','Vicolo c/o Franciacorta Outlet',NULL,true),
('PLM','amex','7378034250',NULL,'7043090000007378034250','lordo','00007','Vicolo Aiello del Friuli',NULL,true),
('PLM','amex','7379455439',NULL,'7043090000007379455439','lordo','00005','Vicolo c/o Palmanova Outlet',DATE '2026-01-31',false),
('BRG','amex','7379416167',NULL,'7043090000007379416167','lordo','00010','Brugnato 5 Terre Outlet Village',NULL,true),
('BRG','amex','7379605249',NULL,'7043090000007379605249','lordo','00009','Vicolo Brugnato',NULL,true),
('VLM','amex','7543377782',NULL,'7043090000007543377782','lordo','00012','Vicolo c/o Valmontone Outlet',NULL,true),
('VLM','amex','7543394233',NULL,'7043090000007543394233','lordo','00011','Vicolo Valmontone',NULL,true),
('TRN','amex','9341423540',NULL,'7043090000009341423540','lordo','00013','Vicolo Settimo Torinese',NULL,true),
('TRN','amex','9341489277',NULL,'7043090000009341489277','lordo','00014','Vicolo Outlet c/o Settimo Torinese',NULL,true),
('VDC','nexi','LN0004777495','PC0001000583','CL2XV900518975PC0001000583','lordo','00002','Nexi VDC',NULL,true),
('PLM','nexi','LN0005475974','PC0001392693','CL2XV900827881PC0001392693','netto','00007','Nexi PLM',NULL,true),
('BRB','nexi','LN0005458723','PC0001379716','CL2XV900815659PC0001379716','netto','00004','Nexi BRB',NULL,true),
('FRC','nexi','LN0005489545','PC0001396411','CL2XV900831630PC0001396411','netto','00008','Nexi FRC',NULL,true),
('BRG','nexi','LN0005533489','PC0001450042','CL2XV900870388PC0001450042','netto','00009','Nexi BRG',NULL,true),
('VLM','nexi','LN0005674696','PC0001488287','CL2XV900910890PC0001488287','netto','00011','Nexi VLM',NULL,true),
('TRN','nexi','LN0005755045','PC0001563440','CL2XV900984755PC0001563440','netto','00013','Nexi TRN',NULL,true)
) AS v(outlet_code, acq, code, pc, sdd, mode, term, label, vto, act)
JOIN public.outlets o ON o.code = v.outlet_code
ON CONFLICT (company_id, acquirer, merchant_code) DO NOTHING;

-- 2. commissioni 2026
INSERT INTO public.acquirer_fees (company_id, contract_id, outlet_id, period_year, period_month, gross_amount, fee_amount, fixed_amount, stamp_amount, settlement_mode, source, note)
SELECT c.company_id, c.id, c.outlet_id, v.y, v.m, v.gross, v.fee, v.fixed, v.stamp, v.mode, v.src, v.note
FROM (VALUES
('7373035260',2026,1,1416.71,12.75,0,0,'lordo','documento','estratto Amex 26AC8SW'),
('7377153036',2026,1,945.15,8.52,0,0,'lordo','documento','estratto Amex 26AC8SW'),
('7377511100',2026,1,1349.10,12.15,0,0,'lordo','documento','estratto Amex 26AC8SW'),
('7378034250',2026,1,111.00,1.00,0,0,'lordo','documento','estratto Amex 26AC8SW'),
('7379416167',2026,1,275.35,2.48,0,0,'lordo','documento','estratto Amex 26AC8SW'),
('7379455439',2026,1,314.62,2.83,0,0,'lordo','documento','estratto Amex 26AC8SW'),
('7379605249',2026,1,114.50,1.03,0,0,'lordo','documento','estratto Amex 26AC8SW'),
('7543377782',2026,1,473.45,4.26,0,0,'lordo','documento','estratto Amex 26AC8SW'),
('7543394233',2026,1,1168.05,10.51,0,0,'lordo','documento','estratto Amex 26AC8SW'),
('7373035260',2026,2,493.69,4.46,0,0,'lordo','documento','estratto Amex 26AP54S'),
('7377153036',2026,2,547.55,4.92,0,0,'lordo','documento','estratto Amex 26AP54S'),
('7377511100',2026,2,1266.62,11.39,0,0,'lordo','documento','estratto Amex 26AP54S'),
('7378034250',2026,2,108.30,0.97,0,0,'lordo','documento','estratto Amex 26AP54S'),
('7379416167',2026,2,210.31,1.89,0,0,'lordo','documento','estratto Amex 26AP54S'),
('7379605249',2026,2,310.12,2.79,0,0,'lordo','documento','estratto Amex 26AP54S'),
('7543377782',2026,2,2029.66,18.28,0,0,'lordo','documento','estratto Amex 26AP54S'),
('7543394233',2026,2,354.20,3.20,0,0,'lordo','documento','estratto Amex 26AP54S'),
('7373035260',2026,3,497.98,7.46,0,0,'lordo','documento','estratto Amex 26BC5CE'),
('7377153036',2026,3,458.25,6.89,0,0,'lordo','documento','estratto Amex 26BC5CE'),
('7377511100',2026,3,627.90,9.42,0,0,'lordo','documento','estratto Amex 26BC5CE'),
('7378034250',2026,3,189.84,2.85,0,0,'lordo','documento','estratto Amex 26BC5CE'),
('7379416167',2026,3,134.60,2.02,0,0,'lordo','documento','estratto Amex 26BC5CE'),
('7379605249',2026,3,266.39,4.00,0,0,'lordo','documento','estratto Amex 26BC5CE'),
('7543377782',2026,3,446.65,6.70,0,0,'lordo','documento','estratto Amex 26BC5CE'),
('7543394233',2026,3,359.90,5.40,0,0,'lordo','documento','estratto Amex 26BC5CE'),
('9341423540',2026,3,292.01,4.39,0,0,'lordo','documento','estratto Amex 26BC5CE'),
('7373035260',2026,4,1015.33,15.23,0,0,'lordo','documento','estratto Amex 26BQ3DO'),
('7377153036',2026,4,815.88,12.25,0,0,'lordo','documento','estratto Amex 26BQ3DO'),
('7377511100',2026,4,511.26,7.67,0,0,'lordo','documento','estratto Amex 26BQ3DO'),
('7378034250',2026,4,365.84,5.49,0,0,'lordo','documento','estratto Amex 26BQ3DO'),
('7379416167',2026,4,280.12,4.20,0,0,'lordo','documento','estratto Amex 26BQ3DO'),
('7379605249',2026,4,268.36,4.03,0,0,'lordo','documento','estratto Amex 26BQ3DO'),
('7543377782',2026,4,255.11,3.84,0,0,'lordo','documento','estratto Amex 26BQ3DO'),
('7543394233',2026,4,1144.76,17.19,0,0,'lordo','documento','estratto Amex 26BQ3DO'),
('9341423540',2026,4,1095.10,16.43,0,0,'lordo','documento','estratto Amex 26BQ3DO'),
('7373035260',2026,5,534.99,8.02,0,0,'lordo','documento','estratto Amex 26CE8OG'),
('7377153036',2026,5,678.32,10.17,0,0,'lordo','documento','estratto Amex 26CE8OG'),
('7377511100',2026,5,2270.22,34.04,0,0,'lordo','documento','estratto Amex 26CE8OG'),
('7378034250',2026,5,600.80,9.01,0,0,'lordo','documento','estratto Amex 26CE8OG'),
('7379416167',2026,5,166.38,2.50,0,0,'lordo','documento','estratto Amex 26CE8OG'),
('7379605249',2026,5,348.60,5.23,0,0,'lordo','documento','estratto Amex 26CE8OG'),
('7543377782',2026,5,1028.20,15.43,0,0,'lordo','documento','estratto Amex 26CE8OG'),
('7543394233',2026,5,895.86,13.43,0,0,'lordo','documento','estratto Amex 26CE8OG'),
('9341423540',2026,5,1029.44,15.45,0,0,'lordo','documento','estratto Amex 26CE8OG'),
('9341489277',2026,5,65.00,0.98,0,0,'lordo','documento','estratto Amex 26CE8OG'),
('7373035260',2026,6,982.36,14.75,0,0,'lordo','documento','estratto Amex 26CT9TM'),
('7377153036',2026,6,977.97,14.68,0,0,'lordo','documento','estratto Amex 26CT9TM'),
('7377511100',2026,6,1587.89,23.82,0,0,'lordo','documento','estratto Amex 26CT9TM'),
('7378034250',2026,6,605.75,9.10,0,0,'lordo','documento','estratto Amex 26CT9TM'),
('7379416167',2026,6,242.92,3.65,0,0,'lordo','documento','estratto Amex 26CT9TM'),
('7379605249',2026,6,296.54,4.45,0,0,'lordo','documento','estratto Amex 26CT9TM'),
('7543377782',2026,6,1044.01,15.67,0,0,'lordo','documento','estratto Amex 26CT9TM'),
('7543394233',2026,6,443.51,6.65,0,0,'lordo','documento','estratto Amex 26CT9TM'),
('9341423540',2026,6,952.30,14.29,0,0,'lordo','documento','estratto Amex 26CT9TM'),
('7373035260',2026,7,1849.94,27.76,0,0,'lordo','documento','estratto Amex 26DJ2BA'),
('7377153036',2026,7,992.09,14.89,0,0,'lordo','documento','estratto Amex 26DJ2BA'),
('7377511100',2026,7,1208.84,18.14,0,0,'lordo','documento','estratto Amex 26DJ2BA'),
('7378034250',2026,7,752.50,11.30,0,0,'lordo','documento','estratto Amex 26DJ2BA'),
('7379416167',2026,7,317.30,4.76,0,0,'lordo','documento','estratto Amex 26DJ2BA'),
('7379605249',2026,7,694.70,10.42,0,0,'lordo','documento','estratto Amex 26DJ2BA'),
('7543377782',2026,7,884.04,13.28,0,0,'lordo','documento','estratto Amex 26DJ2BA'),
('7543394233',2026,7,1169.75,17.56,0,0,'lordo','documento','estratto Amex 26DJ2BA'),
('9341423540',2026,7,2023.22,30.34,0,0,'lordo','documento','estratto Amex 26DJ2BA'),
('9341489277',2026,7,115.80,1.73,0,0,'lordo','documento','estratto Amex 26DJ2BA'),
('7373035260',2026,8,1456.95,21.87,0,0,'lordo','documento','estratto Amex 26DY48D'),
('7377153036',2026,8,988.45,14.83,0,0,'lordo','documento','estratto Amex 26DY48D'),
('7377511100',2026,8,1269.72,19.04,0,0,'lordo','documento','estratto Amex 26DY48D'),
('7378034250',2026,8,737.69,11.07,0,0,'lordo','documento','estratto Amex 26DY48D'),
('7379416167',2026,8,103.00,1.55,0,0,'lordo','documento','estratto Amex 26DY48D'),
('7379605249',2026,8,865.84,12.99,0,0,'lordo','documento','estratto Amex 26DY48D'),
('7543377782',2026,8,694.85,10.42,0,0,'lordo','documento','estratto Amex 26DY48D'),
('7543394233',2026,8,938.87,14.10,0,0,'lordo','documento','estratto Amex 26DY48D'),
('9341423540',2026,8,603.00,9.06,0,0,'lordo','documento','estratto Amex 26DY48D'),
('9341489277',2026,8,38.50,0.58,0,0,'lordo','documento','estratto Amex 26DY48D'),
('LN0004777495',2026,7,77033.20,597.29,2.50,2.00,'lordo','documento','estratto Nexi'),
('LN0005475974',2026,7,56185.04,473.67,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005755045',2026,7,56392.07,431.25,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005674696',2026,7,62180.23,461.69,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005489545',2026,7,53626.19,407.04,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005458723',2026,7,51436.59,391.55,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005533489',2026,7,29884.62,229.86,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0004777495',2026,6,54045.86,405.09,2.50,2.00,'lordo','documento','estratto Nexi'),
('LN0005475974',2026,6,37199.42,301.00,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005755045',2026,6,49509.30,388.67,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005533489',2026,6,16970.69,122.34,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005489545',2026,6,41519.07,335.47,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005458723',2026,6,32780.93,271.40,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005674696',2026,6,33632.46,254.86,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0004777495',2026,5,62307.71,486.57,2.50,2.00,'lordo','documento','estratto Nexi'),
('LN0005475974',2026,5,32157.96,275.86,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005533489',2026,5,16953.90,123.35,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005489545',2026,5,47678.09,365.92,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005458723',2026,5,34647.20,271.17,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005755045',2026,5,47803.75,364.92,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005674696',2026,5,50214.09,377.68,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0004777495',2026,4,47525.51,352.65,2.50,2.00,'lordo','documento','estratto Nexi'),
('LN0005475974',2026,4,31961.45,246.01,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005533489',2026,4,14522.21,113.04,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005489545',2026,4,43118.69,323.08,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005674696',2026,4,35856.08,267.68,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005458723',2026,4,34678.10,252.03,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005755045',2026,4,38548.51,298.54,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005674696',2026,2,23427.56,168.80,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005533489',2026,2,10475.72,79.24,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005489545',2026,2,43839.00,318.51,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0005475974',2026,1,33823.56,305.36,2.50,2.00,'netto','documento','estratto Nexi'),
('LN0004777495',2026,1,NULL,695.79,2.50,2.00,'lordo','banca','da addebito SDD, documento da richiedere'),
('LN0004777495',2026,2,NULL,432.04,2.50,2.00,'lordo','banca','da addebito SDD, documento da richiedere'),
('LN0004777495',2026,3,NULL,294.59,2.50,2.00,'lordo','banca','da addebito SDD, documento da richiedere')
) AS v(code, y, m, gross, fee, fixed, stamp, mode, src, note)
JOIN public.acquirer_contracts c ON c.merchant_code = v.code
ON CONFLICT (contract_id, period_year, period_month) DO NOTHING;
-- Verifica attesa: 18 contratti, 109 righe di commissioni, 12.210,22 euro
-- di commissioni 2026 (725,90 Amex + 11.484,32 Nexi).
--   SELECT count(*) FROM acquirer_contracts;
--   SELECT acquirer, count(*), sum(fee_amount) FROM v_commissioni_incasso
--    WHERE period_year = 2026 GROUP BY 1;
