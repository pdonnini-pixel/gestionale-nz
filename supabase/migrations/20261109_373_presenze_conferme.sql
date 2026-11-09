-- =====================================================================
-- Migrazione 373 — Presenze: chi conferma e la conferma dei casi
-- =====================================================================
-- Decisioni di Patrizio del 09/11/2026 (parte 4, PR A):
--   * Ritardi, uscite prima del turno e straordinari (registro della 372)
--     contano solo dopo la conferma.
--   * Confermano gli amministratori (timbrature_gestore) e gli utenti del
--     gestionale indicati negozio per negozio (referente: un negozio, area
--     manager: piu' negozi) in attendance_confermatori.
--   * Alla conferma: ritardo e uscita per motivo personale creano un
--     permesso approvato (ex festivita' poi ROL, come le richieste);
--     malattia: si prende atto; uscita «d'accordo con il responsabile»:
--     si sceglie caso per caso se scalare il permesso; straordinario: si
--     conferma con i minuti.
--   * Con piu' uscite nello stesso giorno vale l'ultima: chi rientra dopo
--     un'uscita prima del turno chiude quel caso da sola.
--   * Una timbratura annullata chiude il suo caso.
--
-- COSA INTRODUCE:
--   1. attendance_confermatori (utente, negozio).
--   2. attendance_eventi: minuti_confermati, scala_permesso, causale_negozio
--      (la scelta fatta al negozio, conservata anche se l'app la cambia).
--   3. presenze_puo_confermare(outlet), presenze_eventi_elenco(),
--      presenze_decidi_evento(), presenze_riapri_evento(),
--      presenze_confermatori_elenco(), presenze_confermatore_imposta(),
--      presenze_regola_dipendente().
--   4. timbrature_evento_da_timbratura: chiude l'uscita superata dal
--      rientro, avvisa chi conferma (notifica nel gestionale).
--   5. timbrature_annulla: chiude il caso della timbratura annullata.
--   6. app_dipendente_oggi: niente casi chiusi in automatico, piu' minuti
--      confermati e nota della decisione.
--
-- NO DATA LOSS: tabella nuova, colonne nuove, funzioni. L'unico DELETE toglie
-- una spunta di «Chi conferma» (configurazione, non dati del personale).
-- Tenant: NZ e Zago. Rollback: 20261109_373_presenze_conferme_ROLLBACK.sql
-- =====================================================================

BEGIN;

-- 1. Chi conferma, negozio per negozio
CREATE TABLE IF NOT EXISTS public.attendance_confermatori (
  user_id    uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  outlet_id  uuid NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (user_id, outlet_id)
);
CREATE INDEX IF NOT EXISTS attendance_confermatori_outlet_idx ON public.attendance_confermatori (outlet_id);
ALTER TABLE public.attendance_confermatori ENABLE ROW LEVEL SECURITY;
CREATE POLICY attendance_confermatori_select ON public.attendance_confermatori FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id())
         AND ((SELECT public.timbrature_gestore()) OR user_id = (SELECT auth.uid())));
CREATE POLICY cash_operator_block ON public.attendance_confermatori AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'operatore_cassa');
CREATE POLICY dipendente_block ON public.attendance_confermatori AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'dipendente')
  WITH CHECK (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'dipendente');
GRANT SELECT ON public.attendance_confermatori TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_confermatori TO service_role;

-- 2. Colonne della decisione
ALTER TABLE public.attendance_eventi
  ADD COLUMN IF NOT EXISTS minuti_confermati integer CHECK (minuti_confermati IS NULL OR minuti_confermati BETWEEN 0 AND 1440),
  ADD COLUMN IF NOT EXISTS scala_permesso    boolean,
  ADD COLUMN IF NOT EXISTS causale_negozio   text;
UPDATE public.attendance_eventi SET causale_negozio = causale WHERE causale_negozio IS NULL AND causale IS NOT NULL;

CREATE OR REPLACE FUNCTION public.attendance_eventi_causale_negozio()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  NEW.causale_negozio := NEW.causale;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_attendance_eventi_causale_negozio
  BEFORE INSERT ON public.attendance_eventi
  FOR EACH ROW EXECUTE FUNCTION public.attendance_eventi_causale_negozio();

