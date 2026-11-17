-- ZAGO_ONLY 427 — Conti bancari e canali di incasso di Zago (Firenze e Forte dei Marmi)
-- Solo Zago (jxlwvzjreukscnswkbjx). Fonte: mail di Veronica del 17/11/2026 (risposta a «Zago: dati per la
-- chiusura cassa») e gli estratti conto allegati.
-- Conti attivi: MPS Forte dei Marmi 21502/42, MPS Firenze 380638, BCC Pontassieve Forte 604305, BCC Pontassieve
-- Firenze 604178 (MPS ordinario 56117 chiuso: non si crea). IBAN MPS letti dalle fatture di Zago; quelli BCC non
-- sono ancora noti (gli Excel BCC non li portano): il conto si riconosce dal numero.
-- Codici terminale (ultime 5 cifre del codice negli accrediti): MPS Firenze 00002, MPS Forte 00001 (502715900002 /
-- ...001), BCC Firenze 00004, BCC Forte 00003 (502715900004 / ...003). ID terminale dalla mail: MPS Forte 11158086,
-- BCC Forte 87362243, MPS Firenze 11222186, BCC Firenze 87362244. American Express passa da tutti e due i POS:
-- su MPS arriva con il circuito AMEX sul conto MPS, su BCC come «Incassi American Express» sul conto BCC.
-- Contanti: versati all'ATM MPS con la carta del negozio (Firenze carta 13072698, Forte carta 13510051).
-- Idempotente. Rollback: ZAGO_ONLY_20261117_427_..._ROLLBACK.sql
WITH c AS (SELECT id FROM public.companies LIMIT 1),
o AS (SELECT id, code FROM public.outlets WHERE code IN ('ZAGO-FI','ZAGO-FDM')),
v(code, bank_name, iban, account_name, ocode) AS (VALUES
  ('MPS-FDM', 'MPS - Banca Monte dei Paschi di Siena', 'IT52L0103062660000002150242', 'IT52L0103062660000002150242', 'ZAGO-FDM'),
  ('MPS-FI',  'MPS - Banca Monte dei Paschi di Siena', 'IT98W0103038020000000380638', 'IT98W0103038020000000380638', 'ZAGO-FI'),
  ('BCC-FDM', 'BCC Pontassieve', NULL, 'BCC Pontassieve c/c 604305 Forte dei Marmi', 'ZAGO-FDM'),
  ('BCC-FI',  'BCC Pontassieve', NULL, 'BCC Pontassieve c/c 604178 Firenze', 'ZAGO-FI'))
INSERT INTO public.bank_accounts (company_id, bank_name, iban, account_name, account_type, outlet_id, outlet_code, is_active, is_manual, note)
SELECT c.id, v.bank_name, v.iban, v.account_name, 'conto_corrente', o.id, v.ocode, true, true,
       'Creato il 17/11/2026 dalla mail di Veronica (conti attivi di Zago).'
FROM v CROSS JOIN c JOIN o ON o.code = v.ocode
WHERE NOT EXISTS (SELECT 1 FROM public.bank_accounts b WHERE b.account_name = v.account_name);

WITH c AS (SELECT id FROM public.companies LIMIT 1),
acc AS (SELECT outlet_code, CASE WHEN bank_name LIKE 'MPS%' THEN 'MPS' ELSE 'BCC' END banca, id FROM public.bank_accounts WHERE outlet_code IN ('ZAGO-FI','ZAGO-FDM')),
v(ocode, sort, label, kind, banca, term, posid, mode, tol) AS (VALUES
  ('ZAGO-FI', 1,'Contanti','contanti','MPS','13072698',NULL,'netto',0),
  ('ZAGO-FI', 2,'POS MPS','pos','MPS','00002','11222186','netto',1.5),
  ('ZAGO-FI', 3,'POS MPS Amex','pos_amex','MPS','00002','11222186','lordo',0),
  ('ZAGO-FI', 4,'POS BCC','pos','BCC','00004','87362244','netto',1.5),
  ('ZAGO-FI', 5,'POS BCC Amex','pos_amex','BCC','00004','87362244','lordo',0),
  ('ZAGO-FI', 6,'Pay by link','paybylink',NULL,NULL,NULL,'netto',0),
  ('ZAGO-FI', 7,'Fatture','fattura',NULL,NULL,NULL,'netto',0),
  ('ZAGO-FI', 8,'Bonifico','bonifico',NULL,NULL,NULL,'netto',0),
  ('ZAGO-FI', 9,'Buoni e gift card','altro',NULL,NULL,NULL,'netto',0),
  ('ZAGO-FDM',1,'Contanti','contanti','MPS','13510051',NULL,'netto',0),
  ('ZAGO-FDM',2,'POS MPS','pos','MPS','00001','11158086','netto',1.5),
  ('ZAGO-FDM',3,'POS MPS Amex','pos_amex','MPS','00001','11158086','lordo',0),
  ('ZAGO-FDM',4,'POS BCC','pos','BCC','00003','87362243','netto',1.5),
  ('ZAGO-FDM',5,'POS BCC Amex','pos_amex','BCC','00003','87362243','lordo',0),
  ('ZAGO-FDM',6,'Pay by link','paybylink',NULL,NULL,NULL,'netto',0),
  ('ZAGO-FDM',7,'Fatture','fattura',NULL,NULL,NULL,'netto',0),
  ('ZAGO-FDM',8,'Bonifico','bonifico',NULL,NULL,NULL,'netto',0),
  ('ZAGO-FDM',9,'Buoni e gift card','altro',NULL,NULL,NULL,'netto',0))
INSERT INTO public.outlet_payment_channels (company_id, outlet_id, label, kind, bank_account_id, terminal_code, pos_terminal_id,
                                            settlement_days, counts_in_total, sort_order, is_active, bank_tolerance_pct, settlement_mode)
SELECT c.id, o.id, v.label, v.kind, acc.id, v.term, v.posid, 1, true, v.sort, true, v.tol, v.mode
FROM v CROSS JOIN c JOIN public.outlets o ON o.code = v.ocode
LEFT JOIN acc ON acc.outlet_code = v.ocode AND acc.banca = v.banca
WHERE NOT EXISTS (SELECT 1 FROM public.outlet_payment_channels x WHERE x.outlet_id = o.id AND x.label = v.label);
