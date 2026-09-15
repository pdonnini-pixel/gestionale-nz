-- Rollback della 225: rimette i canali Amex su MPS com'erano dopo la 198.
UPDATE public.outlet_payment_channels
   SET kind = 'pos', bank_tolerance_pct = 1.5, updated_at = now()
 WHERE label = 'POS MPS Amex' AND is_active;
