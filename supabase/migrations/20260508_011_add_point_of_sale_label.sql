-- ============================================================================
-- 20260508_011_add_point_of_sale_label.sql
--
-- Aggiunge `companies.point_of_sale_label` per consentire ad ogni tenant di
-- scegliere come chiamare i propri punti vendita (es. "Outlet" per NZ,
-- "Negozio" per Made, "Boutique" per cliente SaaS futuro).
--
-- La label è scelta dal wizard onboarding al primo step e mostrata ovunque
-- nella UI tramite l'hook `useCompanyLabels()`. I nomi tecnici (tabella
-- `outlets`, FK `outlet_id`) NON cambiano — restano internamente "outlet".
--
-- Default: 'Punto vendita' (generico, neutro). Tenant esistenti che vogliono
-- un'altra label aggiornano via wizard o via UPDATE manuale.
-- ============================================================================

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS point_of_sale_label TEXT NOT NULL DEFAULT 'Punto vendita';

COMMENT ON COLUMN public.companies.point_of_sale_label IS
  'Label che il tenant usa per indicare i suoi punti vendita. Esempi: "Outlet", "Negozio", "Punto vendita", "Boutique", "Store". Configurabile dal wizard onboarding al primo step. Mostrata ovunque nell''app al posto di "Outlet" hardcoded. I nomi tecnici delle tabelle restano outlet/outlet_id.';
