-- =====================================================================
-- Migrazione 350 — App del dipendente: turni, ferie e permessi, ore
-- =====================================================================
-- PERCHE': Patrizio (05/11/2026): l'app del dipendente (/app, migration 348)
-- deve mostrare turni, ferie e permessi e ore lavorate, e permettere di
-- chiedere ferie e permessi. Pilota Roma Soratte.
--
-- COME: solo funzioni SECURITY DEFINER che ricavano la persona da
-- auth.uid() (timbrature_mio_dipendente). Le tabelle leave_*, shifts,
-- employees restano chiuse al ruolo dipendente (dipendente_block): ognuno
-- vede e chiede solo per se'.
--
-- LE REGOLE SONO QUELLE DEL GESTIONALE (PIANO_FERIE_NOTES.md):
--   - il saldo e' quello delle paghe meno le ore gia' chieste o approvate
--     (v_leave_disponibilita), in ore con i decimali;
--   - la richiesta nasce «inviata»: e' una proposta, la decidono i referenti
--     (leave_decidi), come quelle registrate dall'amministrazione;
--   - niente ferie ne' permessi negli eventi del negozio che li bloccano;
--   - una giornata vale ore_giornata_dedotte (orario / 5) e non si supera;
--   - non si chiede piu' di quanto si avra' maturato (da_fruire); chi non ha
--     ancora un saldo (assunto da poco) puo' chiedere lo stesso, come dal
--     gestionale: decide il referente;
--   - contratto a chiamata: niente da chiedere (ferie pagate ogni mese);
--   - le ore di una giornata o mezza giornata le calcola il server, non il
--     telefono.
--   - «Permesso»: ex festivita' (F02) finche' bastano, poi ROL (F03). Il
--     dipendente vede Ferie e Permessi, come nel modulo (le due borse dei
--     permessi le distinguono le paghe, non chi chiede un'ora).
-- origine resta 'gestionale' (il CHECK non ha 'app' e cambiarlo vorrebbe un
-- DROP CONSTRAINT): la provenienza sta in compilata_da_nome = 'App del
-- dipendente' e in compilata_da = l'utente del dipendente.
--
-- NO DATA LOSS: solo CREATE OR REPLACE FUNCTION. Nessuna tabella toccata.
-- REGOLA #0 (dal 03/11/2026): NZ e Zago.
-- APPLICATA il 05/11/2026 su NZ (350, 350b, 350c a passi) e su Zago (in un
-- colpo, testo uguale a questo file): funzioni identiche (md5 di
-- pg_get_functiondef uguale sui due tenant).
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. Ferie e permessi: saldo, richieste, giorni senza ferie
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.app_dipendente_ferie()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp  uuid := public.timbrature_mio_dipendente();
  e      public.employees%ROWTYPE;
  v_oggi date := (now() AT TIME ZONE 'Europe/Rome')::date;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Accesso non collegato a un dipendente' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM public.employees WHERE id = v_emp;

  RETURN jsonb_build_object(
    'a_chiamata', regexp_replace(lower(COALESCE(e.contratto_tipo, e.contract_type::text, '')), '[^a-z]', '', 'g') = 'achiamata',
    'saldi', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'voce', d.voce,
               'residuo', d.residuo,
               'residuo_disponibile', d.residuo_disponibile,
               'da_fruire', d.da_fruire,
               'da_fruire_disponibile', d.da_fruire_disponibile,
               'ore_in_attesa', d.ore_in_attesa,
               'ore_approvate', d.ore_approvate,
               'ore_in_bozza', d.ore_in_bozza,
               'saldo_alla_data', d.saldo_alla_data,
               'ore_giornata_dedotte', d.ore_giornata_dedotte,
               'ore_settimanali_dedotte', d.ore_settimanali_dedotte) ORDER BY d.voce)
        FROM public.v_leave_disponibilita d WHERE d.employee_id = v_emp), '[]'::jsonb),
    'ore_settimanali', COALESCE(e.ore_settimanali_paghe, NULL),
    'richieste', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', q.id, 'stato', q.stato, 'note', q.note_dipendente, 'motivazione', q.motivazione,
               'inviata_il', q.inviata_il, 'decisa_il', q.decisa_il, 'decisa_da_nome', q.decisa_da_nome,
               'giorni', (SELECT jsonb_agg(jsonb_build_object('data', g.data, 'voce', g.voce, 'tipo', g.tipo, 'ore', g.ore, 'stato', g.stato) ORDER BY g.data, g.voce)
                            FROM public.leave_request_days g WHERE g.request_id = q.id))
             ORDER BY COALESCE(q.inviata_il, q.created_at) DESC)
        FROM public.leave_requests q
       WHERE q.employee_id = v_emp AND q.stato <> 'bozza'
         AND EXISTS (SELECT 1 FROM public.leave_request_days g
                      WHERE g.request_id = q.id AND g.data >= v_oggi - 365)), '[]'::jsonb),
    'senza_ferie', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('nome', ev.nome, 'dal', ev.data_dal, 'al', COALESCE(ev.data_al, ev.data_dal)) ORDER BY ev.data_dal)
        FROM public.outlet_events ev
       WHERE ev.company_id = e.company_id AND ev.blocca_ferie
         AND COALESCE(ev.data_al, ev.data_dal) >= v_oggi
         AND (ev.outlet_ids IS NULL OR e.outlet_id = ANY (ev.outlet_ids))), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.app_dipendente_ferie() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_dipendente_ferie() TO authenticated;

