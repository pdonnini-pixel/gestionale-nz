-- =====================================================================
-- 474 · Giorni caldi: «Chi apre resta (ore)» si accende e si spegne
-- =====================================================================
-- Patrizio, 26/11/2026: «la regola deve poter essere accesa o spenta, quindi non fissa
-- come costante». Fino a oggi chi fa l'apertura nei giorni caldi (responsabile o vice)
-- doveva restare `caldi_ore_apertura` ore dall'apertura (NULL = 9: 10-19).
--
-- Colonna nuova, additiva:
--   caldi_ore_apertura_attiva boolean
--     NULL o true = accesa, come prima (chi apre resta caldi_ore_apertura ore);
--     false       = spenta: chi apre entra all'apertura, quanto resta lo decidono
--                   fasce, MODA e contratto come per le altre.
-- Nessun dato esistente cambia: tutte le righe restano NULL = accesa.
-- Rollback: 20261126_474_ore_apertura_accendi_spegni_ROLLBACK.sql
-- =====================================================================

BEGIN;

ALTER TABLE public.outlet_shift_rules
  ADD COLUMN IF NOT EXISTS caldi_ore_apertura_attiva boolean;

COMMENT ON COLUMN public.outlet_shift_rules.caldi_ore_apertura_attiva IS
  'Giorni caldi: chi fa l''apertura resta caldi_ore_apertura ore (Patrizio, 26/11/2026: la regola si accende e si spegne). NULL o true = accesa; false = spenta, chi apre entra all''apertura e la durata la decide il motore.';

COMMIT;

-- Verifica:
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'outlet_shift_rules' AND column_name = 'caldi_ore_apertura_attiva';
