-- 466 · Avvisi dei turni sul telefono e cambi d'orario nel registro (Patrizio, 25/11/2026)
--
-- «sì aggiungile tutte e due»: quando un turno pubblicato cambia o viene tolto la dipendente
-- lo deve sapere, nell'app (anche dal computer) e con la notifica sul telefono; e il cambio
-- d'orario di un turno pubblicato deve lasciare traccia come i turni tolti.
--
-- 1. Registro (424): oltre ad annullato, ritirato e cancellato c'e' «cambiato», con il turno
--    di prima (`turno`) e quello di dopo (`dopo`). Lo scrive il database.
-- 2. `turni_avvisi`: una riga per ogni turno pubblicato che arriva, cambia o se ne va, per la
--    persona interessata, solo da oggi in poi (ora di Roma). La legge l'app (`app_dipendente_avvisi_turni`)
--    e la manda sul telefono la Edge Function `turni-notifiche`, che raccoglie in un solo
--    messaggio tutto quello che e' cambiato per una persona (pubblicare una settimana = un avviso).
-- 3. Cron `turni-avvisi-tick` ogni 2 minuti: chiama la funzione solo se una persona ha avvisi
--    fermi da almeno 2 minuti (cosi' una serie di modifiche di seguito parte in un messaggio solo);
--    un turno tolto aspetta 15 minuti, nel caso venga ripubblicato uguale.
--
-- Additiva: nessun dato esistente cambia. Solo NZ e Zago (Made fuori dal 03/11/2026).

BEGIN;

-- ─── 1. Registro: anche il cambio d'orario ──────────────────────────────────
ALTER TABLE public.turni_pubblicati_tolti DROP CONSTRAINT IF EXISTS turni_pubblicati_tolti_azione_check;
ALTER TABLE public.turni_pubblicati_tolti ADD CONSTRAINT turni_pubblicati_tolti_azione_check
  CHECK (azione IN ('annullato', 'ritirato', 'cancellato', 'cambiato'));
ALTER TABLE public.turni_pubblicati_tolti ADD COLUMN IF NOT EXISTS dopo jsonb;
COMMENT ON COLUMN public.turni_pubblicati_tolti.dopo IS
  'Solo per «cambiato»: il turno dopo la modifica (migration 466). `turno` resta quello di prima.';

-- ─── 2. Avvisi dei turni ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.turni_avvisi (
  id           bigserial PRIMARY KEY,
  company_id   uuid NOT NULL REFERENCES public.companies(id),
  employee_id  uuid NOT NULL,
  shift_id     uuid NOT NULL,
  outlet_id    uuid,
  data         date NOT NULL,
  tipo         text NOT NULL CHECK (tipo IN ('pubblicato', 'cambiato', 'tolto')),
  prima        jsonb,
  dopo         jsonb,
  creato_il    timestamptz NOT NULL DEFAULT now(),
  inviato_il   timestamptz,
  esito        text,
  errore       text,
  telefoni     integer,
  letto_il     timestamptz
);
CREATE INDEX IF NOT EXISTS turni_avvisi_persona_idx ON public.turni_avvisi (employee_id, creato_il DESC);
CREATE INDEX IF NOT EXISTS turni_avvisi_da_mandare_idx ON public.turni_avvisi (creato_il) WHERE inviato_il IS NULL;
COMMENT ON TABLE public.turni_avvisi IS
  'Turni pubblicati arrivati, cambiati o tolti, per avvisare la persona in app e sul telefono (migration 466).';

ALTER TABLE public.turni_avvisi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cash_operator_block ON public.turni_avvisi;
CREATE POLICY cash_operator_block ON public.turni_avvisi AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa');
DROP POLICY IF EXISTS dipendente_block ON public.turni_avvisi;
CREATE POLICY dipendente_block ON public.turni_avvisi AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente');
DROP POLICY IF EXISTS responsabile_block ON public.turni_avvisi;
CREATE POLICY responsabile_block ON public.turni_avvisi AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'responsabile')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'responsabile');
DROP POLICY IF EXISTS solo_con_profilo ON public.turni_avvisi;
CREATE POLICY solo_con_profilo ON public.turni_avvisi AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.get_my_role()) IS NOT NULL)
  WITH CHECK ((SELECT public.get_my_role()) IS NOT NULL);
DROP POLICY IF EXISTS turni_avvisi_select ON public.turni_avvisi;
CREATE POLICY turni_avvisi_select ON public.turni_avvisi FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()));
DROP POLICY IF EXISTS demo_nascosto ON public.turni_avvisi;
CREATE POLICY demo_nascosto ON public.turni_avvisi AS RESTRICTIVE FOR ALL TO authenticated
  USING (employee_id <> ALL ((SELECT public.dipendenti_demo_ids())::uuid[]))
  WITH CHECK (employee_id <> ALL ((SELECT public.dipendenti_demo_ids())::uuid[]));
-- Scrive solo il database (trigger) e la Edge Function con la chiave di servizio.
REVOKE ALL ON public.turni_avvisi FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.turni_avvisi TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.turni_avvisi TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.turni_avvisi_id_seq TO service_role;

