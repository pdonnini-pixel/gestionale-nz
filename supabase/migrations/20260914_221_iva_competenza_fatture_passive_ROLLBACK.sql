-- =====================================================================
-- ROLLBACK 221 — riporta v_iva_componenti_mensili alla regola «mese di
-- ricezione SDI» della migration 193. Nessuna tabella toccata.
-- =====================================================================
BEGIN;

CREATE OR REPLACE VIEW public.v_iva_componenti_mensili
WITH (security_invoker = on) AS
WITH dr AS (
  SELECT company_id,
         EXTRACT(YEAR  FROM date)::int AS year,
         EXTRACT(MONTH FROM date)::int AS month,
         SUM(COALESCE(net_revenue, 0))   AS chiusure_netto,
         SUM(COALESCE(gross_revenue, 0)) AS chiusure_lordo,
         COUNT(DISTINCT date)            AS giorni_chiusura,
         COUNT(DISTINCT outlet_id)       AS outlet_chiusura
  FROM public.daily_revenue
  GROUP BY 1, 2, 3
),
bc AS (
  SELECT company_id, year, month,
         SUM(CASE WHEN entry_type = 'cons_monthly' THEN COALESCE(amount, 0) ELSE 0 END) AS consuntivo_netto,
         SUM(CASE WHEN entry_type = 'rev_monthly'  THEN COALESCE(amount, 0) ELSE 0 END) AS preventivo_netto
  FROM public.budget_confronto
  WHERE account_code LIKE '5101%' AND entry_type IN ('cons_monthly', 'rev_monthly')
  GROUP BY 1, 2, 3
),
att AS (
  SELECT company_id,
         EXTRACT(YEAR  FROM invoice_date)::int AS year,
         EXTRACT(MONTH FROM invoice_date)::int AS month,
         SUM(CASE WHEN tipo_documento IN ('TD04', 'TD08') THEN -ABS(COALESCE(vat_amount, 0))
                  ELSE COALESCE(vat_amount, 0) END) AS iva_fatture_attive,
         COUNT(*) AS n_fatture_attive
  FROM public.active_invoices
  GROUP BY 1, 2, 3
),
pas AS (
  SELECT e.company_id,
         COALESCE(a1.acube_created_at::date, a2.acube_created_at::date, e.invoice_date) AS data_ricezione,
         e.tipo_documento,
         COALESCE(e.vat_amount, 0) AS vat
  FROM public.electronic_invoices e
  LEFT JOIN LATERAL (
    SELECT a.acube_created_at
    FROM public.acube_sdi_invoices a
    WHERE a.direction = 'passive' AND e.sdi_id IS NOT NULL AND a.sdi_file_id = e.sdi_id
    LIMIT 1
  ) a1 ON true
  LEFT JOIN LATERAL (
    SELECT a.acube_created_at
    FROM public.acube_sdi_invoices a
    WHERE a1.acube_created_at IS NULL
      AND a.direction = 'passive'
      AND a.invoice_number = e.invoice_number
      AND a.invoice_date = e.invoice_date
      AND regexp_replace(COALESCE(a.sender_vat, ''), '\D', '', 'g')
          = regexp_replace(COALESCE(e.supplier_vat, ''), '\D', '', 'g')
    LIMIT 1
  ) a2 ON true
  WHERE e.invoice_date IS NOT NULL
),
pasm AS (
  SELECT company_id,
         EXTRACT(YEAR  FROM data_ricezione)::int AS year,
         EXTRACT(MONTH FROM data_ricezione)::int AS month,
         SUM(CASE WHEN tipo_documento IN ('TD04', 'TD08', 'TD16', 'TD17', 'TD18', 'TD19') THEN 0 ELSE vat END) AS iva_fatture_passive,
         SUM(CASE WHEN tipo_documento IN ('TD04', 'TD08') THEN ABS(vat) ELSE 0 END)                           AS iva_note_credito,
         SUM(CASE WHEN tipo_documento IN ('TD16', 'TD17', 'TD18', 'TD19') THEN ABS(vat) ELSE 0 END)           AS iva_integrazioni,
         COUNT(*) FILTER (WHERE tipo_documento IS NULL
                             OR tipo_documento NOT IN ('TD04', 'TD08', 'TD16', 'TD17', 'TD18', 'TD19'))  AS n_fatture_passive,
         COUNT(*) FILTER (WHERE tipo_documento IN ('TD04', 'TD08'))                                       AS n_note_credito,
         COUNT(*) FILTER (WHERE tipo_documento IN ('TD16', 'TD17', 'TD18', 'TD19'))                       AS n_integrazioni
  FROM pas
  GROUP BY 1, 2, 3
),
keys AS (
  SELECT company_id, year, month FROM dr
  UNION SELECT company_id, year, month FROM bc
  UNION SELECT company_id, year, month FROM att
  UNION SELECT company_id, year, month FROM pasm
)
SELECT k.company_id, k.year, k.month,
       COALESCE(dr.chiusure_netto, 0)::numeric(14,2)        AS chiusure_netto,
       COALESCE(dr.chiusure_lordo, 0)::numeric(14,2)        AS chiusure_lordo,
       COALESCE(dr.giorni_chiusura, 0)::int                 AS giorni_chiusura,
       COALESCE(dr.outlet_chiusura, 0)::int                 AS outlet_chiusura,
       COALESCE(bc.consuntivo_netto, 0)::numeric(14,2)      AS consuntivo_netto,
       COALESCE(bc.preventivo_netto, 0)::numeric(14,2)      AS preventivo_netto,
       COALESCE(att.iva_fatture_attive, 0)::numeric(14,2)   AS iva_fatture_attive,
       COALESCE(att.n_fatture_attive, 0)::int               AS n_fatture_attive,
       COALESCE(pasm.iva_fatture_passive, 0)::numeric(14,2) AS iva_fatture_passive,
       COALESCE(pasm.iva_note_credito, 0)::numeric(14,2)    AS iva_note_credito,
       COALESCE(pasm.iva_integrazioni, 0)::numeric(14,2)    AS iva_integrazioni,
       COALESCE(pasm.n_fatture_passive, 0)::int             AS n_fatture_passive,
       COALESCE(pasm.n_note_credito, 0)::int                AS n_note_credito,
       COALESCE(pasm.n_integrazioni, 0)::int                AS n_integrazioni
FROM keys k
LEFT JOIN dr   ON dr.company_id   = k.company_id AND dr.year   = k.year AND dr.month   = k.month
LEFT JOIN bc   ON bc.company_id   = k.company_id AND bc.year   = k.year AND bc.month   = k.month
LEFT JOIN att  ON att.company_id  = k.company_id AND att.year  = k.year AND att.month  = k.month
LEFT JOIN pasm ON pasm.company_id = k.company_id AND pasm.year = k.year AND pasm.month = k.month;

GRANT SELECT ON public.v_iva_componenti_mensili TO authenticated, service_role;

COMMIT;