-- 3. Chi puo' confermare in un negozio
CREATE OR REPLACE FUNCTION public.presenze_puo_confermare(p_outlet uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.timbrature_gestore()
      OR (COALESCE(public.get_my_role()::text, '') NOT IN ('dipendente', 'operatore_cassa', 'viewer')
          AND EXISTS (SELECT 1 FROM public.attendance_confermatori c
                       WHERE c.user_id = auth.uid() AND c.outlet_id = p_outlet
                         AND c.company_id = public.get_my_company_id()));
$$;
REVOKE ALL ON FUNCTION public.presenze_puo_confermare(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.presenze_puo_confermare(uuid) TO authenticated, service_role;

-- Nessuno decide sui propri casi (un responsabile e' spesso anche un
-- dipendente del negozio), salvo il super_advisor
CREATE OR REPLACE FUNCTION public.presenze_non_su_di_me(p_employee uuid)
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_employee = public.timbrature_mio_dipendente()
     AND COALESCE(public.get_my_role()::text, '') <> 'super_advisor' THEN
    RAISE EXCEPTION 'I tuoi casi li decide un altro responsabile o un amministratore.' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.presenze_non_su_di_me(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.presenze_non_su_di_me(uuid) TO service_role;

-- Elenco dei casi dei negozi che posso confermare (anche il dipendente demo,
-- segnato come prova: serve per provare il giro senza persone vere)
CREATE OR REPLACE FUNCTION public.presenze_eventi_elenco(p_dal date, p_al date, p_solo_da_confermare boolean DEFAULT true)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH negozi AS (
    SELECT o.id FROM public.outlets o
     WHERE o.company_id = public.get_my_company_id() AND public.presenze_puo_confermare(o.id)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', ev.id, 'data', ev.data, 'tipo', ev.tipo,
           'outlet_id', ev.outlet_id, 'negozio', o.name,
           'employee_id', ev.employee_id,
           'persona', btrim(COALESCE(e.nome, e.first_name, '') || ' ' || COALESCE(e.cognome, e.last_name, '')),
           'prova', e.is_demo,
           'ora', p.ora, 'turno_inizio', ev.turno_inizio, 'turno_fine', ev.turno_fine,
           'minuti', ev.minuti, 'minuti_proposti', ev.minuti_proposti, 'minuti_confermati', ev.minuti_confermati,
           'tolleranza', ev.tolleranza_minuti, 'margine', ev.margine_minuti,
           'causale', ev.causale, 'causale_negozio', ev.causale_negozio, 'motivo', ev.motivo_dipendente,
           'stato', ev.stato, 'esito', ev.esito, 'scala_permesso', ev.scala_permesso,
           'deciso_il', ev.deciso_il,
           'deciso_da', NULLIF(btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
           'nota_decisione', ev.nota_decisione, 'leave_request_id', ev.leave_request_id)
         ORDER BY ev.data DESC, p.ora DESC), '[]'::jsonb)
    FROM public.attendance_eventi ev
    JOIN public.employees e ON e.id = ev.employee_id
    JOIN public.outlets o ON o.id = ev.outlet_id
    LEFT JOIN public.attendance_punches p ON p.id = ev.punch_id
    LEFT JOIN public.user_profiles u ON u.id = ev.deciso_da
   WHERE ev.company_id = public.get_my_company_id()
     AND ev.data BETWEEN p_dal AND LEAST(p_al, p_dal + 400)
     AND ev.outlet_id IN (SELECT id FROM negozi)
     AND (NOT p_solo_da_confermare OR ev.stato = 'da_confermare')
     AND COALESCE(ev.esito, '') NOT IN ('superata', 'timbratura_annullata');
$$;
REVOKE ALL ON FUNCTION public.presenze_eventi_elenco(date, date, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.presenze_eventi_elenco(date, date, boolean) TO authenticated, service_role;

-- Il permesso approvato nato da una conferma (stesse voci delle richieste:
-- ex festivita' finche' bastano, poi ROL; senza saldo, ex festivita')
CREATE OR REPLACE FUNCTION public.presenze_crea_permesso(p_evento uuid, p_minuti integer, p_titolo text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  ev     public.attendance_eventi%ROWTYPE;
  e      public.employees%ROWTYPE;
  v_ore  numeric := round(p_minuti / 60.0, 2);
  v_f02  numeric;
  v_f03  numeric;
  v_req  uuid;
  v_nome text;
BEGIN
  SELECT * INTO ev FROM public.attendance_eventi WHERE id = p_evento;
  SELECT * INTO e FROM public.employees WHERE id = ev.employee_id;
  IF v_ore <= 0 OR v_ore > 24 THEN
    RAISE EXCEPTION 'Minuti di permesso non validi' USING ERRCODE = '22023';
  END IF;
  SELECT max(COALESCE(d.da_fruire_disponibile, d.residuo_disponibile, 0)) FILTER (WHERE d.voce = 'F02'),
         max(COALESCE(d.da_fruire_disponibile, d.residuo_disponibile, 0)) FILTER (WHERE d.voce = 'F03')
    INTO v_f02, v_f03
    FROM public.v_leave_disponibilita d WHERE d.employee_id = ev.employee_id;
  v_f02 := round(CASE WHEN v_f02 IS NULL AND v_f03 IS NULL THEN v_ore
                      ELSE LEAST(v_ore, GREATEST(COALESCE(v_f02, 0), 0)) END, 2);
  v_nome := NULLIF(btrim((SELECT COALESCE(first_name, '') || ' ' || COALESCE(last_name, '') FROM public.user_profiles WHERE id = auth.uid())), '');

  INSERT INTO public.leave_requests
    (company_id, employee_id, outlet_code, stato, titolo, origine, compilata_da, compilata_da_nome,
     inviata_il, decisa_il, decisa_da, decisa_da_nome, motivazione)
  VALUES
    (ev.company_id, ev.employee_id, (SELECT o.code FROM public.outlets o WHERE o.id = ev.outlet_id), 'approvata',
     left(p_titolo, 200), 'gestionale', auth.uid(), 'Presenze (' || COALESCE(v_nome, 'conferma') || ')',
     now(), now(), auth.uid(), v_nome, 'Dalle timbrature: ' || left(p_titolo, 200))
  RETURNING id INTO v_req;

  IF v_f02 >= 0.01 THEN
    INSERT INTO public.leave_request_days (company_id, request_id, data, voce, tipo, ore, stato, nota)
    VALUES (ev.company_id, v_req, ev.data, 'F02', 'ore', v_f02, 'approvato', left(p_titolo, 200));
  END IF;
  IF v_ore - v_f02 >= 0.01 THEN
    INSERT INTO public.leave_request_days (company_id, request_id, data, voce, tipo, ore, stato, nota)
    VALUES (ev.company_id, v_req, ev.data, 'F03', 'ore', v_ore - v_f02, 'approvato', left(p_titolo, 200));
  END IF;

  INSERT INTO public.leave_request_events (company_id, request_id, evento, stato_a, nota, dettaglio, utente_id, utente_nome)
  VALUES (ev.company_id, v_req, 'decisione', 'approvata', left(p_titolo, 200),
          jsonb_build_object('da_presenze', p_evento, 'minuti', p_minuti), auth.uid(), v_nome);
  RETURN v_req;
END;
$$;
REVOKE ALL ON FUNCTION public.presenze_crea_permesso(uuid, integer, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.presenze_crea_permesso(uuid, integer, text) TO service_role;

-- La decisione
CREATE OR REPLACE FUNCTION public.presenze_decidi_evento(
  p_evento uuid, p_conferma boolean, p_minuti integer DEFAULT NULL,
  p_scala_permesso boolean DEFAULT NULL, p_nota text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  ev      public.attendance_eventi%ROWTYPE;
  v_nota  text := left(NULLIF(btrim(p_nota), ''), 500);
  v_min   integer;
  v_esito text;
  v_scala boolean := false;
  v_req   uuid;
  v_giorno text;
BEGIN
  SELECT * INTO ev FROM public.attendance_eventi WHERE id = p_evento FOR UPDATE;
  IF NOT FOUND OR ev.company_id <> public.get_my_company_id() OR NOT public.presenze_puo_confermare(ev.outlet_id) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  PERFORM public.presenze_non_su_di_me(ev.employee_id);
  IF ev.stato <> 'da_confermare' THEN
    RAISE EXCEPTION 'È già stato deciso.' USING ERRCODE = '22023';
  END IF;
  v_giorno := to_char(ev.data, 'DD/MM/YYYY');

  IF p_conferma IS NOT TRUE THEN
    IF v_nota IS NULL THEN
      RAISE EXCEPTION 'Scrivi il motivo: lo legge la persona nell''app.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.attendance_eventi
       SET stato = 'respinto', esito = 'respinto', deciso_da = auth.uid(), deciso_il = now(), nota_decisione = v_nota
     WHERE id = p_evento;
    RETURN 'respinto';
  END IF;

  v_min := COALESCE(p_minuti, ev.minuti_proposti);
  IF v_min IS NULL OR v_min <= 0 OR v_min > 1440 THEN
    RAISE EXCEPTION 'Minuti non validi' USING ERRCODE = '22023';
  END IF;

  IF ev.tipo = 'ritardo' THEN
    v_esito := 'permesso'; v_scala := true;
    v_req := public.presenze_crea_permesso(p_evento, v_min, 'Ritardo del ' || v_giorno);
  ELSIF ev.tipo = 'uscita_anticipata' THEN
    IF ev.causale IS NULL THEN
      RAISE EXCEPTION 'Manca il motivo dell''uscita: chiedilo alla persona o scegli tu.' USING ERRCODE = '22023';
    ELSIF ev.causale = 'malattia' THEN
      v_esito := 'malattia';
    ELSIF ev.causale = 'personale' OR (ev.causale = 'accordo' AND p_scala_permesso IS TRUE) THEN
      v_esito := 'permesso'; v_scala := true;
      v_req := public.presenze_crea_permesso(p_evento, v_min, 'Uscita prima del turno del ' || v_giorno);
    ELSIF ev.causale = 'accordo' AND p_scala_permesso IS FALSE THEN
      v_esito := 'ore_non_lavorate';
    ELSE
      RAISE EXCEPTION 'Uscita d''accordo con il responsabile: scegli se scalare il permesso.' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_esito := 'straordinario';
  END IF;

  UPDATE public.attendance_eventi
     SET stato = 'confermato', esito = v_esito, minuti_confermati = v_min, scala_permesso = v_scala,
         leave_request_id = v_req, deciso_da = auth.uid(), deciso_il = now(), nota_decisione = v_nota
   WHERE id = p_evento;
  RETURN v_esito;
END;
$$;
REVOKE ALL ON FUNCTION public.presenze_decidi_evento(uuid, boolean, integer, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.presenze_decidi_evento(uuid, boolean, integer, boolean, text) TO authenticated, service_role;

-- Chi conferma puo' scegliere il motivo dell'uscita al posto della persona
CREATE OR REPLACE FUNCTION public.presenze_causale_evento(p_evento uuid, p_causale text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  ev public.attendance_eventi%ROWTYPE;
BEGIN
  SELECT * INTO ev FROM public.attendance_eventi WHERE id = p_evento FOR UPDATE;
  IF NOT FOUND OR ev.company_id <> public.get_my_company_id() OR NOT public.presenze_puo_confermare(ev.outlet_id) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  PERFORM public.presenze_non_su_di_me(ev.employee_id);
  IF ev.stato <> 'da_confermare' THEN
    RAISE EXCEPTION 'È già stato deciso.' USING ERRCODE = '22023';
  END IF;
  IF NOT ((ev.tipo = 'uscita_anticipata' AND p_causale IN ('personale', 'malattia', 'accordo'))
       OR (ev.tipo = 'straordinario' AND p_causale IN ('assenza_collega', 'cliente', 'riassortimento', 'allestimento'))) THEN
    RAISE EXCEPTION 'Scelta non valida' USING ERRCODE = '22023';
  END IF;
  UPDATE public.attendance_eventi SET causale = p_causale WHERE id = p_evento;
END;
$$;
REVOKE ALL ON FUNCTION public.presenze_causale_evento(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.presenze_causale_evento(uuid, text) TO authenticated, service_role;

-- Riaprire un caso deciso: solo gli amministratori, con motivo. Il permesso
-- creato dalla conferma si ritira insieme (resta nello storico come ritirato).
CREATE OR REPLACE FUNCTION public.presenze_riapri_evento(p_evento uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  ev     public.attendance_eventi%ROWTYPE;
  v_mot  text := left(NULLIF(btrim(p_motivo), ''), 500);
  v_nome text;
BEGIN
  SELECT * INTO ev FROM public.attendance_eventi WHERE id = p_evento FOR UPDATE;
  IF NOT FOUND OR ev.company_id <> public.get_my_company_id() OR NOT public.timbrature_gestore() THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  IF v_mot IS NULL THEN
    RAISE EXCEPTION 'Serve il motivo' USING ERRCODE = '22023';
  END IF;
  PERFORM public.presenze_non_su_di_me(ev.employee_id);
  IF ev.stato = 'da_confermare' THEN
    RETURN;
  END IF;
  IF COALESCE(ev.esito, '') IN ('superata', 'timbratura_annullata') THEN
    RAISE EXCEPTION 'Questo caso si è chiuso da solo (rientro o timbratura annullata): non si riapre.' USING ERRCODE = '22023';
  END IF;
  IF ev.leave_request_id IS NOT NULL THEN
    v_nome := NULLIF(btrim((SELECT COALESCE(first_name, '') || ' ' || COALESCE(last_name, '') FROM public.user_profiles WHERE id = auth.uid())), '');
    UPDATE public.leave_request_days SET stato = 'respinto' WHERE request_id = ev.leave_request_id;
    UPDATE public.leave_requests SET stato = 'ritirata', updated_at = now() WHERE id = ev.leave_request_id;
    INSERT INTO public.leave_request_events (company_id, request_id, evento, stato_a, nota, utente_id, utente_nome)
    VALUES (ev.company_id, ev.leave_request_id, 'ritiro', 'ritirata', 'Caso delle presenze riaperto: ' || v_mot, auth.uid(), v_nome);
  END IF;
  UPDATE public.attendance_eventi
     SET stato = 'da_confermare', esito = NULL, minuti_confermati = NULL, scala_permesso = NULL,
         leave_request_id = NULL, deciso_da = NULL, deciso_il = NULL,
         nota_decisione = 'Riaperto il ' || to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY') || ': ' || v_mot
   WHERE id = p_evento;
END;
$$;
REVOKE ALL ON FUNCTION public.presenze_riapri_evento(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.presenze_riapri_evento(uuid, text) TO authenticated, service_role;

-- Utenti del gestionale e i loro negozi (per la tabella «Chi conferma»)
CREATE OR REPLACE FUNCTION public.presenze_confermatori_elenco()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.timbrature_gestore() THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'user_id', u.id,
             'nome', NULLIF(btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
             'email', u.email, 'ruolo', u.role,
             'amministratore', (u.role::text = ANY (ARRAY['super_advisor', 'ceo', 'cfo', 'coo', 'contabile']))
                               OR EXISTS (SELECT 1 FROM public.organico_hr h WHERE h.user_id = u.id AND h.company_id = u.company_id),
             'negozi', COALESCE((SELECT jsonb_agg(c.outlet_id) FROM public.attendance_confermatori c WHERE c.user_id = u.id), '[]'::jsonb))
           ORDER BY u.first_name, u.last_name)
      FROM public.user_profiles u
     WHERE u.company_id = public.get_my_company_id()
       AND COALESCE(u.is_active, true)
       AND COALESCE(u.role::text, '') NOT IN ('dipendente', 'operatore_cassa')), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.presenze_confermatori_elenco() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.presenze_confermatori_elenco() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.presenze_confermatore_imposta(p_user uuid, p_outlet uuid, p_attivo boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_co uuid := public.get_my_company_id();
BEGIN
  IF NOT public.timbrature_gestore() THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles u WHERE u.id = p_user AND u.company_id = v_co
                   AND COALESCE(u.role::text, '') NOT IN ('dipendente', 'operatore_cassa'))
     OR NOT EXISTS (SELECT 1 FROM public.outlets o WHERE o.id = p_outlet AND o.company_id = v_co) THEN
    RAISE EXCEPTION 'Utente o negozio non validi' USING ERRCODE = '22023';
  END IF;
  IF p_attivo THEN
    INSERT INTO public.attendance_confermatori (user_id, outlet_id, company_id, created_by)
    VALUES (p_user, p_outlet, v_co, auth.uid())
    ON CONFLICT (user_id, outlet_id) DO NOTHING;
  ELSE
    -- E' una spunta di configurazione, non un dato del personale: si toglie e basta
    DELETE FROM public.attendance_confermatori WHERE user_id = p_user AND outlet_id = p_outlet AND company_id = v_co;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.presenze_confermatore_imposta(uuid, uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.presenze_confermatore_imposta(uuid, uuid, boolean) TO authenticated, service_role;

-- Eccezioni per persona (campo vuoto = come il negozio)
CREATE OR REPLACE FUNCTION public.presenze_regola_dipendente(p_emp uuid, p_tolleranza integer, p_margine integer, p_nota text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_co uuid := public.get_my_company_id();
BEGIN
  IF NOT public.timbrature_gestore() THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = p_emp AND e.company_id = v_co) THEN
    RAISE EXCEPTION 'Persona non trovata' USING ERRCODE = 'P0002';
  END IF;
  IF p_tolleranza IS NOT NULL AND (p_tolleranza < 0 OR p_tolleranza > 120)
     OR p_margine IS NOT NULL AND (p_margine < 0 OR p_margine > 240) THEN
    RAISE EXCEPTION 'Tolleranza da 0 a 120 minuti, margine da 0 a 240.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.attendance_regole_dipendente (employee_id, company_id, tolleranza_entrata_minuti, margine_uscita_minuti, nota, updated_at, updated_by)
  VALUES (p_emp, v_co, p_tolleranza, p_margine, left(NULLIF(btrim(p_nota), ''), 300), now(), auth.uid())
  ON CONFLICT (employee_id) DO UPDATE
    SET tolleranza_entrata_minuti = EXCLUDED.tolleranza_entrata_minuti,
        margine_uscita_minuti = EXCLUDED.margine_uscita_minuti,
        nota = EXCLUDED.nota, updated_at = now(), updated_by = auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.presenze_regola_dipendente(uuid, integer, integer, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.presenze_regola_dipendente(uuid, integer, integer, text) TO authenticated, service_role;

-- 4. Dalla timbratura al caso: rientro che chiude l'uscita, avviso a chi conferma
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
  v_id     uuid;
  v_tipo   text;
  v_nome   text;
  v_demo   boolean;
BEGIN
  SELECT * INTO p FROM public.attendance_punches WHERE id = p_punch;
  IF NOT FOUND OR p.annullata OR p.verifica NOT IN ('ok', 'da_confermare') OR p.tipo NOT IN ('entrata', 'uscita') THEN
    RETURN;
  END IF;
  v_loc := p.ora AT TIME ZONE 'Europe/Rome';
  v_data := v_loc::date;

  -- Rientro dopo un'uscita prima del turno: vale l'ultima uscita, quella di prima si chiude
  IF p.tipo = 'entrata' THEN
    UPDATE public.attendance_eventi ev
       SET stato = 'respinto', esito = 'superata', deciso_il = now(),
           nota_decisione = 'Rientrata alle ' || to_char(v_loc, 'HH24:MI')
      FROM public.attendance_punches u
     WHERE u.id = ev.punch_id AND ev.employee_id = p.employee_id AND ev.data = v_data
       AND ev.tipo = 'uscita_anticipata' AND ev.stato = 'da_confermare' AND u.ora < p.ora;
  END IF;

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
      ON CONFLICT (punch_id, tipo) DO NOTHING
      RETURNING id, tipo INTO v_id, v_tipo;
    END IF;
  ELSE
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
      ON CONFLICT (punch_id, tipo) DO NOTHING
      RETURNING id, tipo INTO v_id, v_tipo;
    ELSE
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
        ON CONFLICT (punch_id, tipo) DO NOTHING
        RETURNING id, tipo INTO v_id, v_tipo;
      END IF;
    END IF;
  END IF;

  -- Avviso nel gestionale a chi conferma quel negozio (non per il dipendente demo)
  IF v_id IS NOT NULL THEN
    SELECT btrim(COALESCE(e.nome, e.first_name, '') || ' ' || COALESCE(e.cognome, e.last_name, '')), e.is_demo
      INTO v_nome, v_demo FROM public.employees e WHERE e.id = p.employee_id;
    IF NOT COALESCE(v_demo, false) THEN
      INSERT INTO public.notifications
        (company_id, user_id, title, message, category, severity, action_url, action_label, reference_type, reference_id)
      SELECT p.company_id, c.user_id,
             CASE v_tipo WHEN 'ritardo' THEN 'Ritardo da confermare: ' WHEN 'uscita_anticipata' THEN 'Uscita prima del turno: '
                         ELSE 'Straordinario da confermare: ' END || COALESCE(v_nome, ''),
             to_char(v_data, 'DD/MM/YYYY') || ', ' || to_char(v_loc, 'HH24:MI') || '. Da confermare in Dipendenti → Presenze.',
             'info', 'info', '/dipendenti?view=presenze', 'Apri le presenze', 'attendance_evento', v_id
        FROM public.attendance_confermatori c WHERE c.outlet_id = p.outlet_id;
    END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.timbrature_evento_da_timbratura(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timbrature_evento_da_timbratura(uuid, text) TO service_role;

-- 5 e 6: modifiche puntuali, con controllo del testo
DO $$
DECLARE
  d text;
  n text;
BEGIN
  d := pg_get_functiondef('public.timbrature_annulla(uuid, text)'::regprocedure);
  n := replace(d, $x$   WHERE id = p_id AND company_id = (SELECT public.get_my_company_id()) AND NOT annullata;
END;$x$, $x$   WHERE id = p_id AND company_id = (SELECT public.get_my_company_id()) AND NOT annullata;
  -- Il caso nato da questa timbratura si chiude (migration 373)
  UPDATE public.attendance_eventi
     SET stato = 'respinto', esito = 'timbratura_annullata', deciso_da = auth.uid(), deciso_il = now(),
         nota_decisione = 'Timbratura annullata: ' || left(p_motivo, 400)
   WHERE punch_id = p_id AND company_id = (SELECT public.get_my_company_id()) AND stato = 'da_confermare';
END;$x$);
  IF n = d THEN RAISE EXCEPTION 'timbrature_annulla: testo atteso non trovato'; END IF;
  EXECUTE n;

  d := pg_get_functiondef('public.app_dipendente_oggi()'::regprocedure);
  n := replace(d, $x$'motivo', ev.motivo_dipendente, 'stato', ev.stato, 'esito', ev.esito) ORDER BY ev.created_at)
                 FROM public.attendance_eventi ev WHERE ev.employee_id = v_emp AND ev.data >= v_oggi - 1)$x$,
    $x$'motivo', ev.motivo_dipendente, 'stato', ev.stato, 'esito', ev.esito,
                 'minuti_confermati', ev.minuti_confermati, 'nota_decisione', ev.nota_decisione) ORDER BY ev.created_at)
                 FROM public.attendance_eventi ev WHERE ev.employee_id = v_emp AND ev.data >= v_oggi - 1
                   AND COALESCE(ev.esito, '') NOT IN ('superata', 'timbratura_annullata'))$x$);
  IF n = d THEN RAISE EXCEPTION 'app_dipendente_oggi: testo atteso non trovato'; END IF;
  EXECUTE n;
END;
$$;

COMMIT;
