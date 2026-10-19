-- =====================================================================
-- Migrazione 315 — Organico di oggi, orari dei negozi, turni
-- =====================================================================
-- PERCHE': l'anagrafica dei dipendenti e' la fotografia dell'ultimo
-- documento dello studio paghe. Fra un documento e l'altro succede di
-- tutto (maternita', contratti non rinnovati, orari cambiati) e nessuno
-- lo vede finche' non arriva il cedolino. Patrizio (19/10/2026): serve un
-- organico vero di oggi, tenuto da chi ha il profilo contabilita' o
-- superiore, da cui costruire i turni dei negozi e il piano ferie.
--
-- IL PRINCIPIO: la scheda della persona NON si modifica. Si registra cio'
-- che le succede, con la sua data (employee_events). L'organico di oggi e'
-- l'anagrafica dello studio piu' i cambiamenti successivi. Quando un
-- documento dello studio conferma un cambiamento, il cambiamento si chiude
-- (organico_riconcilia). Il dato dello studio resta il dato vero.
--
-- COSA INTRODUCE:
--   1. employee_events        — i cambiamenti segnati (chi, cosa, da quando)
--   2. outlet_opening_hours   — orari della settimana tipo di ogni negozio
--   3. outlet_staffing_needs  — persone che servono per fascia (lo decide
--                               Patrizio: scrive solo super_advisor)
--   4. outlet_special_days    — festivi, chiusure, saldi
--   5. outlet_shift_rules     — turno minimo/massimo, pause, giorni di lavoro
--   6. shifts                 — i turni, proposti dal sistema o messi a mano
--   7. organico_nuova_persona — inserisce una persona nuova prima che lo
--                               studio la mandi (RPC con controllo del ruolo)
--   8. organico_riconcilia    — chiude i cambiamenti confermati dallo studio
--
-- CHI SCRIVE: super_advisor, ceo, cfo, coo, contabile ("contabilita' o
-- superiore"). Il fabbisogno solo super_advisor. Tutti gli altri leggono.
--
-- NO DATA LOSS: solo CREATE TABLE / CREATE FUNCTION. Un cambiamento non si
-- cancella (si annulla, stato = annullato). Un turno pubblicato o messo a
-- mano non si cancella (si annulla). Si cancellano solo le proposte del
-- sistema ancora in bozza, che il ricalcolo rifa'.
-- REGOLA #0: da applicare su NZ + Made + Zago.
-- Rollback: 20261019_315_organico_turni_ROLLBACK.sql
--
-- APPLICATA il 19/10/2026 su NZ, Made e Zago via connettore, a blocchi
-- (315a…315i su NZ, 315a/315b su Made e Zago) e senza le righe DROP ... IF
-- EXISTS: le tabelle erano nuove e il connettore chiede conferma per ogni
-- DROP, andando in timeout. Il risultato e' identico a questo file.
-- =====================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 0. Chi puo' scrivere
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.organico_puo_scrivere()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT public.get_my_role())::text, '') =
         ANY (ARRAY['super_advisor', 'ceo', 'cfo', 'coo', 'contabile']);
$$;

COMMENT ON FUNCTION public.organico_puo_scrivere() IS
  'Organico, orari dei negozi e turni: scrive chi ha il profilo contabilita'' o superiore (super_advisor, ceo, cfo, coo, contabile).';

CREATE OR REPLACE FUNCTION public.organico_puo_decidere_fabbisogno()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT public.get_my_role())::text, '') = 'super_advisor';
$$;

COMMENT ON FUNCTION public.organico_puo_decidere_fabbisogno() IS
  'Il fabbisogno di persone per fascia lo decide Patrizio (19/10/2026): scrive solo super_advisor.';

