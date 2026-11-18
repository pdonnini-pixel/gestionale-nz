-- ROLLBACK 441: torna alla vista della 308 (corrispettivi da daily_revenue,
-- fatture di cassa comprese). Le due colonne nuove non si tolgono con
-- CREATE OR REPLACE: si ricrea la vista (nessun dato coinvolto, la vista
-- non ha dipendenti) e si rimettono i permessi.
BEGIN;
DROP VIEW IF EXISTS public.v_iva_componenti_mensili;
CREATE VIEW public.v_iva_componenti_mensili
WITH (security_invoker = on) AS
 WITH dr AS (
         SELECT daily_revenue.company_id,
            EXTRACT(year FROM daily_revenue.date)::integer AS year,
            EXTRACT(month FROM daily_revenue.date)::integer AS month,
            sum(COALESCE(daily_revenue.net_revenue, 0::numeric)) AS chiusure_netto,
            sum(COALESCE(daily_revenue.gross_revenue, 0::numeric)) AS chiusure_lordo,
            count(DISTINCT daily_revenue.date) AS giorni_chiusura,
            count(DISTINCT daily_revenue.outlet_id) AS outlet_chiusura
           FROM daily_revenue
          GROUP BY daily_revenue.company_id, (EXTRACT(year FROM daily_revenue.date)::integer), (EXTRACT(month FROM daily_revenue.date)::integer)
        ), bc AS (
         SELECT budget_confronto.company_id,
            budget_confronto.year,
            budget_confronto.month,
            sum(
                CASE
                    WHEN budget_confronto.entry_type = 'cons_monthly'::text THEN COALESCE(budget_confronto.amount, 0::numeric)
                    ELSE 0::numeric
                END) AS consuntivo_netto,
            sum(
                CASE
                    WHEN budget_confronto.entry_type = 'rev_monthly'::text THEN COALESCE(budget_confronto.amount, 0::numeric)
                    ELSE 0::numeric
                END) AS preventivo_netto
           FROM budget_confronto
          WHERE budget_confronto.account_code ~~ '5101%'::text AND (budget_confronto.entry_type = ANY (ARRAY['cons_monthly'::text, 'rev_monthly'::text]))
          GROUP BY budget_confronto.company_id, budget_confronto.year, budget_confronto.month
        ), att AS (
         SELECT active_invoices.company_id,
            EXTRACT(year FROM active_invoices.invoice_date)::integer AS year,
            EXTRACT(month FROM active_invoices.invoice_date)::integer AS month,
            sum(
                CASE
                    WHEN active_invoices.tipo_documento = ANY (ARRAY['TD04'::text, 'TD08'::text]) THEN - COALESCE(active_invoices.vat_amount, 0::numeric)
                    ELSE COALESCE(active_invoices.vat_amount, 0::numeric)
                END) AS iva_fatture_attive,
            count(*) AS n_fatture_attive
           FROM active_invoices
          GROUP BY active_invoices.company_id, (EXTRACT(year FROM active_invoices.invoice_date)::integer), (EXTRACT(month FROM active_invoices.invoice_date)::integer)
        ), chiusure AS (
         SELECT vat_settlements.company_id,
            vat_settlements.year,
            vat_settlements.month,
            COALESCE(vat_settlements.registro_chiuso_il, (vat_settlements.confirmed_at AT TIME ZONE 'Europe/Rome'::text)::date) AS chiuso_il
           FROM vat_settlements
        ), pas0 AS (
         SELECT e.company_id,
            e.invoice_date,
            COALESCE(a1.acube_created_at::date, a2.acube_created_at::date) AS ricezione,
            COALESCE(vs.competenza_cutoff_day, 15) AS cutoff_day,
            e.tipo_documento,
            COALESCE(e.vat_amount, 0::numeric) - COALESCE(e.vat_non_detraibile, 0::numeric) AS vat
           FROM electronic_invoices e
             LEFT JOIN vat_settings vs ON vs.company_id = e.company_id
             LEFT JOIN LATERAL ( SELECT a.acube_created_at
                   FROM acube_sdi_invoices a
                  WHERE a.direction = 'passive'::text AND e.sdi_id IS NOT NULL AND a.sdi_file_id = e.sdi_id
                 LIMIT 1) a1 ON true
             LEFT JOIN LATERAL ( SELECT a.acube_created_at
                   FROM acube_sdi_invoices a
                  WHERE a1.acube_created_at IS NULL AND a.direction = 'passive'::text AND a.invoice_number = e.invoice_number AND a.invoice_date = e.invoice_date AND regexp_replace(COALESCE(a.sender_vat, ''::text), '\D'::text, ''::text, 'g'::text) = regexp_replace(COALESCE(e.supplier_vat, ''::text), '\D'::text, ''::text, 'g'::text)
                 LIMIT 1) a2 ON true
          WHERE e.invoice_date IS NOT NULL
        ), pas1 AS (
         SELECT p.company_id,
            p.invoice_date,
            p.ricezione,
            p.cutoff_day,
            p.tipo_documento,
            p.vat,
            COALESCE(cm.chiuso_il, (date_trunc('month'::text, p.invoice_date::timestamp with time zone) + '1 mon'::interval)::date + (p.cutoff_day - 1)) AS limite_mese,
            cr.chiuso_il AS chiusura_mese_ricezione
           FROM pas0 p
             LEFT JOIN chiusure cm ON cm.company_id = p.company_id AND cm.year = EXTRACT(year FROM p.invoice_date)::integer AND cm.month = EXTRACT(month FROM p.invoice_date)::integer
             LEFT JOIN chiusure cr ON p.ricezione IS NOT NULL AND cr.company_id = p.company_id AND cr.year = EXTRACT(year FROM p.ricezione)::integer AND cr.month = EXTRACT(month FROM p.ricezione)::integer
        ), pas AS (
         SELECT pas1.company_id,
                CASE
                    WHEN pas1.ricezione IS NULL THEN pas1.invoice_date
                    WHEN pas1.ricezione <= pas1.limite_mese THEN pas1.invoice_date
                    WHEN pas1.chiusura_mese_ricezione IS NOT NULL AND pas1.ricezione > pas1.chiusura_mese_ricezione THEN (date_trunc('month'::text, pas1.ricezione::timestamp with time zone) + '1 mon'::interval)::date
                    ELSE pas1.ricezione
                END AS data_competenza,
            pas1.tipo_documento,
            pas1.vat
           FROM pas1
        ), pasm AS (
         SELECT pas.company_id,
            EXTRACT(year FROM pas.data_competenza)::integer AS year,
            EXTRACT(month FROM pas.data_competenza)::integer AS month,
            sum(
                CASE
                    WHEN pas.tipo_documento = ANY (ARRAY['TD04'::text, 'TD08'::text, 'TD16'::text, 'TD17'::text, 'TD18'::text, 'TD19'::text]) THEN 0::numeric
                    ELSE pas.vat
                END) AS iva_fatture_passive,
            sum(
                CASE
                    WHEN pas.tipo_documento = ANY (ARRAY['TD04'::text, 'TD08'::text]) THEN pas.vat
                    ELSE 0::numeric
                END) AS iva_note_credito,
            sum(
                CASE
                    WHEN pas.tipo_documento = ANY (ARRAY['TD16'::text, 'TD17'::text, 'TD18'::text, 'TD19'::text]) THEN abs(pas.vat)
                    ELSE 0::numeric
                END) AS iva_integrazioni,
            count(*) FILTER (WHERE pas.tipo_documento IS NULL OR (pas.tipo_documento <> ALL (ARRAY['TD04'::text, 'TD08'::text, 'TD16'::text, 'TD17'::text, 'TD18'::text, 'TD19'::text]))) AS n_fatture_passive,
            count(*) FILTER (WHERE pas.tipo_documento = ANY (ARRAY['TD04'::text, 'TD08'::text])) AS n_note_credito,
            count(*) FILTER (WHERE pas.tipo_documento = ANY (ARRAY['TD16'::text, 'TD17'::text, 'TD18'::text, 'TD19'::text])) AS n_integrazioni
           FROM pas
          GROUP BY pas.company_id, (EXTRACT(year FROM pas.data_competenza)::integer), (EXTRACT(month FROM pas.data_competenza)::integer)
        ), keys AS (
         SELECT dr_1.company_id,
            dr_1.year,
            dr_1.month
           FROM dr dr_1
        UNION
         SELECT bc_1.company_id,
            bc_1.year,
            bc_1.month
           FROM bc bc_1
        UNION
         SELECT att_1.company_id,
            att_1.year,
            att_1.month
           FROM att att_1
        UNION
         SELECT pasm_1.company_id,
            pasm_1.year,
            pasm_1.month
           FROM pasm pasm_1
        )
 SELECT k.company_id,
    k.year,
    k.month,
    COALESCE(dr.chiusure_netto, 0::numeric)::numeric(14,2) AS chiusure_netto,
    COALESCE(dr.chiusure_lordo, 0::numeric)::numeric(14,2) AS chiusure_lordo,
    COALESCE(dr.giorni_chiusura, 0::bigint)::integer AS giorni_chiusura,
    COALESCE(dr.outlet_chiusura, 0::bigint)::integer AS outlet_chiusura,
    COALESCE(bc.consuntivo_netto, 0::numeric)::numeric(14,2) AS consuntivo_netto,
    COALESCE(bc.preventivo_netto, 0::numeric)::numeric(14,2) AS preventivo_netto,
    COALESCE(att.iva_fatture_attive, 0::numeric)::numeric(14,2) AS iva_fatture_attive,
    COALESCE(att.n_fatture_attive, 0::bigint)::integer AS n_fatture_attive,
    COALESCE(pasm.iva_fatture_passive, 0::numeric)::numeric(14,2) AS iva_fatture_passive,
    COALESCE(pasm.iva_note_credito, 0::numeric)::numeric(14,2) AS iva_note_credito,
    COALESCE(pasm.iva_integrazioni, 0::numeric)::numeric(14,2) AS iva_integrazioni,
    COALESCE(pasm.n_fatture_passive, 0::bigint)::integer AS n_fatture_passive,
    COALESCE(pasm.n_note_credito, 0::bigint)::integer AS n_note_credito,
    COALESCE(pasm.n_integrazioni, 0::bigint)::integer AS n_integrazioni
   FROM keys k
     LEFT JOIN dr ON dr.company_id = k.company_id AND dr.year = k.year AND dr.month = k.month
     LEFT JOIN bc ON bc.company_id = k.company_id AND bc.year = k.year AND bc.month = k.month
     LEFT JOIN att ON att.company_id = k.company_id AND att.year = k.year AND att.month = k.month
     LEFT JOIN pasm ON pasm.company_id = k.company_id AND pasm.year = k.year AND pasm.month = k.month;

GRANT SELECT ON public.v_iva_componenti_mensili TO authenticated, service_role;
COMMENT ON VIEW public.v_iva_componenti_mensili IS 'Componenti mensili della liquidazione IVA (migration 193/221/222/223/308).';
COMMIT;
