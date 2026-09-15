-- ─────────────────────────────────────────────────────────────────────────────
-- 218 — Liquidazione IVA: l'importo definitivo si può scrivere direttamente
--
-- Finora confermare un mese voleva dire inserire i tre ingredienti
-- (corrispettivi, IVA attive, IVA acquisti) e lasciare che il totale si
-- calcolasse. Ma il commercialista quasi sempre comunica SOLO il totale da
-- versare. Per farlo tornare bisognava ritoccare l'IVA acquisti finché il
-- risultato coincideva: un numero falso in archivio per far quadrare una somma.
--
-- Con `importo_manuale` il totale si scrive e basta. Gli ingredienti restano
-- accanto come traccia di come ci si era arrivati, senza più dover mentire.
--
-- Migration ADDITIVA: una colonna con default, nessun dato toccato.
-- Da applicare su NZ, Made e Zago (parità tenant).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.vat_settlements
  ADD COLUMN IF NOT EXISTS importo_manuale boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.vat_settlements.importo_manuale IS
  'true = `importo` è stato scritto a mano (numero del commercialista) e vince sul calcolo dai componenti; false = `importo` è il risultato della formula.';

COMMIT;

-- ── Verifica ────────────────────────────────────────────────────────────────
-- SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--  WHERE table_name = 'vat_settlements' AND column_name = 'importo_manuale';
-- atteso: importo_manuale | boolean | false
