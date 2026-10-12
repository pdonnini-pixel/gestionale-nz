-- Migrazione 303 — vocabolario: vigilanza, verde, attrezzatura di magazzino (12/10/2026)
--
-- Deciso da Patrizio il 12/10/2026: vigilanza e verde sono manutenzioni, i
-- transpallet sono allestimenti del magazzino. Diventa regola di lettura delle
-- fatture (fn_categorize_from_lines / fn_categoria_dalle_fatture, migrazione
-- 302), quindi vale anche per le fatture future. Poi si rilegge subito.
-- Vale su ogni tenant.

WITH nuove(code, kw) AS (VALUES
  ('MANUT', ARRAY['allarme','videoallarme','vigilanza','aree verdi','bonifica','giardin','sfalcio','potatur']),
  ('ALLESTIMENTI', ARRAY['transpallet','pallet truck','scaffalatur','carrello elevatore','muletto'])
)
UPDATE public.cost_categories c
   SET matching_keywords = (SELECT array_agg(DISTINCT k ORDER BY k) FROM unnest(coalesce(c.matching_keywords, ARRAY[]::text[]) || n.kw) k)
  FROM nuove n WHERE c.code = n.code;

SELECT public.fn_categoria_dalle_fatture(company_id) FROM (SELECT DISTINCT company_id FROM public.suppliers WHERE company_id IS NOT NULL) x;
