-- =====================================================================
-- 475 · «Chi apre resta N ore» spenta in tutti i negozi
-- =====================================================================
-- Patrizio, 26/11/2026: «spegnila su tutti», subito dopo la 474 che ha reso la regola
-- accendibile e spegnibile. Stato prima (letto il 26/11/2026): caldi_ore_apertura_attiva
-- NULL (= accesa) in tutte le righe di NZ (8) e Zago (2); Roma Soratte con 9 ore,
-- l'unico negozio con i giorni caldi accesi. caldi_ore_apertura NON si tocca: se la
-- regola si riaccende torna il numero di prima.
-- Rollback: 20261126_475_ore_apertura_spenta_ovunque_ROLLBACK.sql
-- =====================================================================
BEGIN;
UPDATE public.outlet_shift_rules
   SET caldi_ore_apertura_attiva = false, updated_at = now()
 WHERE caldi_ore_apertura_attiva IS DISTINCT FROM false;
COMMIT;

-- Verifica: SELECT count(*) FILTER (WHERE caldi_ore_apertura_attiva IS DISTINCT FROM false) AS ancora_accese
--             FROM public.outlet_shift_rules;   -- 0
