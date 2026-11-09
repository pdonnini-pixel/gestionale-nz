-- =====================================================================
-- Migrazione 372 — Ritardi, uscite anticipate e straordinari dalle timbrature
-- =====================================================================
-- PERCHE': Patrizio (09/11/2026), dopo la prova con il Dipendente Demo:
--   - entrata oltre la tolleranza (10 minuti di partenza) = ritardo, con
--     minuti di permesso a blocchi di 15 per eccesso (12' -> 15');
--     entro la tolleranza si vede e basta;
--   - uscita prima della fine del turno = uscita anticipata, con la scelta:
--     motivo personale (permesso), malattia (si registra e basta), d'accordo
--     con il responsabile; il motivo scritto lo mette il dipendente dall'app;
--   - uscita oltre il margine (15 minuti di partenza) = straordinario, solo
--     i minuti oltre il margine, con il motivo: concordato per assenza di un
--     collega, cliente da gestire, riassortimento, allestimento;
--   - tolleranza e margine per negozio, con eccezioni per singolo dipendente;
--   - permessi e straordinari contano solo dopo la conferma (parte 4, nel
--     gestionale: qui si registrano «da_confermare»).
--
-- COSA INTRODUCE:
--   1. attendance_settings.tolleranza_entrata_minuti (10); margine d'uscita
--      di partenza 15 (prima 30): i negozi rimasti a 30 passano a 15
--   2. attendance_regole_dipendente: eccezioni per persona
--   3. attendance_eventi: il registro (ritardo, uscita_anticipata,
--      straordinario) con minuti, causale, motivo, stato e decisione
--   4. timbrature_regole(): tolleranza e margine che valgono per una persona
--   5. timbrature_evento_da_timbratura(): crea l'evento da una timbratura
--   6. timbrature_registra: legge la causale scelta sul telefono del negozio
--      e crea l'evento (un errore qui non blocca mai la timbratura)
--   7. timbratrice_dati: tolleranza e margine di ogni persona (offline)
--   8. app_dipendente_oggi: regole ed eventi di ieri e oggi
--   9. app_dipendente_motivo_evento(): il dipendente scrive il motivo
--
-- NO DATA LOSS: ADD COLUMN, CREATE TABLE, funzioni. L'unico UPDATE porta il
-- margine dei negozi da 30 (il valore di partenza) a 15, come deciso.
-- Tenant: NZ e Zago.
-- =====================================================================

BEGIN;

-- 1. Regole del negozio
ALTER TABLE public.attendance_settings
  ADD COLUMN IF NOT EXISTS tolleranza_entrata_minuti smallint NOT NULL DEFAULT 10 CHECK (tolleranza_entrata_minuti BETWEEN 0 AND 120);
ALTER TABLE public.attendance_settings ALTER COLUMN margine_uscita_minuti SET DEFAULT 15;
UPDATE public.attendance_settings SET margine_uscita_minuti = 15, updated_at = now() WHERE margine_uscita_minuti = 30;

-- 2. Eccezioni per persona (vuoto = vale la regola del negozio)
CREATE TABLE IF NOT EXISTS public.attendance_regole_dipendente (
  employee_id               uuid PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
  company_id                uuid NOT NULL REFERENCES public.companies(id),
  tolleranza_entrata_minuti smallint CHECK (tolleranza_entrata_minuti BETWEEN 0 AND 120),
  margine_uscita_minuti     smallint CHECK (margine_uscita_minuti BETWEEN 0 AND 240),
  nota                      text,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid
);
ALTER TABLE public.attendance_regole_dipendente ENABLE ROW LEVEL SECURITY;
CREATE POLICY attendance_regole_dipendente_select ON public.attendance_regole_dipendente FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.timbrature_gestore()));
CREATE POLICY cash_operator_block ON public.attendance_regole_dipendente AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'operatore_cassa');
CREATE POLICY dipendente_block ON public.attendance_regole_dipendente AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'dipendente')
  WITH CHECK (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'dipendente');
CREATE POLICY demo_nascosto ON public.attendance_regole_dipendente AS RESTRICTIVE FOR ALL TO authenticated
  USING (employee_id <> ALL ((SELECT public.dipendenti_demo_ids())::uuid[]))
  WITH CHECK (employee_id <> ALL ((SELECT public.dipendenti_demo_ids())::uuid[]));
GRANT SELECT ON public.attendance_regole_dipendente TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_regole_dipendente TO service_role;

