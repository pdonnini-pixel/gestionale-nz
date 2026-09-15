-- =====================================================================
-- 221 — Liquidazione IVA: fatture passive per COMPETENZA (regola del commercialista)
-- =====================================================================
-- COSA CAMBIA: la vista v_iva_componenti_mensili (migration 193) attribuiva
-- ogni fattura passiva al mese di RICEZIONE SDI. Il confronto con il registro
-- acquisti di agosto 2026 del commercialista (file Fattura SMART, 128 fatture,
-- IVA 55.762 €) ha mostrato che lui lavora per competenza: una fattura va nel
-- mese della sua data se arriva entro il 15 del mese successivo (facolta' di
-- legge, art. 1 c. 1 DPR 100/1998); solo se arriva dopo il 15 va nel mese di
-- ricezione. Con la regola del gestionale agosto valeva 41.404 € di credito
-- (44 fatture datate agosto ma arrivate dal 1° al 9 settembre finivano a
-- settembre, 13 fatture datate luglio arrivate ad agosto finivano ad agosto).
--
-- REGOLA NUOVA (data_competenza):
--   ricezione assente (import manuale)                      -> data fattura
--   ricezione <= 15 del mese successivo alla data fattura   -> data fattura
--   ricezione oltre il 15 del mese successivo               -> data ricezione
--
-- Nessun'altra colonna cambia: il frontend (src/lib/ivaLiquidazione.ts) resta
-- identico. La vista resta security_invoker.
-- REGOLA #0: applicare su NZ -> Made -> Zago.
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
pas0 AS (
  -- Fatture passive con la data di ricezione SDI (A-Cube): aggancio per
  -- sdi_file_id, poi per numero+data+P.IVA; senza aggancio (import manuali) NULL.
  SELECT e.company_id,
         e.invoice_date,
         COALESCE(a1.acube_created_at::date, a2.acube_created_at::date) AS ricezione,
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
pas AS (
  -- Competenza: data fattura se ricevuta entro il 15 del mese successivo,
  -- altrimenti data di ricezione (regola del registro acquisti del commercialista).
  SELECT company_id,
         CASE
           WHEN ricezione IS NULL THEN invoice_date
           WHEN ricezione <= (date_trunc('month', invoice_date) + interval '1 month 14 days')::date THEN invoice_date
           ELSE ricezione
         END AS data_competenza,
         tipo_documento,
         vat
  FROM pas0
),
pasm AS (
  SELECT company_id,
         EXTRACT(YEAR  FROM data_competenza)::int AS year,
         EXTRACT(MONTH FROM data_competenza)::int AS month,
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
SELECT k.company_id,
       k.year,
       k.month,
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

COMMENT ON VIEW public.v_iva_componenti_mensili IS 'Mattoni della liquidazione IVA per azienda/anno/mese: corrispettivi netti (chiusure, consuntivo, preventivo), IVA fatture attive, IVA fatture passive per COMPETENZA (data fattura se ricevuta via SDI entro il 15 del mese successivo, altrimenti data di ricezione), note di credito e integrazioni reverse charge a parte. security_invoker: rispetta la RLS delle tabelle sottostanti.';
GRANT SELECT ON public.v_iva_componenti_mensili TO authenticated, service_role;

COMMIT;

-- VERIFICA (NZ, agosto 2026): iva_fatture_passive attesa ~ 56.263 (55.762 del
-- registro del commercialista + 501 di fatture di luglio/agosto arrivate ad
-- agosto che lui ha messo altrove), note di credito ~ 652, integrazioni a parte.
-- select month, iva_fatture_passive, iva_note_credito, n_fatture_passive from v_iva_componenti_mensili where year=2026 and month in (7,8,9) order by month;
-- select reloptions from pg_class where oid = 'public.v_iva_componenti_mensili'::regclass;  -- {security_invoker=on}
