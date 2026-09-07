-- =============================================================================
-- NZ_ONLY 181 — EPPI S.R.L.: piano di pagamento "A Vista"
-- =============================================================================
-- Richiesta di Patrizio (04/09/2026): a EPPI restano da pagare solo la fattura 32
-- e la 36, entrambe scadute, e il fornitore va messo "a vista".
--
-- SITUAZIONE PRIMA
--   suppliers 731acd47-6bba-4835-9bdc-dd452b8d1db4 (EPPI S.R.L., P.IVA 07355140489):
--     payment_base 'fine_mese', prima_scadenza_gg 30, numero_rate 1,
--     payment_terms 30, default_payment_terms 30   -> etichetta "30 gg DFFM"
--   Con quel piano la fattura 32 del 03/08 scadeva il 30/09 e la 36 del 03/09 il 31/10.
--   Il piano però contraddiceva lo storico: le fatture 4, 8, 11, 16 e 24 hanno tutte
--   due_date = invoice_date, cioè sono sempre state gestite a vista.
--
-- COSA FA
--   1. Piano fornitore -> A Vista: payment_base 'data_fattura', prima_scadenza_gg 0,
--      numero_rate 1 (scheduleLabel in src/lib/paymentSchedule.ts rende "A Vista"),
--      con payment_terms e default_payment_terms allineati a 0.
--   2. Riallinea le scadenze EPPI ancora aperte: due_date = invoice_date.
--      Tocca solo le non pagate, quindi la 32 (03/08) e la 36 (03/09), che passano
--      entrambe a 'scaduto' per effetto del trigger trg_payable_status.
--      original_due_date conserva la scadenza calcolata col vecchio piano.
--
-- Nessuna riga cancellata, nessuno storico riscritto: le sette fatture pagate
-- restano com'erano.
-- =============================================================================

BEGIN;

UPDATE public.suppliers
SET payment_base = 'data_fattura',
    prima_scadenza_gg = 0,
    numero_rate = 1,
    payment_terms = 0,
    default_payment_terms = 0,
    updated_at = now()
WHERE partita_iva = '07355140489';

UPDATE public.payables
SET due_date = invoice_date, updated_at = now()
WHERE supplier_name ILIKE '%EPPI%'
  AND status <> 'pagato'
  AND invoice_date IS NOT NULL;

COMMIT;

-- =============================================================================
-- ESITO VERIFICATO
--   32  03/08/2026  3.050,00  scaduto
--   36  03/09/2026  3.050,00  scaduto
--   tutte le altre (4, 8, 11, 16, 20, 24): pagate, intatte.
-- =============================================================================
