-- =====================================================================
-- Migrazione 378 — Profilo 'responsabile': recinto e funzioni
-- =====================================================================
-- Decisioni di Patrizio del 09/11/2026 (parte 4, PR B):
--   * Il responsabile (referente di negozio o area manager) e' un utente del
--     gestionale con una pagina sua: i casi delle presenze da confermare e
--     le richieste di ferie e permessi dei negozi che un amministratore gli
--     spunta in «Chi conferma» (attendance_confermatori, 373).
--   * Non vede nient'altro: niente banca, fatture, costi, paghe, organico.
--   * «Chi conferma» lo modificano solo amministratori e super advisor
--     (gia' cosi' dalla 373).
--
-- COME (stesso schema dei ruoli dipendente e operatore_cassa):
--   1. responsabile_block: policy RESTRITTIVA su ogni tabella public con RLS
--      fuori dalla lista bianca, e su storage.objects. La pagina del
--      responsabile legge e scrive solo con funzioni SECURITY DEFINER che
--      controllano i suoi negozi.
--      Lista bianca: companies (nome dell'azienda nel layout),
--      help_chat_sessions, help_chat_messages, user_profiles (solo il
--      proprio), notifications (solo le proprie). Niente outlets: con
--      has_outlet_access senza righe vedrebbe affitti e budget dei negozi.
--   2. ferie_responsabile_puo(richiesta): la richiesta e' in attesa, di un
--      negozio suo e non e' la sua.
--   3. leave_decidi accetta anche il responsabile per i suoi negozi.
--   4. responsabile_negozi(), responsabile_ferie_elenco().
--   I casi delle presenze usano gia' presenze_eventi_elenco e
--   presenze_decidi_evento (373-374), che filtrano per negozio.
--
-- ATTENZIONE PER CHI VERRA' DOPO: le tabelle create in futuro NON ricevono
-- responsabile_block da sole: aggiungerla accanto a cash_operator_block e
-- dipendente_block.
--
-- NO DATA LOSS: solo policy e funzioni. Tenant: NZ e Zago.
-- Rollback: 20261109_378_responsabile_recinto_ROLLBACK.sql
-- =====================================================================

BEGIN;

-- 1. Il recinto
DO $$
DECLARE
  t record;
  allow text[] := ARRAY[
    'companies', 'help_chat_sessions', 'help_chat_messages', 'user_profiles', 'notifications'
  ];
  n int := 0;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND rowsecurity AND tablename <> ALL (allow)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t.tablename AND policyname = 'responsabile_block') THEN
      EXECUTE format(
        'CREATE POLICY responsabile_block ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        || 'USING (COALESCE(((SELECT public.get_my_role()))::text, '''') <> ''responsabile'') '
        || 'WITH CHECK (COALESCE(((SELECT public.get_my_role()))::text, '''') <> ''responsabile'')',
        t.tablename);
      n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'responsabile_block creata su % tabelle', n;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_profiles' AND policyname = 'responsabile_solo_suo') THEN
    CREATE POLICY responsabile_solo_suo ON public.user_profiles AS RESTRICTIVE FOR ALL TO authenticated
      USING (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'responsabile' OR id = (SELECT auth.uid()))
      WITH CHECK (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'responsabile' OR id = (SELECT auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications' AND policyname = 'responsabile_notifiche_sue') THEN
    CREATE POLICY responsabile_notifiche_sue ON public.notifications AS RESTRICTIVE FOR ALL TO authenticated
      USING (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'responsabile' OR user_id = (SELECT auth.uid()))
      WITH CHECK (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'responsabile' OR user_id = (SELECT auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'responsabile_block') THEN
    CREATE POLICY responsabile_block ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
      USING (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'responsabile')
      WITH CHECK (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'responsabile');
  END IF;
END $$;

-- 1b. Chi e' davvero la persona. L'account del gestionale di un responsabile
-- e' diverso da quello della sua app da dipendente (employees.user_id e'
-- l'utente dell'app): l'amministratore collega qui l'account del gestionale
-- alla scheda dipendente, cosi' «nessuno decide sui propri casi» vale
-- anche dal gestionale.
CREATE TABLE IF NOT EXISTS public.responsabile_dipendente (
  user_id     uuid PRIMARY KEY REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  company_id  uuid NOT NULL REFERENCES public.companies(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);
ALTER TABLE public.responsabile_dipendente ENABLE ROW LEVEL SECURITY;
CREATE POLICY responsabile_dipendente_select ON public.responsabile_dipendente FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.timbrature_gestore()));
CREATE POLICY cash_operator_block ON public.responsabile_dipendente AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'operatore_cassa');
CREATE POLICY dipendente_block ON public.responsabile_dipendente AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'dipendente')
  WITH CHECK (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'dipendente');
CREATE POLICY responsabile_block ON public.responsabile_dipendente AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'responsabile')
  WITH CHECK (COALESCE(((SELECT public.get_my_role()))::text, '') <> 'responsabile');
