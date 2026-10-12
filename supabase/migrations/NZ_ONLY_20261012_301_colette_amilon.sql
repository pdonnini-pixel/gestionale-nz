-- NZ_ONLY 301 — Colette srl e Amilon (12/10/2026)
--
-- Deciso da Patrizio il 12/10/2026 dopo la lettura delle fatture:
--   Colette srl (05763200481)  → ALLESTIMENTI  fatture 84/2026 e 292/2026: «stender
--                                 accatastabili» e trasporto, attrezzatura della sede e
--                                 del magazzino (la regola manuale «Diretto» sede resta)
--   Amilon (05921090964)       → ALTRE_COMM    fattura 703/ORD: Zucchetti Card da 250 e
--                                 350 €, omaggi e promozioni (la regola «Quote Uguali» resta)
-- Fornitori trovati per partita IVA, solo categorie vuote, nota datata.
-- Rollback: UPDATE suppliers SET default_cost_category_id = NULL WHERE company_id = <NZ>
--           AND partita_iva IN ('05763200481','05921090964');

WITH scelte(piva, code, nota) AS (VALUES
  ('05763200481', 'ALLESTIMENTI', 'categoria Allestimenti e aperture: stender per la sede e il magazzino'),
  ('05921090964', 'ALTRE_COMM',   'categoria Altre commerciali: Zucchetti Card come omaggi e promozioni')
)
UPDATE public.suppliers s
   SET default_cost_category_id = c.id,
       note = concat_ws(E'\n', nullif(s.note, ''), '12/10/2026: ' || x.nota || ' (deciso da Patrizio).')
  FROM scelte x
  JOIN public.cost_categories c ON c.code = x.code AND c.company_id = '00000000-0000-0000-0000-000000000001'
 WHERE s.company_id = '00000000-0000-0000-0000-000000000001'
   AND s.partita_iva = x.piva
   AND s.default_cost_category_id IS NULL;
