-- =============================================================================
-- ROLLBACK NZ_ONLY 181 — EPPI torna a "30 gg DFFM"
-- =============================================================================
BEGIN;

UPDATE public.suppliers
SET payment_base = 'fine_mese',
    prima_scadenza_gg = 30,
    numero_rate = 1,
    payment_terms = 30,
    default_payment_terms = 30,
    updated_at = now()
WHERE partita_iva = '07355140489';

-- Ripristina le due scadenze aperte ai valori del 04/09/2026 prima della modifica.
UPDATE public.payables SET due_date = '2026-09-30', updated_at = now()
WHERE supplier_name ILIKE '%EPPI%' AND invoice_number = '32' AND status <> 'pagato';

UPDATE public.payables SET due_date = '2026-10-31', updated_at = now()
WHERE supplier_name ILIKE '%EPPI%' AND invoice_number = '36' AND status <> 'pagato';

COMMIT;
