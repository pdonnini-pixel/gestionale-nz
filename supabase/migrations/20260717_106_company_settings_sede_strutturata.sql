-- Migration 106 — Sede legale strutturata + regime fiscale in company_settings
--
-- Contesto (audit 2026-07-17, finding critici C3/C4 + alto "sede cedente hardcoded"):
-- la fattura elettronica FPR12 richiede la sede del cedente in forma strutturata
-- (Indirizzo, CAP, Comune, Provincia). Oggi company_settings ha solo sede_legale
-- come testo libero, per cui ConvertitoreFattureXML e acube-sdi-send-invoice
-- avevano i dati di New Zago hardcoded nel codice — sbagliato per Made e Zago.
--
-- Questa migration e' PURAMENTE ADDITIVA (nessun dato toccato) e IDENTICA per
-- i 3 tenant. I VALORI per ciascun tenant vanno inseriti a parte, per progetto
-- (vedi query di popolamento in fondo, da adattare tenant per tenant).
--
-- Rollback:
--   ALTER TABLE public.company_settings
--     DROP COLUMN IF EXISTS sede_indirizzo,
--     DROP COLUMN IF EXISTS sede_cap,
--     DROP COLUMN IF EXISTS sede_comune,
--     DROP COLUMN IF EXISTS sede_provincia,
--     DROP COLUMN IF EXISTS regime_fiscale;

BEGIN;

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS sede_indirizzo text,
  ADD COLUMN IF NOT EXISTS sede_cap text,
  ADD COLUMN IF NOT EXISTS sede_comune text,
  ADD COLUMN IF NOT EXISTS sede_provincia text,
  ADD COLUMN IF NOT EXISTS regime_fiscale text NOT NULL DEFAULT 'RF01';

COMMENT ON COLUMN public.company_settings.sede_indirizzo IS 'Sede legale: indirizzo (via e numero civico) — usato nel blocco <Sede> della fattura elettronica FPR12';
COMMENT ON COLUMN public.company_settings.sede_cap IS 'Sede legale: CAP (5 cifre) — usato nella fattura elettronica FPR12';
COMMENT ON COLUMN public.company_settings.sede_comune IS 'Sede legale: comune — usato nella fattura elettronica FPR12';
COMMENT ON COLUMN public.company_settings.sede_provincia IS 'Sede legale: sigla provincia (2 lettere) — usata nella fattura elettronica FPR12';
COMMENT ON COLUMN public.company_settings.regime_fiscale IS 'Regime fiscale FatturaPA del cedente (default RF01 - ordinario)';

-- Vincolo morbido sulla provincia: 2 lettere maiuscole quando valorizzata
ALTER TABLE public.company_settings
  DROP CONSTRAINT IF EXISTS company_settings_sede_provincia_chk;
ALTER TABLE public.company_settings
  ADD CONSTRAINT company_settings_sede_provincia_chk
  CHECK (sede_provincia IS NULL OR sede_provincia ~ '^[A-Z]{2}$');

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- POPOLAMENTO (da eseguire A PARTE, per singolo tenant, con i SUOI valori).
-- NON fa parte della migration: e' un UPDATE dati che cambia da tenant a tenant.
--
-- Esempio per NZ (valori gia' noti dal vecchio hardcode):
--   UPDATE public.company_settings
--   SET sede_indirizzo = 'VIA IX FEBBRAIO 7',
--       sede_cap       = '50129',
--       sede_comune    = 'FIRENZE',
--       sede_provincia = 'FI'
--   WHERE company_id = (SELECT id FROM public.companies LIMIT 1);
--
-- Per Made e Zago: stesso UPDATE con indirizzo/CAP/comune/provincia della LORO
-- sede legale.
--
-- Verifica finale (su ciascun tenant deve tornare 1 riga con tutti i campi pieni):
--   SELECT ragione_sociale, partita_iva, sede_indirizzo, sede_cap, sede_comune,
--          sede_provincia, regime_fiscale
--   FROM public.company_settings;
-- ─────────────────────────────────────────────────────────────────────────────
