-- =====================================================================
-- ZAGO_ONLY 419 — Corrispettivi dei negozi di Zago nel piano dei conti
-- =====================================================================
-- Solo Zago (jxlwvzjreukscnswkbjx). Patrizio, 16/11/2026: «sì, procedi».
--
-- Il piano dei conti di Zago è stato copiato da New Zago all'onboarding e
-- contiene i 7 «Corrispettivi» dei negozi di New Zago (510107-510124), senza
-- outlet_link. Budget & Controllo lega i ricavi ai negozi da
-- chart_of_accounts.outlet_link: senza un conto per Zago Firenze e Zago Forte
-- dei Marmi i due negozi non avevano righe di ricavo, tutto finiva sulla sede
-- e l'Inserimento rapido restava senza negozi.
--
-- 1. Due conti nuovi, stessa forma dei corrispettivi di New Zago (livello 3,
--    sotto 5101, A.1, ricavi, is_cash, is_recurring), con outlet_link sul
--    centro di costo del negozio.
-- 2. I 7 corrispettivi di New Zago non si cancellano: is_active = false.
--    Al 16/11/2026 non hanno nessuna riga in budget_entries né budget_confronto.
-- Idempotente. Rollback: ZAGO_ONLY_20261116_419_..._ROLLBACK.sql
-- =====================================================================

INSERT INTO public.chart_of_accounts
  (company_id, code, name, level, parent_id, ce_section, macro_group, is_revenue, is_cash,
   is_fixed, is_recurring, is_active, sort_order, annual_amount, default_centers,
   is_admin_compensation, outlet_link, note)
SELECT p.company_id, v.code, v.name, 3, p.parent_id, 'A.1', 'ricavi', true, true,
       false, true, true, v.ord, 0, ARRAY['all'], false, v.link,
       'Creato il 16/11/2026 per i negozi di Zago (ZAGO_ONLY 419)'
FROM (SELECT company_id, parent_id FROM public.chart_of_accounts WHERE code = '510107' LIMIT 1) p
CROSS JOIN (VALUES ('510130', 'Corrispettivi Zago Firenze', 'zago_firenze', 110),
                   ('510131', 'Corrispettivi Zago Forte dei Marmi', 'zago_forte_dei_marmi', 111)) v(code, name, link, ord)
WHERE EXISTS (SELECT 1 FROM public.cost_centers cc WHERE cc.code = v.link AND cc.company_id = p.company_id)
  AND NOT EXISTS (SELECT 1 FROM public.chart_of_accounts x WHERE x.company_id = p.company_id AND x.code = v.code);

UPDATE public.chart_of_accounts
   SET is_active = false, updated_at = now(),
       note = concat_ws(' | ', note, '16/11/2026: disattivato, conto di un negozio di New Zago copiato all''onboarding (ZAGO_ONLY 419)')
 WHERE code IN ('510107','510108','510110','510112','510114','510122','510124')
   AND is_active
   AND outlet_link IS NULL;
