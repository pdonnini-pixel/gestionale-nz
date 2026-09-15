-- =====================================================================
-- 194 — Report incassi serale: confronto con l'obiettivo del budget
-- ---------------------------------------------------------------------
-- Il report serale confronta gli incassi con il budget ricavi mensile per
-- outlet dell'Inserimento rapido (budget_confronto, entry_type rev_monthly,
-- importi NETTI IVA). Le chiusure di cassa sono corrispettivi LORDI: per
-- confrontarli il budget viene aumentato dell'aliquota IVA qui configurata
-- (default 22 %), poi diviso per i giorni del mese → obiettivo del giorno.
-- Additiva, idempotente. Tenant: NZ, Made, Zago.
-- =====================================================================
ALTER TABLE public.daily_report_settings
  ADD COLUMN IF NOT EXISTS budget_vat_rate numeric(5,2) NOT NULL DEFAULT 22
  CHECK (budget_vat_rate >= 0 AND budget_vat_rate <= 100);
COMMENT ON COLUMN public.daily_report_settings.budget_vat_rate IS
  'Aliquota IVA (%) per portare il budget ricavi (netto) al lordo dei corrispettivi nel report serale.';
