-- =====================================================================
-- Migrazione 349 — Timbrature: recinto del ruolo dipendente, tentativi
-- di attivazione, QR usabile una volta, persone non piu' in servizio
-- =====================================================================
-- PERCHE': revisione di sicurezza della 348 (05/11/2026).
--   1. Il blocco dipendente_block (migration 249) era stato creato solo sulle
--      tabelle che esistevano allora. 21 tabelle arrivate dopo (paghe, F24,
--      estratti bancari, ...) avevano solo la policy per azienda: con l'app
--      ogni dipendente avra' un account, e da quell'account le avrebbe lette
--      chiamando l'API. Al 05/11/2026 nessun utente ha il ruolo dipendente,
--      quindi nessuno le ha mai lette: il recinto va messo prima.
--      Il blocco si rilancia su TUTTE le tabelle con RLS fuori dalla lista
--      bianca della 249, cosi' copre anche le prossime dimenticanze.
--   2. Il codice di attivazione non aveva limite di tentativi: si conta ogni
--      errore e dopo 20 errori in 10 minuti l'attivazione si ferma per tutti
--      per 10 minuti (app-dipendente-attiva risponde 429).
--   3. Lo stesso QR (stesso passo di 30 secondi) presentato due volte per la
--      stessa azione dava due timbrature: ora la seconda si scarta.
--   4. Chi non e' piu' in servizio (employees.is_active = false) non timbra
--      e la sua app non risponde piu'.
-- NO DATA LOSS: solo CREATE POLICY, CREATE TABLE, ADD COLUMN, CREATE OR
-- REPLACE FUNCTION. Nessuna riga toccata. Policy RESTRICTIVE: per tutti i
-- ruoli diversi da dipendente non cambia niente.
-- Niente DROP: il connettore chiede conferma per ogni DROP e va in timeout.
-- REGOLA #0 (dal 03/11/2026): NZ e Zago.
-- =====================================================================

-- 1. Recinto del ruolo dipendente su tutte le tabelle che ne sono prive
DO $$
DECLARE t record; n int := 0;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
       AND c.relname NOT IN ('companies', 'company_settings', 'user_profiles', 'user_outlet_access',
                             'outlets', 'help_chat_sessions', 'help_chat_messages')
       AND NOT EXISTS (SELECT 1 FROM pg_policies p
                        WHERE p.schemaname = 'public' AND p.tablename = c.relname AND p.policyname = 'dipendente_block')
  LOOP
    EXECUTE format('CREATE POLICY dipendente_block ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING (COALESCE((SELECT public.get_my_role())::text, '''') <> ''dipendente'') '
      || 'WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '''') <> ''dipendente'')', t.relname);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'dipendente_block aggiunta su % tabelle', n;
END $$;