GRANT SELECT ON public.responsabile_dipendente TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.responsabile_dipendente FROM authenticated, anon;
REVOKE SELECT ON public.responsabile_dipendente FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.responsabile_dipendente TO service_role;

CREATE OR REPLACE FUNCTION public.presenze_sono_io(p_employee uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  -- Sempre vero o falso, mai NULL: senza scheda collegata la risposta e' «no»
  SELECT COALESCE(p_employee IS NOT NULL AND (
           p_employee = public.timbrature_mio_dipendente()
        OR EXISTS (SELECT 1 FROM public.responsabile_dipendente r
                    WHERE r.user_id = auth.uid() AND r.employee_id = p_employee)), false);
$$;
REVOKE ALL ON FUNCTION public.presenze_sono_io(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.presenze_sono_io(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.presenze_responsabile_dipendente_imposta(p_user uuid, p_employee uuid)
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
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles u WHERE u.id = p_user AND u.company_id = v_co) THEN
    RAISE EXCEPTION 'Utente non valido' USING ERRCODE = '22023';
  END IF;
  IF p_employee IS NULL THEN
    -- Configurazione, non dati del personale: «non e' un dipendente» toglie il collegamento
    DELETE FROM public.responsabile_dipendente WHERE user_id = p_user AND company_id = v_co;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = p_employee AND e.company_id = v_co) THEN
    RAISE EXCEPTION 'Persona non trovata' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.responsabile_dipendente (user_id, employee_id, company_id, updated_by)
  VALUES (p_user, p_employee, v_co, auth.uid())
  ON CONFLICT (user_id) DO UPDATE SET employee_id = EXCLUDED.employee_id, updated_at = now(), updated_by = auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.presenze_responsabile_dipendente_imposta(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.presenze_responsabile_dipendente_imposta(uuid, uuid) TO authenticated, service_role;

-- «Nessuno decide sui propri casi» (373) e l'elenco di «Chi conferma» usano il collegamento
DO $$
DECLARE
  d text;
  n text;
BEGIN
  d := pg_get_functiondef('public.presenze_non_su_di_me(uuid)'::regprocedure);
  IF d !~ 'presenze_sono_io' THEN
    n := replace(d, 'IF p_employee = public.timbrature_mio_dipendente()', 'IF public.presenze_sono_io(p_employee)');
    IF n = d THEN RAISE EXCEPTION 'presenze_non_su_di_me: testo atteso non trovato'; END IF;
    EXECUTE n;
  END IF;

  d := pg_get_functiondef('public.presenze_confermatori_elenco()'::regprocedure);
  IF d !~ 'responsabile_dipendente' THEN
    n := replace(d, $x$'negozi', COALESCE((SELECT jsonb_agg(c.outlet_id)$x$,
      $x$'dipendente_id', (SELECT r.employee_id FROM public.responsabile_dipendente r WHERE r.user_id = u.id),
             'negozi', COALESCE((SELECT jsonb_agg(c.outlet_id)$x$);
    IF n = d THEN RAISE EXCEPTION 'presenze_confermatori_elenco: testo atteso non trovato'; END IF;
    EXECUTE n;
  END IF;
END;
$$;

-- 2. Il negozio di una richiesta di ferie: dal codice negozio della
-- richiesta, altrimenti dal negozio in anagrafica
CREATE OR REPLACE FUNCTION public.ferie_negozio_richiesta(p_request uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(
           (SELECT o.id FROM public.outlets o WHERE o.company_id = q.company_id AND o.code = q.outlet_code LIMIT 1),
           e.outlet_id)
    FROM public.leave_requests q JOIN public.employees e ON e.id = q.employee_id
   WHERE q.id = p_request;
$$;
REVOKE ALL ON FUNCTION public.ferie_negozio_richiesta(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ferie_negozio_richiesta(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ferie_responsabile_puo(p_request uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(public.get_my_role()::text, '') = 'responsabile'
     AND EXISTS (
       SELECT 1 FROM public.leave_requests q
        WHERE q.id = p_request
          AND q.stato = 'inviata'
          AND q.company_id = public.get_my_company_id()
          AND NOT public.presenze_sono_io(q.employee_id)
          AND EXISTS (SELECT 1 FROM public.attendance_confermatori c
                       WHERE c.user_id = auth.uid() AND c.company_id = q.company_id
                         AND c.outlet_id = public.ferie_negozio_richiesta(q.id)));
$$;
REVOKE ALL ON FUNCTION public.ferie_responsabile_puo(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ferie_responsabile_puo(uuid) TO authenticated, service_role;

-- 3. leave_decidi: anche il responsabile, per le richieste dei suoi negozi
DO $$
DECLARE
  d text;
  n text;
BEGIN
  d := pg_get_functiondef('public.leave_decidi(uuid, uuid[], text)'::regprocedure);
  IF d ~ 'ferie_responsabile_puo' THEN RETURN; END IF; -- gia' applicata
  n := replace(d, $x$IF r.company_id <> public.get_my_company_id() OR NOT public.posso_decidere_ferie() THEN$x$,
                  $x$IF r.company_id <> public.get_my_company_id()
     OR NOT (public.posso_decidere_ferie() OR public.ferie_responsabile_puo(p_request_id)) THEN$x$);
  IF n = d THEN RAISE EXCEPTION 'leave_decidi: testo atteso non trovato'; END IF;
  EXECUTE n;
END;
$$;

-- 4. La pagina del responsabile
CREATE OR REPLACE FUNCTION public.responsabile_negozi()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', o.id, 'nome', o.name) ORDER BY o.name), '[]'::jsonb)
    FROM public.attendance_confermatori c JOIN public.outlets o ON o.id = c.outlet_id
   WHERE c.user_id = auth.uid() AND c.company_id = public.get_my_company_id();
$$;
REVOKE ALL ON FUNCTION public.responsabile_negozi() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.responsabile_negozi() TO authenticated, service_role;

-- Richieste di ferie e permessi dei negozi del responsabile: in attesa, piu'
-- quelle decise negli ultimi 30 giorni. Con i saldi della persona.
CREATE OR REPLACE FUNCTION public.responsabile_ferie_elenco(p_solo_in_attesa boolean DEFAULT true)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH miei AS (
    SELECT c.outlet_id FROM public.attendance_confermatori c
     WHERE c.user_id = auth.uid() AND c.company_id = public.get_my_company_id()
  ), richieste AS (
    SELECT q.*, public.ferie_negozio_richiesta(q.id) AS negozio_id
      FROM public.leave_requests q
     WHERE q.company_id = public.get_my_company_id()
       AND NOT public.presenze_sono_io(q.employee_id)
       AND (q.stato = 'inviata'
            OR (NOT p_solo_in_attesa AND q.stato IN ('approvata', 'approvata_parziale', 'respinta')
                AND q.decisa_il > now() - interval '30 days'))
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', q.id, 'stato', q.stato, 'negozio', o.name,
           'persona', btrim(COALESCE(e.nome, e.first_name, '') || ' ' || COALESCE(e.cognome, e.last_name, '')),
           'prova', e.is_demo, 'titolo', q.titolo, 'note_dipendente', q.note_dipendente,
           'compilata_da_nome', q.compilata_da_nome, 'inviata_il', q.inviata_il,
           'decisa_il', q.decisa_il, 'decisa_da_nome', q.decisa_da_nome, 'motivazione', q.motivazione,
           'giorni', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'data', d.data, 'voce', d.voce, 'tipo', d.tipo, 'ore', d.ore, 'stato', d.stato) ORDER BY d.data, d.voce)
                                 FROM public.leave_request_days d WHERE d.request_id = q.id), '[]'::jsonb),
           'saldi', COALESCE((SELECT jsonb_agg(jsonb_build_object('voce', v.voce, 'disponibile', COALESCE(v.da_fruire_disponibile, v.residuo_disponibile)) ORDER BY v.voce)
                                FROM public.v_leave_disponibilita v WHERE v.employee_id = q.employee_id), '[]'::jsonb))
         ORDER BY q.inviata_il NULLS LAST, q.created_at), '[]'::jsonb)
    FROM richieste q
    JOIN public.employees e ON e.id = q.employee_id
    LEFT JOIN public.outlets o ON o.id = q.negozio_id
   WHERE q.negozio_id IN (SELECT outlet_id FROM miei);
$$;
REVOKE ALL ON FUNCTION public.responsabile_ferie_elenco(boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.responsabile_ferie_elenco(boolean) TO authenticated, service_role;

COMMIT;

-- Verifica, su ogni tenant:
--   SELECT count(*) FROM pg_policies WHERE policyname = 'responsabile_block';      -- tante quante dipendente_block, piu' storage
--   SELECT pg_get_functiondef('public.leave_decidi(uuid,uuid[],text)'::regprocedure) ~ 'ferie_responsabile_puo';
