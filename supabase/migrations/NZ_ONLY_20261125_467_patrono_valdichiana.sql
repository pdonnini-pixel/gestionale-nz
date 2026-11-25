-- =====================================================================
-- 467 (solo NZ) — Patrono di Valdichiana, dal modello dello studio paghe
--
-- Nel file presenze di novembre 2026 dello Studio Signorini (RILXLS_071041_11-2026)
-- le persone di Valdichiana hanno «F» e «Lavoro festivo» l'11/11 (San Martino,
-- patrono di Foiano della Chiana). Si scrive solo se il campo e' ancora vuoto.
-- =====================================================================
BEGIN;
UPDATE public.outlets
   SET festa_patrono = '11-11'
 WHERE code = 'VDC' AND festa_patrono IS NULL;
COMMIT;

-- VERIFICA: SELECT code, festa_patrono FROM public.outlets WHERE code = 'VDC';  -- 11-11
