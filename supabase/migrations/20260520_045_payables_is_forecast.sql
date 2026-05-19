-- Migrazione 045: aggiunge payables.is_forecast
--
-- Permette di creare entry previsionali (es. "Pagherò 5000€ il 15/06 per X")
-- direttamente dalla pagina CashflowProspettico, senza che siano fatture vere
-- ricevute. Si distinguono visivamente da scadenze reali tramite il flag.
--
-- Regole:
-- - is_forecast=true → entry alimenta solo cashflow prospettico (proiezione saldo)
-- - is_forecast=true → ESCLUSA da KPI consuntivi (Conto Economico, fatturato, ecc.)
-- - is_forecast=false (default) → scadenza/fattura reale, comportamento storico
-- - Quando la previsione si "avvera" (arriva fattura A-Cube reale), si può:
--   a) Eliminare manualmente la previsione
--   b) Aggiornare is_forecast=false e linkare la fattura

ALTER TABLE public.payables
  ADD COLUMN IF NOT EXISTS is_forecast BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.payables.is_forecast IS
  'TRUE = entry creata manualmente come previsione uscita (alimenta solo cashflow prospettico, non Conto Economico consuntivo). FALSE = scadenza/fattura reale.';

CREATE INDEX IF NOT EXISTS idx_payables_is_forecast
  ON public.payables(company_id, is_forecast)
  WHERE is_forecast = true;

NOTIFY pgrst, 'reload schema';