-- ─── Trigger: registro dei cambi e avvisi ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.shifts_avvisi_e_cambi() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_oggi date := (now() AT TIME ZONE 'Europe/Rome')::date;
  v_nome text;
  v_prima jsonb;
  v_dopo  jsonb;
  v_era_pub  boolean := TG_OP IN ('UPDATE', 'DELETE') AND OLD.stato = 'pubblicato';
  v_ora_pub  boolean := TG_OP IN ('INSERT', 'UPDATE') AND NEW.stato = 'pubblicato';
BEGIN
  -- Le bozze (quasi tutte le scritture: piano, ricalcolo, proposte) escono subito
  IF NOT (v_era_pub OR v_ora_pub) THEN
    RETURN NULL;
  END IF;
  IF v_era_pub THEN
    v_prima := jsonb_build_object('inizio', OLD.inizio, 'fine', OLD.fine, 'data', OLD.data, 'outlet_id', OLD.outlet_id);
  END IF;
  IF v_ora_pub THEN
    v_dopo := jsonb_build_object('inizio', NEW.inizio, 'fine', NEW.fine, 'data', NEW.data, 'outlet_id', NEW.outlet_id);
  END IF;

  -- Pubblicato prima e dopo: conta solo se cambia orario, giorno, negozio o persona
  IF v_era_pub AND v_ora_pub AND NOT (
       OLD.data IS DISTINCT FROM NEW.data OR OLD.inizio IS DISTINCT FROM NEW.inizio OR OLD.fine IS DISTINCT FROM NEW.fine
       OR OLD.outlet_id IS DISTINCT FROM NEW.outlet_id OR OLD.employee_id IS DISTINCT FROM NEW.employee_id) THEN
    RETURN NULL;
  END IF;

  IF v_era_pub AND v_ora_pub THEN
    -- Il cambio resta scritto nel registro, come i turni tolti (424)
    SELECT NULLIF(btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') INTO v_nome
      FROM public.user_profiles u WHERE u.id = (SELECT auth.uid());
    INSERT INTO public.turni_pubblicati_tolti
      (company_id, shift_id, outlet_id, employee_id, data, inizio, fine, azione, motivo, turno, dopo, utente_id, utente_nome)
    VALUES (OLD.company_id, OLD.id, OLD.outlet_id, OLD.employee_id, OLD.data, OLD.inizio, OLD.fine, 'cambiato', NULL,
            to_jsonb(OLD), to_jsonb(NEW), (SELECT auth.uid()), v_nome);

    IF OLD.employee_id IS DISTINCT FROM NEW.employee_id THEN
      -- Passato a un'altra persona: per chi lo aveva e' tolto, per chi lo riceve e' nuovo
      IF OLD.data >= v_oggi THEN
        INSERT INTO public.turni_avvisi (company_id, employee_id, shift_id, outlet_id, data, tipo, prima)
        VALUES (OLD.company_id, OLD.employee_id, OLD.id, OLD.outlet_id, OLD.data, 'tolto', v_prima);
      END IF;
      IF NEW.data >= v_oggi THEN
        INSERT INTO public.turni_avvisi (company_id, employee_id, shift_id, outlet_id, data, tipo, dopo)
        VALUES (NEW.company_id, NEW.employee_id, NEW.id, NEW.outlet_id, NEW.data, 'pubblicato', v_dopo);
      END IF;
    ELSIF GREATEST(OLD.data, NEW.data) >= v_oggi THEN
      INSERT INTO public.turni_avvisi (company_id, employee_id, shift_id, outlet_id, data, tipo, prima, dopo)
      VALUES (NEW.company_id, NEW.employee_id, NEW.id, NEW.outlet_id, NEW.data, 'cambiato', v_prima, v_dopo);
    END IF;
    RETURN NULL;
  END IF;

  IF v_ora_pub AND NEW.data >= v_oggi THEN
    INSERT INTO public.turni_avvisi (company_id, employee_id, shift_id, outlet_id, data, tipo, dopo)
    VALUES (NEW.company_id, NEW.employee_id, NEW.id, NEW.outlet_id, NEW.data, 'pubblicato', v_dopo);
  ELSIF v_era_pub AND OLD.data >= v_oggi THEN
    INSERT INTO public.turni_avvisi (company_id, employee_id, shift_id, outlet_id, data, tipo, prima)
    VALUES (OLD.company_id, OLD.employee_id, OLD.id, OLD.outlet_id, OLD.data, 'tolto', v_prima);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.shifts_avvisi_e_cambi() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shifts_avvisi_e_cambi ON public.shifts;
CREATE TRIGGER trg_shifts_avvisi_e_cambi AFTER INSERT OR UPDATE OR DELETE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.shifts_avvisi_e_cambi();

-- ─── Cosa mandare: le persone ferme da almeno 2 minuti ──────────────────────
CREATE OR REPLACE FUNCTION public.turni_avvisi_da_mandare()
RETURNS TABLE (id bigint, company_id uuid, employee_id uuid, shift_id uuid, data date, tipo text,
               prima jsonb, dopo jsonb, creato_il timestamptz, negozio text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.company_id, a.employee_id, a.shift_id, a.data, a.tipo, a.prima, a.dopo, a.creato_il,
         (SELECT o.name FROM public.outlets o WHERE o.id = a.outlet_id)
    FROM public.turni_avvisi a
   WHERE a.inviato_il IS NULL
     AND a.creato_il > now() - interval '2 days'
     AND NOT EXISTS (SELECT 1 FROM public.turni_avvisi b
                      WHERE b.employee_id = a.employee_id AND b.inviato_il IS NULL
                        AND b.creato_il > now() - interval '2 minutes')
     -- Un turno tolto aspetta 15 minuti: se si ritira una settimana per correggerla e la si
     -- ripubblica uguale, «tolto» e «pubblicato» partono insieme e si annullano (revisori, 25/11/2026)
     AND NOT EXISTS (SELECT 1 FROM public.turni_avvisi c
                      WHERE c.employee_id = a.employee_id AND c.inviato_il IS NULL AND c.tipo = 'tolto'
                        AND c.creato_il > now() - interval '15 minutes')
   ORDER BY a.employee_id, a.creato_il, a.id
   LIMIT 2000;
$$;
REVOKE ALL ON FUNCTION public.turni_avvisi_da_mandare() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.turni_avvisi_da_mandare() TO service_role;

CREATE OR REPLACE FUNCTION public.turni_avvisi_tick()
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, net, vault, pg_temp AS $$
DECLARE
  v_secret  text;
  v_url     text;
  v_anon    text;
  v_request bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.turni_avvisi_da_mandare()) THEN
    RETURN NULL;
  END IF;
  SELECT decrypted_secret::text INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'autofix_cron_secret' LIMIT 1;
  SELECT replace(function_url, 'daily-cash-report-send', 'turni-notifiche'), anon_key
    INTO v_url, v_anon FROM public.daily_report_endpoint();
  IF v_secret IS NULL OR v_url IS NULL OR v_anon IS NULL THEN
    RAISE NOTICE 'turni_avvisi_tick: segreto o endpoint mancante, nessun invio';
    RETURN NULL;
  END IF;
  SELECT net.http_post(
    url     := v_url,
    body    := jsonb_build_object('at', now()),
    params  := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon,
                                  'apikey', v_anon, 'x-autofix-cron', v_secret),
    timeout_milliseconds := 60000
  ) INTO v_request;
  RETURN v_request;
