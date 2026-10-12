-- NZ_ONLY 299 — Realcart: buste shopper, ripartite come la merce (12/10/2026)
--
-- Deciso da Patrizio il 12/10/2026: Realcart fornisce le buste shopper dei
-- negozi, quindi va trattata come la merce (quote del preventivo acquisti),
-- non sull'outlet nominato nelle fatture (che è il luogo di consegna).
-- Categoria ACQ_MERCE, scelta di Patrizio: è una scelta umana, quindi senza il
-- segno 'categoria_dal_riparto'. Il fornitore si trova per partita IVA.
-- Poi il riparto ricalcola la regola automatica (passo 3, merce).
-- Rollback: UPDATE suppliers SET default_cost_category_id = NULL, note = NULL
--           WHERE company_id = <NZ> AND partita_iva = '01715000343';
--           poi SELECT public.fn_riparto_automatico(<NZ>);

UPDATE public.suppliers s
   SET default_cost_category_id = c.id,
       note = concat_ws(E'\n', nullif(s.note, ''),
         '12/10/2026: buste shopper, categoria Acquisto merce e riparto come la merce (deciso da Patrizio).')
  FROM public.cost_categories c
 WHERE s.company_id = '00000000-0000-0000-0000-000000000001'
   AND s.partita_iva = '01715000343'
   AND c.company_id = s.company_id AND c.code = 'ACQ_MERCE';

SELECT public.fn_riparto_automatico('00000000-0000-0000-0000-000000000001');
