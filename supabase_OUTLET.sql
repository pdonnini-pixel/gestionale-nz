-- ============================================================
-- GESTIONALE NZ - TABELLE OUTLET
-- Eseguire in Supabase SQL Editor
-- ============================================================

-- ========================
-- 1. OUTLETS (Punti vendita)
-- ========================
CREATE TABLE IF NOT EXISTS outlets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',

  -- Anagrafica
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  brand TEXT,
  outlet_type TEXT DEFAULT 'outlet',
  sqm NUMERIC,
  sell_sqm NUMERIC,
  unit_code TEXT,
  is_active BOOLEAN DEFAULT true,

  -- Ubicazione
  mall_name TEXT,
  concedente TEXT,
  mall_manager TEXT,
  address TEXT,
  city TEXT,
  province TEXT,
  region TEXT,

  -- Date apertura
  delivery_date DATE,
  opening_date DATE,
  opening_confirmed BOOLEAN DEFAULT false,

  -- Contratto
  contract_start DATE,
  contract_end DATE,
  contract_duration_months INT,
  contract_min_months INT,
  rent_free_days INT,
  exit_clause_month INT,

  -- Canone e costi
  rent_annual NUMERIC,
  rent_monthly NUMERIC,
  rent_per_sqm NUMERIC,
  variable_rent_pct NUMERIC,
  rent_year2_annual NUMERIC,
  rent_year3_annual NUMERIC,
  condo_marketing_monthly NUMERIC,
  staff_budget_monthly NUMERIC,

  -- Garanzie
  deposit_guarantee NUMERIC,
  deposit_amount NUMERIC,
  advance_payment NUMERIC,
  setup_cost NUMERIC,

  -- Target
  target_margin_pct NUMERIC DEFAULT 60,
  target_cogs_pct NUMERIC DEFAULT 40,
  min_revenue_target NUMERIC,
  min_revenue_period TEXT,
  exit_revenue_threshold NUMERIC,

  -- Stato
  bp_status TEXT DEFAULT 'bozza',
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(company_id, code)
);

-- RLS
ALTER TABLE outlets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'outlets' AND policyname = 'outlets_select') THEN
    CREATE POLICY outlets_select ON outlets FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'outlets' AND policyname = 'outlets_insert') THEN
    CREATE POLICY outlets_insert ON outlets FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'outlets' AND policyname = 'outlets_update') THEN
    CREATE POLICY outlets_update ON outlets FOR UPDATE TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'outlets' AND policyname = 'outlets_delete') THEN
    CREATE POLICY outlets_delete ON outlets FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- ========================
-- 2. OUTLET ATTACHMENTS (Allegati per outlet)
-- ========================
CREATE TABLE IF NOT EXISTS outlet_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  outlet_id UUID NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,

  attachment_type TEXT NOT NULL,       -- es: 'contratto', 'allegato_a', 'allegato_b'
  label TEXT NOT NULL,                 -- es: 'Allegato A — Planimetria Outlet'
  file_name TEXT,                      -- nome file originale
  file_path TEXT,                      -- path in Supabase Storage
  file_size BIGINT,

  is_required BOOLEAN DEFAULT false,
  is_uploaded BOOLEAN DEFAULT false,
  uploaded_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE outlet_attachments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'outlet_attachments' AND policyname = 'outlet_att_select') THEN
    CREATE POLICY outlet_att_select ON outlet_attachments FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'outlet_attachments' AND policyname = 'outlet_att_insert') THEN
    CREATE POLICY outlet_att_insert ON outlet_attachments FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'outlet_attachments' AND policyname = 'outlet_att_update') THEN
    CREATE POLICY outlet_att_update ON outlet_attachments FOR UPDATE TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'outlet_attachments' AND policyname = 'outlet_att_delete') THEN
    CREATE POLICY outlet_att_delete ON outlet_attachments FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- Indici
CREATE INDEX IF NOT EXISTS idx_outlet_attachments_outlet ON outlet_attachments(outlet_id);

-- ========================
-- 3. STORAGE BUCKET per outlet-attachments
-- ========================
-- Eseguire manualmente se non esiste:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('outlet-attachments', 'outlet-attachments', false) ON CONFLICT DO NOTHING;

-- ========================
-- 4. SEED: Crea outlets dai cost_centers esistenti (se outlets è vuota)
-- Questo collega gli outlet ai centri di costo già inseriti
-- ========================
INSERT INTO outlets (company_id, name, code, is_active, bp_status)
SELECT
  company_id,
  label,
  code,
  is_active,
  'attivo'
FROM cost_centers
WHERE company_id = '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (SELECT 1 FROM outlets WHERE outlets.company_id = cost_centers.company_id AND outlets.code = cost_centers.code)
ON CONFLICT (company_id, code) DO NOTHING;

-- ============================================================
-- FINE - Verifica con: SELECT count(*) FROM outlets;
-- ============================================================
