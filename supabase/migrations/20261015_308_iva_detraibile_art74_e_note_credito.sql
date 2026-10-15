-- =====================================================================
-- 308 — Liquidazione IVA: IVA art. 74 non detraibile e note di credito col segno vero
-- =====================================================================
-- Confronto con il dettaglio della liquidazione di settembre 2026 dello
-- studio Poli (15/10/2026): due errori del gestionale, entrambi a favore di
-- una stima troppo bassa.
--
-- 1) IVA ART. 74 (telefonia: Wind Tre, Fastweb). Nella fattura elettronica il
--    traffico prepagato ha un riepilogo con aliquota 22% e imposta esposta, ma
--    con RiferimentoNormativo «IVA Art.74 c. 1 let. d ... assolta da Wind Tre»:
--    l'IVA l'ha gia' versata l'operatore, chi riceve la fattura non la detrae.
--    Il gestionale la contava come IVA a credito. Wind Tre 2026F001254521 del
--    21/09/2026: IVA della fattura 86,65, detraibile 45,32 (lo studio ha 45,32).
--    Su NZ 8 fatture dal 2026 (Wind Tre e Fastweb), da 24,20 a 53,47 ciascuna.
--
--    COSA INTRODUCE: electronic_invoices.vat_non_detraibile, colonna generata
--    dall'XML (somma delle Imposta dei riepiloghi con riferimento all'art. 74).
--    Si calcola da sola per ogni fattura che arriva, da qualunque canale
--    (A-Cube, SDI, import), e per quelle gia' presenti. vat_amount NON cambia:
--    resta l'IVA del documento, quella che serve a pagamenti e scadenzario.
--
-- 2) NOTE DI CREDITO CON IMPORTI NEGATIVI. La vista sottraeva ABS(IVA) di ogni
--    TD04/TD08. Ma un TD04 con importi negativi (Publiacqua 7026011001294129
--    del 21/09/2026: IVA -3,17) storna una nota di credito: l'IVA torna a
--    favore. Lo studio la registra +3,17, il gestionale la toglieva: 6,34 di
--    differenza. Ora la nota pesa col segno scritto nel documento (IVA della
--    nota = vat_amount, positiva o negativa). Lo stesso per le fatture attive.
--    Su NZ: 2 note su 102 (Estenergy 06/05/2026 e Publiacqua 21/09/2026).
--
-- Additiva: una colonna generata, una funzione, la vista ricreata con le
-- stesse colonne. Nessun dato toccato. La vista resta security_invoker.
-- REGOLA #0: NZ -> Made -> Zago.
-- =====================================================================
BEGIN;