-- ─────────────────────────────────────────────────────────────────────
-- 1. I cambiamenti
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id),
  employee_id      uuid NOT NULL REFERENCES public.employees(id),

  tipo             text NOT NULL CHECK (tipo IN (
                     'assenza_lunga', 'rientro', 'non_rinnovo', 'proroga',
                     'cessazione', 'cambio_orario', 'cambio_negozio',
                     'trasformazione_indeterminato', 'assunzione', 'altro')),
  -- maternita', malattia, aspettativa, licenziamento, dimissioni, ...
  motivo           text,

  -- Da quando vale. Per cessazione e non rinnovo e' l'ULTIMO giorno di
  -- lavoro: dal giorno dopo la persona non c'e' piu'.
  data_dal         date NOT NULL,
  -- Rientro previsto (assenza lunga) o nuova scadenza (proroga, assunzione).
  data_al          date,

  ore_settimanali  numeric(5,2) CHECK (ore_settimanali IS NULL OR (ore_settimanali > 0 AND ore_settimanali <= 48)),
  outlet_id        uuid REFERENCES public.outlets(id),
  contratto_tipo   text,

  nota             text,
  documento_path   text,
  documento_nome   text,

  -- da_confermare: lo studio non lo riporta ancora; confermato: un
  -- documento dello studio dice la stessa cosa; annullato: era un errore,
  -- oppure lo studio dice altro e vale lo studio.
  stato            text NOT NULL DEFAULT 'da_confermare'
                     CHECK (stato IN ('da_confermare', 'confermato', 'annullato')),
  esito_nota       text,
  esito_il         timestamptz,
  esito_da         uuid,

  created_by       uuid DEFAULT auth.uid(),
  created_by_nome  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CHECK (data_al IS NULL OR data_al >= data_dal)
);

COMMENT ON TABLE public.employee_events IS
  'Cambiamenti dell''organico segnati in azienda prima che lo studio paghe li riporti (assenze lunghe, proroghe, cessazioni, cambi d''orario o di negozio, assunzioni). L''organico di oggi = anagrafica dello studio + questi cambiamenti. Non si cancellano: si annullano.';

CREATE INDEX IF NOT EXISTS idx_employee_events_emp
  ON public.employee_events (company_id, employee_id, data_dal);
CREATE INDEX IF NOT EXISTS idx_employee_events_stato
  ON public.employee_events (company_id, stato);

CREATE OR REPLACE FUNCTION public.employee_events_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.stato IS DISTINCT FROM OLD.stato THEN
    NEW.esito_il := COALESCE(NEW.esito_il, now());
    NEW.esito_da := COALESCE(NEW.esito_da, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_employee_events_touch ON public.employee_events;
CREATE TRIGGER trg_employee_events_touch
  BEFORE UPDATE ON public.employee_events
  FOR EACH ROW EXECUTE FUNCTION public.employee_events_touch();

CREATE OR REPLACE FUNCTION public.employee_events_no_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Un cambiamento dell''organico non si cancella: si annulla (stato = annullato).';
END;
$$;

DROP TRIGGER IF EXISTS trg_employee_events_no_delete ON public.employee_events;
CREATE TRIGGER trg_employee_events_no_delete
  BEFORE DELETE ON public.employee_events
  FOR EACH ROW EXECUTE FUNCTION public.employee_events_no_delete();

-- ─────────────────────────────────────────────────────────────────────
-- 2. Orari della settimana tipo
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.outlet_opening_hours (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id),
  outlet_id   uuid NOT NULL REFERENCES public.outlets(id),
  -- 1 = lunedi' ... 7 = domenica (ISO)
  giorno      smallint NOT NULL CHECK (giorno BETWEEN 1 AND 7),
  chiuso      boolean NOT NULL DEFAULT false,
  apre        time,
  chiude      time,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid DEFAULT auth.uid(),
  UNIQUE (outlet_id, giorno),
  CHECK (chiuso OR (apre IS NOT NULL AND chiude IS NOT NULL AND chiude > apre))
);

COMMENT ON TABLE public.outlet_opening_hours IS
  'Orari di apertura della settimana tipo di un negozio (giorno 1 = lunedi''). Li inserisce chi tiene l''organico.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. Fabbisogno per fascia (lo decide Patrizio)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.outlet_staffing_needs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id),
  outlet_id   uuid NOT NULL REFERENCES public.outlets(id),
  giorno      smallint NOT NULL CHECK (giorno BETWEEN 1 AND 7),
  dalle       time NOT NULL,
  alle        time NOT NULL,
  persone     smallint NOT NULL CHECK (persone BETWEEN 0 AND 30),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid DEFAULT auth.uid(),
  UNIQUE (outlet_id, giorno, dalle),
  CHECK (alle > dalle)
);

COMMENT ON TABLE public.outlet_staffing_needs IS
  'Quante persone servono in negozio in una fascia oraria di un giorno della settimana tipo. Lo decide Patrizio: scrive solo super_advisor.';

CREATE INDEX IF NOT EXISTS idx_outlet_staffing_needs_outlet
  ON public.outlet_staffing_needs (outlet_id, giorno);

