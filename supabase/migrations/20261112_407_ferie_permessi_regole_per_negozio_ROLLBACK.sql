-- ROLLBACK della 407. Rimette le funzioni com'erano e toglie tabelle, colonne e funzioni nate con la 407.
-- ATTENZIONE: perde i dati scritti dopo la 407 (regole del negozio, elenco HR, eccezioni, prime
-- approvazioni). Prima di eseguirlo, salvare:
--   SELECT * FROM public.outlet_leave_rules;  SELECT * FROM public.leave_hr;
--   SELECT id, eccezione, eccezione_motivo, prima_decisione FROM public.leave_requests
--    WHERE eccezione IS NOT NULL OR prima_decisione IS NOT NULL;
-- e chiedere conferma a Patrizio (regola NO DATA LOSS). Le richieste restano nello stato che hanno.
-- Il rollback ne fa comunque una copia prima di toglierle: _bkp_407_outlet_leave_rules,
-- _bkp_407_leave_hr, _bkp_407_leave_requests (senza GRANT: invisibili all'API).
--
-- EVENTI: dopo il rollback torna a valere solo blocca_ferie (blocca ferie e permessi insieme).
--   - Gli eventi allineati dalla 407 tornano alle voci di prima (regole.prima_407).
--   - Gli eventi salvati DOPO la 407 con una sola voce spenta hanno blocca_ferie = false:
--     col codice di prima non bloccherebbero piu' niente. Il rollback li riporta a
--     blocca_ferie = true (bloccano tutte e due, come faceva la 405). Se per uno di loro
--     si vuole il contrario, va riaperto e risalvato dalla finestra dell'evento.
BEGIN;

-- copie di sicurezza, prima di tutto
CREATE TABLE IF NOT EXISTS public._bkp_407_outlet_leave_rules AS SELECT now() AS salvato_il, * FROM public.outlet_leave_rules;
CREATE TABLE IF NOT EXISTS public._bkp_407_leave_hr AS SELECT now() AS salvato_il, * FROM public.leave_hr;
CREATE TABLE IF NOT EXISTS public._bkp_407_leave_requests AS
  SELECT now() AS salvato_il, id, company_id, stato, eccezione, eccezione_motivo, prima_decisione
    FROM public.leave_requests WHERE eccezione IS NOT NULL OR eccezione_motivo IS NOT NULL OR prima_decisione IS NOT NULL;
ALTER TABLE public._bkp_407_outlet_leave_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bkp_407_leave_hr ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bkp_407_leave_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bkp_407_outlet_leave_rules, public._bkp_407_leave_hr, public._bkp_407_leave_requests FROM PUBLIC, anon, authenticated;

-- eventi: le voci di prima dove la 407 le aveva allineate, e il blocco di tutte e due dove ne e' spenta una
UPDATE public.outlet_events
   SET regole = (regole - 'prima_407') || jsonb_strip_nulls(jsonb_build_object('ferie', regole -> 'prima_407' -> 'ferie', 'permessi', regole -> 'prima_407' -> 'permessi'))
 WHERE regole ? 'prima_407';
UPDATE public.outlet_events
   SET blocca_ferie = true
 WHERE NOT COALESCE(blocca_ferie, false)
   AND (COALESCE(regole ->> 'ferie', '') = 'false' OR COALESCE(regole ->> 'permessi', '') = 'false');

DROP TRIGGER IF EXISTS trg_leave_requests_campi_protetti ON public.leave_requests;
DROP FUNCTION IF EXISTS public.leave_requests_campi_protetti();

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
        $x$'id', q.id, 'stato', q.stato, 'eccezione', COALESCE(q.eccezione, false), 'attesa_seconda', (q.prima_decisione IS NOT NULL), 'note', q.note_dipendente,$x$,
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

  d := pg_get_functiondef('public.ferie_lunedi_testo(uuid,date[],boolean)'::regprocedure);
  n := replace(d, $x$|| CASE WHEN public.ferie_lunedi_provvisoria(p_employee_id) THEN '' ELSE ' è già assente l''altra fra responsabile e vice del negozio' END$x$,
    $x$|| ' è già assente l''altra fra responsabile e vice del negozio'$x$);
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
DROP FUNCTION IF EXISTS public.ferie_lunedi_provvisoria(uuid);
DROP FUNCTION IF EXISTS public.guida_negozio_effettiva(uuid);
DROP FUNCTION IF EXISTS public.festivo_italiano(date);

ALTER TABLE public.leave_requests
  DROP COLUMN IF EXISTS prima_decisione,
  DROP COLUMN IF EXISTS eccezione_motivo,
  DROP COLUMN IF EXISTS eccezione;
DROP TABLE IF EXISTS public.leave_hr;
DROP TABLE IF EXISTS public.outlet_leave_rules;

COMMIT;
