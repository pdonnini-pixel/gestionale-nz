-- =====================================================================
-- NZ_ONLY 141 — Ripristino rata "saldo" nascosta per errore dal dedup 106
-- =====================================================================
-- CASO SEGNALATO (Patrizio, 06/08/2026): fattura 32 di 999 SRL mostrata come
-- "pagata per pieno" nello scadenzario, mentre in realtà era stato pagato solo
-- un acconto (rata 1/2, €2.627,27, bonifico del 13/07 "SALDO FATTURA 32").
-- La seconda rata (il saldo, €2.627,27) risultava invisibile.
--
-- CAUSA RADICE: la migration 106 (dedup doppioni go-live) marca is_placeholder
-- clusterizzando per (company_id, supplier_name, invoice_number, round(gross_amount))
-- SENZA considerare installment_number. Un piano a rate uguali (es. 2 rate da
-- €2.627,27 su fattura da €5.254,54) ha entrambe le rate con lo stesso importo
-- arrotondato → finiscono nello stesso cluster → una rata viene tenuta e le altre
-- marcate come "doppione" (is_placeholder=true), sparendo dallo scadenzario
-- (vista v_payables_operative) e dal motore di riconciliazione.
--
-- Le rate NON sono doppioni: si distinguono per installment_number. Questo è un
-- FALSO POSITIVO del dedup, non un doppione reale.
--
-- AMBITO: i piani a rate sono DATO solo di New Zago (popolati dal file Sabrina,
-- vedi PAYMENT_PLAN_NOTES.md) → Made e Zago hanno 0 righe di questa classe
-- (verificato). Perciò NZ_ONLY.
--
-- QUESTO FILE: solo il caso segnalato (999 SRL, fattura 32, rata 2/2).
-- La bonifica massiva delle altre ~213 rate nascoste è in un file separato,
-- da applicare solo dopo conferma di Patrizio.
--
-- Reversibile: basta rimettere is_placeholder=true (o ripristinare dal backup
-- public.payables_installment_placeholder_backup_20260806, 214 righe).
-- =====================================================================

-- 1) Backup di sicurezza di TUTTE le rate marcate placeholder (additivo, non distruttivo)
CREATE TABLE IF NOT EXISTS public.payables_installment_placeholder_backup_20260806 AS
SELECT * FROM public.payables
WHERE is_placeholder = true AND installment_number IS NOT NULL
  AND invoice_number IS NOT NULL AND invoice_number <> '';

-- 2) Ripristino della rata saldo 2/2 della fattura 32 di 999 SRL (P.IVA 04312281209)
UPDATE public.payables
SET is_placeholder = false, updated_at = now()
WHERE supplier_id = (SELECT id FROM public.suppliers WHERE partita_iva = '04312281209' OR vat_number = '04312281209' LIMIT 1)
  AND invoice_number = '32'
  AND installment_number = 2
  AND installment_total = 2
  AND is_placeholder = true;

-- 3) Verifica: la fattura 32 deve mostrare 2 rate nello scadenzario operativo,
--    una pagata (€2.627,27) e una scaduta/saldo (€2.627,27), totale €5.254,54.
-- SELECT invoice_number, gross_amount, amount_paid, amount_remaining, status, due_date
-- FROM public.v_payables_operative
-- WHERE supplier_vat = '04312281209' AND invoice_number = '32'
-- ORDER BY status;
