-- =====================================================================
-- Migrazione 251 — Fase 2 del piano ferie: la richiesta
-- =====================================================================
-- DOVE ERAVAMO: la 248 ha portato dentro il residuo vero di ogni persona,
-- letto dal tabulato delle paghe. Un saldo che nessuno puo' ancora usare,
-- perche' non esiste il posto dove si chiedono le ferie.
--
-- COSA INTRODUCE:
--   1. leave_requests — una richiesta: di chi e', per quale outlet, in che
--      stato, chi l'ha materialmente compilata. Finche' i dipendenti non
--      hanno un accesso, la compila l'amministrazione per conto loro a
--      partire dal modulo che ricevono: per questo esistono origine e
--      compilata_da, cosi' si sa sempre da dove arriva un dato.
--   2. leave_request_days — un giorno chiesto: data, voce (ferie, ex
--      festivita', ROL), giornata intera / mezza / un numero di ore, e le
--      ore effettive. Le ore sono sempre valorizzate, anche per la
--      giornata intera: un conto in ore non deve dipendere da chi legge.
--   3. leave_request_events — la traccia. Ogni cambio di stato la scrive
--      da solo, via trigger: se domani qualcuno chiede "chi ha approvato
--      e quando", la risposta non dipende dal fatto che il frontend si
--      sia ricordato di scriverla.
--   4. v_leave_disponibilita — quante ore restano davvero: il residuo
--      delle paghe meno quello che e' gia' stato chiesto o approvato qui
--      dentro.
--
-- IL DOPPIO CONTEGGIO, E COME SI EVITA: il tabulato porta una data di
-- saldo (fine mese elaborato) e il goduto fino a quel giorno c'e' gia'
-- dentro. Scalano quindi solo i giorni che cadono DOPO quella data. Un
-- giorno anteriore non si sottrae due volte.
--
-- GLI STATI: bozza, inviata, approvata, approvata_parziale, respinta,
-- ritirata, chiusa. La fase 2 ne usa tre (bozza, inviata, ritirata); gli
-- altri sono gia' previsti qui perche' l'approvazione della fase 3 non
-- debba toccare di nuovo lo schema. Solo le richieste inviate e quelle
-- approvate impegnano ore: una bozza non toglie niente a nessuno.
--
-- NO DATA LOSS: solo CREATE TABLE / CREATE VIEW. Una richiesta gia'
-- inviata non si cancella nemmeno volendo (trigger leave_requests_no_hard_delete):
-- si ritira, e resta a vedersi. Si cancellano solo le bozze.
-- REGOLA #0: da applicare su NZ + Made + Zago.
-- Rollback: 20260922_251_leave_requests_ROLLBACK.sql
-- =====================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. La richiesta
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leave_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id),
  employee_id       uuid NOT NULL REFERENCES public.employees(id),

  -- Outlet fotografato al momento della richiesta: le allocazioni cambiano,
  -- una richiesta del passato deve restare leggibile com'era.
  outlet_code       text,

  stato             text NOT NULL DEFAULT 'bozza'
                      CHECK (stato IN ('bozza', 'inviata', 'approvata',
                                       'approvata_parziale', 'respinta',
                                       'ritirata', 'chiusa')),
  titolo            text,
  note_dipendente   text,

  -- Da dove arriva: compilata qui dentro, oppure ricopiata da un modulo
  -- cartaceo o da una mail finche' i dipendenti non hanno un accesso.
  origine           text NOT NULL DEFAULT 'gestionale'
                      CHECK (origine IN ('gestionale', 'modulo_cartaceo', 'mail')),
  compilata_da      uuid REFERENCES auth.users(id),
  compilata_da_nome text,

  inviata_il        timestamptz,
  decisa_il         timestamptz,
  decisa_da         uuid REFERENCES auth.users(id),
  decisa_da_nome    text,
  motivazione       text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.leave_requests IS
  'Richiesta di ferie o permessi di un dipendente. Fase 2 del piano ferie: finche'' i dipendenti non hanno un accesso, la compila l''amministrazione (origine = modulo_cartaceo o mail).';
COMMENT ON COLUMN public.leave_requests.outlet_code IS
  'Outlet al momento della richiesta, copiato dalle allocazioni. Serve a rileggere il passato com''era.';

