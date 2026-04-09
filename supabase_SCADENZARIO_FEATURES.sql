-- =====================================================
-- SCADENZARIO FEATURES: Rate multiple + Fornitore CRUD
-- Eseguire in Supabase SQL Editor
-- =====================================================

-- 1. Aggiungere parent_payable_id per rate multiple
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payables' AND column_name='parent_payable_id') THEN
    ALTER TABLE payables ADD COLUMN parent_payable_id UUID REFERENCES payables(id);
  END IF;
END $$;

-- 2. Aggiungere is_deleted a suppliers per soft-delete
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='is_deleted') THEN
    ALTER TABLE suppliers ADD COLUMN is_deleted BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='email') THEN
    ALTER TABLE suppliers ADD COLUMN email TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='telefono') THEN
    ALTER TABLE suppliers ADD COLUMN telefono TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='indirizzo') THEN
    ALTER TABLE suppliers ADD COLUMN indirizzo TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='note') THEN
    ALTER TABLE suppliers ADD COLUMN note TEXT;
  END IF;
END $$;

-- 3. Aggiungere approved_by/approved_at a balance_sheet_imports
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='balance_sheet_imports' AND column_name='approved_by') THEN
    ALTER TABLE balance_sheet_imports ADD COLUMN approved_by UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='balance_sheet_imports' AND column_name='approved_at') THEN
    ALTER TABLE balance_sheet_imports ADD COLUMN approved_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='balance_sheet_imports' AND column_name='uploaded_by') THEN
    ALTER TABLE balance_sheet_imports ADD COLUMN uploaded_by UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='balance_sheet_imports' AND column_name='uploaded_by_name') THEN
    ALTER TABLE balance_sheet_imports ADD COLUMN uploaded_by_name TEXT;
  END IF;
END $$;

-- Indice per lookup parent_payable
CREATE INDEX IF NOT EXISTS idx_payables_parent ON payables(parent_payable_id) WHERE parent_payable_id IS NOT NULL;

-- Fatto!
