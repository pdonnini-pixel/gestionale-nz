-- 067 — flag is_cash su chart_of_accounts
-- Scopo: marcare le voci NON di cassa (ammortamenti, variazione rimanenze, accantonamenti,
-- svalutazioni) così da escluderle dalla stima delle uscite del Cashflow Prospettico.
-- Additiva e non distruttiva: ADD COLUMN IF NOT EXISTS + UPDATE di un flag. Nessun DELETE.
-- Default true => comportamento invariato per tutti gli altri conti.
-- Applicata ai 3 tenant (NZ / Made / Zago). Atteso is_cash=false: solo ammortamenti + variazione_rimanenze.

ALTER TABLE public.chart_of_accounts
  ADD COLUMN IF NOT EXISTS is_cash boolean NOT NULL DEFAULT true;

-- Voci NON di cassa: ammortamenti e variazione rimanenze
UPDATE public.chart_of_accounts SET is_cash = false
  WHERE macro_group IN ('ammortamenti','variazione_rimanenze');

-- Accantonamenti / svalutazioni (se presenti come macro_group in un tenant)
UPDATE public.chart_of_accounts SET is_cash = false
  WHERE macro_group ILIKE '%accantonament%' OR macro_group ILIKE '%svalutaz%';
