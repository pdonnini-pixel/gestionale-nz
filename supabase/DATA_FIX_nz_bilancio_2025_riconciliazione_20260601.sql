-- =====================================================================
-- DATA FIX — RICONCILIAZIONE BILANCIO 2025 NEW ZAGO  (2026-06-01)
-- =====================================================================
-- ⚠️  NON È UNA MIGRATION. NON eseguire da un migration-runner.
-- ⚠️  NZ-ONLY — DATI SPECIFICI DI NEW ZAGO S.R.L.
--     NON replicare su Made (9397f87a...) né su Zago (e592f732...):
--     hanno bilanci propri. La parità 3 tenant vale per schema/codice,
--     NON per questi numeri.
-- ⚠️  Già applicato in produzione (project xfvfxsvqpnpvibgeqpqp) il
--     2026-06-01 via Supabase MCP. Questo file è SOLO per tracciabilità.
--
-- Scope: company_id = 00000000-0000-0000-0000-000000000001, year = 2025.
-- Obiettivo: allineare la versione PROVVISORIA in DB al bilancio di
--   verifica 2025 DEFINITIVO (imposte sul reddito, rimanenze finali,
--   pareggio stato patrimoniale).
-- Vincoli rispettati: NIENTE wipe; nessun TRUNCATE/DELETE di massa;
--   nessuna modifica al 2026 (budget_entries y=2026, budget_confronto,
--   budget_approval_log invariati: 1872 / 108 / 3 righe prima = dopo).
-- =====================================================================

-- ---------- BACKUP (IF NOT EXISTS: non clobbera snapshot pre-modifica) ----------
CREATE TABLE IF NOT EXISTS balance_sheet_data_bkp_20260601 AS
  SELECT * FROM balance_sheet_data
  WHERE company_id='00000000-0000-0000-0000-000000000001' AND year=2025;          -- 127 righe
CREATE TABLE IF NOT EXISTS budget_entries_bkp_20260601 AS
  SELECT * FROM budget_entries
  WHERE company_id='00000000-0000-0000-0000-000000000001' AND year=2025 AND cost_center='all';  -- 1116 righe

BEGIN;

-- ====== A) CONTO ECONOMICO (section='conto_economico') ======
-- utile_netto è STORATO e mostrato as-is (mai ricalcolato a valle: verificato in
-- ContoEconomico.tsx buildCeFromData + tree risultato + trend) → nessun doppio
-- conteggio sottraendo le imposte due volte.
UPDATE balance_sheet_data SET amount=3051.61
 WHERE company_id='00000000-0000-0000-0000-000000000001' AND year=2025
   AND section='conto_economico' AND account_code='utile_netto';   -- 17.973,61 -> 3.051,61

-- Imposte sul reddito = IRAP 11.424,00 + IRES 3.498,00. account_code='imposte'
-- è esattamente la chiave attesa da CE_FIELDS; importo POSITIVO come gli altri
-- costi (la pagina la classifica come componente negativa, non ricavo/subtotale).
INSERT INTO balance_sheet_data (company_id, year, period_type, section, account_code, account_name, amount, cost_center, sort_order)
SELECT '00000000-0000-0000-0000-000000000001', 2025, 'annuale', 'conto_economico', 'imposte', 'Imposte sul reddito', 14922.00, 'all', 15
WHERE NOT EXISTS (SELECT 1 FROM balance_sheet_data
  WHERE company_id='00000000-0000-0000-0000-000000000001' AND year=2025 AND section='conto_economico' AND account_code='imposte');

-- ====== B) SP ATTIVITA (section='sp_attivita') ======
-- Rimanenze 300.288,68 -> 518.288,68 (macro 09 + 0907 + 090703)
UPDATE balance_sheet_data SET amount=518288.68
 WHERE company_id='00000000-0000-0000-0000-000000000001' AND year=2025
   AND section='sp_attivita' AND account_code IN ('09','0907','090703');

-- Crediti 77.471,90 -> 67.674,90
UPDATE balance_sheet_data SET amount=67674.90
 WHERE company_id='00000000-0000-0000-0000-000000000001' AND year=2025 AND section='sp_attivita' AND account_code='11';
-- Crediti tributari 11.611,36 -> 1.814,36 (macro+sub 1116/111601/11160101)
UPDATE balance_sheet_data SET amount=1814.36
 WHERE company_id='00000000-0000-0000-0000-000000000001' AND year=2025 AND section='sp_attivita'
   AND account_code IN ('1116','111601','11160101');
-- Acconti IRES 5.286,00 -> 1.788,00
UPDATE balance_sheet_data SET amount=1788.00
 WHERE company_id='00000000-0000-0000-0000-000000000001' AND year=2025 AND section='sp_attivita' AND account_code='1116010137';
-- Acconti IRAP 6.299,00 -> ELIMINATO (assente nel definitivo). 1116010101=17,40 e 1116010141=8,96 invariati.
DELETE FROM balance_sheet_data
 WHERE company_id='00000000-0000-0000-0000-000000000001' AND year=2025 AND section='sp_attivita' AND account_code='1116010139';

-- Ratei e risconti attivi 2.352,54 -> 3.881,53 (macro 17 + 1705); 170503 993,73 -> 2.522,72 (170501=1.358,81 invariato)
UPDATE balance_sheet_data SET amount=3881.53
 WHERE company_id='00000000-0000-0000-0000-000000000001' AND year=2025 AND section='sp_attivita' AND account_code IN ('17','1705');
