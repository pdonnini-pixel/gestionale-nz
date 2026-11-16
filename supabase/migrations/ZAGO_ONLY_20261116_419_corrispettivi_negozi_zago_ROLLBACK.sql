-- ROLLBACK ZAGO_ONLY 419 — solo Zago. Riattiva i 7 conti e disattiva (non cancella) i due nuovi.
UPDATE public.chart_of_accounts SET is_active = true, updated_at = now()
 WHERE code IN ('510107','510108','510110','510112','510114','510122','510124') AND NOT is_active;
UPDATE public.chart_of_accounts SET is_active = false, updated_at = now()
 WHERE code IN ('510130','510131') AND is_active;