CREATE INDEX IF NOT EXISTS idx_leave_requests_company_emp
  ON public.leave_requests (company_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_stato
  ON public.leave_requests (company_id, stato);

-- ─────────────────────────────────────────────────────────────────────
-- 2. I giorni chiesti
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leave_request_days (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id),
  request_id   uuid NOT NULL REFERENCES public.leave_requests(id) ON DELETE CASCADE,

  data         date NOT NULL,
  voce         text NOT NULL CHECK (voce IN ('F01', 'F02', 'F03')),
  tipo         text NOT NULL CHECK (tipo IN ('giornata', 'mezza_giornata', 'ore')),

  -- Ore effettive: sempre presenti, anche per giornata e mezza giornata,
  -- calcolate dall'orario della persona. Il conto non deve dipendere da
  -- chi legge la riga.
  ore          numeric(6,2) NOT NULL CHECK (ore > 0 AND ore <= 24),

  stato        text NOT NULL DEFAULT 'richiesto'
                 CHECK (stato IN ('richiesto', 'approvato', 'respinto')),
  nota         text,
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- Lo stesso giorno non si chiede due volte per la stessa voce nella
  -- stessa richiesta.
  UNIQUE (request_id, data, voce)
);

COMMENT ON TABLE public.leave_request_days IS
  'Un giorno di una richiesta: data, voce (F01 ferie, F02 ex festivita'', F03 ROL), giornata intera / mezza / ore, e le ore effettive.';

CREATE INDEX IF NOT EXISTS idx_leave_request_days_req
  ON public.leave_request_days (request_id);
CREATE INDEX IF NOT EXISTS idx_leave_request_days_data
  ON public.leave_request_days (company_id, data);

-- ─────────────────────────────────────────────────────────────────────
-- 3. La traccia
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leave_request_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id),
  request_id   uuid NOT NULL REFERENCES public.leave_requests(id) ON DELETE CASCADE,

  evento       text NOT NULL,
  stato_da     text,
  stato_a      text,
  nota         text,
  dettaglio    jsonb,

  utente_id    uuid,
  utente_nome  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.leave_request_events IS
  'Storico di una richiesta. I cambi di stato li scrive il trigger leave_requests_traccia: la traccia non dipende dal frontend.';

CREATE INDEX IF NOT EXISTS idx_leave_request_events_req
  ON public.leave_request_events (request_id, created_at);

-- ─────────────────────────────────────────────────────────────────────
-- 4. Trigger: la traccia si scrive da sola
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.leave_requests_traccia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.leave_request_events
      (company_id, request_id, evento, stato_a, utente_id, utente_nome)
    VALUES (NEW.company_id, NEW.id, 'creata', NEW.stato, auth.uid(), NEW.compilata_da_nome);
    RETURN NEW;
  END IF;

  NEW.updated_at := now();

  IF NEW.stato IS DISTINCT FROM OLD.stato THEN
    INSERT INTO public.leave_request_events
      (company_id, request_id, evento, stato_da, stato_a, nota, utente_id)
    VALUES (NEW.company_id, NEW.id, NEW.stato, OLD.stato, NEW.stato,
            NEW.motivazione, auth.uid());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leave_requests_traccia_ins ON public.leave_requests;
CREATE TRIGGER trg_leave_requests_traccia_ins
  AFTER INSERT ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.leave_requests_traccia();

DROP TRIGGER IF EXISTS trg_leave_requests_traccia_upd ON public.leave_requests;
CREATE TRIGGER trg_leave_requests_traccia_upd
  BEFORE UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.leave_requests_traccia();

-- Una richiesta uscita dalla bozza non si cancella: si ritira.
CREATE OR REPLACE FUNCTION public.leave_requests_no_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.stato <> 'bozza' THEN
    RAISE EXCEPTION 'Una richiesta gia'' inviata non si cancella: va ritirata (stato = ritirata).';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_leave_requests_no_hard_delete ON public.leave_requests;
CREATE TRIGGER trg_leave_requests_no_hard_delete
  BEFORE DELETE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.leave_requests_no_hard_delete();

