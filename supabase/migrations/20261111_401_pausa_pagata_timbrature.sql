-- =====================================================================
-- Migrazione 401 — Timbrature: la pausa pagata si timbra ma non si toglie
-- =====================================================================
-- PERCHE': Patrizio, 11/11/2026, sul modello in prova a Roma Soratte: «la
-- timbratura deve lo stesso farla la dipendente, perché io devo sapere quando
-- non era in negozio e quanto c'è stata; ma non deve essere presa in
-- considerazione, non te la sto stornando dall'orario di lavoro».
-- Nei negozi con la pausa corta pagata (outlet_shift_rules.pausa_corta_pagata,
-- migration 399) il turno oltre 6 e fino a 8 ore ha una pausa di 10 minuti che
-- si timbra come le altre e NON si toglie dalle ore. Se dura di piu', la parte
-- in piu' segue la regola della «pausa piu' lunga» (392): decide il responsabile.
--
-- DIPENDE DALLA 392 (ramo fine_pausa di timbrature_evento_da_timbratura, gia' su main e applicata su NZ
-- e Zago: verificato in lettura l'11/11/2026, le quattro funzioni sono identiche sui due tenant) e DALLA 399
-- (colonna pausa_corta_pagata). Ordine: 392 → 399 → 401 → NZ_ONLY 400.
--
-- COME:
--   1. shifts.pausa_pagata_minuti: i minuti di pausa che si timbrano e non si
--      tolgono. shifts.pausa_minuti resta la pausa che si toglie.
--   2. La calcola il database da solo, dalle regole del negozio, a ogni turno
--      scritto o cambiato (trigger): nessuno la deve compilare e nessuna
--      schermata puo' sbagliarla. Se cambiano le regole del negozio si
--      ricalcolano i turni da oggi in avanti; quelli passati restano com'erano.
--   3. Le funzioni delle timbrature che leggono la pausa del turno:
--        - timbratrice_dati, app_dipendente_oggi, app_dipendente_periodo danno
--          anche 'pausa_pagata_minuti' (il telefono propone «Vado in pausa» e il
--          conto delle ore non toglie quei minuti);
--        - timbrature_evento_da_timbratura confronta le pause della giornata con
--          la pausa concessa, cioe' pausa_minuti + pausa_pagata_minuti.
--      timbrature_turni_ufficiali NON si tocca: cambiarne le colonne vorrebbe
--      un DROP della funzione da cui dipendono dieci altre, e la 395 (non ancora
--      applicata) la riscrive con la stessa firma. La pausa pagata si legge dal
--      turno con lo shift_id che la funzione gia' restituisce. Le quattro
--      funzioni si correggono sul testo vivo (come la 392), cosi' vale sia con
--      la versione 348 sia con la 395.
--
-- NEGLI ALTRI NEGOZI NON CAMBIA NIENTE: senza la scelta accesa la colonna vale
-- 0 e pausa concessa = pausa_minuti, come oggi.
--
-- NO DATA LOSS: ADD COLUMN con default 0, funzioni e trigger. Nessuna riga
-- cancellata; i turni esistenti restano a 0 (nessun negozio ha la scelta accesa).
-- Tenant: NZ e Zago (Made non riceve piu' migration dal 03/11/2026).
-- =====================================================================

BEGIN;

-- 1. La colonna
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS pausa_pagata_minuti smallint NOT NULL DEFAULT 0;
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_pausa_pagata_minuti_check;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_pausa_pagata_minuti_check CHECK (pausa_pagata_minuti BETWEEN 0 AND 60);
COMMENT ON COLUMN public.shifts.pausa_pagata_minuti IS
  'Pausa pagata (Patrizio, 11/11/2026): minuti che si timbrano ma non si tolgono dalle ore. La calcola il trigger trg_shifts_pausa_pagata dalle regole del negozio (pausa_corta_pagata): non si scrive a mano. pausa_minuti resta la pausa che si toglie.';

-- 2. Il calcolo, uguale a pausaPagataDelTurno in src/lib/turni.ts
CREATE OR REPLACE FUNCTION public.pausa_pagata_del_turno(p_outlet_id uuid, p_inizio time, p_fine time, p_pausa_minuti integer)
 RETURNS smallint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT LEAST(60, GREATEST(0, r.pausa_minuti))::smallint
      FROM public.outlet_shift_rules r
     WHERE r.outlet_id = p_outlet_id
       AND r.pausa_corta_pagata IS TRUE
       AND COALESCE(p_pausa_minuti, 0) = 0
       AND extract(epoch FROM (p_fine - p_inizio)) / 60.0 > r.pausa_oltre_ore * 60
       AND extract(epoch FROM (p_fine - p_inizio)) / 60.0 <= COALESCE(r.pausa_lunga_oltre_ore, 8) * 60
  ), 0::smallint);
