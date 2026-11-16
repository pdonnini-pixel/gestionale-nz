-- =====================================================================
-- ZAGO_ONLY 420 — Sede di Zago a Pian di Rona (legale e operativa)
-- =====================================================================
-- Solo Zago (jxlwvzjreukscnswkbjx). Patrizio, 16/11/2026: «la sede legale di
-- Zago è la stessa di New Zago e la sede operativa è la stessa di New Zago
-- (Pian di Rona)».
--
-- 1. Il centro di costo «sede» (role 'hq') esisteva dall'onboarding ma senza
--    un punto collegato: si crea il punto di tipo sede, stessa forma di quello
--    di New Zago (Località Pian di Rona 120/B, 50066 Reggello FI). Niente
--    canone né contratto: il magazzino è in locazione a New Zago.
-- 2. companies.legal_address passa a Pian di Rona; l'indirizzo di prima resta
--    scritto nelle note dell'azienda.
-- Idempotente. Rollback: ZAGO_ONLY_20261116_420_..._ROLLBACK.sql
-- =====================================================================

INSERT INTO public.outlets
  (company_id, code, name, outlet_type, city, address, cap, province, region, mall_name,
   cost_center_key, is_active, bp_status, rent_free_days, notes)
SELECT c.company_id, 'ZAGO-SEDE', 'Sede / Magazzino', 'sede', 'Reggello', 'Località Pian di Rona 120/B',
       '50066', 'FI', 'Toscana', 'Matassino', 'sede', true, 'bozza', 0,
       'Sede legale e operativa di Zago, la stessa di New Zago (Patrizio, 16/11/2026). Il magazzino è in locazione a New Zago: qui niente canone.'
FROM public.cost_centers c
WHERE c.code = 'sede' AND c.role = 'hq'
  AND NOT EXISTS (SELECT 1 FROM public.outlets o WHERE o.company_id = c.company_id AND o.cost_center_key = 'sede');

UPDATE public.companies
   SET notes = concat_ws(E'\n', notes, '16/11/2026: sede legale indicata da Patrizio a Pian di Rona; prima era scritto «' || legal_address || '».'),
       legal_address = 'Località Pian di Rona 120/B, 50066 Reggello (FI)'
 WHERE legal_address IS DISTINCT FROM 'Località Pian di Rona 120/B, 50066 Reggello (FI)';
