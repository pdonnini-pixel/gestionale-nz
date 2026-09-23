-- =====================================================================
-- Migrazione 252 — Fase 3 del piano ferie: chi decide, e come
-- =====================================================================
-- IL PROBLEMA, GUARDANDO I DATI VERI DI NZ: i referenti delle ferie che
-- Patrizio ha nominato sono Massimo, Denise e Sabrina. In user_profiles
-- Sabrina e' contabile, Denise e' viewer (sola lettura, non potrebbe
-- toccare niente) e Massimo non ha proprio un account. Legare
-- l'approvazione al ruolo lascerebbe fuori due referenti su tre.
--
-- Quindi chi approva non e' un ruolo: e' un ELENCO.
--   1. leave_approvers — un referente. Con user_id se entra nel
--      gestionale, con la sola email se deve solo ricevere l'avviso.
--      outlet_code vuoto = tutti i punti vendita.
--   2. leave_settings — dove mandare gli avvisi, per azienda. Nessun
--      indirizzo nel codice, come per il report di cassa.
--   3. leave_decidi() — la decisione, anche parziale: si passano i giorni
--      approvati, gli altri risultano respinti. Chi respinge deve dire
--      perche': un rifiuto senza motivo lascia la persona a indovinare, e
--      il giro ricomincia da capo.
--   4. L'avviso in-app su notifications, come fa la richiesta di
--      riapertura cassa. La mail e' un secondo canale (leave-notify), non
--      l'unico: se non e' configurata, la decisione vale lo stesso.
--
-- PERCHE' UNA FUNZIONE E NON UNA UPDATE DAL FRONTEND: la decisione tocca
-- piu' righe (i giorni, la richiesta, la traccia) e deve valere tutta
-- insieme o niente. E i permessi si controllano in un posto solo.
--
-- NO DATA LOSS: due tabelle nuove e una funzione. Nessuna riga esistente
-- viene toccata. Le policy della 251 restano come sono: la decisione
-- passa dalla funzione, che e' SECURITY DEFINER e controlla da se'.
-- REGOLA #0: da applicare su NZ + Made + Zago.
-- Rollback: 20260922_252_leave_approvazioni_ROLLBACK.sql
-- =====================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Chi approva
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leave_approvers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id),

  -- Uno dei due deve esserci: l'utente se entra nel gestionale e decide,
  -- l'email se deve soltanto essere avvisato.
  user_id      uuid REFERENCES auth.users(id),
  email        text,
  nome         text NOT NULL,

  -- Vuoto = referente per tutti i punti vendita.
  outlet_code  text,

  attivo       boolean NOT NULL DEFAULT true,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,

  CONSTRAINT leave_approvers_chi CHECK (user_id IS NOT NULL OR NULLIF(btrim(email), '') IS NOT NULL)
);

COMMENT ON TABLE public.leave_approvers IS
  'Referenti delle ferie. Non e'' un ruolo: Denise e'' viewer e Massimo non ha un account, ma tutti e due devono contare. user_id decide in app, email riceve soltanto l''avviso.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_approvers_utente
  ON public.leave_approvers (company_id, user_id, coalesce(outlet_code, ''))
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leave_approvers_company
  ON public.leave_approvers (company_id, attivo);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Dove vanno gli avvisi
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leave_settings (
  company_id           uuid PRIMARY KEY REFERENCES public.companies(id),
  -- Destinatari in piu' oltre ai referenti con email (es. l'amministrazione).
  recipients           text[] NOT NULL DEFAULT '{}',
  avvisa_alla_richiesta boolean NOT NULL DEFAULT true,
  avvisa_alla_decisione boolean NOT NULL DEFAULT true,
  app_url              text,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.leave_settings IS
  'Impostazioni degli avvisi ferie per azienda. Nessun indirizzo nel codice: finche'' qui non c''e'' niente e nessun referente ha una email, la mail non parte e la richiesta vale lo stesso.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. Chi puo' decidere
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.posso_decidere_ferie()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (public.get_my_role())::text = ANY (ARRAY['super_advisor', 'coo', 'contabile'])
    OR EXISTS (
      SELECT 1 FROM public.leave_approvers a
      WHERE a.user_id = auth.uid()
        AND a.company_id = public.get_my_company_id()
        AND a.attivo
    );
