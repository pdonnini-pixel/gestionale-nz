-- =====================================================================
-- Migrazione 348 — Timbrature: presenze, pause, accesso del dipendente
-- =====================================================================
-- PERCHE': oggi le timbrature stanno su People Smart (Zucchetti), fuori dal
-- gestionale, e nessuno le confronta con i turni. Lo studio paghe a fine
-- mese trova straordinari e permessi non segnalati, presenze mancanti,
-- chiamate registrate a meta' (due diligence in
-- docs/DUE_DILIGENCE_PRESENZE_DIPENDENTI.md). Patrizio (05/11/2026):
-- timbratura sul cellulare aziendale del negozio (Android, resta in
-- negozio, Wi-Fi), un accesso per dipendente creato con il dipendente,
-- avviso WhatsApp se a fine turno + 30 minuti l'uscita non e' timbrata,
-- pilota a Roma Soratte.
--
-- COME FUNZIONA:
--   - Il telefono del dipendente mostra un QR che cambia ogni 30 secondi:
--     NZT1.<employee_id>.<passo>.<firma>, firma = HMAC-SHA256 con il
--     segreto personale (primi 16 caratteri esadecimali). Si calcola anche
--     senza rete.
--   - Il cellulare del negozio (account di cassa, operatore_cassa) legge il
--     QR, salva la timbratura in locale e la manda con
--     timbrature_registra(). La firma la controlla il server: il negozio
--     non conosce i segreti.
--   - Una timbratura con firma sbagliata o fuori tempo NON si scarta: si
--     salva con l'esito, perche' e' comunque un fatto accaduto (NO DATA LOSS).
--
-- COSA INTRODUCE:
--   1. employees.user_id, employees.telefono_whatsapp (colonne nuove, vuote)
--   2. employee_app_access   — segreto e codice di attivazione (solo via RPC)
--   3. attendance_settings   — timbrature e avvisi accesi per negozio,
--                              margine d'uscita (30 minuti)
--   4. attendance_punches    — le timbrature (solo aggiunte, si annullano)
--   5. attendance_notifications — avvisi WhatsApp mandati
--   6. trigger: ogni dipendente nuovo riceve il suo accesso
--   7. RPC per il negozio, per il dipendente, per l'HR, per gli avvisi
--   8. cron ogni 10 minuti (manda solo dove gli avvisi sono accesi)
--
-- NO DATA LOSS: solo ADD COLUMN, CREATE TABLE, CREATE FUNCTION. Nessuna
-- riga esistente cambia. Timbrature, avvisi e accessi non si cancellano.
-- REGOLA #0 (dal 03/11/2026): solo NZ e Zago.
-- Rollback: 20261105_348_timbrature_presenze_ROLLBACK.sql
-- =====================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Colonne nuove su employees
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS telefono_whatsapp text;
CREATE UNIQUE INDEX IF NOT EXISTS employees_user_id_un ON public.employees (user_id) WHERE user_id IS NOT NULL;
COMMENT ON COLUMN public.employees.user_id IS 'Accesso personale del dipendente (ruolo dipendente), legato dall''attivazione dell''app (migration 348).';
COMMENT ON COLUMN public.employees.telefono_whatsapp IS 'Numero per gli avvisi WhatsApp delle timbrature, formato +39...';

-- Chi chiama: il dipendente collegato all'utente corrente (o NULL).
CREATE OR REPLACE FUNCTION public.timbrature_mio_dipendente()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id FROM public.employees e WHERE e.user_id = (SELECT auth.uid()) LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.timbrature_mio_dipendente() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.timbrature_mio_dipendente() TO authenticated, service_role;

-- Chi gestisce le presenze: chi scrive l'organico o l'HR.
CREATE OR REPLACE FUNCTION public.timbrature_gestore()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.organico_puo_scrivere() OR public.organico_e_hr();
$$;
REVOKE ALL ON FUNCTION public.timbrature_gestore() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.timbrature_gestore() TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Accesso dell'app (segreto e codice di attivazione)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_app_access (
  employee_id    uuid PRIMARY KEY REFERENCES public.employees(id),
  company_id     uuid NOT NULL REFERENCES public.companies(id),
  segreto        text NOT NULL,
  codice         text,
  codice_scade   timestamptz,
  attivata_il    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS employee_app_access_codice_un ON public.employee_app_access (codice) WHERE codice IS NOT NULL;