-- IVA dei riepiloghi art. 74 dentro l'XML FatturaPA. Il testo si spezza su
-- </DatiRiepilogo> (con o senza prefisso di namespace): ogni pezzo, tolto
-- tutto fino al tag di apertura, e' il contenuto di un riepilogo.
CREATE OR REPLACE FUNCTION public.iva_art74_da_xml(p_xml text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $$
  SELECT COALESCE(round(sum(
           substring(r.part FROM '<(?:\w+:)?Imposta>\s*(-?[0-9]+(?:\.[0-9]+)?)\s*<')::numeric
         ), 2), 0)
  FROM (
    SELECT regexp_replace(ch, '^.*<(\w+:)?DatiRiepilogo[^>]*>', '') AS part
    FROM regexp_split_to_table(p_xml, '</(\w+:)?DatiRiepilogo>') AS ch
    WHERE p_xml ~* 'art\.?\s*74'
      AND ch ~ '<(\w+:)?DatiRiepilogo'
  ) r
  WHERE r.part ~* 'RiferimentoNormativo>[^<]*art\.?\s*74'
$$;

COMMENT ON FUNCTION public.iva_art74_da_xml(text) IS
  'IVA dei riepiloghi FatturaPA con RiferimentoNormativo art. 74 (IVA assolta a monte dall''operatore, es. telefonia prepagata): esposta in fattura ma non detraibile.';

ALTER TABLE public.electronic_invoices
  ADD COLUMN IF NOT EXISTS vat_non_detraibile numeric(14,2)
  GENERATED ALWAYS AS (public.iva_art74_da_xml(xml_content)) STORED;

COMMENT ON COLUMN public.electronic_invoices.vat_non_detraibile IS
  'Parte di vat_amount che non si detrae (riepiloghi art. 74, letta dall''XML). La liquidazione IVA usa vat_amount - vat_non_detraibile.';

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
  -- nota di credito: l'IVA si toglie col segno del documento (una nota con
  -- importi negativi storna una nota e l'IVA torna a debito)
  SELECT company_id,
         EXTRACT(YEAR  FROM invoice_date)::int AS year,
         EXTRACT(MONTH FROM invoice_date)::int AS month,
         SUM(CASE WHEN tipo_documento IN ('TD04', 'TD08') THEN -COALESCE(vat_amount, 0)
                  ELSE COALESCE(vat_amount, 0) END) AS iva_fatture_attive,
         COUNT(*) AS n_fatture_attive
  FROM public.active_invoices
  GROUP BY 1, 2, 3
),
chiusure AS (
  SELECT company_id, year, month,
         COALESCE(registro_chiuso_il, (confirmed_at AT TIME ZONE 'Europe/Rome')::date) AS chiuso_il
  FROM public.vat_settlements
),
pas0 AS (
  SELECT e.company_id,
         e.invoice_date,
         COALESCE(a1.acube_created_at::date, a2.acube_created_at::date) AS ricezione,
         COALESCE(vs.competenza_cutoff_day, 15) AS cutoff_day,
         e.tipo_documento,
         -- IVA detraibile: quella del documento meno la parte art. 74
         COALESCE(e.vat_amount, 0) - COALESCE(e.vat_non_detraibile, 0) AS vat
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
  SELECT p.*,
         COALESCE(cm.chiuso_il,
                  (date_trunc('month', p.invoice_date) + interval '1 month')::date + (p.cutoff_day - 1)) AS limite_mese,
         cr.chiuso_il AS chiusura_mese_ricezione
  FROM pas0 p
  LEFT JOIN chiusure cm
    ON cm.company_id = p.company_id
   AND cm.year  = EXTRACT(YEAR  FROM p.invoice_date)::int
   AND cm.month = EXTRACT(MONTH FROM p.invoice_date)::int
  LEFT JOIN chiusure cr
    ON p.ricezione IS NOT NULL
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
         SUM(CASE WHEN tipo_documento IN ('TD04','TD08','TD16','TD17','TD18','TD19') THEN 0 ELSE vat END) AS iva_fatture_passive,
         -- nota di credito col segno del documento: negativa = storno di una nota
         SUM(CASE WHEN tipo_documento IN ('TD04','TD08') THEN vat ELSE 0 END) AS iva_note_credito,
         SUM(CASE WHEN tipo_documento IN ('TD16','TD17','TD18','TD19') THEN ABS(vat) ELSE 0 END) AS iva_integrazioni,
         COUNT(*) FILTER (WHERE tipo_documento IS NULL OR tipo_documento NOT IN ('TD04','TD08','TD16','TD17','TD18','TD19')) AS n_fatture_passive,
         COUNT(*) FILTER (WHERE tipo_documento IN ('TD04','TD08')) AS n_note_credito,
         COUNT(*) FILTER (WHERE tipo_documento IN ('TD16','TD17','TD18','TD19')) AS n_integrazioni
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
       COALESCE(dr.chiusure_netto, 0)::numeric(14,2)     AS chiusure_netto,
       COALESCE(dr.chiusure_lordo, 0)::numeric(14,2)     AS chiusure_lordo,
       COALESCE(dr.giorni_chiusura, 0)::int              AS giorni_chiusura,
       COALESCE(dr.outlet_chiusura, 0)::int              AS outlet_chiusura,
       COALESCE(bc.consuntivo_netto, 0)::numeric(14,2)   AS consuntivo_netto,
       COALESCE(bc.preventivo_netto, 0)::numeric(14,2)   AS preventivo_netto,
       COALESCE(att.iva_fatture_attive, 0)::numeric(14,2) AS iva_fatture_attive,
       COALESCE(att.n_fatture_attive, 0)::int            AS n_fatture_attive,
       COALESCE(pasm.iva_fatture_passive, 0)::numeric(14,2) AS iva_fatture_passive,
       COALESCE(pasm.iva_note_credito, 0)::numeric(14,2)    AS iva_note_credito,
       COALESCE(pasm.iva_integrazioni, 0)::numeric(14,2)    AS iva_integrazioni,
       COALESCE(pasm.n_fatture_passive, 0)::int          AS n_fatture_passive,
       COALESCE(pasm.n_note_credito, 0)::int             AS n_note_credito,
       COALESCE(pasm.n_integrazioni, 0)::int             AS n_integrazioni
FROM keys k
LEFT JOIN dr   ON dr.company_id   = k.company_id AND dr.year   = k.year AND dr.month   = k.month
LEFT JOIN bc   ON bc.company_id   = k.company_id AND bc.year   = k.year AND bc.month   = k.month
LEFT JOIN att  ON att.company_id  = k.company_id AND att.year  = k.year AND att.month  = k.month
LEFT JOIN pasm ON pasm.company_id = k.company_id AND pasm.year = k.year AND pasm.month = k.month;

COMMIT;

-- ── Verifica (NZ, settembre 2026) ──────────────────────────────────────
-- SELECT invoice_number, vat_amount, vat_non_detraibile FROM public.electronic_invoices
--  WHERE invoice_number = '2026F001254521';                 -- 86.65 | 41.33
-- SELECT iva_fatture_passive - iva_note_credito FROM public.v_iva_componenti_mensili
--  WHERE year = 2026 AND month = 9;   -- IVA acquisti detraibile del gestionale