$$;

COMMENT ON FUNCTION public.posso_decidere_ferie() IS
  'Vero per i ruoli che gestiscono il personale e per chi e'' nell''elenco dei referenti, qualunque sia il suo ruolo (Denise e'' viewer e deve poter approvare).';

REVOKE ALL ON FUNCTION public.posso_decidere_ferie() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.posso_decidere_ferie() TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 4. La decisione
-- ─────────────────────────────────────────────────────────────────────
-- p_giorni_approvati: gli id dei giorni che si concedono. Tutti gli altri
-- giorni della richiesta risultano respinti. Passare l'elenco vuoto vuol
-- dire respingere tutto.
CREATE OR REPLACE FUNCTION public.leave_decidi(
  p_request_id       uuid,
  p_giorni_approvati uuid[] DEFAULT '{}',
  p_motivazione      text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r            public.leave_requests%ROWTYPE;
  v_tot        int;
  v_ok         int;
  v_stato      text;
  v_nome       text;
  v_dipendente text;
  v_motivo     text := NULLIF(btrim(p_motivazione), '');
BEGIN
  SELECT * INTO r FROM public.leave_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Richiesta non trovata' USING ERRCODE = 'P0002';
  END IF;

  IF r.company_id <> public.get_my_company_id() OR NOT public.posso_decidere_ferie() THEN
    RAISE EXCEPTION 'Non autorizzato a decidere sulle ferie' USING ERRCODE = '42501';
  END IF;

  IF r.stato NOT IN ('inviata', 'approvata', 'approvata_parziale', 'respinta') THEN
    RAISE EXCEPTION 'Una richiesta in stato % non si puo'' decidere' , r.stato USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_tot FROM public.leave_request_days WHERE request_id = p_request_id;
  IF v_tot = 0 THEN
    RAISE EXCEPTION 'La richiesta non ha giorni' USING ERRCODE = '22023';
  END IF;

  v_ok := (SELECT count(*) FROM public.leave_request_days
            WHERE request_id = p_request_id AND id = ANY (p_giorni_approvati));

  -- Un rifiuto senza motivo lascia la persona a indovinare, e il giro
  -- ricomincia da capo: quando si toglie anche un solo giorno, il perche'
  -- e' obbligatorio.
  IF v_ok < v_tot AND v_motivo IS NULL THEN
    RAISE EXCEPTION 'Serve il motivo quando si respinge, anche solo in parte' USING ERRCODE = '22023';
  END IF;

  UPDATE public.leave_request_days
     SET stato = CASE WHEN id = ANY (p_giorni_approvati) THEN 'approvato' ELSE 'respinto' END
   WHERE request_id = p_request_id;

  v_stato := CASE WHEN v_ok = v_tot THEN 'approvata'
                  WHEN v_ok = 0     THEN 'respinta'
                  ELSE 'approvata_parziale' END;

  SELECT btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
    INTO v_nome FROM public.user_profiles WHERE id = auth.uid();

  UPDATE public.leave_requests
     SET stato          = v_stato,
         decisa_il      = now(),
         decisa_da      = auth.uid(),
         decisa_da_nome = NULLIF(v_nome, ''),
         motivazione    = v_motivo
   WHERE id = p_request_id;

  -- Il trigger della 251 ha gia' scritto il cambio di stato. Qui si
  -- aggiunge il dettaglio: quanti giorni concessi su quanti chiesti.
  INSERT INTO public.leave_request_events
    (company_id, request_id, evento, stato_a, nota, dettaglio, utente_id, utente_nome)
  VALUES (r.company_id, p_request_id, 'decisione', v_stato, v_motivo,
          jsonb_build_object('giorni_totali', v_tot, 'giorni_approvati', v_ok),
          auth.uid(), NULLIF(v_nome, ''));

  SELECT btrim(coalesce(e.cognome, e.last_name, '') || ' ' || coalesce(e.nome, e.first_name, ''))
    INTO v_dipendente FROM public.employees e WHERE e.id = r.employee_id;

  INSERT INTO public.notifications
    (company_id, user_id, title, message, category, severity, action_url, action_label, reference_type, reference_id)
  VALUES
    (r.company_id, NULL,
     CASE v_stato
       WHEN 'approvata'          THEN 'Ferie approvate: ' || coalesce(v_dipendente, '')
       WHEN 'approvata_parziale' THEN 'Ferie approvate in parte: ' || coalesce(v_dipendente, '')
       ELSE 'Ferie respinte: ' || coalesce(v_dipendente, '')
     END,
     CASE v_stato
       WHEN 'approvata' THEN 'Concessi tutti i ' || v_tot || ' giorni chiesti.'
       WHEN 'respinta'  THEN 'Nessun giorno concesso.' || coalesce(' Motivo: ' || v_motivo, '')
       ELSE 'Concessi ' || v_ok || ' giorni su ' || v_tot || '.' || coalesce(' Motivo: ' || v_motivo, '')
     END || ' Da comunicare alla persona.',
     'info',
     -- severity ammette solo info / warning / critical
     CASE WHEN v_stato = 'approvata' THEN 'info' ELSE 'warning' END,
     '/dipendenti?view=ferie&richiesta=' || p_request_id::text,
     'Apri la richiesta', 'leave_request', p_request_id);

  RETURN v_stato;
END;
$$;

COMMENT ON FUNCTION public.leave_decidi(uuid, uuid[], text) IS
  'Decide una richiesta di ferie, anche solo in parte: i giorni passati sono concessi, gli altri respinti. Motivo obbligatorio se si toglie anche un solo giorno.';

REVOKE ALL ON FUNCTION public.leave_decidi(uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_decidi(uuid, uuid[], text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 5. RLS
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.leave_approvers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_settings  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leave_approvers', 'leave_settings'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (company_id = public.get_my_company_id())',
      t || '_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL
         USING (company_id = public.get_my_company_id()
                AND (public.get_my_role())::text = ANY (ARRAY[''super_advisor'', ''contabile'', ''coo'']))
         WITH CHECK (company_id = public.get_my_company_id()
                AND (public.get_my_role())::text = ANY (ARRAY[''super_advisor'', ''contabile'', ''coo'']))',
      t || '_write', t);

    EXECUTE format('DROP POLICY IF EXISTS cash_operator_block ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY cash_operator_block ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
         USING (COALESCE(public.get_my_role()::text, '''') <> ''operatore_cassa'')
         WITH CHECK (COALESCE(public.get_my_role()::text, '''') <> ''operatore_cassa'')', t);

    EXECUTE format('DROP POLICY IF EXISTS dipendente_block ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY dipendente_block ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
         USING (COALESCE(public.get_my_role()::text, '''') <> ''dipendente'')
         WITH CHECK (COALESCE(public.get_my_role()::text, '''') <> ''dipendente'')', t);

    EXECUTE format('DROP POLICY IF EXISTS viewer_no_insert ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY viewer_no_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated
         WITH CHECK (COALESCE(public.get_my_role()::text, '''') <> ''viewer'')', t);
    EXECUTE format('DROP POLICY IF EXISTS viewer_no_update ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY viewer_no_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated
         USING (COALESCE(public.get_my_role()::text, '''') <> ''viewer'')', t);
    EXECUTE format('DROP POLICY IF EXISTS viewer_no_delete ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY viewer_no_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated
         USING (COALESCE(public.get_my_role()::text, '''') <> ''viewer'')', t);
  END LOOP;
END $$;

COMMIT;

-- VERIFICA:
--   SELECT count(*) FROM public.leave_approvers;   -- 0: l'elenco lo compila l'utente
--   SELECT public.posso_decidere_ferie();          -- true per chi gestisce il personale
--   SELECT proname FROM pg_proc WHERE proname IN ('leave_decidi', 'posso_decidere_ferie');