COMMENT ON TABLE public.employee_app_access IS
  'Segreto del QR e codice di attivazione dell''app del dipendente. Nessuna policy: si legge e si scrive solo con le RPC timbrature_* (il segreto non deve uscire).';
ALTER TABLE public.employee_app_access ENABLE ROW LEVEL SECURITY;
-- Nessuna policy per authenticated, di proposito: l'accesso e' solo via RPC
-- SECURITY DEFINER. Il service role serve alla Edge Function di attivazione.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_app_access TO service_role;

CREATE OR REPLACE FUNCTION public.timbrature_nuovo_codice()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public, extensions
AS $$
DECLARE
  alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea;
  c text;
  i int;
BEGIN
  LOOP
    b := extensions.gen_random_bytes(8);
    c := '';
    FOR i IN 0..7 LOOP
      c := c || substr(alfabeto, (get_byte(b, i) % length(alfabeto)) + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.employee_app_access WHERE codice = c);
  END LOOP;
  RETURN c;
END;
$$;
REVOKE ALL ON FUNCTION public.timbrature_nuovo_codice() FROM public, anon, authenticated;

-- Ogni dipendente nuovo riceve il suo accesso (Patrizio: «un accesso per
-- dipendente che si crea quando si crea il dipendente»).
CREATE OR REPLACE FUNCTION public.timbrature_crea_accesso()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  INSERT INTO public.employee_app_access (employee_id, company_id, segreto, codice, codice_scade)
  VALUES (NEW.id, NEW.company_id, encode(extensions.gen_random_bytes(20), 'hex'),
          public.timbrature_nuovo_codice(), now() + interval '30 days')
  ON CONFLICT (employee_id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_employees_accesso_app ON public.employees;
CREATE TRIGGER trg_employees_accesso_app
  AFTER INSERT ON public.employees
  FOR EACH ROW WHEN (NEW.company_id IS NOT NULL)
  EXECUTE FUNCTION public.timbrature_crea_accesso();

-- Accesso anche per chi c'e' gia' (solo persone attive).
INSERT INTO public.employee_app_access (employee_id, company_id, segreto, codice, codice_scade)
SELECT e.id, e.company_id, encode(extensions.gen_random_bytes(20), 'hex'),
       public.timbrature_nuovo_codice(), now() + interval '30 days'
  FROM public.employees e
 WHERE e.company_id IS NOT NULL AND COALESCE(e.is_active, true)
ON CONFLICT (employee_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Impostazioni per negozio
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_settings (
  outlet_id             uuid PRIMARY KEY REFERENCES public.outlets(id),
  company_id            uuid NOT NULL REFERENCES public.companies(id),
  attive                boolean NOT NULL DEFAULT false,
  avvisi_whatsapp       boolean NOT NULL DEFAULT false,
  margine_uscita_minuti smallint NOT NULL DEFAULT 30 CHECK (margine_uscita_minuti BETWEEN 0 AND 240),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid DEFAULT auth.uid()
);
COMMENT ON TABLE public.attendance_settings IS
  'Timbrature per negozio: accese o no, avvisi WhatsApp accesi o no, margine dopo la fine del turno (entro il margine l''uscita non e'' straordinario e non parte l''avviso).';
ALTER TABLE public.attendance_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY attendance_settings_select ON public.attendance_settings
  FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.timbrature_gestore()));
CREATE POLICY attendance_settings_write ON public.attendance_settings
  FOR ALL TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.timbrature_gestore()))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.timbrature_gestore()));