-- 3. Registro degli eventi
CREATE TABLE IF NOT EXISTS public.attendance_eventi (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id),
  outlet_id           uuid NOT NULL REFERENCES public.outlets(id),
  employee_id         uuid NOT NULL REFERENCES public.employees(id),
  punch_id            uuid NOT NULL REFERENCES public.attendance_punches(id),
  data                date NOT NULL,
  tipo                text NOT NULL CHECK (tipo IN ('ritardo', 'uscita_anticipata', 'straordinario')),
  turno_inizio        time,
  turno_fine          time,
  minuti              integer NOT NULL CHECK (minuti >= 0),
  -- ritardo: blocchi di 15 per eccesso; uscita: i minuti; straordinario: oltre il margine
  minuti_proposti     integer NOT NULL CHECK (minuti_proposti >= 0),
  tolleranza_minuti   smallint,
  margine_minuti      smallint,
  causale             text CHECK (causale IS NULL OR causale IN (
                        'personale', 'malattia', 'accordo',
                        'assenza_collega', 'cliente', 'riassortimento', 'allestimento')),
  motivo_dipendente   text CHECK (motivo_dipendente IS NULL OR length(motivo_dipendente) <= 500),
  motivo_il           timestamptz,
  stato               text NOT NULL DEFAULT 'da_confermare' CHECK (stato IN ('da_confermare', 'confermato', 'respinto')),
  esito               text,
  deciso_da           uuid,
  deciso_il           timestamptz,
  nota_decisione      text,
  leave_request_id    uuid REFERENCES public.leave_requests(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (punch_id, tipo)
);
CREATE INDEX IF NOT EXISTS attendance_eventi_emp_data_idx ON public.attendance_eventi (employee_id, data);
CREATE INDEX IF NOT EXISTS attendance_eventi_da_confermare_idx ON public.attendance_eventi (company_id, outlet_id, stato) WHERE stato = 'da_confermare';
ALTER TABLE public.attendance_eventi ENABLE ROW LEVEL SECURITY;
CREATE POLICY attendance_eventi_select ON public.attendance_eventi FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.timbrature_gestore()));
CREATE POLICY cash_operator_block ON public.attendance_eventi AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'operatore_cassa');
CREATE POLICY dipendente_block ON public.attendance_eventi AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'dipendente')
  WITH CHECK (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'dipendente');
CREATE POLICY demo_nascosto ON public.attendance_eventi AS RESTRICTIVE FOR ALL TO authenticated
  USING (employee_id <> ALL ((SELECT public.dipendenti_demo_ids())::uuid[]))
  WITH CHECK (employee_id <> ALL ((SELECT public.dipendenti_demo_ids())::uuid[]));
GRANT SELECT ON public.attendance_eventi TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_eventi TO service_role;

