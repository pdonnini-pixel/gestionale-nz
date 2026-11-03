-- 20261102_334 — Organico di oggi: correggere i dati di una persona
--
-- Nata il 02/11/2026: Veronica aggiunge Angelini da «Organico di oggi»,
-- sbaglia il livello e da li' non c'e' modo di correggerlo. La scheda di
-- Dipendenti salva, ma per chi e' entrato da Organico ore, negozio,
-- contratto e scadenza li comanda il cambiamento «assunzione», non la
-- scheda: correggerli li' non cambia niente in Organico, turni e ferie.
--
-- Questa funzione corregge un errore di inserimento (non registra un
-- cambiamento: per quello c'e' «Segna»):
--   - nome, cognome e livello si correggono per tutti;
--   - negozio, contratto, ore, data di inizio e scadenza solo finche'
--     l'assunzione segnata da Organico aspetta i documenti dello studio
--     (stato 'da_confermare'). Si correggono insieme scheda e assunzione,
--     cosi' Organico, turni, ferie e Dipendenti dicono la stessa cosa.
--     Arrivati i documenti dello studio vale lo studio (regola del
--     29/09/2026): un cambiamento vero si segna con «Segna».
-- Ogni correzione lascia una nota datata in coda alla scheda.
--
-- Solo additiva: una funzione nuova, nessuna tabella toccata.
-- Tenant: NZ, Made, Zago.

