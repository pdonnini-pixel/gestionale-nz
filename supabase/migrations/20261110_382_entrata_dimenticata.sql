-- =====================================================================
-- Migrazione 382 — Presenze: entrata dimenticata, aggiunta a mano,
-- avvisi accesi di base e avviso a chi conferma il negozio
-- =====================================================================
-- Decisioni di Patrizio del 10/11/2026 (mockup approvati):
--   * Chi ha dimenticato l'entrata la segna da sola: al telefono del
--     negozio (quando avvicina il QR e il turno e' cominciato da piu' della
--     tolleranza senza entrata) o dall'app (riquadro giallo nella scheda
--     Oggi). L'ora si sceglie fra l'inizio del turno meno un'ora e adesso.
--   * L'entrata dichiarata vale subito per pausa e uscita, ma resta «da
--     confermare»: la conferma chi conferma il negozio. Alla conferma, se
--     l'ora e' oltre la tolleranza, nasce il ritardo (da confermare a sua
--     volta, come sempre). Non confermata, la timbratura si annulla.
--   * Chi segue il personale aggiunge a mano una timbratura (entrata,
--     pausa, rientro, uscita) con il motivo: resta «inserita a mano».
--   * Avvisi sul telefono accesi di base («casomai li devono disattivare»):
--     vale per i negozi nuovi. I negozi gia' configurati non cambiano.
--   * Nuovo destinatario degli avvisi: chi conferma il negozio (notifica nel
--     gestionale), acceso di base per i negozi nuovi; nei negozi gia'
--     configurati resta spento finche' non lo si spunta.
--   * Entrata non confermata: la giornata resta senza entrata e se ne occupa
--     chi segue il personale (notifica all'ufficio nel gestionale).
--
-- COSA INTRODUCE:
--   1. attendance_eventi.tipo: 'entrata_dichiarata'.
--      attendance_alerts.destinatario: 'confermatori'.
--      attendance_settings: avvisi_push DEFAULT true, avvisa_confermatori.
--   2. timbrature_entrata_dichiarata_evento(punch): il caso da confermare
--      e la notifica a chi conferma (interna).
--   3. timbrature_registra: riga con 'ora_dichiarata' dal telefono del
--      negozio (QR valido, stesso giorno, nessuna timbratura prima, ora non
--      prima dell'inizio del turno meno un'ora). Se la dichiarazione non
--      regge, l'entrata si salva all'ora del QR come sempre: nessuna
--      timbratura si perde.
--   4. app_dipendente_dichiara_entrata(ora, nota): dall'app, solo oggi.
--   5. presenze_decidi_entrata(evento, conferma, ora, nota);
--      presenze_decidi_evento la usa per questo tipo; presenze_riapri_evento
--      non riapre un'entrata decisa; timbrature_conferma (Giornata) passa
--      dalla stessa decisione.
--   6. timbrature_aggiungi(persona, negozio, tipo, ora, motivo): solo chi
--      segue il personale (timbrature_gestore).
--   7. presenze_eventi_elenco: quando e da dove e' stata segnata;
--      timbratrice_dati e app_dipendente_oggi: se la timbratura e'
--      dichiarata e da confermare.
--   8. timbrature_avvisi_da_mandare: anche avvisa_confermatori.
--
-- NO DATA LOSS: nessuna riga cancellata; colonne e vincoli solo allargati.
-- Tenant: NZ e Zago (Made escluso dal 03/11/2026).
-- Rollback: 20261110_382_entrata_dimenticata_ROLLBACK.sql
-- =====================================================================

BEGIN;

-- 1. Vincoli e impostazioni ---------------------------------------------
ALTER TABLE public.attendance_eventi DROP CONSTRAINT attendance_eventi_tipo_check;
ALTER TABLE public.attendance_eventi ADD CONSTRAINT attendance_eventi_tipo_check
  CHECK (tipo = ANY (ARRAY['ritardo', 'uscita_anticipata', 'straordinario', 'entrata_dichiarata']));

ALTER TABLE public.attendance_alerts DROP CONSTRAINT attendance_alerts_destinatario_check;
ALTER TABLE public.attendance_alerts ADD CONSTRAINT attendance_alerts_destinatario_check
  CHECK (destinatario = ANY (ARRAY['dipendente', 'responsabile', 'ufficio', 'confermatori']));

ALTER TABLE public.attendance_settings ALTER COLUMN avvisi_push SET DEFAULT true;
-- Le righe gia' salvate restano com'erano (avvisa_confermatori false): si
-- accende dalla pagina. I negozi nuovi nascono con tutto acceso.
ALTER TABLE public.attendance_settings ADD COLUMN IF NOT EXISTS avvisa_confermatori boolean NOT NULL DEFAULT false;
ALTER TABLE public.attendance_settings ALTER COLUMN avvisa_confermatori SET DEFAULT true;

-- 2. Il caso dell'entrata dichiarata ------------------------------------
CREATE OR REPLACE FUNCTION public.timbrature_entrata_dichiarata_evento(p_punch uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  p        public.attendance_punches%ROWTYPE;
  v_loc    timestamp;
  v_data   date;
  v_inizio time;
  v_fine   time;
  v_tol    integer;
  v_marg   integer;
  v_min    integer := 0;
  v_id     uuid;
  v_nome   text;
  v_demo   boolean;
BEGIN
  SELECT * INTO p FROM public.attendance_punches WHERE id = p_punch;
  IF NOT FOUND OR p.annullata OR p.tipo <> 'entrata' OR p.origine <> 'dichiarata' OR p.verifica <> 'da_confermare' THEN
    RETURN NULL;
  END IF;
  v_loc  := p.ora AT TIME ZONE 'Europe/Rome';
  v_data := v_loc::date;
  SELECT min(t.inizio), max(t.fine) INTO v_inizio, v_fine
    FROM public.timbrature_turni_ufficiali(p.company_id, v_data, v_data) t
   WHERE t.employee_id = p.employee_id;
  SELECT r.tolleranza, r.margine INTO v_tol, v_marg FROM public.timbrature_regole(p.employee_id, p.outlet_id) r;
  IF v_inizio IS NOT NULL THEN
    v_min := GREATEST(0, ceil(extract(epoch FROM (v_loc - (v_data + v_inizio))) / 60.0)::integer);
  END IF;

  INSERT INTO public.attendance_eventi
    (company_id, outlet_id, employee_id, punch_id, data, tipo, turno_inizio, turno_fine,
     minuti, minuti_proposti, tolleranza_minuti, margine_minuti)
  VALUES
    (p.company_id, p.outlet_id, p.employee_id, p.id, v_data, 'entrata_dichiarata', v_inizio, v_fine,
     v_min, 0, v_tol, v_marg)
  ON CONFLICT (punch_id, tipo) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    SELECT btrim(COALESCE(e.nome, e.first_name, '') || ' ' || COALESCE(e.cognome, e.last_name, '')), e.is_demo
      INTO v_nome, v_demo FROM public.employees e WHERE e.id = p.employee_id;
    IF NOT COALESCE(v_demo, false) THEN
      INSERT INTO public.notifications
        (company_id, user_id, title, message, category, severity, action_url, action_label, reference_type, reference_id)
      SELECT p.company_id, c.user_id,
             'Entrata da confermare: ' || COALESCE(v_nome, ''),
             to_char(v_data, 'DD/MM/YYYY') || ', entrata segnata alle ' || to_char(v_loc, 'HH24:MI')
               || ' (non timbrata). Da confermare in Dipendenti → Presenze.',
             'info', 'info', '/dipendenti?view=presenze', 'Apri le presenze', 'attendance_evento', v_id
        FROM public.attendance_confermatori c WHERE c.outlet_id = p.outlet_id;
    END IF;
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.timbrature_entrata_dichiarata_evento(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timbrature_entrata_dichiarata_evento(uuid) TO service_role;

-- 3. Telefono del negozio: riga con l'ora dichiarata ---------------------
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
  -- entrata dimenticata (migration 382)
  v_dich    timestamptz;
  v_dich_ok boolean;
  v_giorno  date;
  v_ini     time;
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

    -- Entrata dimenticata (382): vale solo con il QR valido, lo stesso giorno,
    -- nessuna timbratura prima e un'ora non prima dell'inizio del turno meno
    -- un'ora. Altrimenti l'entrata si salva all'ora del QR, come sempre.
    v_dich := NULL;
    v_dich_ok := false;
    IF r->>'tipo' = 'entrata' AND COALESCE(r->>'ora_dichiarata', '') <> '' AND v_verifica = 'ok' THEN
      BEGIN
        v_dich := (r->>'ora_dichiarata')::timestamptz;
      EXCEPTION WHEN others THEN
        v_dich := NULL;
      END;
      v_giorno := (v_ora AT TIME ZONE 'Europe/Rome')::date;
      IF v_dich IS NOT NULL AND v_dich <= v_ora AND (v_dich AT TIME ZONE 'Europe/Rome')::date = v_giorno THEN
        SELECT min(t.inizio) INTO v_ini
          FROM public.timbrature_turni_ufficiali(v_company, v_giorno, v_giorno) t
         WHERE t.employee_id = v_emp;
        v_dich_ok := v_ini IS NOT NULL
          AND v_dich >= ((v_giorno + v_ini) AT TIME ZONE 'Europe/Rome') - interval '60 minutes'
          AND NOT EXISTS (SELECT 1 FROM public.attendance_punches a
                           WHERE a.employee_id = v_emp AND NOT a.annullata
                             AND a.ora >= (v_giorno::timestamp AT TIME ZONE 'Europe/Rome') AND a.ora < v_ora);
      END IF;
    END IF;

    INSERT INTO public.attendance_punches
      (id, company_id, outlet_id, employee_id, tipo, ora, ora_dispositivo, scarto_secondi,
       dispositivo_id, sequenza, origine, verifica, passo_qr, nota)
    VALUES
      ((r->>'id')::uuid, v_company, v_outlet, v_emp, r->>'tipo',
       CASE WHEN v_dich_ok THEN v_dich ELSE v_ora END, v_disp, v_scarto,
       left(r->>'dispositivo_id', 80), (r->>'sequenza')::integer,
       CASE WHEN v_dich_ok THEN 'dichiarata' ELSE 'cellulare_negozio' END,
       CASE WHEN v_dich_ok THEN 'da_confermare' ELSE v_verifica END,
       CASE WHEN v_verifica = 'firma_non_valida' THEN NULL ELSE v_passo END,
       CASE WHEN v_dich_ok THEN 'Entrata segnata al telefono del negozio alle '
                                || to_char(v_ora AT TIME ZONE 'Europe/Rome', 'HH24:MI') END)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 1 AND v_dich_ok THEN
      BEGIN
        PERFORM public.timbrature_entrata_dichiarata_evento((r->>'id')::uuid);
      EXCEPTION WHEN others THEN
        RAISE WARNING 'timbrature_entrata_dichiarata_evento: %', SQLERRM;
      END;
    ELSIF v_n = 1 AND v_verifica IN ('ok', 'da_confermare') THEN
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
      'verifica', v_verifica,
      'dichiarata', v_dich_ok);
   EXCEPTION WHEN others THEN
    v_esiti := v_esiti || jsonb_build_object('id', r->>'id', 'esito', 'errore_temporaneo');
   END;
  END LOOP;

  RETURN jsonb_build_object('ora_server', now(), 'esiti', v_esiti);
END;
$fn$;

-- 4. Dall'app: «Sono entrato alle» --------------------------------------
CREATE OR REPLACE FUNCTION public.app_dipendente_dichiara_entrata(p_ora time, p_nota text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_emp    uuid := public.timbrature_mio_dipendente();
  v_comp   uuid;
  v_outlet uuid;
  v_ini    time;
  v_oggi   date := (now() AT TIME ZONE 'Europe/Rome')::date;
  v_ts     timestamptz;
  v_dal    timestamptz;
  v_id     uuid := gen_random_uuid();
  v_ev     uuid;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Accesso non collegato a un dipendente' USING ERRCODE = '42501';
  END IF;
  IF p_ora IS NULL THEN
    RAISE EXCEPTION 'Scegli l''ora' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('entrata_dichiarata:' || v_emp::text));
  SELECT company_id INTO v_comp FROM public.employees WHERE id = v_emp;

  SELECT t.inizio, t.outlet_id INTO v_ini, v_outlet
    FROM public.timbrature_turni_ufficiali(v_comp, v_oggi, v_oggi) t
   WHERE t.employee_id = v_emp
   ORDER BY t.inizio LIMIT 1;
  IF v_ini IS NULL THEN
    RAISE EXCEPTION 'Oggi non risulta un tuo turno: avvisa il responsabile.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.attendance_punches a
              WHERE a.employee_id = v_emp AND NOT a.annullata
                AND a.ora >= (v_oggi::timestamp AT TIME ZONE 'Europe/Rome')) THEN
    RAISE EXCEPTION 'Oggi risulta già una timbratura: se manca qualcosa avvisa il responsabile.' USING ERRCODE = '22023';
  END IF;

  v_ts  := (v_oggi + p_ora) AT TIME ZONE 'Europe/Rome';
  v_dal := ((v_oggi + v_ini) AT TIME ZONE 'Europe/Rome') - interval '60 minutes';
  IF v_ts > now() OR v_ts < v_dal THEN
    RAISE EXCEPTION 'Puoi segnare un''ora fra le % e adesso.', to_char(v_dal AT TIME ZONE 'Europe/Rome', 'HH24:MI')
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.attendance_punches (id, company_id, outlet_id, employee_id, tipo, ora, origine, verifica, nota)
  VALUES (v_id, v_comp, v_outlet, v_emp, 'entrata', v_ts, 'dichiarata', 'da_confermare',
          'Entrata segnata dall''app alle ' || to_char(now() AT TIME ZONE 'Europe/Rome', 'HH24:MI'));
  v_ev := public.timbrature_entrata_dichiarata_evento(v_id);
  IF v_ev IS NOT NULL AND NULLIF(btrim(p_nota), '') IS NOT NULL THEN
    UPDATE public.attendance_eventi
       SET motivo_dipendente = left(btrim(p_nota), 500), motivo_il = now()
     WHERE id = v_ev;
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.app_dipendente_dichiara_entrata(time, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_dipendente_dichiara_entrata(time, text) TO authenticated, service_role;

-- 5. La decisione su un'entrata dichiarata ------------------------------
CREATE OR REPLACE FUNCTION public.presenze_decidi_entrata(
  p_evento uuid, p_conferma boolean, p_ora time DEFAULT NULL, p_nota text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  ev       public.attendance_eventi%ROWTYPE;
  p        public.attendance_punches%ROWTYPE;
  v_nota   text := left(NULLIF(btrim(p_nota), ''), 500);
  v_segnata timestamptz;
  v_nuova  timestamptz;
  v_dopo   timestamptz;
  v_min    integer;
  v_ritardo boolean;
BEGIN
  -- Stesso ordine dei lucchetti di timbrature_annulla: prima la timbratura, poi il caso
  SELECT * INTO ev FROM public.attendance_eventi WHERE id = p_evento;
  IF NOT FOUND OR ev.company_id <> public.get_my_company_id() OR NOT public.presenze_puo_confermare(ev.outlet_id) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.attendance_punches WHERE id = ev.punch_id FOR UPDATE;
  SELECT * INTO ev FROM public.attendance_eventi WHERE id = p_evento FOR UPDATE;
  PERFORM public.presenze_non_su_di_me(ev.employee_id);
  IF ev.tipo <> 'entrata_dichiarata' THEN
    RAISE EXCEPTION 'Non è un''entrata dichiarata' USING ERRCODE = '22023';
  END IF;
  IF ev.stato <> 'da_confermare' THEN
    RAISE EXCEPTION 'È già stato deciso.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO p FROM public.attendance_punches WHERE id = ev.punch_id;
  IF NOT FOUND OR p.annullata THEN
    RAISE EXCEPTION 'La timbratura è stata annullata.' USING ERRCODE = '22023';
  END IF;

  IF p_conferma IS NOT TRUE THEN
    IF v_nota IS NULL THEN
      RAISE EXCEPTION 'Scrivi il motivo: lo legge la persona nell''app.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.attendance_punches
       SET annullata = true, annullata_motivo = 'Entrata dichiarata non confermata: ' || v_nota,
           annullata_da = auth.uid(), annullata_il = now()
     WHERE id = p.id;
    UPDATE public.attendance_eventi
       SET stato = 'respinto', esito = 'entrata_non_confermata', deciso_da = auth.uid(), deciso_il = now(),
           nota_decisione = v_nota
     WHERE id = p_evento;
    -- La giornata resta senza entrata (pausa e uscita restano): la sistema chi
    -- segue il personale, che lo sa dalla notifica dell'ufficio.
    IF NOT COALESCE((SELECT e.is_demo FROM public.employees e WHERE e.id = ev.employee_id), false) THEN
      INSERT INTO public.notifications
        (company_id, user_id, title, message, category, severity, action_url, action_label, reference_type, reference_id)
      SELECT ev.company_id, NULL,
             'Entrata non confermata: ' || btrim(COALESCE(e.nome, e.first_name, '') || ' ' || COALESCE(e.cognome, e.last_name, '')),
             to_char(ev.data, 'DD/MM/YYYY') || ': la giornata è senza entrata. Aggiungila a mano in Dipendenti → Presenze → Giornata, se serve.',
             'info', 'warning', '/dipendenti?view=presenze', 'Apri le presenze', 'attendance_evento', ev.id
        FROM public.employees e WHERE e.id = ev.employee_id;
    END IF;
    RETURN 'respinto';
  END IF;

  -- Ora corretta da chi conferma: fra l'inizio del turno meno un'ora, prima
  -- di quando e' stata segnata e prima della timbratura successiva.
  IF p_ora IS NOT NULL AND p_ora <> (p.ora AT TIME ZONE 'Europe/Rome')::time THEN
    v_nuova   := (ev.data + p_ora) AT TIME ZONE 'Europe/Rome';
    v_segnata := COALESCE(p.ora_dispositivo + make_interval(secs => COALESCE(p.scarto_secondi, 0)), p.ora_server);
    SELECT min(a.ora) INTO v_dopo FROM public.attendance_punches a
     WHERE a.employee_id = p.employee_id AND NOT a.annullata AND a.id <> p.id AND a.ora > p.ora
       AND a.ora < ((ev.data + 1)::timestamp AT TIME ZONE 'Europe/Rome');
    IF (ev.turno_inizio IS NOT NULL AND v_nuova < ((ev.data + ev.turno_inizio) AT TIME ZONE 'Europe/Rome') - interval '60 minutes')
       OR v_nuova > v_segnata OR (v_dopo IS NOT NULL AND v_nuova >= v_dopo) THEN
      RAISE EXCEPTION 'Ora non valida: deve stare fra l''inizio del turno meno un''ora, prima della timbratura successiva e prima di quando è stata segnata.'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.attendance_punches
       SET ora = v_nuova,
           nota = btrim(COALESCE(nota, '') || ' [ora corretta da ' || to_char(p.ora AT TIME ZONE 'Europe/Rome', 'HH24:MI')
                  || ' a ' || to_char(v_nuova AT TIME ZONE 'Europe/Rome', 'HH24:MI') || ']')
     WHERE id = p.id;
    p.ora := v_nuova;
  END IF;

  v_min := CASE WHEN ev.turno_inizio IS NULL THEN 0
                ELSE GREATEST(0, ceil(extract(epoch FROM ((p.ora AT TIME ZONE 'Europe/Rome') - (ev.data + ev.turno_inizio))) / 60.0)::integer) END;

  -- Il ritardo nasce adesso, come se l'entrata fosse stata timbrata a quell'ora
  -- (la timbratura e' ancora 'da_confermare', che timbrature_evento_da_timbratura accetta).
  PERFORM public.timbrature_evento_da_timbratura(p.id, NULL);
  v_ritardo := EXISTS (SELECT 1 FROM public.attendance_eventi x WHERE x.punch_id = p.id AND x.tipo = 'ritardo');

  UPDATE public.attendance_punches
     SET verifica = 'manuale',
         nota = btrim(COALESCE(nota, '') || ' [confermata il ' || to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY HH24:MI') || ']')
   WHERE id = p.id;
  UPDATE public.attendance_eventi
     SET stato = 'confermato', esito = 'entrata_confermata', minuti = v_min, minuti_confermati = 0,
         deciso_da = auth.uid(), deciso_il = now(), nota_decisione = v_nota
   WHERE id = p_evento;
  RETURN CASE WHEN v_ritardo THEN 'entrata_confermata_ritardo' ELSE 'entrata_confermata' END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.presenze_decidi_entrata(uuid, boolean, time, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.presenze_decidi_entrata(uuid, boolean, time, text) TO authenticated, service_role;

-- 5b. presenze_decidi_evento, presenze_riapri_evento, timbratrice_dati,
--     app_dipendente_oggi, presenze_eventi_elenco: ritocchi sul testo vivo
DO $do$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.presenze_decidi_evento(uuid, boolean, integer, boolean, text)'::regprocedure);
  n := replace(d, $x$  v_giorno := to_char(ev.data, 'DD/MM/YYYY');
$x$, $x$  -- Entrata dichiarata (382): decisione sua, con l'ora e il ritardo
  IF ev.tipo = 'entrata_dichiarata' THEN
    RETURN public.presenze_decidi_entrata(p_evento, p_conferma, NULL, p_nota);
  END IF;
  v_giorno := to_char(ev.data, 'DD/MM/YYYY');
$x$);
  IF n = d THEN RAISE EXCEPTION 'presenze_decidi_evento: testo atteso non trovato'; END IF;
  EXECUTE n;

  d := pg_get_functiondef('public.presenze_riapri_evento(uuid, text)'::regprocedure);
  n := replace(d, $x$  IF ev.leave_request_id IS NOT NULL THEN
$x$, $x$  IF ev.tipo = 'entrata_dichiarata' THEN
    RAISE EXCEPTION 'Un''entrata già decisa non si riapre: in Giornata annulla la timbratura o aggiungine una a mano.' USING ERRCODE = '22023';
  END IF;
  IF ev.leave_request_id IS NOT NULL THEN
$x$);
  IF n = d THEN RAISE EXCEPTION 'presenze_riapri_evento: testo atteso non trovato'; END IF;
  EXECUTE n;

  d := pg_get_functiondef('public.timbratrice_dati(uuid)'::regprocedure);
  n := replace(d, $x$jsonb_build_object('id', a.id, 'employee_id', a.employee_id, 'tipo', a.tipo, 'ora', a.ora)$x$,
    $x$jsonb_build_object('id', a.id, 'employee_id', a.employee_id, 'tipo', a.tipo, 'ora', a.ora,
                                                         'dichiarata', a.origine = 'dichiarata' AND a.verifica = 'da_confermare')$x$);
  IF n = d THEN RAISE EXCEPTION 'timbratrice_dati: testo atteso non trovato'; END IF;
  EXECUTE n;

  d := pg_get_functiondef('public.app_dipendente_oggi()'::regprocedure);
  n := replace(d, $x$jsonb_build_object('tipo', a.tipo, 'ora', a.ora, 'origine', a.origine)$x$,
    $x$jsonb_build_object('tipo', a.tipo, 'ora', a.ora, 'origine', a.origine, 'verifica', a.verifica)$x$);
  IF n = d THEN RAISE EXCEPTION 'app_dipendente_oggi: testo atteso non trovato'; END IF;
  EXECUTE n;

  d := pg_get_functiondef('public.presenze_eventi_elenco(date, date, boolean)'::regprocedure);
  n := replace(d, $x$'ora', p.ora, 'turno_inizio'$x$,
    $x$'ora', p.ora,
           'segnata_il', COALESCE(p.ora_dispositivo + make_interval(secs => COALESCE(p.scarto_secondi, 0)), p.ora_server),
           'canale', CASE WHEN p.origine <> 'dichiarata' THEN NULL WHEN p.ora_dispositivo IS NOT NULL THEN 'negozio' ELSE 'app' END,
           'turno_inizio'$x$);
  IF n = d THEN RAISE EXCEPTION 'presenze_eventi_elenco: testo atteso non trovato'; END IF;
  EXECUTE n;
END
$do$;

-- 5c. Giornata → «Conferma» su un'entrata dichiarata passa dalla decisione
CREATE OR REPLACE FUNCTION public.timbrature_conferma(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_ev uuid;
BEGIN
  IF NOT public.timbrature_gestore() THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  SELECT ev.id INTO v_ev FROM public.attendance_eventi ev
   WHERE ev.punch_id = p_id AND ev.tipo = 'entrata_dichiarata' AND ev.stato = 'da_confermare'
     AND ev.company_id = (SELECT public.get_my_company_id());
  IF v_ev IS NOT NULL THEN
    PERFORM public.presenze_decidi_entrata(v_ev, true, NULL, NULL);
    RETURN;
  END IF;
  UPDATE public.attendance_punches
     SET verifica = 'manuale', nota = trim(COALESCE(nota, '') || ' [confermata il ' || to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY HH24:MI') || ']')
   WHERE id = p_id AND company_id = (SELECT public.get_my_company_id()) AND verifica = 'da_confermare' AND NOT annullata;
END;
$fn$;

-- 6. Chi segue il personale aggiunge una timbratura a mano ---------------
CREATE OR REPLACE FUNCTION public.timbrature_aggiungi(
  p_employee uuid, p_outlet uuid, p_tipo text, p_ora timestamptz, p_motivo text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_comp uuid := (SELECT public.get_my_company_id());
  v_mot  text := left(NULLIF(btrim(p_motivo), ''), 500);
  v_id   uuid := gen_random_uuid();
BEGIN
  IF NOT public.timbrature_gestore() THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  -- Nessuno si aggiunge timbrature da solo (salvo super_advisor, come nelle decisioni)
  PERFORM public.presenze_non_su_di_me(p_employee);
  IF v_mot IS NULL THEN
    RAISE EXCEPTION 'Serve il motivo' USING ERRCODE = '22023';
  END IF;
  IF p_tipo NOT IN ('entrata', 'inizio_pausa', 'fine_pausa', 'uscita') THEN
    RAISE EXCEPTION 'Tipo non valido' USING ERRCODE = '22023';
  END IF;
  IF p_ora IS NULL OR p_ora > now() + interval '5 minutes' OR p_ora < now() - interval '400 days' THEN
    RAISE EXCEPTION 'Ora non valida' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = p_employee AND e.company_id = v_comp)
     OR NOT EXISTS (SELECT 1 FROM public.outlets o WHERE o.id = p_outlet AND o.company_id = v_comp) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.attendance_punches (id, company_id, outlet_id, employee_id, tipo, ora, origine, verifica, nota, registrata_da)
  VALUES (v_id, v_comp, p_outlet, p_employee, p_tipo, p_ora, 'manuale', 'manuale', v_mot, auth.uid());
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.timbrature_aggiungi(uuid, uuid, text, timestamptz, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.timbrature_aggiungi(uuid, uuid, text, timestamptz, text) TO authenticated, service_role;

-- 8. Avvisi: anche a chi conferma il negozio -----------------------------
DROP FUNCTION public.timbrature_avvisi_da_mandare(timestamptz);
CREATE FUNCTION public.timbrature_avvisi_da_mandare(p_now timestamptz DEFAULT now())
RETURNS TABLE(company_id uuid, outlet_id uuid, employee_id uuid, shift_id uuid, data date, ora_turno time,
              tipo text, nome text, negozio text, responsabile_id uuid,
              avvisa_dipendente boolean, avvisa_responsabile boolean, avvisa_ufficio boolean,
              avvisa_confermatori boolean)
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
           n.avvisa_confermatori AS a_conf,
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
         o.referente_employee_id, c.a_dip, c.a_resp AND NOT e.is_demo, c.a_uff AND NOT e.is_demo,
         c.a_conf AND NOT e.is_demo
    FROM candidati c
    JOIN public.employees e ON e.id = c.employee_id AND COALESCE(e.is_active, true)
    JOIN public.outlets o ON o.id = c.outlet_id
   WHERE NOT EXISTS (SELECT 1 FROM public.attendance_alerts x
                      WHERE x.employee_id = c.employee_id AND x.data = c.data
                        AND x.ora_turno = c.ora AND x.tipo = c.tipo_avviso);
$fn$;
REVOKE ALL ON FUNCTION public.timbrature_avvisi_da_mandare(timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timbrature_avvisi_da_mandare(timestamptz) TO service_role;

COMMIT;

-- Verifica (attesi: 4 vincoli/colonne giusti, 4 funzioni nuove, testi ritoccati):
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname IN ('attendance_eventi_tipo_check', 'attendance_alerts_destinatario_check');
-- SELECT column_default FROM information_schema.columns WHERE table_name = 'attendance_settings' AND column_name IN ('avvisi_push', 'avvisa_confermatori');
-- SELECT proname FROM pg_proc WHERE proname IN ('timbrature_entrata_dichiarata_evento', 'app_dipendente_dichiara_entrata', 'presenze_decidi_entrata', 'timbrature_aggiungi');
-- SELECT pg_get_functiondef('public.presenze_decidi_evento(uuid, boolean, integer, boolean, text)'::regprocedure) ~ 'presenze_decidi_entrata',
--        pg_get_functiondef('public.timbratrice_dati(uuid)'::regprocedure) ~ 'dichiarata',
--        pg_get_functiondef('public.presenze_eventi_elenco(date, date, boolean)'::regprocedure) ~ 'canale';