GRANT SELECT, INSERT, UPDATE ON public.attendance_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_settings TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Timbrature
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_punches (
  id                 uuid PRIMARY KEY,               -- generato dal telefono: rende l'invio ripetibile
  company_id         uuid NOT NULL REFERENCES public.companies(id),
  outlet_id          uuid NOT NULL REFERENCES public.outlets(id),
  employee_id        uuid NOT NULL REFERENCES public.employees(id),
  tipo               text NOT NULL CHECK (tipo IN ('entrata', 'inizio_pausa', 'fine_pausa', 'uscita')),
  ora                timestamptz NOT NULL,            -- ora ufficiale: ora del telefono del negozio corretta con lo scarto
  ora_dispositivo    timestamptz,
  scarto_secondi     integer,
  ora_server         timestamptz NOT NULL DEFAULT now(),
  dispositivo_id     text,
  sequenza           integer,
  origine            text NOT NULL CHECK (origine IN ('cellulare_negozio', 'dichiarata', 'manuale')),
  verifica           text NOT NULL CHECK (verifica IN ('ok', 'firma_non_valida', 'fuori_tempo', 'da_confermare', 'manuale')),
  nota               text,
  registrata_da      uuid DEFAULT auth.uid(),
  annullata          boolean NOT NULL DEFAULT false,
  annullata_motivo   text,
  annullata_da       uuid,
  annullata_il       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attendance_punches_emp_ora_idx ON public.attendance_punches (employee_id, ora);
CREATE INDEX IF NOT EXISTS attendance_punches_outlet_ora_idx ON public.attendance_punches (company_id, outlet_id, ora);
COMMENT ON TABLE public.attendance_punches IS
  'Timbrature (entrata, pausa, uscita). Solo aggiunte: una timbratura sbagliata si annulla con motivo, non si cancella (LUL, 5 anni).';
ALTER TABLE public.attendance_punches ENABLE ROW LEVEL SECURITY;
-- Lettura per chi gestisce le presenze. Scrittura solo via RPC.
CREATE POLICY attendance_punches_select ON public.attendance_punches
  FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.timbrature_gestore()));
GRANT SELECT ON public.attendance_punches TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.attendance_punches TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Avvisi mandati
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id),
  employee_id  uuid NOT NULL REFERENCES public.employees(id),
  shift_id     uuid REFERENCES public.shifts(id) ON DELETE SET NULL,  -- il turno puo' essere rifatto: l'avviso resta
  data         date NOT NULL,
  fine_turno   time NOT NULL,
  tipo         text NOT NULL DEFAULT 'uscita_mancante' CHECK (tipo IN ('uscita_mancante')),
  canale       text NOT NULL DEFAULT 'whatsapp',
  telefono     text,
  esito        text NOT NULL CHECK (esito IN ('sent', 'failed')),
  errore       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shift_id, tipo)
);
ALTER TABLE public.attendance_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY attendance_notifications_select ON public.attendance_notifications
  FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.timbrature_gestore()));
GRANT SELECT ON public.attendance_notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.attendance_notifications TO service_role;

-- Secondo recinto, come 315 e 329: l'account di cassa e il dipendente non
-- leggono queste tabelle nemmeno se un giorno finissero fra i gestori.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_settings', 'attendance_punches', 'attendance_notifications'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS cash_operator_block ON public.%I', t);
    EXECUTE format('CREATE POLICY cash_operator_block ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING (COALESCE((SELECT public.get_my_role())::text, '''') <> ''operatore_cassa'') '
      || 'WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '''') <> ''operatore_cassa'')', t);
    EXECUTE format('DROP POLICY IF EXISTS dipendente_block ON public.%I', t);
    EXECUTE format('CREATE POLICY dipendente_block ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING (COALESCE((SELECT public.get_my_role())::text, '''') <> ''dipendente'') '
      || 'WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '''') <> ''dipendente'')', t);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 6. Turni ufficiali: se il mese ha un piano «scelto» valgono i suoi turni