-- ─────────────────────────────────────────────────────────────────────
-- 4. Giorni speciali
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.outlet_special_days (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id),
  outlet_id      uuid NOT NULL REFERENCES public.outlets(id),
  data           date NOT NULL,
  chiuso         boolean NOT NULL DEFAULT false,
  apre           time,
  chiude         time,
  -- Persone in piu' (o in meno) rispetto al fabbisogno del giorno tipo.
  -- E' fabbisogno: la cambia solo super_advisor (trigger sotto).
  persone_extra  smallint NOT NULL DEFAULT 0 CHECK (persone_extra BETWEEN -30 AND 30),
  nota           text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid DEFAULT auth.uid(),
  UNIQUE (outlet_id, data),
  CHECK (chiuso OR apre IS NULL OR chiude IS NULL OR chiude > apre)
);

COMMENT ON TABLE public.outlet_special_days IS
  'Festivi, chiusure, saldi: orari diversi dalla settimana tipo e, se serve, persone in piu''. Le persone in piu'' sono fabbisogno e le decide solo super_advisor.';

CREATE OR REPLACE FUNCTION public.outlet_special_days_fabbisogno()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.persone_extra, 0) <> COALESCE(CASE WHEN TG_OP = 'UPDATE' THEN OLD.persone_extra END, 0)
     AND NOT public.organico_puo_decidere_fabbisogno() THEN
    RAISE EXCEPTION 'Le persone in piu'' di un giorno speciale sono fabbisogno: le decide solo Patrizio.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_outlet_special_days_fabbisogno ON public.outlet_special_days;
CREATE TRIGGER trg_outlet_special_days_fabbisogno
  BEFORE INSERT OR UPDATE ON public.outlet_special_days
  FOR EACH ROW EXECUTE FUNCTION public.outlet_special_days_fabbisogno();

-- ─────────────────────────────────────────────────────────────────────
-- 5. Regole dei turni (una riga per negozio)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.outlet_shift_rules (
  outlet_id          uuid PRIMARY KEY REFERENCES public.outlets(id),
  company_id         uuid NOT NULL REFERENCES public.companies(id),
  turno_min_ore      numeric(4,2) NOT NULL DEFAULT 4 CHECK (turno_min_ore BETWEEN 1 AND 12),
  turno_max_ore      numeric(4,2) NOT NULL DEFAULT 8 CHECK (turno_max_ore BETWEEN 1 AND 12),
  pausa_oltre_ore    numeric(4,2) NOT NULL DEFAULT 6 CHECK (pausa_oltre_ore BETWEEN 1 AND 12),
  pausa_minuti       smallint NOT NULL DEFAULT 30 CHECK (pausa_minuti BETWEEN 0 AND 120),
  giorni_lavoro_max  smallint NOT NULL DEFAULT 6 CHECK (giorni_lavoro_max BETWEEN 1 AND 7),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid DEFAULT auth.uid(),
  CHECK (turno_max_ore >= turno_min_ore)
);

COMMENT ON TABLE public.outlet_shift_rules IS
  'Regole per proporre i turni di un negozio. Senza riga valgono i valori di default (4-8 ore, pausa di 30 minuti oltre le 6 ore, al massimo 6 giorni su 7).';

-- ─────────────────────────────────────────────────────────────────────
-- 6. I turni
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shifts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id),
  outlet_id         uuid NOT NULL REFERENCES public.outlets(id),
  employee_id       uuid NOT NULL REFERENCES public.employees(id),
  data              date NOT NULL,
  inizio            time NOT NULL,
  fine              time NOT NULL,
  pausa_minuti      smallint NOT NULL DEFAULT 0 CHECK (pausa_minuti BETWEEN 0 AND 180),
  -- proposta: l'ha fatto il sistema e il ricalcolo puo' rifarlo;
  -- manuale: l'ha messo o spostato una persona e il ricalcolo non lo tocca.
  origine           text NOT NULL DEFAULT 'proposta' CHECK (origine IN ('proposta', 'manuale')),
  stato             text NOT NULL DEFAULT 'bozza' CHECK (stato IN ('bozza', 'pubblicato', 'annullato')),
  nota              text,
  annullato_motivo  text,
  created_by        uuid DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (fine > inizio)
);

COMMENT ON TABLE public.shifts IS
  'Turni di lavoro. Le proposte in bozza le rifa'' il ricalcolo; i turni messi a mano e quelli pubblicati non si cancellano mai: si annullano con il motivo.';

CREATE INDEX IF NOT EXISTS idx_shifts_outlet_data
  ON public.shifts (company_id, outlet_id, data);
CREATE INDEX IF NOT EXISTS idx_shifts_emp_data
  ON public.shifts (employee_id, data);