-- 2. Tentativi di attivazione
CREATE TABLE IF NOT EXISTS public.employee_app_activation_attempts (
  id         bigserial PRIMARY KEY,
  esito      text NOT NULL CHECK (esito IN ('ok', 'errato')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_app_activation_attempts_at_idx ON public.employee_app_activation_attempts (created_at);
COMMENT ON TABLE public.employee_app_activation_attempts IS
  'Tentativi di attivazione dell''app del dipendente (solo esito e ora). Oltre 20 errori in 10 minuti l''attivazione si ferma per 10 minuti.';
ALTER TABLE public.employee_app_activation_attempts ENABLE ROW LEVEL SECURITY;
-- Nessuna policy: la usa solo la Edge Function (service role).
REVOKE ALL ON public.employee_app_activation_attempts FROM anon, authenticated;
GRANT SELECT, INSERT ON public.employee_app_activation_attempts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.employee_app_activation_attempts_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.app_attivazione_bloccata()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*) >= 20 FROM public.employee_app_activation_attempts
   WHERE esito = 'errato' AND created_at > now() - interval '10 minutes';
$$;
REVOKE ALL ON FUNCTION public.app_attivazione_bloccata() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_attivazione_bloccata() TO service_role;

-- 3. Passo del QR sulla timbratura: lo stesso QR vale una volta per azione
ALTER TABLE public.attendance_punches ADD COLUMN IF NOT EXISTS passo_qr bigint;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_punches_qr_un
  ON public.attendance_punches (employee_id, passo_qr, tipo) WHERE passo_qr IS NOT NULL;

CREATE OR REPLACE FUNCTION public.timbrature_registra(p_righe jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
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

    INSERT INTO public.attendance_punches
      (id, company_id, outlet_id, employee_id, tipo, ora, ora_dispositivo, scarto_secondi,
       dispositivo_id, sequenza, origine, verifica, passo_qr)
    VALUES
      ((r->>'id')::uuid, v_company, v_outlet, v_emp, r->>'tipo', v_ora, v_disp, v_scarto,
       left(r->>'dispositivo_id', 80), (r->>'sequenza')::integer, 'cellulare_negozio', v_verifica,
       CASE WHEN v_verifica = 'firma_non_valida' THEN NULL ELSE v_passo END)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    v_esiti := v_esiti || jsonb_build_object('id', r->>'id',
      'esito', CASE WHEN v_n = 1 THEN 'salvata'
                    WHEN EXISTS (SELECT 1 FROM public.attendance_punches WHERE id = (r->>'id')::uuid) THEN 'salvata'
                    ELSE 'qr_gia_usato' END,
      'verifica', v_verifica);
   EXCEPTION WHEN others THEN
    -- Errore non previsto (timeout, blocco): la riga resta in coda sul
    -- telefono e si riprova, non si scarta.
    v_esiti := v_esiti || jsonb_build_object('id', r->>'id', 'esito', 'errore_temporaneo');
   END;
  END LOOP;

  RETURN jsonb_build_object('ora_server', now(), 'esiti', v_esiti);
END;
$$;
REVOKE ALL ON FUNCTION public.timbrature_registra(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.timbrature_registra(jsonb) TO authenticated;

-- 4. Chi non e' piu' in servizio: l'app non risponde
CREATE OR REPLACE FUNCTION public.timbrature_mio_dipendente()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT e.id FROM public.employees e
   WHERE e.user_id = (SELECT auth.uid()) AND COALESCE(e.is_active, true)
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.timbrature_mio_dipendente() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.timbrature_mio_dipendente() TO authenticated, service_role;

-- 5. Turno spezzato (9-13 e 16-20): l'avviso guarda solo l'ultimo turno della
--    giornata. Prima bastava un altro turno entro un'ora; con la pausa lunga
--    l'avviso partiva alle 13:30 a chi era semplicemente uscito senza timbrare.
CREATE OR REPLACE FUNCTION public.timbrature_da_avvisare(p_now timestamptz DEFAULT now())
RETURNS TABLE (company_id uuid, outlet_id uuid, employee_id uuid, shift_id uuid, data date, fine time,
               nome text, telefono text, negozio text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH oggi AS (SELECT (p_now AT TIME ZONE 'Europe/Rome')::date AS d),
  negozi AS (
    SELECT a.outlet_id, a.company_id, a.margine_uscita_minuti
      FROM public.attendance_settings a WHERE a.attive AND a.avvisi_whatsapp
  ),
  turni AS (
    SELECT t.*, n.margine_uscita_minuti, n.company_id AS cid,
           ((t.data + t.fine) AT TIME ZONE 'Europe/Rome') AS fine_ts
      FROM negozi n, oggi,
           LATERAL public.timbrature_turni_ufficiali(n.company_id, oggi.d - 1, oggi.d) t
     WHERE t.outlet_id = n.outlet_id
  )
  SELECT t.cid, t.outlet_id, t.employee_id, t.shift_id, t.data, t.fine,
         COALESCE(e.nome, e.first_name), e.telefono_whatsapp, o.name
    FROM turni t
    JOIN public.employees e ON e.id = t.employee_id AND COALESCE(e.is_active, true)
    JOIN public.outlets o ON o.id = t.outlet_id
   WHERE t.fine_ts + make_interval(mins => t.margine_uscita_minuti) <= p_now
     AND t.fine_ts >= p_now - interval '12 hours'
     AND COALESCE(e.telefono_whatsapp, '') <> ''
     AND NOT EXISTS (SELECT 1 FROM public.attendance_notifications x
                      WHERE x.tipo = 'uscita_mancante'
                        AND (x.shift_id = t.shift_id
                             OR (x.employee_id = t.employee_id AND x.data = t.data AND x.fine_turno = t.fine)))
     AND NOT EXISTS (SELECT 1 FROM public.timbrature_turni_ufficiali(t.cid, t.data, t.data) t2
                      WHERE t2.employee_id = t.employee_id AND t2.shift_id <> t.shift_id
                        AND t2.inizio >= t.fine)
     AND (SELECT a.tipo FROM public.attendance_punches a
           WHERE a.employee_id = t.employee_id AND NOT a.annullata
             AND a.ora >= (t.data::timestamp AT TIME ZONE 'Europe/Rome') AND a.ora <= p_now
           ORDER BY a.ora DESC LIMIT 1) IN ('entrata', 'inizio_pausa', 'fine_pausa');
$$;
REVOKE ALL ON FUNCTION public.timbrature_da_avvisare(timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timbrature_da_avvisare(timestamptz) TO service_role;

-- Verifica su ogni tenant (attese: 0 righe, e false):
-- SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--  WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
--    AND c.relname NOT IN ('companies','company_settings','user_profiles','user_outlet_access','outlets','help_chat_sessions','help_chat_messages')
--    AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename=c.relname AND p.policyname='dipendente_block');
-- SELECT has_table_privilege('authenticated','public.employee_app_activation_attempts','select');
