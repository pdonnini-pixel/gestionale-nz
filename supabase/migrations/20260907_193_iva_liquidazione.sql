-- =====================================================================
-- 193 — Liquidazione IVA mensile previsionale
-- =====================================================================
-- COSA MANCAVA (audit AUDIT_IVA_PREVISIONALE_2026-09-03.md): il gestionale
-- aveva tutte le fatture passive con l'imposta, le fatture attive e da
-- settembre 2026 le chiusure di cassa (daily_revenue, netto IVA), ma nessun
-- punto in cui questi numeri venissero messi insieme per stimare la
-- liquidazione IVA del mese. Le scadenze IVA in fiscal_deadlines venivano
-- scritte a mano, e senza righe future il Cashflow Prospettico non
-- prevedeva alcuna uscita IVA.
--
-- COSA INTRODUCE:
--   * vat_settings    — parametri IVA per azienda: aliquota vendite (default
--     22%), periodicita', mese di partenza del calcolo e credito IVA
--     iniziale (riporto). Una riga per company.
--   * vat_settlements — i mesi CONFERMATI: quando Patrizio/il commercialista
--     hanno i numeri definitivi, la riga sostituisce la stima e chiude la
--     catena del riporto (credito del mese precedente).
--   * v_iva_componenti_mensili — vista (security_invoker) con, per azienda,
--     anno e mese, i mattoni della liquidazione:
--       - corrispettivi netti dalle chiusure di cassa (daily_revenue),
--         consuntivo e preventivo mensile (budget_confronto, conti 5101xx)
--       - IVA delle fatture attive (per data fattura, note di credito TD04
--         sottratte)
--       - IVA delle fatture passive per MESE DI RICEZIONE SDI (data in cui
--         A-Cube le ha ricevute: e' il mese in cui l'IVA diventa detraibile),
--         con le note di credito a parte e le integrazioni reverse charge
--         (TD16/17/18/19) a parte perche' neutre (debito = credito).
--     Il calcolo vero e proprio (fonte da usare per i corrispettivi, aliquota,
--     riporto del credito, scadenza) sta nel frontend: src/lib/ivaLiquidazione.ts.
--
-- Additiva: nessun DROP, nessuna modifica a tabelle esistenti.
-- REGOLA #0: applicare su NZ -> Made -> Zago.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- 1. Parametri IVA per azienda
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vat_settings (
  company_id      uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  sales_vat_rate  numeric(5,2)  NOT NULL DEFAULT 22 CHECK (sales_vat_rate >= 0 AND sales_vat_rate <= 100),
  periodicity     text          NOT NULL DEFAULT 'mensile' CHECK (periodicity IN ('mensile', 'trimestrale')),
  start_year      integer,
  start_month     integer CHECK (start_month BETWEEN 1 AND 12),
  opening_credit  numeric(14,2) NOT NULL DEFAULT 0,
  acconto_base    numeric(14,2),
  notes           text,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now()
);
COMMENT ON TABLE  public.vat_settings IS 'Parametri della liquidazione IVA per azienda (aliquota vendite, periodicita, mese di partenza, credito iniziale).';
COMMENT ON COLUMN public.vat_settings.sales_vat_rate IS 'Aliquota applicata ai corrispettivi netti per stimare l''IVA a debito (default 22).';
COMMENT ON COLUMN public.vat_settings.start_year  IS 'Primo mese da cui parte la catena del riporto (anno).';
COMMENT ON COLUMN public.vat_settings.start_month IS 'Primo mese da cui parte la catena del riporto (mese 1-12).';
COMMENT ON COLUMN public.vat_settings.opening_credit IS 'Credito IVA da riportare nel mese di partenza (0 se il mese precedente era a debito).';
COMMENT ON COLUMN public.vat_settings.acconto_base IS 'Base per l''acconto IVA di dicembre col metodo storico (liquidazione di dicembre dell''anno prima). NULL = non impostata.';

ALTER TABLE public.vat_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vat_settings_select ON public.vat_settings;
CREATE POLICY vat_settings_select ON public.vat_settings
  FOR SELECT USING (company_id = public.get_my_company_id());
DROP POLICY IF EXISTS vat_settings_write ON public.vat_settings;
CREATE POLICY vat_settings_write ON public.vat_settings
  FOR ALL USING (company_id = public.get_my_company_id()
                 AND public.get_my_role()::text IN ('super_advisor', 'contabile', 'cfo'))
  WITH CHECK (company_id = public.get_my_company_id()
              AND public.get_my_role()::text IN ('super_advisor', 'contabile', 'cfo'));
