-- =====================================================================
-- 223 — Liquidazione IVA: la data di chiusura del registro chiude il mese
-- =====================================================================
-- La 221/222 attribuiscono le fatture passive per competenza con un giorno
-- limite fisso (vat_settings.competenza_cutoff_day, default 15). Il registro
-- del commercialista pero' non chiude a giorno fisso: chiude quando lo studio
-- fa la liquidazione, e da quel momento tutto cio' che arriva va nel mese
-- dopo. Su NZ: luglio 2026 chiuso il 3 agosto (le fatture di luglio arrivate
-- dal 4 agosto sono finite in agosto), agosto chiuso il 9 settembre.
-- Con il giorno fisso 15 la vista dava per agosto 31.286,59 di IVA acquisti
-- contro i 55.761,98 del registro: un numero che non serve a nessuno.
--
-- COSA INTRODUCE:
--   * vat_settlements.registro_chiuso_il (date, facoltativa): il giorno in
--     cui il registro del mese e' stato chiuso. Se manca, un mese confermato
--     si considera chiuso il giorno della conferma (confirmed_at).
--   * v_iva_componenti_mensili: per una fattura datata nel mese M ricevuta
--     via SDI il giorno R:
--       - limite(M) = chiusura del registro di M se M e' confermato,
--                     altrimenti il giorno limite standard di M+1 (222);
--       - R <= limite(M)  -> mese M (data fattura);
--       - altrimenti      -> mese di R; se anche il mese di R risulta gia'
--                            chiuso prima di R, il mese successivo.
--     Senza data di ricezione (import manuali) resta la data fattura.
--   I mesi non confermati continuano a usare il giorno limite standard: il
--   previsionale non cambia comportamento, cambia solo quando un mese viene
--   chiuso per davvero.
-- Additiva. REGOLA #0: NZ -> Made -> Zago.
-- =====================================================================
BEGIN;

ALTER TABLE public.vat_settlements
  ADD COLUMN IF NOT EXISTS registro_chiuso_il date;
COMMENT ON COLUMN public.vat_settlements.registro_chiuso_il IS 'Giorno in cui il registro IVA acquisti del mese e'' stato chiuso: le fatture del mese ricevute dopo questa data vanno nel mese di ricezione. Se NULL vale la data della conferma (confirmed_at).';

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
chiusure AS (
  -- Giorno di chiusura del registro per ogni mese confermato (data esplicita,
  -- altrimenti il giorno della conferma).
  SELECT company_id, year, month,
         COALESCE(registro_chiuso_il, (confirmed_at AT TIME ZONE 'Europe/Rome')::date) AS chiuso_il
  FROM public.vat_settlements
),
pas0 AS (
  -- Fatture passive con la data di ricezione SDI (A-Cube): aggancio per
  -- sdi_file_id, poi per numero+data+P.IVA; senza aggancio (import manuali) NULL.
  SELECT e.company_id,
         e.invoice_date,
         COALESCE(a1.acube_created_at::date, a2.acube_created_at::date) AS ricezione,
         COALESCE(vs.competenza_cutoff_day, 15) AS cutoff_day,
         e.tipo_documento,
         COALESCE(e.vat_amount, 0) AS vat
  FROM public.electronic_invoices e
  LEFT JOIN public.vat_settings vs ON vs.company_id = e.company_id
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
pas1 AS (
  -- limite del mese della fattura: chiusura del registro se il mese e'
  -- confermato, altrimenti il giorno limite standard del mese successivo
  SELECT p.*,
         COALESCE(cm.chiuso_il,
                  (date_trunc('month', p.invoice_date) + interval '1 month')::date + (p.cutoff_day - 1)) AS limite_mese,
         cr.chiuso_il AS chiusura_mese_ricezione
  FROM pas0 p
  LEFT JOIN chiusure cm ON cm.company_id = p.company_id
                       AND cm.year  = EXTRACT(YEAR  FROM p.invoice_date)::int
                       AND cm.month = EXTRACT(MONTH FROM p.invoice_date)::int
  LEFT JOIN chiusure cr ON p.ricezione IS NOT NULL
                       AND cr.company_id = p.company_id
                       AND cr.year  = EXTRACT(YEAR  FROM p.ricezione)::int
                       AND cr.month = EXTRACT(MONTH FROM p.ricezione)::int
),
pas AS (
  SELECT company_id,
         CASE
           WHEN ricezione IS NULL THEN invoice_date
           WHEN ricezione <= limite_mese THEN invoice_date
           WHEN chiusura_mese_ricezione IS NOT NULL AND ricezione > chiusura_mese_ricezione
                THEN (date_trunc('month', ricezione) + interval '1 month')::date
           ELSE ricezione
         END AS data_competenza,
         tipo_documento,
         vat
  FROM pas1
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

COMMENT ON VIEW public.v_iva_componenti_mensili IS 'Mattoni della liquidazione IVA per azienda/anno/mese: corrispettivi netti (chiusure, consuntivo, preventivo), IVA fatture attive, IVA fatture passive per COMPETENZA: una fattura del mese M ricevuta via SDI entro la chiusura del registro di M (vat_settlements.registro_chiuso_il, o la data di conferma; per i mesi non confermati il giorno limite vat_settings.competenza_cutoff_day di M+1, default 15) resta in M, altrimenti va nel mese di ricezione (o nel successivo se anche quello e'' gia'' chiuso). Note di credito e integrazioni reverse charge a parte. security_invoker: rispetta la RLS delle tabelle sottostanti.';
GRANT SELECT ON public.v_iva_componenti_mensili TO authenticated, service_role;

COMMIT;

-- VERIFICA: select column_name from information_schema.columns where table_name='vat_settlements' and column_name='registro_chiuso_il';
--          select reloptions from pg_class where oid = 'public.v_iva_componenti_mensili'::regclass;  -- {security_invoker=on}