END $$;
REVOKE ALL ON FUNCTION public.turni_avvisi_tick() FROM PUBLIC, anon, authenticated;

-- ─── App del dipendente: i miei avvisi e «ho visto» ─────────────────────────
CREATE OR REPLACE FUNCTION public.app_dipendente_avvisi_turni()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_emp uuid := public.timbrature_mio_dipendente();
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Accesso non collegato a un dipendente' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', a.id, 'shift_id', a.shift_id, 'tipo', a.tipo, 'data', a.data, 'prima', a.prima, 'dopo', a.dopo,
                     'negozio', (SELECT o.name FROM public.outlets o WHERE o.id = a.outlet_id),
                     'creato_il', a.creato_il, 'letto', a.letto_il IS NOT NULL) ORDER BY a.creato_il DESC, a.id DESC)
      FROM (SELECT * FROM public.turni_avvisi x
             WHERE x.employee_id = v_emp AND x.creato_il > now() - interval '30 days'
             ORDER BY x.creato_il DESC, x.id DESC LIMIT 60) a), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.app_dipendente_avvisi_turni() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_dipendente_avvisi_turni() TO authenticated, service_role;

-- p_ids: gli avvisi che la dipendente ha visto a schermo; NULL = tutti i suoi
CREATE OR REPLACE FUNCTION public.app_dipendente_avvisi_turni_letti(p_ids bigint[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_emp uuid := public.timbrature_mio_dipendente();
  v_n   integer;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Accesso non collegato a un dipendente' USING ERRCODE = '42501';
  END IF;
  UPDATE public.turni_avvisi SET letto_il = now()
   WHERE employee_id = v_emp AND letto_il IS NULL AND (p_ids IS NULL OR id = ANY (p_ids));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.app_dipendente_avvisi_turni_letti(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_dipendente_avvisi_turni_letti(bigint[]) TO authenticated, service_role;

COMMIT;

-- ─── 3. Cron (fuori dalla transazione) ──────────────────────────────────────
SELECT cron.unschedule('turni-avvisi-tick') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'turni-avvisi-tick');
SELECT cron.schedule('turni-avvisi-tick', '*/2 * * * *', 'SELECT public.turni_avvisi_tick();');

-- Verifica:
-- SELECT has_table_privilege('authenticated','public.turni_avvisi','select') auth,
--        has_table_privilege('service_role','public.turni_avvisi','insert') srv,
--        (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_shifts_avvisi_e_cambi') trg,
--        (SELECT schedule FROM cron.job WHERE jobname = 'turni-avvisi-tick') cron;
