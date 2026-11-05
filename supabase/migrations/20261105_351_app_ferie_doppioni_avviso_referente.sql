-- =====================================================================
-- Migrazione 351 — App del dipendente: richieste di ferie piu' robuste
-- =====================================================================
-- PERCHE': revisione di codice e sicurezza della 350 (05/11/2026).
--   1. La stessa data si poteva chiedere piu' volte con richieste diverse
--      (rete caduta, nuovo tentativo): il referente si trovava doppioni e le
--      ore in attesa raddoppiavano. Ora una data gia' chiesta (in attesa o
--      approvata) non si richiede oltre la giornata.
--   2. Al massimo 10 richieste in attesa per persona, e un lucchetto per
--      persona: due invii insieme non scavalcano il saldo.
--   3. Permesso: se ne' le ex festivita' ne' i ROL bastano da soli ma insieme
--      si', il giorno si divide sulle due voci (l'app mostra una riga sola,
--      «Permessi», che le somma: il server deve dire la stessa cosa).
--   4. Eventi «niente ferie»: chi non ha un negozio in anagrafica e' bloccato
--      da ogni evento (al 05/11/2026 nessuno e' in questo caso), invece di
--      non esserlo da nessuno.
--   5. Avviso al referente: la richiesta crea da sola la notifica nel
--      gestionale (come leave_decidi). L'app non chiama piu' la mail
--      leave-notify, che non distingue chi chiama e restituisce gli
--      indirizzi dei referenti.
--   6. Dati mancanti: messaggi in italiano, non errori del database.
--   7. search_path con pg_temp, come le altre funzioni SECURITY DEFINER.
-- NO DATA LOSS: solo CREATE OR REPLACE FUNCTION e ALTER FUNCTION.
-- REGOLA #0 (dal 03/11/2026): NZ e Zago.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.app_dipendente_chiedi_ferie(p_giorni jsonb, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
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
  v_gia      numeric;
  v_f02      numeric;
  v_disp     jsonb := '{}'::jsonb;
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
  -- Un invio alla volta per persona: il controllo del saldo e l'inserimento
  -- non devono incrociarsi con un secondo invio.
  PERFORM pg_advisory_xact_lock(hashtext('app_dipendente_chiedi_ferie:' || v_emp::text));

  SELECT * INTO e FROM public.employees WHERE id = v_emp;
  IF regexp_replace(lower(COALESCE(e.contratto_tipo, e.contract_type::text, '')), '[^a-z]', '', 'g') = 'achiamata' THEN
    RAISE EXCEPTION 'Con il contratto a chiamata ferie e permessi sono pagati ogni mese: non ci sono ore da chiedere.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_giorni) IS DISTINCT FROM 'array' OR jsonb_array_length(p_giorni) = 0 OR jsonb_array_length(p_giorni) > 62 THEN
    RAISE EXCEPTION 'Scegli da 1 a 62 giorni.' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.leave_requests q WHERE q.employee_id = v_emp AND q.stato = 'inviata') >= 10 THEN
    RAISE EXCEPTION 'Hai già 10 richieste in attesa di risposta: aspetta una risposta o ritirane una.' USING ERRCODE = '22023';
  END IF;

  FOR r IN SELECT d.voce, COALESCE(d.da_fruire_disponibile, d.residuo_disponibile, 0) AS disp, d.ore_giornata_dedotte
             FROM public.v_leave_disponibilita d WHERE d.employee_id = v_emp LOOP
    v_disp := v_disp || jsonb_build_object(r.voce, r.disp);
    v_giornata := COALESCE(v_giornata, r.ore_giornata_dedotte);
  END LOOP;
  -- Senza saldo (assunti da poco) si chiede lo stesso: decide il referente.
  v_con_saldo := v_disp <> '{}'::jsonb;
  v_giornata := COALESCE(v_giornata, NULLIF(e.ore_settimanali_paghe, 0) / 5.0, NULLIF(e.ore_settimanali, 0) / 5.0, 8);

  FOR g IN SELECT * FROM jsonb_array_elements(p_giorni) LOOP
    IF COALESCE(g->>'data', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'Manca la data di un giorno.' USING ERRCODE = '22023';
    END IF;
    v_data := (g->>'data')::date;
    v_tipo := COALESCE(g->>'tipo', '');
    IF v_data < v_oggi THEN
      RAISE EXCEPTION 'Il % è già passato.', to_char(v_data, 'DD/MM/YYYY') USING ERRCODE = '22023';
    END IF;
    IF v_data > v_oggi + 400 THEN
      RAISE EXCEPTION 'Il % è troppo lontano.', to_char(v_data, 'DD/MM/YYYY') USING ERRCODE = '22023';
    END IF;
    IF v_tipo NOT IN ('giornata', 'mezza_giornata', 'ore') THEN
      RAISE EXCEPTION 'Scegli giornata intera, mezza giornata o ore per il %.', to_char(v_data, 'DD/MM/YYYY') USING ERRCODE = '22023';
    END IF;
    IF v_tipo = 'ore' AND COALESCE(g->>'ore', '') !~ '^\d+(\.\d+)?$' THEN
      RAISE EXCEPTION 'Indica quante ore di permesso il %.', to_char(v_data, 'DD/MM/YYYY') USING ERRCODE = '22023';
    END IF;
    v_ore := CASE v_tipo
               WHEN 'giornata' THEN round(v_giornata, 2)
               WHEN 'mezza_giornata' THEN round(v_giornata / 2, 2)
               ELSE round(LEAST((g->>'ore')::numeric, 24), 2) END;
    IF v_ore <= 0 THEN
      RAISE EXCEPTION 'Indica quante ore di permesso il %.', to_char(v_data, 'DD/MM/YYYY') USING ERRCODE = '22023';
    END IF;

    SELECT ev.nome INTO v_ev FROM public.outlet_events ev
     WHERE ev.company_id = e.company_id AND ev.blocca_ferie
       AND v_data BETWEEN ev.data_dal AND COALESCE(ev.data_al, ev.data_dal)
       AND (ev.outlet_ids IS NULL OR e.outlet_id IS NULL OR e.outlet_id = ANY (ev.outlet_ids))
     LIMIT 1;
    IF v_ev IS NOT NULL THEN
      RAISE EXCEPTION 'Il % c''è %: niente ferie né permessi.', to_char(v_data, 'DD/MM/YYYY'), v_ev USING ERRCODE = '22023';
    END IF;

    -- Una giornata al massimo per data, contando anche le richieste gia' fatte
    SELECT COALESCE(sum(d.ore), 0) INTO v_gia
      FROM public.leave_request_days d JOIN public.leave_requests q ON q.id = d.request_id
     WHERE q.employee_id = v_emp AND d.data = v_data
       AND q.stato IN ('inviata', 'approvata', 'approvata_parziale', 'chiusa')
       AND d.stato IN ('richiesto', 'approvato');
    v_per_data := jsonb_set(v_per_data, ARRAY[v_data::text], to_jsonb(COALESCE((v_per_data->>v_data::text)::numeric, 0) + v_ore));
    IF v_gia > 0 AND v_gia + (v_per_data->>v_data::text)::numeric > v_giornata + 0.001 THEN
      RAISE EXCEPTION 'Per il % hai già una richiesta: guarda «Le tue richieste».', to_char(v_data, 'DD/MM/YYYY') USING ERRCODE = '22023';
    END IF;
    IF (v_per_data->>v_data::text)::numeric > v_giornata + 0.001 THEN
      RAISE EXCEPTION 'Il % hai chiesto più di una giornata (% ore).', to_char(v_data, 'DD/MM/YYYY'), round(v_giornata, 2) USING ERRCODE = '22023';
    END IF;

    IF COALESCE(g->>'voce', 'ferie') = 'ferie' THEN
      IF v_con_saldo AND COALESCE((v_disp->>'F01')::numeric, 0) + 0.001 < v_ore THEN
        RAISE EXCEPTION 'Ferie: non hai abbastanza ore, nemmeno contando quelle che maturano.' USING ERRCODE = '22023';
      END IF;
      IF v_con_saldo THEN v_disp := jsonb_set(v_disp, ARRAY['F01'], to_jsonb(COALESCE((v_disp->>'F01')::numeric, 0) - v_ore)); END IF;
      v_righe := v_righe || jsonb_build_object('data', v_data, 'voce', 'F01', 'tipo', v_tipo, 'ore', v_ore);
    ELSIF NOT v_con_saldo THEN
      v_righe := v_righe || jsonb_build_object('data', v_data, 'voce', 'F02', 'tipo', v_tipo, 'ore', v_ore);
    ELSE
      -- Permesso: ex festivita' finche' bastano, poi ROL; se serve, diviso fra le due
      IF COALESCE((v_disp->>'F02')::numeric, 0) + COALESCE((v_disp->>'F03')::numeric, 0) + 0.001 < v_ore THEN
        RAISE EXCEPTION 'Permessi: non hai abbastanza ore, nemmeno contando quelle che maturano.' USING ERRCODE = '22023';
      END IF;
      v_f02 := LEAST(v_ore, GREATEST(COALESCE((v_disp->>'F02')::numeric, 0), 0));
      IF v_f02 >= v_ore - 0.001 THEN
        v_righe := v_righe || jsonb_build_object('data', v_data, 'voce', 'F02', 'tipo', v_tipo, 'ore', v_ore);
      ELSIF v_f02 <= 0.001 THEN
        v_righe := v_righe || jsonb_build_object('data', v_data, 'voce', 'F03', 'tipo', v_tipo, 'ore', v_ore);
      ELSE
        v_righe := v_righe || jsonb_build_object('data', v_data, 'voce', 'F02', 'tipo', 'ore', 'ore', round(v_f02, 2))
                           || jsonb_build_object('data', v_data, 'voce', 'F03', 'tipo', 'ore', 'ore', round(v_ore - v_f02, 2));
      END IF;
      v_disp := jsonb_set(v_disp, ARRAY['F02'], to_jsonb(COALESCE((v_disp->>'F02')::numeric, 0) - v_f02));
      v_disp := jsonb_set(v_disp, ARRAY['F03'], to_jsonb(COALESCE((v_disp->>'F03')::numeric, 0) - (v_ore - v_f02)));
    END IF;
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

  -- Avviso nel gestionale per chi decide (come leave_decidi)
  INSERT INTO public.notifications
    (company_id, user_id, title, message, category, severity, action_url, action_label, reference_type, reference_id)
  VALUES
    (e.company_id, NULL, 'Richiesta di ferie dall''app: ' || v_nome,
     (SELECT CASE count(DISTINCT x->>'data') WHEN 1 THEN 'Un giorno, il ' ELSE count(DISTINCT x->>'data')::text || ' giorni, dal ' END
        FROM jsonb_array_elements(v_righe) x) ||
     to_char((SELECT min((x->>'data')::date) FROM jsonb_array_elements(v_righe) x), 'DD/MM/YYYY') || '. Da decidere in Ferie e permessi → Approvazioni.',
     'info', 'info', '/dipendenti?view=ferie&ferie=approvazioni', 'Apri le approvazioni', 'leave_request', v_req);

  RETURN v_req;
END;
$$;
REVOKE ALL ON FUNCTION public.app_dipendente_chiedi_ferie(jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_dipendente_chiedi_ferie(jsonb, text) TO authenticated;

-- Eventi «niente ferie» anche per chi non ha un negozio in anagrafica
DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'app_dipendente_ferie';
  IF position('e.outlet_id IS NULL OR e.outlet_id = ANY' IN d) = 0 THEN
    EXECUTE replace(d, '(ev.outlet_ids IS NULL OR e.outlet_id = ANY (ev.outlet_ids))',
                       '(ev.outlet_ids IS NULL OR e.outlet_id IS NULL OR e.outlet_id = ANY (ev.outlet_ids))');
  END IF;
END $$;

ALTER FUNCTION public.app_dipendente_ferie() SET search_path = public, pg_temp;
ALTER FUNCTION public.app_dipendente_ritira_ferie(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.app_dipendente_periodo(date, date) SET search_path = public, pg_temp;
