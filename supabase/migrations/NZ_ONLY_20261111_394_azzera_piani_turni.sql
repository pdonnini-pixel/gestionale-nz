-- =====================================================================
-- NZ_ONLY 394 — Si riparte dal motore nuovo: via i piani dei turni esistenti
-- =====================================================================
-- PERCHE': Patrizio, 11/11/2026: «cancella dicembre e tutti quelli che ci sono
-- già», confermato «tutti» (tutti i negozi), per rifare i piani con le regole
-- dell'11/11/2026 (ORGANICO_TURNI_NOTES.md). Solo New Zago: Zago non ha turni.
--
-- COSA SI TOGLIE (contato l'11/11/2026 prima di applicare):
--   - 20 piani del mese (novembre: Torino, Valdichiana, Valmontone, 4 bozze a
--     testa; dicembre: Barberino e Roma Soratte, 1 scelto e 3 bozze a testa);
--   - i loro 1.743 turni, nessuno pubblicato;
--   - 66 righe di sabati e domeniche liberi di quei piani;
--   - 20 proposte in bozza senza piano di novembre (Barberino).
-- COSA RESTA: i 64 turni in bozza di novembre di Roma Soratte (caricati
-- l'11/11/2026), gli 84 turni messi a mano della Sede, i 12 turni del
-- dipendente di prova, il turno annullato di Brugnato, le proposte di
-- ottobre (mese passato, 156 righe).
--
-- NO DATA LOSS: prima di cancellare tutto viene copiato in tre tabelle di
-- backup, senza GRANT (invisibili all'API). Se qualcosa non torna la
-- transazione si annulla da sola.
-- RIPRISTINO: INSERT ... SELECT dalle tre tabelle di backup, nell'ordine
-- shift_plans, shifts, shift_plan_weekend_off.
-- =====================================================================

BEGIN;

CREATE TABLE public._bkp_20261111_shift_plans AS SELECT * FROM public.shift_plans;
CREATE TABLE public._bkp_20261111_shifts AS
  SELECT * FROM public.shifts
   WHERE plan_id IS NOT NULL
      OR (plan_id IS NULL AND origine = 'proposta' AND stato = 'bozza' AND data >= DATE '2026-11-01'
          AND outlet_id <> (SELECT id FROM public.outlets WHERE code = 'RSO'));
CREATE TABLE public._bkp_20261111_shift_plan_weekend_off AS SELECT * FROM public.shift_plan_weekend_off;

ALTER TABLE public._bkp_20261111_shift_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bkp_20261111_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bkp_20261111_shift_plan_weekend_off ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bkp_20261111_shift_plans, public._bkp_20261111_shifts, public._bkp_20261111_shift_plan_weekend_off FROM anon, authenticated;

DO $$
DECLARE
  n_piani int; n_turni int; n_liberi int; n_pubblicati int;
BEGIN
  SELECT count(*) INTO n_pubblicati FROM public.shifts WHERE plan_id IS NOT NULL AND stato = 'pubblicato';
  IF n_pubblicati > 0 THEN RAISE EXCEPTION 'Ci sono % turni pubblicati dentro un piano: non si cancella niente.', n_pubblicati; END IF;

  DELETE FROM public.shift_plan_weekend_off;
  GET DIAGNOSTICS n_liberi = ROW_COUNT;
  DELETE FROM public.shifts s USING public._bkp_20261111_shifts b WHERE s.id = b.id;
  GET DIAGNOSTICS n_turni = ROW_COUNT;
  DELETE FROM public.shift_plans;
  GET DIAGNOSTICS n_piani = ROW_COUNT;

  IF n_piani <> (SELECT count(*) FROM public._bkp_20261111_shift_plans)
     OR n_turni <> (SELECT count(*) FROM public._bkp_20261111_shifts)
     OR n_liberi <> (SELECT count(*) FROM public._bkp_20261111_shift_plan_weekend_off) THEN
    RAISE EXCEPTION 'Backup e righe cancellate non coincidono (piani %, turni %, liberi %): annullo.', n_piani, n_turni, n_liberi;
  END IF;
  RAISE NOTICE 'Tolti % piani, % turni, % sabati e domeniche liberi.', n_piani, n_turni, n_liberi;
END $$;

COMMIT;

-- VERIFICA:
-- SELECT (SELECT count(*) FROM shift_plans) piani, (SELECT count(*) FROM shifts WHERE plan_id IS NOT NULL) turni_piano,
--        (SELECT count(*) FROM _bkp_20261111_shift_plans) bkp_piani, (SELECT count(*) FROM _bkp_20261111_shifts) bkp_turni,
--        (SELECT count(*) FROM _bkp_20261111_shift_plan_weekend_off) bkp_liberi,
--        (SELECT count(*) FROM shifts s JOIN outlets o ON o.id = s.outlet_id WHERE o.code = 'RSO' AND s.data BETWEEN '2026-11-09' AND '2026-11-30' AND s.stato = 'bozza') rso_novembre;
-- attesi: 0, 0, 20, 1763, 66, 64