-- Richiesta di ferie o permessi dal telefono.
-- p_giorni: [{ data: 'YYYY-MM-DD', tipo: 'giornata'|'mezza_giornata'|'ore', ore?: n, voce: 'ferie'|'permesso' }]
CREATE OR REPLACE FUNCTION public.app_dipendente_chiedi_ferie(p_giorni jsonb, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp      uuid := public.timbrature_mio_dipendente();
  e          public.employees%ROWTYPE;
  v_oggi     date := (now() AT TIME ZONE 'Europe/Rome')::date;
  v_giornata numeric;
  g          jsonb;
  v_data     date;
  v_tipo     text;
  v_ore      numeric;
  v_voce     text;
  v_disp     jsonb := '{}'::jsonb;  -- ore ancora disponibili per voce (da_fruire_disponibile)
  v_righe    jsonb := '[]'::jsonb;
  v_per_data jsonb := '{}'::jsonb;
  v_req      uuid;
  v_outlet   text;
  v_nome     text;
  v_ev       text;
  v_con_saldo boolean;
  r          record;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Accesso non collegato a un dipendente' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM public.employees WHERE id = v_emp;
  IF regexp_replace(lower(COALESCE(e.contratto_tipo, e.contract_type::text, '')), '[^a-z]', '', 'g') = 'achiamata' THEN
    RAISE EXCEPTION 'Con il contratto a chiamata ferie e permessi sono pagati ogni mese: non ci sono ore da chiedere.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_giorni) <> 'array' OR jsonb_array_length(p_giorni) = 0 OR jsonb_array_length(p_giorni) > 62 THEN
    RAISE EXCEPTION 'Scegli da 1 a 62 giorni.' USING ERRCODE = '22023';
  END IF;

  -- Saldi e giornata, dal database (un conto solo)
  FOR r IN SELECT d.voce, COALESCE(d.da_fruire_disponibile, d.residuo_disponibile, 0) AS disp, d.ore_giornata_dedotte
             FROM public.v_leave_disponibilita d WHERE d.employee_id = v_emp LOOP
    v_disp := v_disp || jsonb_build_object(r.voce, r.disp);
    v_giornata := COALESCE(v_giornata, r.ore_giornata_dedotte);
  END LOOP;
  -- Senza saldo (assunti da poco, non ancora nel prospetto delle paghe) la
  -- richiesta parte lo stesso, come dal gestionale: la decide il referente.
  v_con_saldo := v_disp <> '{}'::jsonb;
  v_giornata := COALESCE(v_giornata, NULLIF(e.ore_settimanali_paghe, 0) / 5.0, NULLIF(e.ore_settimanali, 0) / 5.0, 8);

  FOR g IN SELECT * FROM jsonb_array_elements(p_giorni) LOOP
    v_data := (g->>'data')::date;
    v_tipo := g->>'tipo';
    IF v_data < v_oggi THEN
      RAISE EXCEPTION 'Il % è già passato.', to_char(v_data, 'DD/MM/YYYY') USING ERRCODE = '22023';
    END IF;
    IF v_data > v_oggi + 400 THEN
      RAISE EXCEPTION 'Il % è troppo lontano.', to_char(v_data, 'DD/MM/YYYY') USING ERRCODE = '22023';
    END IF;
    IF v_tipo NOT IN ('giornata', 'mezza_giornata', 'ore') THEN
      RAISE EXCEPTION 'Tipo di giorno non valido.' USING ERRCODE = '22023';
    END IF;
    v_ore := CASE v_tipo
               WHEN 'giornata' THEN round(v_giornata, 2)
               WHEN 'mezza_giornata' THEN round(v_giornata / 2, 2)
               ELSE round(LEAST(GREATEST(COALESCE((g->>'ore')::numeric, 0), 0), 24), 2) END;
    IF v_ore <= 0 THEN
      RAISE EXCEPTION 'Indica quante ore di permesso il %.', to_char(v_data, 'DD/MM/YYYY') USING ERRCODE = '22023';
    END IF;

    SELECT ev.nome INTO v_ev FROM public.outlet_events ev
     WHERE ev.company_id = e.company_id AND ev.blocca_ferie
       AND v_data BETWEEN ev.data_dal AND COALESCE(ev.data_al, ev.data_dal)
       AND (ev.outlet_ids IS NULL OR e.outlet_id = ANY (ev.outlet_ids))
     LIMIT 1;
    IF v_ev IS NOT NULL THEN
      RAISE EXCEPTION 'Il % c''è %: niente ferie né permessi.', to_char(v_data, 'DD/MM/YYYY'), v_ev USING ERRCODE = '22023';
    END IF;

    -- Una giornata al massimo per data
    v_per_data := jsonb_set(v_per_data, ARRAY[v_data::text], to_jsonb(COALESCE((v_per_data->>v_data::text)::numeric, 0) + v_ore));
    IF (v_per_data->>v_data::text)::numeric > v_giornata + 0.001 THEN
      RAISE EXCEPTION 'Il % hai chiesto più di una giornata (% ore).', to_char(v_data, 'DD/MM/YYYY'), round(v_giornata, 2) USING ERRCODE = '22023';
    END IF;

    -- Voce: ferie = F01; permesso = ex festivita' finche' bastano, poi ROL
    IF COALESCE(g->>'voce', 'ferie') = 'ferie' THEN
      v_voce := 'F01';
    ELSIF COALESCE((v_disp->>'F02')::numeric, 0) >= v_ore THEN
      v_voce := 'F02';
    ELSIF COALESCE((v_disp->>'F03')::numeric, 0) >= v_ore THEN
      v_voce := 'F03';
    ELSE
      v_voce := 'F02';
    END IF;
    IF v_con_saldo THEN
      IF COALESCE((v_disp->>v_voce)::numeric, 0) + 0.001 < v_ore THEN
        RAISE EXCEPTION '%: non hai abbastanza ore, nemmeno contando quelle che maturano.',
          CASE v_voce WHEN 'F01' THEN 'Ferie' ELSE 'Permessi' END USING ERRCODE = '22023';
      END IF;
      v_disp := jsonb_set(v_disp, ARRAY[v_voce], to_jsonb(COALESCE((v_disp->>v_voce)::numeric, 0) - v_ore));
    END IF;

    v_righe := v_righe || jsonb_build_object('data', v_data, 'voce', v_voce, 'tipo', v_tipo, 'ore', v_ore);
  END LOOP;

  SELECT o.code INTO v_outlet FROM public.outlets o WHERE o.id = e.outlet_id;
  v_nome := trim(COALESCE(e.nome, e.first_name, '') || ' ' || COALESCE(e.cognome, e.last_name, ''));

  INSERT INTO public.leave_requests
    (company_id, employee_id, outlet_code, stato, note_dipendente, origine, compilata_da, compilata_da_nome, inviata_il)
  VALUES
    (e.company_id, v_emp, v_outlet, 'inviata', left(NULLIF(trim(p_note), ''), 500), 'gestionale',
     (SELECT auth.uid()), 'App del dipendente (' || v_nome || ')', now())
  RETURNING id INTO v_req;

  INSERT INTO public.leave_request_days (company_id, request_id, data, voce, tipo, ore)
  SELECT e.company_id, v_req, (x->>'data')::date, x->>'voce', x->>'tipo', (x->>'ore')::numeric
    FROM jsonb_array_elements(v_righe) x;

  RETURN v_req;
END;
$$;
REVOKE ALL ON FUNCTION public.app_dipendente_chiedi_ferie(jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_dipendente_chiedi_ferie(jsonb, text) TO authenticated;

-- Ritira una richiesta non ancora decisa (resta nello storico, non si cancella).
CREATE OR REPLACE FUNCTION public.app_dipendente_ritira_ferie(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.timbrature_mio_dipendente();
  v_n   int;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Accesso non collegato a un dipendente' USING ERRCODE = '42501';
  END IF;
  UPDATE public.leave_requests
     SET stato = 'ritirata', motivazione = 'Ritirata dal dipendente dall''app'
   WHERE id = p_request_id AND employee_id = v_emp AND stato = 'inviata';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Si può ritirare solo una richiesta non ancora decisa.' USING ERRCODE = '22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.app_dipendente_ritira_ferie(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_dipendente_ritira_ferie(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Turni e ore di un periodo (al massimo 70 giorni)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.app_dipendente_periodo(p_dal date, p_al date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid := public.timbrature_mio_dipendente();
  e     public.employees%ROWTYPE;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Accesso non collegato a un dipendente' USING ERRCODE = '42501';
  END IF;
  IF p_al < p_dal OR p_al - p_dal > 70 THEN
    RAISE EXCEPTION 'Periodo non valido' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO e FROM public.employees WHERE id = v_emp;

  RETURN jsonb_build_object(
    'ora_server', now(),
    'ore_settimanali', e.ore_settimanali_paghe,
    'margine_uscita_minuti', COALESCE((SELECT a.margine_uscita_minuti FROM public.attendance_settings a WHERE a.outlet_id = e.outlet_id), 30),
    'turni', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('data', t.data, 'inizio', t.inizio, 'fine', t.fine, 'pausa_minuti', t.pausa_minuti,
                         'negozio', (SELECT o.name FROM public.outlets o WHERE o.id = t.outlet_id)) ORDER BY t.data, t.inizio)
        FROM public.timbrature_turni_ufficiali(e.company_id, p_dal, p_al) t
       WHERE t.employee_id = v_emp), '[]'::jsonb),
    'timbrature', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('tipo', a.tipo, 'ora', a.ora, 'origine', a.origine, 'verifica', a.verifica) ORDER BY a.ora)
        FROM public.attendance_punches a
       WHERE a.employee_id = v_emp AND NOT a.annullata
         AND a.ora >= (p_dal::timestamp AT TIME ZONE 'Europe/Rome')
         AND a.ora <  ((p_al + 1)::timestamp AT TIME ZONE 'Europe/Rome')), '[]'::jsonb),
    'ferie', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('data', g.data, 'tipo', g.tipo, 'ore', g.ore, 'stato', g.stato,
                         'voce', CASE g.voce WHEN 'F01' THEN 'ferie' ELSE 'permesso' END) ORDER BY g.data)
        FROM public.leave_request_days g JOIN public.leave_requests q ON q.id = g.request_id
       WHERE q.employee_id = v_emp AND q.stato NOT IN ('bozza', 'ritirata', 'respinta')
         AND g.stato <> 'respinto' AND g.data BETWEEN p_dal AND p_al), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.app_dipendente_periodo(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_dipendente_periodo(date, date) TO authenticated;
