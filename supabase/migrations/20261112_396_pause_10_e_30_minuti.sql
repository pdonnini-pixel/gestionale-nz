-- =====================================================================
-- Migrazione 396 — Pause dei turni: 10 minuti e 30 minuti
-- =====================================================================
-- PERCHE': Patrizio, 12/11/2026: «non è più 30 minuti un'ora, ma 10 minuti
-- 30 minuti». Le soglie restano quelle: nessuna pausa fino a 6 ore
-- lavorate, la pausa corta oltre 6, la pausa lunga da 8.
--
-- COME: le durate stanno nelle regole di ogni negozio
-- (outlet_shift_rules.pausa_minuti e pausa_lunga_minuti). Si portano a 10 e
-- 30 le righe che hanno ancora i valori di prima (30 e 60), e i default
-- delle colonne. Un negozio a cui qualcuno avesse scritto durate diverse
-- non viene toccato.
--
-- NO DATA LOSS: prima dell'UPDATE i valori di prima si copiano in una
-- tabella di backup senza GRANT. I turni gia' salvati non cambiano: tengono
-- la pausa scritta nel turno (shifts.pausa_minuti).
-- Contato l'11/11/2026 su NZ: 8 negozi, tutti a 30 e 60.
-- Tenant: NZ e Zago.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public._bkp_20261112_outlet_shift_rules_pause AS
  SELECT outlet_id, company_id, pausa_minuti, pausa_lunga_minuti, updated_at, now() AS copiato_il
    FROM public.outlet_shift_rules;
ALTER TABLE public._bkp_20261112_outlet_shift_rules_pause ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bkp_20261112_outlet_shift_rules_pause FROM anon, authenticated;

UPDATE public.outlet_shift_rules
   SET pausa_minuti = 10, pausa_lunga_minuti = 30, updated_at = now()
 WHERE pausa_minuti = 30 AND COALESCE(pausa_lunga_minuti, 60) = 60;

ALTER TABLE public.outlet_shift_rules ALTER COLUMN pausa_minuti SET DEFAULT 10;
ALTER TABLE public.outlet_shift_rules ALTER COLUMN pausa_lunga_minuti SET DEFAULT 30;

COMMIT;

-- VERIFICA (su ogni tenant):
-- SELECT pausa_minuti, pausa_lunga_minuti, count(*) FROM public.outlet_shift_rules GROUP BY 1, 2;   -- tutte 10 / 30
-- SELECT count(*) FROM public._bkp_20261112_outlet_shift_rules_pause;                                -- le righe di prima
