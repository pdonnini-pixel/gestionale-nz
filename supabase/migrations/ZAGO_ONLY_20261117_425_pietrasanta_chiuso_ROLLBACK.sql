-- ROLLBACK ZAGO_ONLY 425 — solo Zago. Toglie le giornate di Pietrasanta scritte dalla 425; punto vendita e
-- centro di costo restano (gia' disattivati). Operazione distruttiva: prima un SELECT di backup e la conferma di Patrizio.
DELETE FROM public.daily_revenue d USING public.outlets o
 WHERE d.outlet_id = o.id AND o.code = 'ZAGO-PIETRASANTA' AND d.notes = 'Registro corrispettivi (import storico 2026-11-17)';
