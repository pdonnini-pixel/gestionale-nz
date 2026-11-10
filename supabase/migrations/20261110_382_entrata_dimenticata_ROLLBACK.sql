-- Rollback della migrazione 382 (entrata dimenticata, aggiunta a mano, avvisi).
-- Le timbrature dichiarate e aggiunte a mano restano (nessun dato si cancella);
-- i vincoli tornano come prima ma NOT VALID, perche' le righe nuove restano.
-- La colonna avvisa_confermatori resta (un'impostazione salvata non si perde).
BEGIN;

ALTER TABLE public.attendance_eventi DROP CONSTRAINT attendance_eventi_tipo_check;
ALTER TABLE public.attendance_eventi ADD CONSTRAINT attendance_eventi_tipo_check
  CHECK (tipo = ANY (ARRAY['ritardo', 'uscita_anticipata', 'straordinario'])) NOT VALID;
ALTER TABLE public.attendance_alerts DROP CONSTRAINT attendance_alerts_destinatario_check;
ALTER TABLE public.attendance_alerts ADD CONSTRAINT attendance_alerts_destinatario_check
  CHECK (destinatario = ANY (ARRAY['dipendente', 'responsabile', 'ufficio'])) NOT VALID;
ALTER TABLE public.attendance_settings ALTER COLUMN avvisi_push SET DEFAULT false;

DO $do$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.presenze_decidi_evento(uuid, boolean, integer, boolean, text)'::regprocedure);
  n := replace(d, $x$  -- Entrata dichiarata (382): decisione sua, con l'ora e il ritardo
  IF ev.tipo = 'entrata_dichiarata' THEN
    RETURN public.presenze_decidi_entrata(p_evento, p_conferma, NULL, p_nota);
  END IF;
$x$, '');
  EXECUTE n;

  d := pg_get_functiondef('public.presenze_riapri_evento(uuid, text)'::regprocedure);
  n := replace(d, $x$  IF ev.tipo = 'entrata_dichiarata' THEN
    RAISE EXCEPTION 'Un''entrata già decisa non si riapre: in Giornata annulla la timbratura o aggiungine una a mano.' USING ERRCODE = '22023';
  END IF;
$x$, '');
  EXECUTE n;

  d := pg_get_functiondef('public.timbratrice_dati(uuid)'::regprocedure);
  n := replace(d, $x$,
                                                         'dichiarata', a.origine = 'dichiarata' AND a.verifica = 'da_confermare')$x$, ')');
  EXECUTE n;

  d := pg_get_functiondef('public.app_dipendente_oggi()'::regprocedure);
  n := replace(d, $x$, 'verifica', a.verifica)$x$, ')');
  EXECUTE n;

  d := pg_get_functiondef('public.presenze_eventi_elenco(date, date, boolean)'::regprocedure);
  n := replace(d, $x$
           'segnata_il', COALESCE(p.ora_dispositivo + make_interval(secs => COALESCE(p.scarto_secondi, 0)), p.ora_server),
           'canale', CASE WHEN p.origine <> 'dichiarata' THEN NULL WHEN p.ora_dispositivo IS NOT NULL THEN 'negozio' ELSE 'app' END,
           'turno_inizio'$x$, $x$ 'turno_inizio'$x$);
  EXECUTE n;
END
$do$;