--    (la scelta del piano e' la decisione dell'HR, anche se i turni restano
--    in stato bozza: al 05/11/2026 nessun turno e' «pubblicato»). Senza piano
--    scelto valgono i turni senza piano pubblicati o messi a mano, non le
--    proposte in bozza che il ricalcolo rifa'.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.timbrature_turni_ufficiali(p_company_id uuid, p_dal date, p_al date)
RETURNS TABLE (shift_id uuid, outlet_id uuid, employee_id uuid, data date, inizio time, fine time, pausa_minuti smallint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.outlet_id, s.employee_id, s.data, s.inizio, s.fine, s.pausa_minuti
    FROM public.shifts s
    LEFT JOIN public.shift_plans p
      ON p.outlet_id = s.outlet_id AND p.mese = date_trunc('month', s.data)::date AND p.stato = 'scelto'
   WHERE s.company_id = p_company_id
     AND s.data BETWEEN p_dal AND p_al
     AND s.stato <> 'annullato'
     AND ((p.id IS NOT NULL AND s.plan_id = p.id)
          OR (p.id IS NULL AND s.plan_id IS NULL AND (s.stato = 'pubblicato' OR s.origine = 'manuale')));
$$;
REVOKE ALL ON FUNCTION public.timbrature_turni_ufficiali(uuid, date, date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timbrature_turni_ufficiali(uuid, date, date) TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 7a. RPC del cellulare del negozio
-- ─────────────────────────────────────────────────────────────────────
-- Puo' timbrare: l'account di cassa del negozio, o chi gestisce le presenze.
CREATE OR REPLACE FUNCTION public.timbrature_puo_timbrare(p_outlet_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_outlet_access(p_outlet_id)
     AND (COALESCE((SELECT public.get_my_role())::text, '') = 'operatore_cassa' OR public.timbrature_gestore())
     AND EXISTS (SELECT 1 FROM public.outlets o WHERE o.id = p_outlet_id AND o.company_id = (SELECT public.get_my_company_id()));
$$;
REVOKE ALL ON FUNCTION public.timbrature_puo_timbrare(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.timbrature_puo_timbrare(uuid) TO authenticated;

-- I negozi in cui l'utente puo' timbrare e dove le timbrature sono accese.
CREATE OR REPLACE FUNCTION public.timbratrice_negozi()
RETURNS TABLE (outlet_id uuid, nome text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.name
    FROM public.outlets o
    JOIN public.attendance_settings a ON a.outlet_id = o.id AND a.attive
   WHERE o.company_id = (SELECT public.get_my_company_id())
     AND public.timbrature_puo_timbrare(o.id)
   ORDER BY o.name;
$$;
REVOKE ALL ON FUNCTION public.timbratrice_negozi() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.timbratrice_negozi() TO authenticated;

-- Quello che il cellulare del negozio tiene in memoria per lavorare offline:
-- persone, turni della settimana, timbrature di oggi, ora del server.
CREATE OR REPLACE FUNCTION public.timbratrice_dati(p_outlet_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := (SELECT public.get_my_company_id());
  v_oggi    date := (now() AT TIME ZONE 'Europe/Rome')::date;
  v_out     jsonb;
BEGIN
  IF NOT public.timbrature_puo_timbrare(p_outlet_id) THEN
    RAISE EXCEPTION 'Non puoi timbrare in questo negozio' USING ERRCODE = '42501';
  END IF;

  WITH turni AS (
    SELECT * FROM public.timbrature_turni_ufficiali(v_company, v_oggi - 1, v_oggi + 7) t
     WHERE t.outlet_id = p_outlet_id
  ), persone AS (
    SELECT e.id, trim(COALESCE(e.nome, e.first_name, '') || ' ' || COALESCE(e.cognome, e.last_name, '')) AS nome
      FROM public.employees e
     WHERE e.company_id = v_company
       AND ((e.outlet_id = p_outlet_id AND COALESCE(e.is_active, true))
            OR e.id IN (SELECT employee_id FROM turni))
  )
  SELECT jsonb_build_object(
    'ora_server', now(),
    'outlet', (SELECT jsonb_build_object('id', o.id, 'nome', o.name) FROM public.outlets o WHERE o.id = p_outlet_id),
    'margine_uscita_minuti', COALESCE((SELECT a.margine_uscita_minuti FROM public.attendance_settings a WHERE a.outlet_id = p_outlet_id), 30),
    'persone', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome) ORDER BY p.nome) FROM persone p), '[]'::jsonb),
    'turni', COALESCE((SELECT jsonb_agg(jsonb_build_object('employee_id', t.employee_id, 'data', t.data, 'inizio', t.inizio, 'fine', t.fine, 'pausa_minuti', t.pausa_minuti) ORDER BY t.data, t.inizio) FROM turni t), '[]'::jsonb),
    'timbrature', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'employee_id', a.employee_id, 'tipo', a.tipo, 'ora', a.ora) ORDER BY a.ora)
                              FROM public.attendance_punches a
                             WHERE a.outlet_id = p_outlet_id AND NOT a.annullata
                               AND a.ora >= ((v_oggi - 1)::timestamp AT TIME ZONE 'Europe/Rome')), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.timbratrice_dati(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.timbratrice_dati(uuid) TO authenticated;

-- Firma del QR (stessa formula di src/lib/timbrature.ts).
CREATE OR REPLACE FUNCTION public.timbrature_firma(p_segreto text, p_employee_id uuid, p_passo bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT left(encode(extensions.hmac(convert_to(p_employee_id::text || '.' || p_passo::text, 'UTF8'),
                                     decode(p_segreto, 'hex'), 'sha256'), 'hex'), 16);
$$;
REVOKE ALL ON FUNCTION public.timbrature_firma(text, uuid, bigint) FROM public, anon, authenticated;

-- Registra le timbrature arrivate dal cellulare del negozio (anche in blocco,
-- dopo un periodo offline). Ripetibile: lo stesso id non si salva due volte.
-- p_righe: [{ id, outlet_id, codice, tipo, ora_dispositivo, scarto_secondi, dispositivo_id, sequenza }]
CREATE OR REPLACE FUNCTION public.timbrature_registra(p_righe jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := (SELECT public.get_my_company_id());
  r         jsonb;
  v_parti   text[];
  v_emp     uuid;
  v_passo   bigint;
  v_segreto text;
  v_disp    timestamptz;
  v_scarto  integer;
  v_ora     timestamptz;
  v_verifica text;
  v_esiti   jsonb := '[]'::jsonb;
  v_outlet  uuid;
BEGIN
  IF jsonb_typeof(p_righe) <> 'array' OR jsonb_array_length(p_righe) > 500 THEN
    RAISE EXCEPTION 'Formato non valido' USING ERRCODE = '22023';
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_righe) LOOP
   -- Ogni riga da sola: una riga rovinata non deve fermare le altre
   -- (la coda del negozio riproverebbe all'infinito lo stesso lotto).
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

    SELECT a.segreto INTO v_segreto
      FROM public.employee_app_access a
      JOIN public.employees e ON e.id = a.employee_id
     WHERE a.employee_id = v_emp AND e.company_id = v_company;
    IF NOT FOUND THEN
      v_esiti := v_esiti || jsonb_build_object('id', r->>'id', 'esito', 'persona_sconosciuta');
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
      -- Arrivata molto dopo: l'ora la dichiara solo il telefono, la guarda l'HR.
      v_verifica := 'da_confermare';
    ELSE
      v_verifica := 'ok';
    END IF;

    INSERT INTO public.attendance_punches
      (id, company_id, outlet_id, employee_id, tipo, ora, ora_dispositivo, scarto_secondi,
       dispositivo_id, sequenza, origine, verifica)
    VALUES
      ((r->>'id')::uuid, v_company, v_outlet, v_emp, r->>'tipo', v_ora, v_disp, v_scarto,
       left(r->>'dispositivo_id', 80), (r->>'sequenza')::integer, 'cellulare_negozio', v_verifica)
    ON CONFLICT (id) DO NOTHING;

    v_esiti := v_esiti || jsonb_build_object('id', r->>'id', 'esito', 'salvata', 'verifica', v_verifica);
   EXCEPTION WHEN others THEN
    v_esiti := v_esiti || jsonb_build_object('id', r->>'id', 'esito', 'riga_non_valida', 'errore', left(SQLERRM, 200));
   END;
  END LOOP;

  RETURN jsonb_build_object('ora_server', now(), 'esiti', v_esiti);
END;
$$;
REVOKE ALL ON FUNCTION public.timbrature_registra(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.timbrature_registra(jsonb) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 7b. RPC del dipendente (la sua app)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.app_dipendente_oggi()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp   uuid := public.timbrature_mio_dipendente();
  v_comp  uuid;
  v_oggi  date := (now() AT TIME ZONE 'Europe/Rome')::date;
  v_out   jsonb;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Accesso non collegato a un dipendente' USING ERRCODE = '42501';
  END IF;
  SELECT company_id INTO v_comp FROM public.employees WHERE id = v_emp;

  SELECT jsonb_build_object(
    'ora_server', now(),
    'persona', (SELECT jsonb_build_object('id', e.id,
                  'nome', trim(COALESCE(e.nome, e.first_name, '') || ' ' || COALESCE(e.cognome, e.last_name, '')),
                  'negozio', (SELECT o.name FROM public.outlets o WHERE o.id = e.outlet_id))
                  FROM public.employees e WHERE e.id = v_emp),
    'turni', COALESCE((SELECT jsonb_agg(jsonb_build_object('data', t.data, 'inizio', t.inizio, 'fine', t.fine,
                         'pausa_minuti', t.pausa_minuti,
                         'negozio', (SELECT o.name FROM public.outlets o WHERE o.id = t.outlet_id)) ORDER BY t.data, t.inizio)
                         FROM public.timbrature_turni_ufficiali(v_comp, v_oggi - 1, v_oggi + 13) t
                        WHERE t.employee_id = v_emp), '[]'::jsonb),
    'timbrature', COALESCE((SELECT jsonb_agg(jsonb_build_object('tipo', a.tipo, 'ora', a.ora, 'origine', a.origine) ORDER BY a.ora)
                              FROM public.attendance_punches a
                             WHERE a.employee_id = v_emp AND NOT a.annullata
                               AND a.ora >= ((v_oggi - 1)::timestamp AT TIME ZONE 'Europe/Rome')), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.app_dipendente_oggi() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_dipendente_oggi() TO authenticated;

-- Il dipendente segna l'ora d'uscita che non ha timbrato (oggi o ieri).
-- Resta «da confermare»: la decide chi gestisce le presenze.
CREATE OR REPLACE FUNCTION public.app_dipendente_dichiara_uscita(p_data date, p_ora time, p_nota text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp    uuid := public.timbrature_mio_dipendente();
  v_comp   uuid;
  v_outlet uuid;
  v_oggi   date := (now() AT TIME ZONE 'Europe/Rome')::date;
  v_ora    timestamptz := (p_data + p_ora) AT TIME ZONE 'Europe/Rome';
  v_ultima text;
  v_ultima_ora timestamptz;
  v_id     uuid := gen_random_uuid();
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Accesso non collegato a un dipendente' USING ERRCODE = '42501';
  END IF;
  IF p_data NOT IN (v_oggi, v_oggi - 1) OR v_ora > now() THEN
    RAISE EXCEPTION 'Si puo'' segnare solo l''uscita di oggi o di ieri, non nel futuro' USING ERRCODE = '22023';
  END IF;

  SELECT a.tipo, a.outlet_id, a.ora INTO v_ultima, v_outlet, v_ultima_ora
    FROM public.attendance_punches a
   WHERE a.employee_id = v_emp AND NOT a.annullata
     AND a.ora >= (p_data::timestamp AT TIME ZONE 'Europe/Rome')
     AND a.ora <  ((p_data + 1)::timestamp AT TIME ZONE 'Europe/Rome')
   ORDER BY a.ora DESC LIMIT 1;
  IF v_ultima IS NULL OR v_ultima = 'uscita' THEN
    RAISE EXCEPTION 'Per quel giorno non risulta un''uscita da segnare' USING ERRCODE = '22023';
  END IF;
  IF v_ora <= v_ultima_ora THEN
    RAISE EXCEPTION 'L''uscita deve venire dopo l''ultima timbratura (%)', to_char(v_ultima_ora AT TIME ZONE 'Europe/Rome', 'HH24:MI') USING ERRCODE = '22023';
  END IF;

  SELECT company_id INTO v_comp FROM public.employees WHERE id = v_emp;
  INSERT INTO public.attendance_punches (id, company_id, outlet_id, employee_id, tipo, ora, origine, verifica, nota)
  VALUES (v_id, v_comp, v_outlet, v_emp, 'uscita', v_ora, 'dichiarata', 'da_confermare', left(p_nota, 500));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.app_dipendente_dichiara_uscita(date, time, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_dipendente_dichiara_uscita(date, time, text) TO authenticated;

-- Attivazione: lo chiama SOLO la Edge Function app-dipendente-attiva (service
-- role). Consuma il codice e crea un segreto nuovo: il telefono di prima
-- smette di funzionare.
CREATE OR REPLACE FUNCTION public.app_dipendente_consuma_codice(p_codice text)
RETURNS TABLE (employee_id uuid, company_id uuid, segreto text, nome text, cognome text, user_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_emp uuid;
BEGIN
  SELECT a.employee_id INTO v_emp
    FROM public.employee_app_access a
   WHERE a.codice = upper(trim(p_codice)) AND a.codice_scade > now()
   FOR UPDATE;
  IF v_emp IS NULL THEN RETURN; END IF;

  UPDATE public.employee_app_access a
     SET segreto = encode(extensions.gen_random_bytes(20), 'hex'),
         codice = NULL, codice_scade = NULL, attivata_il = now(), updated_at = now()
   WHERE a.employee_id = v_emp;

  RETURN QUERY
  SELECT e.id, e.company_id, a.segreto,
         COALESCE(e.nome, e.first_name), COALESCE(e.cognome, e.last_name), e.user_id
    FROM public.employees e JOIN public.employee_app_access a ON a.employee_id = e.id
   WHERE e.id = v_emp;
END;
$$;
REVOKE ALL ON FUNCTION public.app_dipendente_consuma_codice(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_dipendente_consuma_codice(text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 7c. RPC per l'HR (pagina Dipendenti → Presenze)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.app_accessi_elenco(p_outlet_id uuid)
RETURNS TABLE (employee_id uuid, nome text, telefono_whatsapp text, codice text, codice_scade timestamptz, attivata_il timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.timbrature_gestore() THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT e.id, trim(COALESCE(e.nome, e.first_name, '') || ' ' || COALESCE(e.cognome, e.last_name, '')),
         e.telefono_whatsapp, a.codice, a.codice_scade, a.attivata_il
    FROM public.employees e
    LEFT JOIN public.employee_app_access a ON a.employee_id = e.id
   WHERE e.company_id = (SELECT public.get_my_company_id())
     AND e.outlet_id = p_outlet_id AND COALESCE(e.is_active, true)
   ORDER BY 2;
END;
$$;
REVOKE ALL ON FUNCTION public.app_accessi_elenco(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_accessi_elenco(uuid) TO authenticated;

-- Codice nuovo (telefono cambiato, codice scaduto). Il segreto cambia
-- all'attivazione, non qui: finche' il codice non si usa, il telefono di
-- prima continua a funzionare.
CREATE OR REPLACE FUNCTION public.app_accesso_nuovo_codice(p_employee_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_comp uuid;
  v_cod  text := public.timbrature_nuovo_codice();
BEGIN
  IF NOT public.timbrature_gestore() THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  SELECT company_id INTO v_comp FROM public.employees
   WHERE id = p_employee_id AND company_id = (SELECT public.get_my_company_id());
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'Dipendente non trovato' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.employee_app_access (employee_id, company_id, segreto, codice, codice_scade)
  VALUES (p_employee_id, v_comp, encode(extensions.gen_random_bytes(20), 'hex'), v_cod, now() + interval '30 days')
  ON CONFLICT (employee_id) DO UPDATE
     SET codice = EXCLUDED.codice, codice_scade = EXCLUDED.codice_scade, updated_at = now();
  RETURN v_cod;
END;
$$;
REVOKE ALL ON FUNCTION public.app_accesso_nuovo_codice(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_accesso_nuovo_codice(uuid) TO authenticated;

-- Annulla una timbratura sbagliata (resta nello storico con il motivo).
CREATE OR REPLACE FUNCTION public.timbrature_annulla(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.timbrature_gestore() THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(trim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Serve il motivo' USING ERRCODE = '22023';
  END IF;
  UPDATE public.attendance_punches
     SET annullata = true, annullata_motivo = left(p_motivo, 500), annullata_da = auth.uid(), annullata_il = now()
   WHERE id = p_id AND company_id = (SELECT public.get_my_company_id()) AND NOT annullata;
END;
$$;
REVOKE ALL ON FUNCTION public.timbrature_annulla(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.timbrature_annulla(uuid, text) TO authenticated;

-- Conferma un'uscita dichiarata dal dipendente.
CREATE OR REPLACE FUNCTION public.timbrature_conferma(p_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.timbrature_gestore() THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  UPDATE public.attendance_punches
     SET verifica = 'manuale', nota = trim(COALESCE(nota, '') || ' [confermata il ' || to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY HH24:MI') || ']')
   WHERE id = p_id AND company_id = (SELECT public.get_my_company_id()) AND verifica = 'da_confermare' AND NOT annullata;
END;
$$;
REVOKE ALL ON FUNCTION public.timbrature_conferma(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.timbrature_conferma(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 8. Avvisi «uscita non timbrata»
-- ─────────────────────────────────────────────────────────────────────
-- Turni finiti da piu' del margine (30') in cui la persona risulta ancora
-- dentro (ultima timbratura entrata o pausa) e non e' gia' stata avvisata.
-- Chi non ha timbrato niente non riceve l'avviso: puo' essere in ferie.
-- Se la persona ha un altro turno che comincia entro un'ora, niente avviso.
CREATE OR REPLACE FUNCTION public.timbrature_da_avvisare(p_now timestamptz DEFAULT now())
RETURNS TABLE (company_id uuid, outlet_id uuid, employee_id uuid, shift_id uuid, data date, fine time,
               nome text, telefono text, negozio text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH oggi AS (SELECT (p_now AT TIME ZONE 'Europe/Rome')::date AS d),
  negozi AS (
    SELECT a.outlet_id, a.company_id, a.margine_uscita_minuti
      FROM public.attendance_settings a WHERE a.attive AND a.avvisi_whatsapp
  ),
  turni AS (
    SELECT t.*, n.margine_uscita_minuti, n.company_id AS cid,
           ((t.data + t.fine) AT TIME ZONE 'Europe/Rome') AS fine_ts,
           ((t.data + t.inizio) AT TIME ZONE 'Europe/Rome') AS inizio_ts
      FROM negozi n, oggi,
           LATERAL public.timbrature_turni_ufficiali(n.company_id, oggi.d - 1, oggi.d) t
     WHERE t.outlet_id = n.outlet_id
  )
  SELECT t.cid, t.outlet_id, t.employee_id, t.shift_id, t.data, t.fine,
         COALESCE(e.nome, e.first_name), e.telefono_whatsapp, o.name
    FROM turni t
    JOIN public.employees e ON e.id = t.employee_id
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
                        AND ((t2.data + t2.inizio) AT TIME ZONE 'Europe/Rome') BETWEEN t.fine_ts AND t.fine_ts + interval '60 minutes')
     AND (SELECT a.tipo FROM public.attendance_punches a
           WHERE a.employee_id = t.employee_id AND NOT a.annullata
             AND a.ora >= t.inizio_ts - interval '3 hours' AND a.ora <= p_now
           ORDER BY a.ora DESC LIMIT 1) IN ('entrata', 'inizio_pausa', 'fine_pausa');
$$;
REVOKE ALL ON FUNCTION public.timbrature_da_avvisare(timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timbrature_da_avvisare(timestamptz) TO service_role;

-- Il cron chiama la Edge Function timbrature-avvisi solo se c'e' qualcuno
-- da avvisare (stesso schema di closing_checks_dispatch, migration 342).
CREATE OR REPLACE FUNCTION public.timbrature_avvisi_tick()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net', 'vault', 'pg_temp'
AS $function$
DECLARE
  v_secret  text;
  v_url     text;
  v_anon    text;
  v_request bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.timbrature_da_avvisare(now())) THEN
    RETURN NULL;
  END IF;
  SELECT decrypted_secret::text INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'autofix_cron_secret' LIMIT 1;
  SELECT replace(function_url, 'daily-cash-report-send', 'timbrature-avvisi'), anon_key
    INTO v_url, v_anon FROM public.daily_report_endpoint();
  IF v_secret IS NULL OR v_url IS NULL OR v_anon IS NULL THEN
    RAISE NOTICE 'timbrature_avvisi_tick: segreto o endpoint mancante, nessun invio';
    RETURN NULL;
  END IF;
  SELECT net.http_post(
    url     := v_url,
    body    := jsonb_build_object('at', now()),
    params  := '{}'::jsonb,
    headers := jsonb_build_object(
                 'Content-Type',   'application/json',
                 'Authorization',  'Bearer ' || v_anon,
                 'apikey',         v_anon,
                 'x-autofix-cron', v_secret),
    timeout_milliseconds := 60000
  ) INTO v_request;
  RETURN v_request;
END;
$function$;
REVOKE ALL ON FUNCTION public.timbrature_avvisi_tick() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timbrature_avvisi_tick() TO service_role;

-- Segreto Twilio del modello WhatsApp delle timbrature (letto dalla Edge
-- Function; il valore lo inserisce Patrizio nel Vault quando Meta approva il
-- modello: twilio_whatsapp_timbrature_content_sid).
CREATE OR REPLACE FUNCTION public.get_twilio_timbrature_template()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret::text FROM vault.decrypted_secrets WHERE name = 'twilio_whatsapp_timbrature_content_sid' LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_twilio_timbrature_template() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_twilio_timbrature_template() TO service_role;

COMMIT;

-- Il cron sta fuori dalla transazione
SELECT cron.schedule('timbrature-avvisi-tick', '*/10 * * * *',
  $cron$SELECT public.timbrature_avvisi_tick();$cron$);

-- Verifica, su ogni tenant:
-- SELECT has_table_privilege('authenticated','public.attendance_punches','select') AS auth,
--        has_table_privilege('service_role','public.attendance_punches','insert') AS srv;
-- SELECT count(*) FROM public.employee_app_access;            -- = dipendenti attivi
-- SELECT jobname, schedule FROM cron.job WHERE jobname = 'timbrature-avvisi-tick';
