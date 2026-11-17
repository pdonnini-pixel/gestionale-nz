-- ROLLBACK ZAGO_ONLY 426 — solo Zago. Toglie solo le righe scritte dalla 426 (riconoscibili dalla nota).
-- Operazione distruttiva: prima un SELECT di backup e la conferma di Patrizio.
DELETE FROM public.daily_revenue WHERE notes = 'Registro corrispettivi (import storico 2026-11-17, mag-ott 2026)';
