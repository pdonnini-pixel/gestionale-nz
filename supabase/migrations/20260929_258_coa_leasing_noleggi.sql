-- Ticket #d93ea65d (Lilian, 25/09/2026): nuove voci di costo nel piano dei conti.
--   650105 Canoni di leasing
--   650111 Noleggi
--   650112 Noleggi deducibili all'80%
-- Vanno sotto il mastro 6501 «Per godimento beni di terzi» (B.8), come le
-- sorelle 650101/650104/650113/650120. Budget & Controllo e Conto Economico
-- leggono chart_of_accounts in modo dinamico: una volta inserite compaiono da sole.
--
-- Solo aggiunte: nessuna riga esistente viene cancellata. L'unico UPDATE sposta
-- sort_order di 650113 e 650120 (da 513/514 a 516/517) per tenere l'ordine per
-- codice. Idempotente, per azienda, nessun company_id hardcoded.
BEGIN;

UPDATE public.chart_of_accounts SET sort_order = 516, updated_at = now()
 WHERE code = '650113' AND sort_order = 513;
UPDATE public.chart_of_accounts SET sort_order = 517, updated_at = now()
 WHERE code = '650120' AND sort_order = 514;

INSERT INTO public.chart_of_accounts
  (company_id, code, name, macro_group, parent_id, is_fixed, is_recurring,
   default_centers, annual_amount, note, sort_order, is_active, level,
   ce_section, is_revenue, outlet_link, is_admin_compensation, is_cash)
SELECT t.company_id, v.code, v.name, t.macro_group, t.parent_id, t.is_fixed, t.is_recurring,
       t.default_centers, 0, NULL, v.sort_order, true, 3,
       t.ce_section, false, NULL, false, t.is_cash
  FROM public.chart_of_accounts t
 CROSS JOIN (VALUES
   ('650105', 'Canoni di leasing',                513),
   ('650111', 'Noleggi',                          514),
   ('650112', 'Noleggi deducibili all''80%',      515)
 ) AS v(code, name, sort_order)
 WHERE t.code = '650113'
   AND NOT EXISTS (
     SELECT 1 FROM public.chart_of_accounts x
      WHERE x.company_id = t.company_id AND x.code = v.code
   );

COMMIT;