$function$;
REVOKE ALL ON FUNCTION public.pausa_pagata_del_turno(uuid, time, time, integer) FROM PUBLIC, anon, authenticated;
-- la usano solo i trigger (SECURITY DEFINER) e le migration: authenticated non ne ha bisogno
GRANT EXECUTE ON FUNCTION public.pausa_pagata_del_turno(uuid, time, time, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.shifts_pausa_pagata()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- sempre calcolata: quello che arriva dal client non conta
  NEW.pausa_pagata_minuti := public.pausa_pagata_del_turno(NEW.outlet_id, NEW.inizio, NEW.fine, NEW.pausa_minuti);
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.shifts_pausa_pagata() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_shifts_pausa_pagata ON public.shifts;
CREATE TRIGGER trg_shifts_pausa_pagata
  BEFORE INSERT OR UPDATE OF inizio, fine, pausa_minuti, outlet_id, pausa_pagata_minuti ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.shifts_pausa_pagata();

-- Se cambiano le regole del negozio: i turni da oggi in avanti si ricalcolano,
-- quelli passati restano com'erano (e i mesi chiusi non si toccano).
CREATE OR REPLACE FUNCTION public.outlet_shift_rules_ricalcola_pausa_pagata()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.pausa_corta_pagata IS NOT DISTINCT FROM OLD.pausa_corta_pagata
     AND NEW.pausa_minuti IS NOT DISTINCT FROM OLD.pausa_minuti
     AND NEW.pausa_oltre_ore IS NOT DISTINCT FROM OLD.pausa_oltre_ore
     AND NEW.pausa_lunga_oltre_ore IS NOT DISTINCT FROM OLD.pausa_lunga_oltre_ore THEN
    RETURN NULL;
  END IF;
  UPDATE public.shifts s
     SET pausa_pagata_minuti = public.pausa_pagata_del_turno(s.outlet_id, s.inizio, s.fine, s.pausa_minuti)
   WHERE s.outlet_id = NEW.outlet_id
     AND s.data >= (now() AT TIME ZONE 'Europe/Rome')::date
     AND NOT public.turni_mese_chiuso(s.company_id, s.data)
     AND s.pausa_pagata_minuti IS DISTINCT FROM public.pausa_pagata_del_turno(s.outlet_id, s.inizio, s.fine, s.pausa_minuti);
  RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION public.outlet_shift_rules_ricalcola_pausa_pagata() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_outlet_shift_rules_pausa_pagata ON public.outlet_shift_rules;
CREATE TRIGGER trg_outlet_shift_rules_pausa_pagata
  AFTER INSERT OR UPDATE ON public.outlet_shift_rules
  FOR EACH ROW EXECUTE FUNCTION public.outlet_shift_rules_ricalcola_pausa_pagata();

-- 3. Le funzioni delle timbrature: la pausa pagata accanto a quella che si toglie
DO $do$
DECLARE
  f record;
  d text;
  n text;
  c_pagata constant text := $x$COALESCE((SELECT s.pausa_pagata_minuti FROM public.shifts s WHERE s.id = t.shift_id), 0)$x$;
BEGIN
  FOR f IN
    SELECT * FROM (VALUES
      ('public.app_dipendente_oggi()',
       $x$'pausa_minuti', t.pausa_minuti,$x$,
       $x$'pausa_minuti', t.pausa_minuti, 'pausa_pagata_minuti', $x$ || c_pagata || ','),
      ('public.app_dipendente_periodo(date,date)',
       $x$'pausa_minuti', t.pausa_minuti,$x$,
       $x$'pausa_minuti', t.pausa_minuti, 'pausa_pagata_minuti', $x$ || c_pagata || ','),
      ('public.timbratrice_dati(uuid)',
       $x$'pausa_minuti', t.pausa_minuti)$x$,
       $x$'pausa_minuti', t.pausa_minuti, 'pausa_pagata_minuti', $x$ || c_pagata || ')'),
      ('public.timbrature_evento_da_timbratura(uuid,text)',
       $x$SELECT sum(t.pausa_minuti) INTO v_pausa$x$,
       $x$SELECT sum(t.pausa_minuti + $x$ || c_pagata || $x$) INTO v_pausa  -- 401: pausa concessa$x$)
    ) AS v(firma, ancora, nuovo)
  LOOP
    d := pg_get_functiondef(f.firma::regprocedure);
    IF position('pausa_pagata_minuti' in d) > 0 THEN CONTINUE; END IF;  -- gia' fatta
    IF (length(d) - length(replace(d, f.ancora, ''))) / length(f.ancora) <> 1 THEN
      RAISE EXCEPTION '401: ancora non trovata una e una sola volta in %', f.firma;
    END IF;
    n := replace(d, f.ancora, f.nuovo);
    EXECUTE n;
  END LOOP;
END
$do$;

COMMIT;

-- VERIFICA (su ogni tenant):
-- SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='shifts' AND column_name='pausa_pagata_minuti') AS colonna,          -- 1
--        (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_shifts_pausa_pagata','trg_outlet_shift_rules_pausa_pagata') AND NOT tgisinternal) AS trigger,        -- 2
--        (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public'
--           AND p.proname IN ('app_dipendente_oggi','app_dipendente_periodo','timbratrice_dati','timbrature_evento_da_timbratura')
--           AND p.prosrc ~ 'pausa_pagata_minuti') AS funzioni,                                                                                                           -- 4
--        (SELECT count(*) FROM public.shifts WHERE pausa_pagata_minuti <> 0) AS turni_con_pausa_pagata;                                                                  -- 0 finche' nessun negozio accende la scelta
