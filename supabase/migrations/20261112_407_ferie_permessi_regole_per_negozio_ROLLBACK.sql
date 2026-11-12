-- ROLLBACK della 407. Rimette le funzioni com'erano e toglie tabelle, colonne e funzioni nate con la 407.
-- ATTENZIONE: perde i dati scritti dopo la 407 (regole del negozio, elenco HR, eccezioni, prime
-- approvazioni). Prima di eseguirlo, salvare:
--   SELECT * FROM public.outlet_leave_rules;  SELECT * FROM public.leave_hr;
--   SELECT id, eccezione, eccezione_motivo, prima_decisione FROM public.leave_requests
--    WHERE eccezione IS NOT NULL OR prima_decisione IS NOT NULL;
-- e chiedere conferma a Patrizio (regola NO DATA LOSS). Le richieste restano nello stato che hanno.
BEGIN;

DO $do$
DECLARE
  f record;
  d text;
  n text;
  i int;
BEGIN
  FOR f IN
    SELECT * FROM (VALUES
      ('public.app_dipendente_chiedi_ferie(jsonb,text)', ARRAY[
        $x$  v_con_saldo boolean;
  v_ecc      text;  -- 407$x$,
        $x$    -- 407: quando si possono chiedere (eventi, giorni caldi, regole del negozio) e le eccezioni
    v_ev := public.ferie_blocco_giorno(v_emp, v_data, CASE WHEN COALESCE(g->>'voce', 'ferie') = 'ferie' THEN 'ferie' ELSE 'permessi' END);
    IF v_ev IS NOT NULL THEN
      IF NOT public.ferie_eccezioni_attive(e.outlet_id) THEN
        RAISE EXCEPTION '%', v_ev USING ERRCODE = '22023';
      ELSIF COALESCE(g->>'eccezione', '') <> 'true' THEN
        RAISE EXCEPTION '% Si può chiedere solo come eccezione.', v_ev USING ERRCODE = '22023', HINT = 'eccezione';
      END IF;
      v_ecc := left(concat_ws(' ', v_ecc, v_ev), 500);
    END IF;
    SELECT ev.nome INTO v_ev FROM public.outlet_events ev$x$,
        $x$AND false /* 407: decide ferie_blocco_giorno */$x$,
        $x$  RETURNING id INTO v_req;
  IF v_ecc IS NOT NULL THEN  -- 407
    UPDATE public.leave_requests SET eccezione = true, eccezione_motivo = v_ecc WHERE id = v_req;
  END IF;$x$], ARRAY[
        $x$  v_con_saldo boolean;$x$,
        $x$    SELECT ev.nome INTO v_ev FROM public.outlet_events ev$x$,
        $x$AND ev.blocca_ferie$x$,
        $x$  RETURNING id INTO v_req;$x$]),
      ('public.app_dipendente_ferie()', ARRAY[
        $x$'id', q.id, 'stato', q.stato, 'eccezione', COALESCE(q.eccezione, false), 'attesa_seconda', (q.stato = 'inviata' AND q.prima_decisione IS NOT NULL), 'note', q.note_dipendente,$x$,
        $x$    'eccezioni', public.ferie_eccezioni_attive(e.outlet_id),  -- 407
    'senza_ferie', COALESCE(($x$], ARRAY[
        $x$'id', q.id, 'stato', q.stato, 'note', q.note_dipendente,$x$,
        $x$    'senza_ferie', COALESCE(($x$]),
      ('public.leave_decidi(uuid,uuid[],text)', ARRAY[
        $x$  v_motivo     text := NULLIF(btrim(p_motivazione), '');
  v_407        jsonb;$x$,
        $x$  PERFORM public.ferie_controlla_lato(p_request_id);  -- 407: chi approva, per negozio

  IF r.stato NOT IN ('inviata', 'approvata', 'approvata_parziale', 'respinta') THEN$x$,
        $x$  -- 407: dove servono due approvazioni
  v_407 := public.ferie_doppia_approvazione(p_request_id, p_giorni_approvati, v_motivo);
  IF v_407 ? 'attesa' THEN
    RETURN 'attesa_seconda';
  END IF;
  IF v_407 ? 'giorni' THEN
    p_giorni_approvati := ARRAY(SELECT jsonb_array_elements_text(v_407 -> 'giorni')::uuid);
    v_ok := (SELECT count(*) FROM public.leave_request_days
              WHERE request_id = p_request_id AND id = ANY (p_giorni_approvati));
    v_motivo := COALESCE(v_motivo, NULLIF(v_407 ->> 'motivo', ''));
    IF v_ok < v_tot AND v_motivo IS NULL THEN
      v_motivo := 'Giorni non concessi dalla prima approvazione.';
    END IF;
  END IF;

  UPDATE public.leave_request_days$x$], ARRAY[
        $x$  v_motivo     text := NULLIF(btrim(p_motivazione), '');$x$,
        $x$  IF r.stato NOT IN ('inviata', 'approvata', 'approvata_parziale', 'respinta') THEN$x$,
        $x$  UPDATE public.leave_request_days$x$]),
      ('public.responsabile_ferie_elenco(boolean)', ARRAY[
        $x$'prova', e.is_demo, 'eccezione', COALESCE(q.eccezione, false), 'eccezione_motivo', q.eccezione_motivo, 'prima_decisione', q.prima_decisione, 'posso', public.ferie_lato_puo(q.id), 'titolo', q.titolo,$x$], ARRAY[
        $x$'prova', e.is_demo, 'titolo', q.titolo,$x$])
    ) AS v(firma, ancore, nuovi)
  LOOP
    d := pg_get_functiondef(f.firma::regprocedure);
    n := d;
    FOR i IN 1 .. array_length(f.ancore, 1) LOOP
      n := replace(n, f.ancore[i], f.nuovi[i]);
    END LOOP;
    IF n <> d THEN EXECUTE n; END IF;
    IF position('407' in n) > 0 OR position('ferie_lato_puo' in n) > 0 OR position('ferie_eccezioni_attive' in n) > 0 THEN
      RAISE EXCEPTION 'ROLLBACK 407: % non e'' tornata com''era', f.firma;
    END IF;
  END LOOP;

  d := pg_get_functiondef('public.leave_request_days_lunedi()'::regprocedure);
  n := replace(d, 'IF NOT public.ferie_lunedi_ce_guida() THEN',
    'IF NOT EXISTS (SELECT 1 FROM public.outlets o
                  WHERE o.referente_employee_id IS NOT NULL
                    AND o.vice_referente_employee_id IS NOT NULL) THEN');
  IF n <> d THEN EXECUTE n; END IF;
END
$do$;

-- ferie_lunedi_conflitti come nella 393
CREATE OR REPLACE FUNCTION public.ferie_lunedi_conflitti(
  p_employee_id uuid, p_date date[], p_solo_approvate boolean DEFAULT false)
RETURNS TABLE (data date, altra_id uuid)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH lunedi AS (
    SELECT COALESCE(array_agg(DISTINCT x), '{}'::date[]) AS date
      FROM unnest(p_date) AS x
     WHERE extract(isodow FROM x) = 1
       AND x >= (now() AT TIME ZONE 'Europe/Rome')::date
  ), altre AS (
    SELECT DISTINCT CASE WHEN o.referente_employee_id = p_employee_id
                         THEN o.vice_referente_employee_id
                         ELSE o.referente_employee_id END AS altra_id
      FROM public.outlets o
     WHERE o.referente_employee_id IS NOT NULL
       AND o.vice_referente_employee_id IS NOT NULL
       AND COALESCE(o.is_active, true)
       AND p_employee_id IN (o.referente_employee_id, o.vice_referente_employee_id)
  )
  SELECT g.data, a.altra_id
    FROM lunedi l
    CROSS JOIN altre a
    CROSS JOIN LATERAL unnest(public.ferie_giorni_interi(a.altra_id, l.date, p_solo_approvate, NULL)) AS g(data)
   WHERE cardinality(l.date) > 0
   ORDER BY g.data;
$$;
REVOKE ALL ON FUNCTION public.ferie_lunedi_conflitti(uuid, date[], boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ferie_lunedi_conflitti(uuid, date[], boolean) TO service_role;

DROP FUNCTION IF EXISTS public.ferie_doppia_approvazione(uuid, uuid[], text);
DROP FUNCTION IF EXISTS public.ferie_controlla_lato(uuid);
DROP FUNCTION IF EXISTS public.ferie_lato_puo(uuid);
DROP FUNCTION IF EXISTS public.ferie_mio_lato();
DROP FUNCTION IF EXISTS public.ferie_regole_richiesta(uuid);
DROP FUNCTION IF EXISTS public.ferie_eccezioni_attive(uuid);
DROP FUNCTION IF EXISTS public.ferie_blocco_giorno(uuid, date, text);
DROP FUNCTION IF EXISTS public.ferie_lunedi_ce_guida();
DROP FUNCTION IF EXISTS public.guida_negozio_effettiva(uuid);
DROP FUNCTION IF EXISTS public.festivo_italiano(date);

ALTER TABLE public.leave_requests
  DROP COLUMN IF EXISTS prima_decisione,
  DROP COLUMN IF EXISTS eccezione_motivo,
  DROP COLUMN IF EXISTS eccezione;
DROP TABLE IF EXISTS public.leave_hr;
DROP TABLE IF EXISTS public.outlet_leave_rules;

COMMIT;
