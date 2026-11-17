-- ROLLBACK ZAGO_ONLY 424 — solo Zago. Toglie soltanto le righe scritte dalla 424 (riconoscibili dalla nota).
-- Operazione distruttiva: prima un SELECT di backup e la conferma di Patrizio.
DELETE FROM public.daily_revenue WHERE notes = 'Registro corrispettivi (import storico 2026-11-17)';