UPDATE balance_sheet_data SET amount=2522.72
 WHERE company_id='00000000-0000-0000-0000-000000000001' AND year=2025 AND section='sp_attivita' AND account_code='170503';

-- ====== C) SP PASSIVITA (section='sp_passivita') ======
-- Patrimonio netto 17.097,41 -> 20.149,02 (macro 21) + nuova riga Utile d'esercizio (2117/211701)
UPDATE balance_sheet_data SET amount=20149.02
 WHERE company_id='00000000-0000-0000-0000-000000000001' AND year=2025 AND section='sp_passivita' AND account_code='21';
-- Debiti 1.447.893,92 -> 1.453.018,92 (macro 27)  ← NB: aggiornare ANCHE il macro, non solo il figlio 2743
UPDATE balance_sheet_data SET amount=1453018.92
 WHERE company_id='00000000-0000-0000-0000-000000000001' AND year=2025 AND section='sp_passivita' AND account_code='27';
-- Debiti tributari 11.186,33 -> 16.311,33 (2743) + nuova riga IRAP (274305). 274307/274309/274319 invariati.
UPDATE balance_sheet_data SET amount=16311.33
 WHERE company_id='00000000-0000-0000-0000-000000000001' AND year=2025 AND section='sp_passivita' AND account_code='2743';

INSERT INTO balance_sheet_data (company_id, year, period_type, section, account_code, account_name, amount, cost_center, sort_order)
SELECT '00000000-0000-0000-0000-000000000001', 2025, 'annuale', 'sp_passivita', '2117', 'Utile (Perdita) dell''esercizio', 3051.61, 'all', 0
WHERE NOT EXISTS (SELECT 1 FROM balance_sheet_data WHERE company_id='00000000-0000-0000-0000-000000000001' AND year=2025 AND section='sp_passivita' AND account_code='2117');
INSERT INTO balance_sheet_data (company_id, year, period_type, section, account_code, account_name, amount, cost_center, sort_order)
SELECT '00000000-0000-0000-0000-000000000001', 2025, 'annuale', 'sp_passivita', '211701', 'Utile d''esercizio', 3051.61, 'all', 0
WHERE NOT EXISTS (SELECT 1 FROM balance_sheet_data WHERE company_id='00000000-0000-0000-0000-000000000001' AND year=2025 AND section='sp_passivita' AND account_code='211701');
INSERT INTO balance_sheet_data (company_id, year, period_type, section, account_code, account_name, amount, cost_center, sort_order)
SELECT '00000000-0000-0000-0000-000000000001', 2025, 'annuale', 'sp_passivita', '274305', 'IRAP', 5125.00, 'all', 0
WHERE NOT EXISTS (SELECT 1 FROM balance_sheet_data WHERE company_id='00000000-0000-0000-0000-000000000001' AND year=2025 AND section='sp_passivita' AND account_code='274305');

-- Rinumera sort_order sp_passivita per account_code (= ordine gerarchico): la vista
-- tree di ContoEconomico.tsx ordina .order('sort_order') e annida per livello-codice,
-- quindi le righe nuove (2117/211701/274305) vanno posizionate nel punto corretto.
WITH ordered AS (
  SELECT id, (row_number() OVER (ORDER BY account_code)) - 1 AS rn
  FROM balance_sheet_data
  WHERE company_id='00000000-0000-0000-0000-000000000001' AND year=2025 AND section='sp_passivita'
)
UPDATE balance_sheet_data b SET sort_order=o.rn FROM ordered o WHERE b.id=o.id;

-- ====== D) BUDGET_ENTRIES (cost_center='all' = controllo gestione civilistico) ======
-- Aggiunge i conti imposte spalmati su 12 mesi con split ai centesimi (somma esatta,
-- stessa logica di splitMonthly in BudgetControl). 9305 IRAP 11.424,00 e 9307 IRES 3.498,00
-- dividono esatti (952,00 e 291,50/mese). macro_group='CE', is_approved=false.
INSERT INTO budget_entries (company_id, account_code, account_name, macro_group, cost_center, year, month, budget_amount, is_approved)
SELECT '00000000-0000-0000-0000-000000000001', v.code, v.name, 'CE', 'all', 2025, g.m,
  ( (round(v.annual*100)::int / 12)
    + CASE WHEN g.m <= (round(v.annual*100)::int - (round(v.annual*100)::int/12)*12) THEN 1 ELSE 0 END
  )::numeric / 100,
  false
FROM (VALUES ('9305','Irap',11424.00::numeric), ('9307','Ires',3498.00::numeric)) AS v(code,name,annual)
CROSS JOIN generate_series(1,12) AS g(m)
ON CONFLICT (company_id, account_code, cost_center, year, month)
DO UPDATE SET budget_amount=EXCLUDED.budget_amount, account_name=EXCLUDED.account_name, macro_group=EXCLUDED.macro_group;

COMMIT;

-- =====================================================================
-- VERIFICA (esito al 2026-06-01):
--   SP attivo  (03+05+09+11+15+17) = 1.543.725,02
--   SP passivo (21+25+27+29)       = 1.543.725,02   → DELTA 0,00  ✔ pareggia
--   CE utile_netto visibile = 3.051,61 ; CE imposte = 14.922,00     ✔
--   budget_entries 'all' 2025: 9305+9307 = 14.922,00 (24 righe)      ✔
--   2026 invariato: budget_entries=1872, budget_confronto=108, budget_approval_log=3  ✔
-- =====================================================================
