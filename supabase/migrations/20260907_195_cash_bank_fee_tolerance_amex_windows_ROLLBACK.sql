-- Rollback 195: ripristina la UNIQUE su bank_transaction_id (fallisce se un accredito Amex
-- e' gia' stato ripartito su piu' chiusure: in quel caso cancellare prima quegli abbinamenti,
-- con backup) e rimuove la tolleranza. La funzione va riportata alla versione della 192
-- rieseguendo quel file.
ALTER TABLE public.closing_bank_matches DROP CONSTRAINT IF EXISTS closing_bank_matches_tx_closing_key;
ALTER TABLE public.closing_bank_matches ADD CONSTRAINT closing_bank_matches_bank_transaction_id_key UNIQUE (bank_transaction_id);
ALTER TABLE public.outlet_payment_channels DROP CONSTRAINT IF EXISTS outlet_payment_channels_bank_tolerance_pct_check;
ALTER TABLE public.outlet_payment_channels DROP COLUMN IF EXISTS bank_tolerance_pct;