-- 4. Le regole che valgono per una persona: la sua eccezione, poi il negozio, poi 10 e 15
CREATE OR REPLACE FUNCTION public.timbrature_regole(p_emp uuid, p_outlet uuid)
RETURNS TABLE(tolleranza integer, margine integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(rd.tolleranza_entrata_minuti, s.tolleranza_entrata_minuti, 10)::integer,
         COALESCE(rd.margine_uscita_minuti, s.margine_uscita_minuti, 15)::integer
    FROM (SELECT 1) x
    LEFT JOIN public.attendance_regole_dipendente rd ON rd.employee_id = p_emp
    LEFT JOIN public.attendance_settings s ON s.outlet_id = p_outlet;
$$;
REVOKE ALL ON FUNCTION public.timbrature_regole(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timbrature_regole(uuid, uuid) TO service_role;

-- 5. Dall'una timbratura all'evento (se c'e')
CREATE OR REPLACE FUNCTION public.timbrature_evento_da_timbratura(p_punch uuid, p_causale text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  p        public.attendance_punches%ROWTYPE;
  v_loc    timestamp;
  v_data   date;
  v_inizio time;
  v_fine   time;
  v_tol    integer;
  v_marg   integer;
  v_min    integer;
BEGIN
  SELECT * INTO p FROM public.attendance_punches WHERE id = p_punch;
  IF NOT FOUND OR p.annullata OR p.verifica NOT IN ('ok', 'da_confermare') OR p.tipo NOT IN ('entrata', 'uscita') THEN
    RETURN;
  END IF;
  v_loc := p.ora AT TIME ZONE 'Europe/Rome';
  v_data := v_loc::date;

  -- Turno della giornata: dal primo inizio all'ultima fine (turno spezzato compreso)
  SELECT min(t.inizio), max(t.fine) INTO v_inizio, v_fine
    FROM public.timbrature_turni_ufficiali(p.company_id, v_data, v_data) t
   WHERE t.employee_id = p.employee_id;
  IF v_inizio IS NULL OR v_fine <= v_inizio THEN
    RETURN; -- nessun turno (o turno a cavallo della mezzanotte): niente evento
  END IF;
  SELECT r.tolleranza, r.margine INTO v_tol, v_marg FROM public.timbrature_regole(p.employee_id, p.outlet_id) r;

  IF p.tipo = 'entrata' THEN
    -- Solo la prima entrata della giornata
    IF EXISTS (SELECT 1 FROM public.attendance_punches a
                WHERE a.employee_id = p.employee_id AND NOT a.annullata AND a.tipo = 'entrata' AND a.id <> p.id
                  AND (a.ora AT TIME ZONE 'Europe/Rome')::date = v_data AND a.ora < p.ora) THEN
      RETURN;
    END IF;
    v_min := ceil(extract(epoch FROM (v_loc - (v_data + v_inizio))) / 60.0)::integer;
    IF v_min > v_tol THEN
      INSERT INTO public.attendance_eventi
        (company_id, outlet_id, employee_id, punch_id, data, tipo, turno_inizio, turno_fine,
         minuti, minuti_proposti, tolleranza_minuti, margine_minuti)
      VALUES
        (p.company_id, p.outlet_id, p.employee_id, p.id, v_data, 'ritardo', v_inizio, v_fine,
         v_min, (ceil(v_min / 15.0) * 15)::integer, v_tol, v_marg)
      ON CONFLICT (punch_id, tipo) DO NOTHING;
    END IF;
    RETURN;
  END IF;

  -- Uscita prima della fine del turno (non conta se dopo c'e' un altro pezzo di turno)
  v_min := floor(extract(epoch FROM ((v_data + v_fine) - v_loc)) / 60.0)::integer;
  IF v_min >= 1 AND NOT EXISTS (
       SELECT 1 FROM public.timbrature_turni_ufficiali(p.company_id, v_data, v_data) t
        WHERE t.employee_id = p.employee_id AND t.inizio > v_loc::time) THEN
    INSERT INTO public.attendance_eventi
      (company_id, outlet_id, employee_id, punch_id, data, tipo, turno_inizio, turno_fine,
       minuti, minuti_proposti, tolleranza_minuti, margine_minuti, causale)
    VALUES
      (p.company_id, p.outlet_id, p.employee_id, p.id, v_data, 'uscita_anticipata', v_inizio, v_fine,
       v_min, v_min, v_tol, v_marg,
       CASE WHEN p_causale IN ('personale', 'malattia', 'accordo') THEN p_causale END)
    ON CONFLICT (punch_id, tipo) DO NOTHING;
    RETURN;
  END IF;

  -- Uscita oltre il margine: straordinario, solo i minuti oltre il margine
  v_min := floor(extract(epoch FROM (v_loc - (v_data + v_fine))) / 60.0)::integer;
  IF v_min > v_marg THEN
    INSERT INTO public.attendance_eventi
      (company_id, outlet_id, employee_id, punch_id, data, tipo, turno_inizio, turno_fine,
       minuti, minuti_proposti, tolleranza_minuti, margine_minuti, causale)
    VALUES
      (p.company_id, p.outlet_id, p.employee_id, p.id, v_data, 'straordinario', v_inizio, v_fine,
       v_min, v_min - v_marg, v_tol, v_marg,
       CASE WHEN p_causale IN ('assenza_collega', 'cliente', 'riassortimento', 'allestimento') THEN p_causale END)
    ON CONFLICT (punch_id, tipo) DO NOTHING;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.timbrature_evento_da_timbratura(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timbrature_evento_da_timbratura(uuid, text) TO service_role;

-- 9. Il dipendente scrive il motivo (e puo' correggere la causale dell'uscita)
CREATE OR REPLACE FUNCTION public.app_dipendente_motivo_evento(p_evento uuid, p_motivo text, p_causale text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_emp uuid := public.timbrature_mio_dipendente();
  ev    public.attendance_eventi%ROWTYPE;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Accesso non collegato a un dipendente' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO ev FROM public.attendance_eventi WHERE id = p_evento AND employee_id = v_emp;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Non trovato' USING ERRCODE = 'P0002';
  END IF;
  IF ev.stato <> 'da_confermare' THEN
    RAISE EXCEPTION 'È già stato deciso: non si può più cambiare.' USING ERRCODE = '22023';
  END IF;
  IF p_causale IS NOT NULL AND NOT (
       (ev.tipo = 'uscita_anticipata' AND p_causale IN ('personale', 'malattia', 'accordo'))
    OR (ev.tipo = 'straordinario' AND p_causale IN ('assenza_collega', 'cliente', 'riassortimento', 'allestimento'))) THEN
    RAISE EXCEPTION 'Scelta non valida' USING ERRCODE = '22023';
  END IF;
  UPDATE public.attendance_eventi
     SET motivo_dipendente = left(NULLIF(btrim(p_motivo), ''), 500),
         motivo_il = now(),
         causale = COALESCE(p_causale, causale)
   WHERE id = p_evento;
END;
$$;
REVOKE ALL ON FUNCTION public.app_dipendente_motivo_evento(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_dipendente_motivo_evento(uuid, text, text) TO authenticated, service_role;

-- 6, 7, 8: modifiche puntuali a funzioni esistenti, con controllo del testo
DO $$
DECLARE
  d text;
  n text;
BEGIN
  -- 6. timbrature_registra: dopo il salvataggio, l'evento (errore isolato)
  d := pg_get_functiondef('public.timbrature_registra(jsonb)'::regprocedure);
  n := replace(d, $x$    GET DIAGNOSTICS v_n = ROW_COUNT;
$x$, $x$    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 1 AND v_verifica IN ('ok', 'da_confermare') THEN
      BEGIN
        PERFORM public.timbrature_evento_da_timbratura((r->>'id')::uuid, NULLIF(r->>'causale', ''));
      EXCEPTION WHEN others THEN
        RAISE WARNING 'timbrature_evento_da_timbratura: %', SQLERRM;
      END;
    END IF;
$x$);
  IF n = d THEN RAISE EXCEPTION 'timbrature_registra: testo atteso non trovato'; END IF;
  EXECUTE n;

  -- 7. timbratrice_dati: tolleranza e margine di ogni persona
  d := pg_get_functiondef('public.timbratrice_dati(uuid)'::regprocedure);
  n := replace(d,
    $x$'persone', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome) ORDER BY p.nome) FROM persone p), '[]'::jsonb),$x$,
    $x$'persone', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'tolleranza', rg.tolleranza, 'margine', rg.margine) ORDER BY p.nome)
                            FROM persone p, LATERAL public.timbrature_regole(p.id, p_outlet_id) rg), '[]'::jsonb),$x$);
  IF n = d THEN RAISE EXCEPTION 'timbratrice_dati: testo atteso non trovato'; END IF;
  EXECUTE n;

  -- 8. app_dipendente_oggi: regole ed eventi di ieri e oggi
  d := pg_get_functiondef('public.app_dipendente_oggi()'::regprocedure);
  n := replace(d, $x$
  ) INTO v_out;$x$, $x$,
    'regole', (SELECT jsonb_build_object('tolleranza', rg.tolleranza, 'margine', rg.margine)
                 FROM public.employees e2, LATERAL public.timbrature_regole(e2.id, e2.outlet_id) rg WHERE e2.id = v_emp),
    'eventi', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'id', ev.id, 'data', ev.data, 'tipo', ev.tipo, 'minuti', ev.minuti, 'minuti_proposti', ev.minuti_proposti,
                 'turno_inizio', ev.turno_inizio, 'turno_fine', ev.turno_fine, 'causale', ev.causale,
                 'motivo', ev.motivo_dipendente, 'stato', ev.stato, 'esito', ev.esito) ORDER BY ev.created_at)
                 FROM public.attendance_eventi ev WHERE ev.employee_id = v_emp AND ev.data >= v_oggi - 1), '[]'::jsonb)
  ) INTO v_out;$x$);
  IF n = d THEN RAISE EXCEPTION 'app_dipendente_oggi: testo atteso non trovato'; END IF;
  EXECUTE n;
END;
$$;

COMMIT;

-- Verifica, su ogni tenant:
-- SELECT has_table_privilege('authenticated','public.attendance_eventi','select'),
--        has_table_privilege('service_role','public.attendance_eventi','insert'),
--        pg_get_functiondef('public.timbrature_registra(jsonb)'::regprocedure) ~ 'timbrature_evento_da_timbratura',
--        pg_get_functiondef('public.timbratrice_dati(uuid)'::regprocedure) ~ 'timbrature_regole',
--        pg_get_functiondef('public.app_dipendente_oggi()'::regprocedure) ~ 'attendance_eventi';
