-- 20261102_335 — Nessuno senza negozio nella ripartizione
--
-- Patrizio, 02/11/2026: «nessuno deve restare mai senza un outlet
-- assegnato». La pagina Dipendenti raggruppa per ripartizione
-- (employee_outlet_allocations), Organico e turni per il negozio della
-- scheda (employees.outlet_id). Chi entrava da «Organico di oggi» aveva
-- solo il secondo e finiva in «Senza sede».
--
-- 1. Trigger su employees: se la persona ha un negozio nella scheda e
--    nessuna ripartizione, se ne crea una al 100% su quel negozio. Vale
--    per ogni strada (Organico, scheda di Dipendenti, import). Non
--    sostituisce mai una ripartizione che c'e' gia': spostarla
--    cambierebbe a quale negozio vanno i costi gia' registrati.
-- 2. organico_correggi_persona: correggendo il negozio di chi aspetta
--    ancora lo studio si sposta anche la sua ripartizione (se e' una sola).
--
-- Solo additiva. Nessun dato esistente cambia con questa migration: il
-- recupero delle persone gia' senza ripartizione e' a parte
-- (NZ_ONLY_20261102_336). Tenant: NZ, Made, Zago.

CREATE OR REPLACE FUNCTION public.employees_ripartizione_da_negozio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nome text;
BEGIN
  IF NEW.outlet_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.employee_outlet_allocations WHERE employee_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  SELECT name INTO v_nome FROM public.outlets WHERE id = NEW.outlet_id AND company_id = NEW.company_id;
  IF v_nome IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.employee_outlet_allocations
    (employee_id, company_id, outlet_code, allocation_pct, is_primary, valid_from)
  VALUES
    (NEW.id, NEW.company_id, v_nome, 100, true, COALESCE(NEW.data_assunzione, NEW.hire_date, CURRENT_DATE));
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.employees_ripartizione_da_negozio() IS
  'Chi ha un negozio nella scheda e nessuna ripartizione riceve la ripartizione al 100% su quel negozio. Non tocca mai una ripartizione esistente.';

DROP TRIGGER IF EXISTS trg_employees_ripartizione_da_negozio ON public.employees;
CREATE TRIGGER trg_employees_ripartizione_da_negozio
  AFTER INSERT OR UPDATE OF outlet_id ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.employees_ripartizione_da_negozio();

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

    -- Il negozio corretto vale anche per la ripartizione (Dipendenti, costi):
    -- chi aspetta lo studio non ha ancora cedolini, spostarla non cambia
    -- nessun costo gia' registrato. Solo se la ripartizione e' una sola.
    IF v_outlet IS DISTINCT FROM e.outlet_id AND v_new_out IS NOT NULL
       AND (SELECT count(*) FROM public.employee_outlet_allocations WHERE employee_id = e.id) = 1 THEN
      UPDATE public.employee_outlet_allocations SET outlet_code = v_new_out
       WHERE employee_id = e.id;
    END IF;
  END IF;

  RETURN v_testo;
END;
$$;

COMMENT ON FUNCTION public.organico_correggi_persona(uuid, text, text, text, uuid, text, numeric, date, date, text) IS
  'Corregge un errore di inserimento da «Organico di oggi»: nome, cognome e livello sempre; negozio, contratto, ore, inizio e scadenza solo finche'' l''assunzione aspetta lo studio (scheda, assunzione e ripartizione insieme). Nota datata in coda.';
