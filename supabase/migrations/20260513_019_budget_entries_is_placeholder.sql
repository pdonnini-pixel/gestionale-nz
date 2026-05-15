-- Migrazione 019 — budget_entries.is_placeholder
-- Marca le righe del preventivo come "provvisorie" (placeholder) per
-- distinguere visivamente in UI quelle generate automaticamente
-- (es. copia da consuntivo anno precedente) da quelle confermate
-- da Lilian. L'UPDATE manuale di budget_amount le promuove a "definitive".

ALTER TABLE budget_entries
  ADD COLUMN IF NOT EXISTS is_placeholder boolean DEFAULT false NOT NULL;

COMMENT ON COLUMN budget_entries.is_placeholder IS
  'TRUE se la riga è un preventivo placeholder generato automaticamente (es. copia anno precedente), FALSE se confermato/modificato da utente. Auto-aggiornato a FALSE dal trigger trg_budget_unflag_placeholder quando budget_amount viene modificato.';

CREATE INDEX IF NOT EXISTS idx_budget_entries_placeholder
  ON budget_entries (company_id, year, is_placeholder)
  WHERE is_placeholder = true;

-- Trigger: quando Lilian (o chiunque) modifica budget_amount di una riga
-- placeholder, la riga diventa "definitiva". Bypassa quando il bypass del
-- lock è attivo (es. RPC refresh_budget_consuntivo che NON tocca budget_amount).
CREATE OR REPLACE FUNCTION public.budget_entries_unflag_placeholder()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Se budget_amount è cambiato E la riga era placeholder → diventa definitiva
  IF NEW.budget_amount IS DISTINCT FROM OLD.budget_amount AND OLD.is_placeholder = true THEN
    NEW.is_placeholder := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_budget_entries_unflag_placeholder ON budget_entries;
CREATE TRIGGER trg_budget_entries_unflag_placeholder
  BEFORE UPDATE OF budget_amount ON budget_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.budget_entries_unflag_placeholder();

COMMENT ON FUNCTION public.budget_entries_unflag_placeholder() IS
  'Auto-unflag is_placeholder quando budget_amount viene modificato. Trigger BEFORE UPDATE OF budget_amount.';
