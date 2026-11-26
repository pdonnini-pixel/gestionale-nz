-- ROLLBACK NZ_ONLY 477 — toglie solo le righe inserite dalla 477 (riconoscibili dalla nota).
-- Solo New Zago. Da usare solo su richiesta esplicita di Patrizio (regola NO DATA LOSS).
DELETE FROM public.daily_revenue
WHERE notes = 'Registro corrispettivi (import storico 2026-11-26)'
  AND date BETWEEN '2025-01-01' AND '2025-07-31';