CREATE OR REPLACE FUNCTION public.shifts_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shifts_touch ON public.shifts;
CREATE TRIGGER trg_shifts_touch
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.shifts_touch();

CREATE OR REPLACE FUNCTION public.shifts_no_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT (OLD.origine = 'proposta' AND OLD.stato = 'bozza') THEN
    RAISE EXCEPTION 'Un turno messo a mano o gia'' pubblicato non si cancella: si annulla (stato = annullato).';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_shifts_no_hard_delete ON public.shifts;
CREATE TRIGGER trg_shifts_no_hard_delete
  BEFORE DELETE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.shifts_no_hard_delete();

-- ─────────────────────────────────────────────────────────────────────
-- 7. RLS
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  chi_scrive text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employee_events', 'outlet_opening_hours', 'outlet_staffing_needs',
                           'outlet_special_days', 'outlet_shift_rules', 'shifts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    chi_scrive := CASE WHEN t = 'outlet_staffing_needs'
                       THEN '(SELECT public.organico_puo_decidere_fabbisogno())'
                       ELSE '(SELECT public.organico_puo_scrivere())' END;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (company_id = (SELECT public.get_my_company_id()))',
      t || '_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL
         USING (company_id = (SELECT public.get_my_company_id()) AND %s)
         WITH CHECK (company_id = (SELECT public.get_my_company_id()) AND %s)',
      t || '_write', t, chi_scrive, chi_scrive);

    EXECUTE format('DROP POLICY IF EXISTS cash_operator_block ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY cash_operator_block ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
         USING (COALESCE((SELECT public.get_my_role())::text, '''') <> ''operatore_cassa'')
         WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '''') <> ''operatore_cassa'')', t);

    EXECUTE format('DROP POLICY IF EXISTS dipendente_block ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY dipendente_block ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
         USING (COALESCE((SELECT public.get_my_role())::text, '''') <> ''dipendente'')
         WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '''') <> ''dipendente'')', t);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 8. Una persona nuova, prima dei documenti dello studio
-- ─────────────────────────────────────────────────────────────────────
-- La scheda dei dipendenti la scrivono solo super_advisor e contabile
-- (policy employees_write). Chi tiene l'organico deve poter segnare
-- un'assunzione anche se e' ceo, cfo o coo: passa da qui, che controlla il
-- ruolo e scrive scheda e cambiamento insieme.
CREATE OR REPLACE FUNCTION public.organico_nuova_persona(
  p_nome            text,
  p_cognome         text,
  p_outlet_id       uuid,
  p_contratto_tipo  text,
  p_ore_settimanali numeric,
  p_data_assunzione date,
  p_scadenza        date,
  p_livello         text,
  p_nota            text,
  p_autore_nome     text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_id      uuid;
  v_nota    text;
BEGIN
  IF NOT public.organico_puo_scrivere() THEN
    RAISE EXCEPTION 'Solo chi ha il profilo contabilita'' o superiore puo'' aggiungere una persona all''organico.';
  END IF;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Azienda non riconosciuta.';
  END IF;
  IF COALESCE(trim(p_nome), '') = '' OR COALESCE(trim(p_cognome), '') = '' THEN
    RAISE EXCEPTION 'Servono nome e cognome.';
  END IF;
  IF p_data_assunzione IS NULL THEN
    RAISE EXCEPTION 'Serve la data di assunzione.';
  END IF;
  IF p_outlet_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.outlets WHERE id = p_outlet_id AND company_id = v_company) THEN
    RAISE EXCEPTION 'Negozio non riconosciuto.';
  END IF;

  v_nota := '[' || to_char((now() AT TIME ZONE 'Europe/Rome')::date, 'DD/MM/YYYY') || '] '
            || 'Inserita da «Organico di oggi»' || COALESCE(' da ' || NULLIF(trim(p_autore_nome), ''), '')
            || ', in attesa dei documenti dello studio paghe.'
            || COALESCE(' ' || NULLIF(trim(p_nota), ''), '');

  INSERT INTO public.employees (
    company_id, first_name, last_name, nome, cognome, outlet_id,
    contratto_tipo, ore_settimanali, part_time_pct, data_assunzione, hire_date,
    scadenza_td, livello, is_active, note
  ) VALUES (
    v_company, upper(trim(p_nome)), upper(trim(p_cognome)), upper(trim(p_nome)), upper(trim(p_cognome)), p_outlet_id,
    p_contratto_tipo, p_ore_settimanali,
    CASE WHEN p_ore_settimanali IS NOT NULL THEN round(p_ore_settimanali / 40 * 100, 1) END,
    p_data_assunzione, p_data_assunzione,
    p_scadenza, p_livello, true, v_nota
  )
  RETURNING id INTO v_id;

  INSERT INTO public.employee_events (
    company_id, employee_id, tipo, data_dal, data_al, ore_settimanali, outlet_id,
    contratto_tipo, nota, created_by_nome
  ) VALUES (
    v_company, v_id, 'assunzione', p_data_assunzione, p_scadenza, p_ore_settimanali, p_outlet_id,
    p_contratto_tipo, NULLIF(trim(p_nota), ''), p_autore_nome
  );

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.organico_nuova_persona(text, text, uuid, text, numeric, date, date, text, text, text) IS
  'Aggiunge una persona all''organico prima che lo studio paghe la mandi: scrive la scheda (con nota datata) e il cambiamento «assunzione» da confermare.';

-- ─────────────────────────────────────────────────────────────────────
-- 9. Riconciliazione con i documenti dello studio
-- ─────────────────────────────────────────────────────────────────────
-- L'anagrafica la scrivono i documenti dello studio (elenco dipendenti,
-- contratti, proroghe). Un cambiamento e' confermato quando l'anagrafica
-- dice la stessa cosa, o quando c'e' il cedolino (per un'assunzione).
-- Assenze lunghe e rientri non compaiono in nessun documento letto dal
-- gestionale: restano da confermare a mano.
CREATE OR REPLACE FUNCTION public.organico_riconcilia()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_n integer := 0;
  v_k integer;
BEGIN
  IF v_company IS NULL OR NOT public.organico_puo_scrivere() THEN
    RETURN 0;
  END IF;

  UPDATE public.employee_events ev
     SET stato = 'confermato',
         esito_nota = 'Confermato dall''anagrafica allineata ai documenti dello studio paghe.',
         esito_il = now()
    FROM public.employees e
   WHERE ev.company_id = v_company
     AND ev.stato = 'da_confermare'
     AND e.id = ev.employee_id
     AND (
          (ev.tipo = 'cambio_orario' AND ev.ore_settimanali IS NOT NULL
             AND e.ore_settimanali = ev.ore_settimanali)
       OR (ev.tipo = 'proroga' AND ev.data_al IS NOT NULL AND e.scadenza_td = ev.data_al)
       OR (ev.tipo = 'trasformazione_indeterminato' AND e.contratto_tipo = 'indeterminato')
       OR (ev.tipo IN ('cessazione', 'non_rinnovo')
             AND COALESCE(e.data_cessazione, e.termination_date) IS NOT NULL)
       OR (ev.tipo = 'cambio_negozio' AND ev.outlet_id IS NOT NULL AND e.outlet_id = ev.outlet_id)
     );
  GET DIAGNOSTICS v_k = ROW_COUNT;
  v_n := v_n + v_k;

  UPDATE public.employee_events ev
     SET stato = 'confermato',
         esito_nota = 'Confermato: lo studio paghe ha elaborato il cedolino.',
         esito_il = now()
   WHERE ev.company_id = v_company
     AND ev.stato = 'da_confermare'
     AND ev.tipo = 'assunzione'
     AND EXISTS (
       SELECT 1 FROM public.employee_cost_slips s
        WHERE s.employee_id = ev.employee_id
          AND make_date(s.year, s.month, 1) >= date_trunc('month', ev.data_dal)::date
     );
  GET DIAGNOSTICS v_k = ROW_COUNT;
  v_n := v_n + v_k;

  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.organico_riconcilia() IS
  'Chiude i cambiamenti dell''organico che i documenti dello studio hanno confermato (anagrafica allineata o cedolino elaborato). Restituisce quanti ne ha chiusi.';

REVOKE ALL ON FUNCTION public.organico_nuova_persona(text, text, uuid, text, numeric, date, date, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organico_riconcilia() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organico_nuova_persona(text, text, uuid, text, numeric, date, date, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.organico_riconcilia() TO authenticated;
GRANT EXECUTE ON FUNCTION public.organico_puo_scrivere() TO authenticated;
GRANT EXECUTE ON FUNCTION public.organico_puo_decidere_fabbisogno() TO authenticated;

COMMIT;

-- VERIFICA:
--   SELECT count(*) FROM public.employee_events;                 -- 0
--   SELECT tablename, policyname, permissive FROM pg_policies
--    WHERE tablename IN ('employee_events','outlet_opening_hours','outlet_staffing_needs',
--                        'outlet_special_days','outlet_shift_rules','shifts')
--    ORDER BY tablename, policyname;                             -- 4 policy per tabella
