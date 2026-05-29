-- Sprint 3 (29/05/2026): de-hardcode RICAVI_OUTLET_MAP + HQ_CODE dal frontend.
-- Applicata via MCP su NZ + Made + Zago. Su Made/Zago solo schema, niente seed
-- (i loro outlet vanno mappati al loro onboarding).

ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS outlet_link TEXT NULL;
COMMENT ON COLUMN chart_of_accounts.outlet_link IS 'Se settato, questo account e un ricavo corrispettivo specifico per outlet (cost_centers.code). Usato da BudgetControl per RICAVI_OUTLET_MAP dinamico.';

ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'outlet' CHECK (role IN ('hq', 'outlet', 'non_operational'));
COMMENT ON COLUMN cost_centers.role IS 'hq=sede/magazzino, outlet=punto vendita, non_operational=spese non divise/rettifiche';

-- Seed NZ (su Made/Zago non eseguito)
UPDATE chart_of_accounts SET outlet_link = 'sede_magazzino' WHERE code = '51010101';
UPDATE chart_of_accounts SET outlet_link = 'valdichiana'   WHERE code = '510107';
UPDATE chart_of_accounts SET outlet_link = 'barberino'     WHERE code = '510108';
UPDATE chart_of_accounts SET outlet_link = 'franciacorta'  WHERE code = '510110';
UPDATE chart_of_accounts SET outlet_link = 'palmanova'     WHERE code = '510112';
UPDATE chart_of_accounts SET outlet_link = 'brugnato'      WHERE code = '510114';
UPDATE chart_of_accounts SET outlet_link = 'valmontone'    WHERE code = '510122';
UPDATE chart_of_accounts SET outlet_link = 'torino'        WHERE code = '510124';

UPDATE cost_centers SET role = 'hq' WHERE code = 'sede_magazzino';
UPDATE cost_centers SET role = 'non_operational' WHERE code IN ('spese_non_divise', 'rettifica_bilancio');