-- ─────────────────────────────────────────────────────────────────────
-- 5. Quante ore restano davvero
-- ─────────────────────────────────────────────────────────────────────
-- residuo        = quello che il tabulato dice alla sua data
-- impegnato      = ore chieste (inviate) o approvate DOPO quella data
-- disponibile    = residuo - impegnato
-- da_fruire      = residuo + quello che maturera' entro fine anno
--
-- Le bozze si contano a parte: si vedono, ma non tolgono niente.
CREATE OR REPLACE VIEW public.v_leave_disponibilita
WITH (security_invoker = on) AS
SELECT
  b.company_id,
  b.employee_id,
  b.voce,
  b.voce_label,
  b.saldo_alla_data,
  b.periodo_anno,
  b.periodo_mese,
  b.ore_settimanali_dedotte,
  b.ore_giornata_dedotte,
  b.residuo,
  b.da_fruire,
  COALESCE(r.ore_in_attesa, 0)  AS ore_in_attesa,
  COALESCE(r.ore_approvate, 0)  AS ore_approvate,
  COALESCE(r.ore_in_bozza, 0)   AS ore_in_bozza,
  b.residuo   - COALESCE(r.ore_in_attesa, 0) - COALESCE(r.ore_approvate, 0) AS residuo_disponibile,
  b.da_fruire - COALESCE(r.ore_in_attesa, 0) - COALESCE(r.ore_approvate, 0) AS da_fruire_disponibile
FROM public.v_leave_balances b
LEFT JOIN (
  SELECT
    d.company_id,
    q.employee_id,
    d.voce,
    b2.saldo_alla_data,
    SUM(d.ore) FILTER (
      WHERE q.stato = 'inviata' AND d.stato = 'richiesto'
    ) AS ore_in_attesa,
    SUM(d.ore) FILTER (
      WHERE q.stato IN ('approvata', 'approvata_parziale', 'chiusa') AND d.stato = 'approvato'
    ) AS ore_approvate,
    SUM(d.ore) FILTER (WHERE q.stato = 'bozza') AS ore_in_bozza
  FROM public.leave_request_days d
  JOIN public.leave_requests q ON q.id = d.request_id
  JOIN public.v_leave_balances b2
    ON b2.employee_id = q.employee_id AND b2.voce = d.voce
  WHERE q.stato <> 'ritirata'
    AND q.stato <> 'respinta'
    -- solo i giorni che le paghe non hanno ancora contato
    AND (b2.saldo_alla_data IS NULL OR d.data > b2.saldo_alla_data)
  GROUP BY d.company_id, q.employee_id, d.voce, b2.saldo_alla_data
) r ON r.employee_id = b.employee_id AND r.voce = b.voce;

COMMENT ON VIEW public.v_leave_disponibilita IS
  'Residuo delle paghe meno le ore gia'' chieste o approvate nel gestionale. Scalano solo i giorni successivi alla data del tabulato: quelli precedenti le paghe li hanno gia'' contati.';

-- ─────────────────────────────────────────────────────────────────────
-- 6. RLS
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.leave_requests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_request_days   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_request_events ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leave_requests', 'leave_request_days', 'leave_request_events'] LOOP
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

    -- Chi sta in cassa non c'entra niente con le ferie.
    EXECUTE format('DROP POLICY IF EXISTS cash_operator_block ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY cash_operator_block ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
         USING (COALESCE(public.get_my_role()::text, '''') <> ''operatore_cassa'')
         WITH CHECK (COALESCE(public.get_my_role()::text, '''') <> ''operatore_cassa'')', t);

    -- Il ruolo dipendente esiste (migration 249) ma non ha ancora un
    -- collegamento con la sua scheda: finche' non c'e', non entra. Sara'
    -- la fase 3 ad aprirgli le sue righe, e solo quelle.
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

GRANT SELECT ON public.v_leave_disponibilita TO authenticated;

COMMIT;

-- VERIFICA:
--   SELECT count(*) FROM public.leave_requests;        -- 0
--   SELECT count(*) FROM public.v_leave_disponibilita; -- una riga per persona e voce
--   SELECT tablename, policyname, permissive FROM pg_policies
--     WHERE tablename LIKE 'leave_request%' ORDER BY tablename, policyname;
