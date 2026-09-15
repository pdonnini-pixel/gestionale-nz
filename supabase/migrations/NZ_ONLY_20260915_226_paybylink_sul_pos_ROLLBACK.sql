-- =====================================================================
-- ROLLBACK della 226 — il pay by link torna canale a se'
-- ---------------------------------------------------------------------
-- Riporta i 7 canali «Pay by link» a kind = paybylink senza codice
-- terminale, com'erano prima. Da eseguire solo se si dimostra che il pay
-- by link NON passa dal POS: le prove raccolte dicono il contrario.
-- Dopo il rollback vanno rilanciati riscontro e proiezione.
-- =====================================================================

BEGIN;

UPDATE public.outlet_payment_channels c
   SET kind = 'paybylink', terminal_code = NULL, bank_tolerance_pct = 0, updated_at = now()
 WHERE c.label = 'Pay by link' AND c.is_active;

COMMIT;
