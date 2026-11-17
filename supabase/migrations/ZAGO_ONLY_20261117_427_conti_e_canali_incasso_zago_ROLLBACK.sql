-- ROLLBACK ZAGO_ONLY 427 — solo Zago. Disattiva (non cancella) canali e conti creati dalla 427.
UPDATE public.outlet_payment_channels c SET is_active = false FROM public.outlets o
 WHERE o.id = c.outlet_id AND o.code IN ('ZAGO-FI','ZAGO-FDM');
UPDATE public.bank_accounts SET is_active = false WHERE note = 'Creato il 17/11/2026 dalla mail di Veronica (conti attivi di Zago).';
