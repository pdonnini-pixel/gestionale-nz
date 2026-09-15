-- Rollback NZ_ONLY 198: riporta "POS MPS Amex" a tipo pos_amex con il codice del canale "POS BCC" dello stesso outlet.
WITH bcc AS (SELECT outlet_id, terminal_code FROM public.outlet_payment_channels WHERE label = 'POS BCC' AND is_active)
UPDATE public.outlet_payment_channels ch SET kind = 'pos_amex', terminal_code = bcc.terminal_code, bank_tolerance_pct = 0
  FROM bcc WHERE ch.outlet_id = bcc.outlet_id AND ch.label = 'POS MPS Amex';