DROP POLICY IF EXISTS cash_operator_block ON public.vat_settings;
CREATE POLICY cash_operator_block ON public.vat_settings AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (COALESCE(public.get_my_role()::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE(public.get_my_role()::text, '') <> 'operatore_cassa');

DROP TRIGGER IF EXISTS trg_vat_settings_updated_at ON public.vat_settings;
CREATE TRIGGER trg_vat_settings_updated_at
  BEFORE UPDATE ON public.vat_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- 2. Mesi confermati (numeri definitivi che sostituiscono la stima)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vat_settlements (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year                        integer NOT NULL,
  month                       integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  corrispettivi_netti         numeric(14,2) NOT NULL DEFAULT 0,
  iva_debito_corrispettivi    numeric(14,2) NOT NULL DEFAULT 0,
  iva_debito_fatture_attive   numeric(14,2) NOT NULL DEFAULT 0,
  iva_credito                 numeric(14,2) NOT NULL DEFAULT 0,
  iva_riporto_precedente      numeric(14,2) NOT NULL DEFAULT 0,
  importo                     numeric(14,2) NOT NULL DEFAULT 0,
  fonte_corrispettivi         text,
  fiscal_deadline_id          uuid REFERENCES public.fiscal_deadlines(id) ON DELETE SET NULL,
  note                        text,
  confirmed_by                uuid,
  confirmed_at                timestamptz NOT NULL DEFAULT now(),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, year, month)
);
COMMENT ON TABLE public.vat_settlements IS 'Liquidazioni IVA confermate (numeri definitivi). Importo > 0 = da versare con F24, < 0 = credito riportato al mese dopo.';

ALTER TABLE public.vat_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vat_settlements_select ON public.vat_settlements;
CREATE POLICY vat_settlements_select ON public.vat_settlements
  FOR SELECT USING (company_id = public.get_my_company_id());
DROP POLICY IF EXISTS vat_settlements_write ON public.vat_settlements;
CREATE POLICY vat_settlements_write ON public.vat_settlements
  FOR ALL USING (company_id = public.get_my_company_id()
                 AND public.get_my_role()::text IN ('super_advisor', 'contabile', 'cfo'))
  WITH CHECK (company_id = public.get_my_company_id()
              AND public.get_my_role()::text IN ('super_advisor', 'contabile', 'cfo'));
DROP POLICY IF EXISTS cash_operator_block ON public.vat_settlements;
CREATE POLICY cash_operator_block ON public.vat_settlements AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (COALESCE(public.get_my_role()::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE(public.get_my_role()::text, '') <> 'operatore_cassa');

DROP TRIGGER IF EXISTS trg_vat_settlements_updated_at ON public.vat_settlements;
CREATE TRIGGER trg_vat_settlements_updated_at
  BEFORE UPDATE ON public.vat_settlements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- 3. Vista: i mattoni della liquidazione, per azienda / anno / mese
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_iva_componenti_mensili
WITH (security_invoker = on) AS
WITH dr AS (
  -- Chiusure di cassa confermate (proiettate in daily_revenue, netto IVA gia' scorporato)
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
  -- Corrispettivi mensili di Budget & Controllo (imponibile): consuntivo granitico e preventivo
  SELECT company_id, year, month,
         SUM(CASE WHEN entry_type = 'cons_monthly' THEN COALESCE(amount, 0) ELSE 0 END) AS consuntivo_netto,
         SUM(CASE WHEN entry_type = 'rev_monthly'  THEN COALESCE(amount, 0) ELSE 0 END) AS preventivo_netto
  FROM public.budget_confronto
  WHERE account_code LIKE '5101%' AND entry_type IN ('cons_monthly', 'rev_monthly')
  GROUP BY 1, 2, 3
),
att AS (
  -- Fatture attive per data di emissione (le note di credito riducono il debito)
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
  -- Fatture passive: il mese che conta e' quello di RICEZIONE SDI (acube_created_at).
  -- Aggancio prima per sdi_file_id, poi per numero+data+P.IVA; senza aggancio
  -- (import manuali) resta la data fattura.
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

COMMENT ON VIEW public.v_iva_componenti_mensili IS 'Mattoni della liquidazione IVA per azienda/anno/mese: corrispettivi netti (chiusure, consuntivo, preventivo), IVA fatture attive, IVA fatture passive per mese di ricezione SDI, note di credito e integrazioni reverse charge a parte. security_invoker: rispetta la RLS delle tabelle sottostanti.';
GRANT SELECT ON public.v_iva_componenti_mensili TO authenticated, service_role;

COMMIT;

-- ---------------------------------------------------------------------
-- VERIFICA (da eseguire su ogni tenant dopo l'applicazione)
-- ---------------------------------------------------------------------
-- 1) tabelle e RLS
-- select relname, relrowsecurity from pg_class where relname in ('vat_settings','vat_settlements');
-- atteso: entrambe true
-- 2) la vista e' security_invoker
-- select reloptions from pg_class where oid = 'public.v_iva_componenti_mensili'::regclass;
-- atteso: {security_invoker=on}
-- 3) componenti dell'anno corrente
-- select * from v_iva_componenti_mensili where year = 2026 order by month;