CREATE OR REPLACE FUNCTION public.organico_correggi_persona(
  p_employee_id     uuid,
  p_nome            text,
  p_cognome         text,
  p_livello         text,
  p_outlet_id       uuid,
  p_contratto_tipo  text,
  p_ore_settimanali numeric,
  p_data_assunzione date,
  p_scadenza        date,
  p_autore_nome     text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company  uuid := public.get_my_company_id();
  e          public.employees%ROWTYPE;
  v_ass      public.employee_events%ROWTYPE;
  v_nome     text := upper(trim(COALESCE(p_nome, '')));
  v_cognome  text := upper(trim(COALESCE(p_cognome, '')));
  v_livello  text := NULLIF(trim(COALESCE(p_livello, '')), '');
  v_contr    text;
  v_ore      numeric;
  v_outlet   uuid;
  v_dal      date;
  v_scad     date;
  v_diff     text[] := ARRAY[]::text[];
  v_testo    text;
  v_old_out  text;
  v_new_out  text;
BEGIN
  IF NOT public.organico_puo_scrivere() THEN
    RAISE EXCEPTION 'Solo chi ha il profilo contabilita'' o superiore puo'' correggere i dati di una persona.';
  END IF;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Azienda non riconosciuta.';
  END IF;

  SELECT * INTO e FROM public.employees
   WHERE id = p_employee_id AND company_id = v_company
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Persona non trovata.';
  END IF;
  IF v_nome = '' OR v_cognome = '' THEN
    RAISE EXCEPTION 'Servono nome e cognome.';
  END IF;

  SELECT * INTO v_ass FROM public.employee_events
   WHERE employee_id = e.id AND company_id = v_company
     AND tipo = 'assunzione' AND stato = 'da_confermare'
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_cognome IS DISTINCT FROM upper(COALESCE(e.cognome, e.last_name, '')) THEN
    v_diff := v_diff || ('cognome ' || COALESCE(e.cognome, e.last_name, '—') || ' → ' || v_cognome);
  END IF;
  IF v_nome IS DISTINCT FROM upper(COALESCE(e.nome, e.first_name, '')) THEN
    v_diff := v_diff || ('nome ' || COALESCE(e.nome, e.first_name, '—') || ' → ' || v_nome);
  END IF;
  IF v_livello IS DISTINCT FROM e.livello THEN
    v_diff := v_diff || ('livello ' || COALESCE(e.livello, '—') || ' → ' || COALESCE(v_livello, '—'));
  END IF;

  IF v_ass.id IS NOT NULL THEN
    v_contr  := NULLIF(trim(COALESCE(p_contratto_tipo, '')), '');
    v_ore    := p_ore_settimanali;
    v_outlet := p_outlet_id;
    v_dal    := p_data_assunzione;
    v_scad   := CASE WHEN v_contr = 'indeterminato' THEN NULL ELSE p_scadenza END;

    IF v_dal IS NULL THEN
      RAISE EXCEPTION 'Serve la data di inizio.';
    END IF;
    IF v_outlet IS NULL THEN
      RAISE EXCEPTION 'Scegli il negozio.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.outlets WHERE id = v_outlet AND company_id = v_company) THEN
      RAISE EXCEPTION 'Negozio non riconosciuto.';
    END IF;
    IF v_contr IS NULL THEN
      RAISE EXCEPTION 'Scegli il tipo di contratto.';
    END IF;
    IF v_contr = 'determinato' AND v_scad IS NULL THEN
      RAISE EXCEPTION 'Un contratto a tempo determinato ha bisogno della scadenza.';
    END IF;
    IF v_scad IS NOT NULL AND v_scad < v_dal THEN
      RAISE EXCEPTION 'La scadenza viene prima della data di inizio.';
    END IF;
    IF v_contr NOT ILIKE '%chiamata%' AND (v_ore IS NULL OR v_ore <= 0 OR v_ore > 48) THEN
      RAISE EXCEPTION 'Le ore settimanali vanno da 1 a 48.';
    END IF;

    IF v_outlet IS DISTINCT FROM e.outlet_id THEN
      SELECT name INTO v_old_out FROM public.outlets WHERE id = e.outlet_id;
      SELECT name INTO v_new_out FROM public.outlets WHERE id = v_outlet;
      v_diff := v_diff || ('negozio ' || COALESCE(v_old_out, '—') || ' → ' || COALESCE(v_new_out, '—'));
    END IF;
    IF v_contr IS DISTINCT FROM e.contratto_tipo THEN
      v_diff := v_diff || ('contratto ' || COALESCE(e.contratto_tipo, '—') || ' → ' || v_contr);
    END IF;
    IF v_ore IS DISTINCT FROM e.ore_settimanali THEN
      v_diff := v_diff || ('ore ' || COALESCE(trim(to_char(e.ore_settimanali, 'FM990D0')), '—') || ' → ' || COALESCE(trim(to_char(v_ore, 'FM990D0')), '—'));
    END IF;
    IF v_dal IS DISTINCT FROM COALESCE(e.data_assunzione, e.hire_date) THEN
      v_diff := v_diff || ('inizio ' || COALESCE(to_char(COALESCE(e.data_assunzione, e.hire_date), 'DD/MM/YYYY'), '—') || ' → ' || to_char(v_dal, 'DD/MM/YYYY'));
    END IF;
    IF v_scad IS DISTINCT FROM e.scadenza_td THEN
      v_diff := v_diff || ('scadenza ' || COALESCE(to_char(e.scadenza_td, 'DD/MM/YYYY'), '—') || ' → ' || COALESCE(to_char(v_scad, 'DD/MM/YYYY'), '—'));
    END IF;
  END IF;

  IF array_length(v_diff, 1) IS NULL THEN
    RETURN '';
  END IF;

  v_testo := '[' || to_char((now() AT TIME ZONE 'Europe/Rome')::date, 'DD/MM/YYYY') || '] '
             || 'Corretto da «Organico di oggi»' || COALESCE(' da ' || NULLIF(trim(p_autore_nome), ''), '')
             || ': ' || array_to_string(v_diff, '; ') || '.';

  UPDATE public.employees SET
    nome = v_nome, first_name = v_nome,
    cognome = v_cognome, last_name = v_cognome,
    livello = v_livello, level = v_livello,
    note = CASE WHEN COALESCE(trim(note), '') = '' THEN v_testo ELSE note || ' ' || v_testo END
  WHERE id = e.id;

  IF v_ass.id IS NOT NULL THEN
    UPDATE public.employees SET
      outlet_id = v_outlet,
      contratto_tipo = v_contr,
      ore_settimanali = v_ore,
      part_time_pct = CASE WHEN v_ore IS NOT NULL THEN round(v_ore / 40 * 100, 1) END,
      data_assunzione = v_dal, hire_date = v_dal,
      scadenza_td = v_scad
    WHERE id = e.id;

    UPDATE public.employee_events SET
      data_dal = v_dal, data_al = v_scad, ore_settimanali = v_ore,
      outlet_id = v_outlet, contratto_tipo = v_contr
    WHERE id = v_ass.id;
  END IF;

  RETURN v_testo;
END;
$$;

COMMENT ON FUNCTION public.organico_correggi_persona(uuid, text, text, text, uuid, text, numeric, date, date, text) IS
  'Corregge un errore di inserimento da «Organico di oggi»: nome, cognome e livello sempre; negozio, contratto, ore, inizio e scadenza solo finche'' l''assunzione aspetta lo studio (scheda e assunzione insieme). Nota datata in coda.';

REVOKE ALL ON FUNCTION public.organico_correggi_persona(uuid, text, text, text, uuid, text, numeric, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organico_correggi_persona(uuid, text, text, text, uuid, text, numeric, date, date, text) TO authenticated, service_role;
