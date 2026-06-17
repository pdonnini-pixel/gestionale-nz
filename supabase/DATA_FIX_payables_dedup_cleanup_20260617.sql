-- ════════════════════════════════════════════════════════════════════
-- DATA FIX — bonifica payable duplicati (tutti i tenant)
-- Eseguito il 2026-06-17. Solo UPDATE (status='annullato'), NESSUNA cancellazione
-- fisica. Backup completo prima della bonifica.
--
-- Per ogni gruppo (company_id, electronic_invoice_id, COALESCE(installment_number,1))
-- con >1 riga non annullata:
--  - se gli importi divergono (> 0.02) o ci sono più righe "lavorate"
--    (pagate/riconciliate) → NON si annulla: si riporta in
--    payables_dedup_review_20260617 per revisione manuale;
--  - altrimenti si tiene la riga canonica (lavorata, altrimenti la più vecchia
--    per created_at) e si annullano i cloni con nota di audit.
--
-- Stato all'esecuzione: NZ già bonificato (0 gruppi attivi), Made/Zago vuoti →
-- la bonifica è un no-op verificato; lo script resta idempotente e ri-eseguibile.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.payables_bkp_dedup_20260617 AS SELECT * FROM public.payables;

CREATE TABLE IF NOT EXISTS public.payables_dedup_review_20260617 (
  company_id uuid, electronic_invoice_id uuid, installment_number int,
  ids uuid[], gross_amounts numeric[], reason text, flagged_at timestamptz DEFAULT now()
);

-- Flag gruppi non auto-risolvibili (revisione manuale)
WITH grp AS (
  SELECT company_id, electronic_invoice_id, COALESCE(installment_number,1) AS inst,
    array_agg(id ORDER BY
      (COALESCE(amount_paid,0)>0 OR bank_transaction_id IS NOT NULL OR status IN ('pagato','parziale'))::int DESC,
      created_at ASC) AS ids,
    array_agg(gross_amount) AS amts,
    max(gross_amount)-min(gross_amount) AS amt_spread,
    count(*) FILTER (WHERE COALESCE(amount_paid,0)>0 OR bank_transaction_id IS NOT NULL OR status IN ('pagato','parziale')) AS n_worked
  FROM public.payables
  WHERE electronic_invoice_id IS NOT NULL AND status IS DISTINCT FROM 'annullato'
  GROUP BY company_id, electronic_invoice_id, COALESCE(installment_number,1)
  HAVING count(*)>1
)
INSERT INTO public.payables_dedup_review_20260617(company_id, electronic_invoice_id, installment_number, ids, gross_amounts, reason)
SELECT company_id, electronic_invoice_id, inst, ids, amts,
  CASE WHEN amt_spread > 0.02 THEN 'amount_mismatch' ELSE 'multiple_worked_rows' END
FROM grp WHERE amt_spread > 0.02 OR n_worked > 1;

-- Annulla i cloni dei gruppi auto-risolvibili (importi coerenti, ≤1 riga lavorata)
WITH grp AS (
  SELECT array_agg(id ORDER BY
      (COALESCE(amount_paid,0)>0 OR bank_transaction_id IS NOT NULL OR status IN ('pagato','parziale'))::int DESC,
      created_at ASC) AS ids,
    max(gross_amount)-min(gross_amount) AS amt_spread,
    count(*) FILTER (WHERE COALESCE(amount_paid,0)>0 OR bank_transaction_id IS NOT NULL OR status IN ('pagato','parziale')) AS n_worked
  FROM public.payables
  WHERE electronic_invoice_id IS NOT NULL AND status IS DISTINCT FROM 'annullato'
  GROUP BY company_id, electronic_invoice_id, COALESCE(installment_number,1)
  HAVING count(*)>1
),
ok AS (SELECT ids FROM grp WHERE amt_spread <= 0.02 AND n_worked <= 1),
to_annul AS (SELECT unnest(ids[2:array_length(ids,1)]) AS id, ids[1] AS keep_id FROM ok)
UPDATE public.payables p
SET status='annullato', previous_status=p.status,
    notes=concat_ws(' | ', p.notes, format('[dedup 20260617] clone di %s annullato (stessa fattura+rata)', t.keep_id)),
    updated_at=now()
FROM to_annul t WHERE p.id=t.id AND p.status IS DISTINCT FROM 'annullato';
