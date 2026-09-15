-- =====================================================================
-- NZ_ONLY 142 — Bonifica massiva: ripristina TUTTE le rate genuine nascoste
--               per errore dal dedup 106
-- =====================================================================
-- Segue NZ_ONLY 141 (caso 999 SRL). Stessa causa radice: la migration 106
-- (dedup doppioni go-live) ha marcato is_placeholder=true su rate genuine di
-- piani a rate uguali, perché clusterizza per (fornitore, n.fattura, importo
-- arrotondato) SENZA installment_number. Vedi PAYMENT_PLAN_NOTES.md.
--
-- Analisi (06/08/2026, dato verificato su NZ):
--  - Nessuna "installment identity" (fornitore, fattura, importo arrotondato,
--    installment_number) ha più di una riga → NESSUN doppione reale tra le rate.
--  - Nessuna identity ha contemporaneamente una riga visibile e una nascosta.
--  → Le rate nascoste sono tutte falsi positivi del dedup, non doppioni.
--
-- CRITERIO SICURO di ripristino (un-hide):
--   is_placeholder = true
--   AND installment_number IS NOT NULL           -- è una rata
--   AND invoice_number valorizzato
--   AND status <> 'annullato'                     -- esclude righe annullate
--   AND nessun "fratello" NON-rata visibile nel cluster (anti doppio conteggio)
-- Escluse (restano nascoste, corretto): MINGARDO SRLS 48 rata 4 (annullato),
-- SP CONTABILE 322/E rata 1/1 (annullato, doppione di una riga pagata visibile).
--
-- Impatto atteso: 211 rate ripristinate, ~€238.655 di residuo che torna visibile
-- nello scadenzario. Ambito NZ_ONLY (Made/Zago: 0 righe di questa classe).
-- Reversibile: rollback ri-marca placeholder; backup completo in
-- public.payables_installment_placeholder_backup_20260806 (214 righe).
-- =====================================================================

-- Backup di sicurezza (idempotente; già creato dalla 141)
CREATE TABLE IF NOT EXISTS public.payables_installment_placeholder_backup_20260806 AS
SELECT * FROM public.payables
WHERE is_placeholder = true AND installment_number IS NOT NULL
  AND invoice_number IS NOT NULL AND invoice_number <> '';

UPDATE public.payables p
SET is_placeholder = false, updated_at = now()
WHERE p.is_placeholder = true
  AND p.installment_number IS NOT NULL
  AND p.invoice_number IS NOT NULL AND p.invoice_number <> ''
  AND p.status <> 'annullato'
  AND NOT EXISTS (
    SELECT 1 FROM public.payables s
    WHERE s.company_id = p.company_id AND s.supplier_name = p.supplier_name
      AND s.invoice_number = p.invoice_number AND round(s.gross_amount) = round(p.gross_amount)
      AND s.installment_number IS NULL AND s.is_placeholder = false
  );

-- Verifica:
-- SELECT COUNT(*) FROM public.payables
-- WHERE is_placeholder = true AND installment_number IS NOT NULL;  -- attese: solo le annullate