CREATE OR REPLACE FUNCTION public.timbrature_conferma(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.timbrature_gestore() THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  UPDATE public.attendance_punches
     SET verifica = 'manuale', nota = trim(COALESCE(nota, '') || ' [confermata il ' || to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY HH24:MI') || ']')
   WHERE id = p_id AND company_id = (SELECT public.get_my_company_id()) AND verifica = 'da_confermare' AND NOT annullata;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.timbrature_registra(p_righe jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company uuid := (SELECT public.get_my_company_id());
  r         jsonb;
  v_parti   text[];
  v_emp     uuid;
  v_passo   bigint;
  v_segreto text;
  v_attivo  boolean;
  v_disp    timestamptz;
  v_scarto  integer;
  v_ora     timestamptz;
  v_verifica text;
  v_esiti   jsonb := '[]'::jsonb;
  v_outlet  uuid;
  v_n       integer;
BEGIN
  IF jsonb_typeof(p_righe) <> 'array' OR jsonb_array_length(p_righe) > 500 THEN
    RAISE EXCEPTION 'Formato non valido' USING ERRCODE = '22023';
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_righe) LOOP
   BEGIN
    IF COALESCE(r->>'tipo', '') NOT IN ('entrata', 'inizio_pausa', 'fine_pausa', 'uscita')
       OR COALESCE(r->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_esiti := v_esiti || jsonb_build_object('id', r->>'id', 'esito', 'riga_non_valida');
      CONTINUE;
    END IF;
    v_outlet := (r->>'outlet_id')::uuid;
    IF NOT public.timbrature_puo_timbrare(v_outlet) THEN
      v_esiti := v_esiti || jsonb_build_object('id', r->>'id', 'esito', 'negozio_non_autorizzato');
      CONTINUE;
    END IF;

    v_parti := string_to_array(COALESCE(r->>'codice', ''), '.');
    IF array_length(v_parti, 1) IS DISTINCT FROM 4 OR v_parti[1] <> 'NZT1'
       OR v_parti[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR v_parti[3] !~ '^[0-9]{1,12}$' THEN
      v_esiti := v_esiti || jsonb_build_object('id', r->>'id', 'esito', 'codice_illeggibile');
      CONTINUE;
    END IF;
    v_emp   := v_parti[2]::uuid;
    v_passo := v_parti[3]::bigint;

    SELECT a.segreto, COALESCE(e.is_active, true) INTO v_segreto, v_attivo
      FROM public.employee_app_access a
      JOIN public.employees e ON e.id = a.employee_id
     WHERE a.employee_id = v_emp AND e.company_id = v_company;
    IF NOT FOUND THEN
      v_esiti := v_esiti || jsonb_build_object('id', r->>'id', 'esito', 'persona_sconosciuta');
      CONTINUE;
    END IF;
    IF NOT v_attivo THEN
      v_esiti := v_esiti || jsonb_build_object('id', r->>'id', 'esito', 'persona_non_in_servizio');
      CONTINUE;
    END IF;

    v_disp   := COALESCE((r->>'ora_dispositivo')::timestamptz, now());
    v_scarto := COALESCE((r->>'scarto_secondi')::integer, 0);
    IF abs(v_scarto) > 86400 THEN v_scarto := 0; END IF;
    v_ora    := v_disp + make_interval(secs => v_scarto);

    IF public.timbrature_firma(v_segreto, v_emp, v_passo) <> lower(v_parti[4]) THEN
      v_verifica := 'firma_non_valida';
    ELSIF abs(extract(epoch FROM v_disp) - v_passo * 30) > 600
          OR v_ora > now() + interval '5 minutes' THEN
      v_verifica := 'fuori_tempo';
    ELSIF now() - v_ora > interval '36 hours' THEN
      v_verifica := 'da_confermare';
    ELSE
      v_verifica := 'ok';
    END IF;

    INSERT INTO public.attendance_punches
      (id, company_id, outlet_id, employee_id, tipo, ora, ora_dispositivo, scarto_secondi,
       dispositivo_id, sequenza, origine, verifica, passo_qr)
    VALUES
      ((r->>'id')::uuid, v_company, v_outlet, v_emp, r->>'tipo', v_ora, v_disp, v_scarto,
       left(r->>'dispositivo_id', 80), (r->>'sequenza')::integer, 'cellulare_negozio', v_verifica,
       CASE WHEN v_verifica = 'firma_non_valida' THEN NULL ELSE v_passo END)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 1 AND v_verifica IN ('ok', 'da_confermare') THEN
      BEGIN
        PERFORM public.timbrature_evento_da_timbratura((r->>'id')::uuid, NULLIF(r->>'causale', ''));
      EXCEPTION WHEN others THEN
        RAISE WARNING 'timbrature_evento_da_timbratura: %', SQLERRM;
      END;
    END IF;

    v_esiti := v_esiti || jsonb_build_object('id', r->>'id',
      'esito', CASE WHEN v_n = 1 THEN 'salvata'
                    WHEN EXISTS (SELECT 1 FROM public.attendance_punches WHERE id = (r->>'id')::uuid) THEN 'salvata'
                    ELSE 'qr_gia_usato' END,
      'verifica', v_verifica);
   EXCEPTION WHEN others THEN
    v_esiti := v_esiti || jsonb_build_object('id', r->>'id', 'esito', 'errore_temporaneo');
   END;
  END LOOP;

  RETURN jsonb_build_object('ora_server', now(), 'esiti', v_esiti);
END;
$fn$;

DROP FUNCTION public.timbrature_avvisi_da_mandare(timestamptz);
CREATE FUNCTION public.timbrature_avvisi_da_mandare(p_now timestamptz DEFAULT now())
RETURNS TABLE(company_id uuid, outlet_id uuid, employee_id uuid, shift_id uuid, data date, ora_turno time,
              tipo text, nome text, negozio text, responsabile_id uuid,
              avvisa_dipendente boolean, avvisa_responsabile boolean, avvisa_ufficio boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH oggi AS (SELECT (p_now AT TIME ZONE 'Europe/Rome')::date AS d),
  negozi AS (
    SELECT a.* FROM public.attendance_settings a WHERE a.attive AND a.avvisi_push
  ),
  turni AS (
    SELECT t.*, n.company_id AS cid, n.ritardo_attivo, n.ritardo_minuti, n.uscita_attivo, n.margine_uscita_minuti,
           n.avvisa_dipendente AS a_dip, n.avvisa_responsabile AS a_resp, n.avvisa_ufficio AS a_uff,
           ((t.data + t.inizio) AT TIME ZONE 'Europe/Rome') AS inizio_ts,
           ((t.data + t.fine)   AT TIME ZONE 'Europe/Rome') AS fine_ts
      FROM negozi n, oggi,
           LATERAL public.timbrature_turni_ufficiali(n.company_id, oggi.d - 1, oggi.d) t
     WHERE t.outlet_id = n.outlet_id
  ),
  stato AS (
    SELECT t.*,
           (SELECT a.tipo FROM public.attendance_punches a
             WHERE a.employee_id = t.employee_id AND NOT a.annullata
               AND a.ora >= (t.data::timestamp AT TIME ZONE 'Europe/Rome') AND a.ora <= p_now
             ORDER BY a.ora DESC LIMIT 1) AS ultima
      FROM turni t
  ),
  candidati AS (
    SELECT s.*, 'ritardo'::text AS tipo_avviso, s.inizio AS ora
      FROM stato s
     WHERE s.ritardo_attivo
       AND s.inizio_ts + make_interval(mins => s.ritardo_minuti) <= p_now
       AND s.inizio_ts >= p_now - interval '3 hours'
       AND COALESCE(s.ultima, 'uscita') = 'uscita'
       AND NOT EXISTS (SELECT 1 FROM public.leave_request_days d JOIN public.leave_requests q ON q.id = d.request_id
                        WHERE q.employee_id = s.employee_id AND d.data = s.data
                          AND q.stato IN ('inviata', 'approvata', 'approvata_parziale', 'chiusa')
                          AND d.stato IN ('richiesto', 'approvato'))
    UNION ALL
    SELECT s.*, 'uscita_mancante'::text, s.fine
      FROM stato s
     WHERE s.uscita_attivo
       AND s.fine_ts + make_interval(mins => s.margine_uscita_minuti) <= p_now
       AND s.fine_ts >= p_now - interval '12 hours'
       AND s.ultima IN ('entrata', 'inizio_pausa', 'fine_pausa')
       AND NOT EXISTS (SELECT 1 FROM public.timbrature_turni_ufficiali(s.cid, s.data, s.data) t2
                        WHERE t2.employee_id = s.employee_id AND t2.shift_id <> s.shift_id AND t2.inizio >= s.fine)
  )
  SELECT c.cid, c.outlet_id, c.employee_id, c.shift_id, c.data, c.ora, c.tipo_avviso,
         trim(COALESCE(e.nome, e.first_name, '') || ' ' || COALESCE(e.cognome, e.last_name, '')), o.name,
         o.referente_employee_id, c.a_dip, c.a_resp AND NOT e.is_demo, c.a_uff AND NOT e.is_demo
    FROM candidati c
    JOIN public.employees e ON e.id = c.employee_id AND COALESCE(e.is_active, true)
    JOIN public.outlets o ON o.id = c.outlet_id
   WHERE NOT EXISTS (SELECT 1 FROM public.attendance_alerts x
                      WHERE x.employee_id = c.employee_id AND x.data = c.data
                        AND x.ora_turno = c.ora AND x.tipo = c.tipo_avviso);
$fn$;
REVOKE ALL ON FUNCTION public.timbrature_avvisi_da_mandare(timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timbrature_avvisi_da_mandare(timestamptz) TO service_role;

DROP FUNCTION IF EXISTS public.timbrature_aggiungi(uuid, uuid, text, timestamptz, text);
DROP FUNCTION IF EXISTS public.presenze_decidi_entrata(uuid, boolean, time, text);
DROP FUNCTION IF EXISTS public.app_dipendente_dichiara_entrata(time, text);
DROP FUNCTION IF EXISTS public.timbrature_entrata_dichiarata_evento(uuid);

COMMIT;
