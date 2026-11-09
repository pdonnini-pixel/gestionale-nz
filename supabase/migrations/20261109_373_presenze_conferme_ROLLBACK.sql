-- =====================================================================
-- ROLLBACK della migrazione 373 (presenze: chi conferma, conferma dei casi)
-- =====================================================================
-- Rimette timbrature_annulla e app_dipendente_oggi come dopo la 372 e
-- toglie le funzioni nuove. timbrature_evento_da_timbratura torna al testo
-- della 372 (sezione 5, copiata qui sotto).
-- La tabella attendance_confermatori e le colonne nuove di
-- attendance_eventi RESTANO (contengono decisioni vere): toglierle solo
-- con backup e conferma di Patrizio. I permessi gia' creati dalle
-- conferme restano in Ferie e permessi.
-- =====================================================================

BEGIN;

DO $$
DECLARE
  d text;
  n text;
BEGIN
  d := pg_get_functiondef('public.timbrature_annulla(uuid, text)'::regprocedure);
  n := replace(d, $x$
  -- Il caso nato da questa timbratura si chiude (migration 373)
  UPDATE public.attendance_eventi
     SET stato = 'respinto', esito = 'timbratura_annullata', deciso_da = auth.uid(), deciso_il = now(),
         nota_decisione = 'Timbratura annullata: ' || left(p_motivo, 400)
   WHERE punch_id = p_id AND company_id = (SELECT public.get_my_company_id()) AND stato = 'da_confermare';$x$, '');
  IF n = d THEN RAISE EXCEPTION 'timbrature_annulla: pezzo della 373 non trovato'; END IF;
  EXECUTE n;

  d := pg_get_functiondef('public.app_dipendente_oggi()'::regprocedure);
  n := replace(d, $x$'motivo', ev.motivo_dipendente, 'stato', ev.stato, 'esito', ev.esito,
                 'minuti_confermati', ev.minuti_confermati, 'nota_decisione', ev.nota_decisione) ORDER BY ev.created_at)
                 FROM public.attendance_eventi ev WHERE ev.employee_id = v_emp AND ev.data >= v_oggi - 1
                   AND COALESCE(ev.esito, '') NOT IN ('superata', 'timbratura_annullata'))$x$,
    $x$'motivo', ev.motivo_dipendente, 'stato', ev.stato, 'esito', ev.esito) ORDER BY ev.created_at)
                 FROM public.attendance_eventi ev WHERE ev.employee_id = v_emp AND ev.data >= v_oggi - 1)$x$);
  IF n = d THEN RAISE EXCEPTION 'app_dipendente_oggi: pezzo della 373 non trovato'; END IF;
  EXECUTE n;
END;
$$;

-- timbrature_evento_da_timbratura come nella 372
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

DROP TRIGGER IF EXISTS trg_attendance_eventi_causale_negozio ON public.attendance_eventi;
DROP FUNCTION IF EXISTS public.attendance_eventi_causale_negozio();
DROP FUNCTION IF EXISTS public.presenze_regola_dipendente(uuid, integer, integer, text);
DROP FUNCTION IF EXISTS public.presenze_confermatore_imposta(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.presenze_confermatori_elenco();
DROP FUNCTION IF EXISTS public.presenze_riapri_evento(uuid, text);
DROP FUNCTION IF EXISTS public.presenze_causale_evento(uuid, text);
DROP FUNCTION IF EXISTS public.presenze_decidi_evento(uuid, boolean, integer, boolean, text);
DROP FUNCTION IF EXISTS public.presenze_crea_permesso(uuid, integer, text);
DROP FUNCTION IF EXISTS public.presenze_eventi_elenco(date, date, boolean);
DROP FUNCTION IF EXISTS public.presenze_non_su_di_me(uuid);
DROP FUNCTION IF EXISTS public.presenze_puo_confermare(uuid);

COMMIT;
