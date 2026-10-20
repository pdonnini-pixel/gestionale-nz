-- 320 — Pianificazione mensile, traffico MODA, responsabili HR, controproposte
--       delle ferie (Patrizio, 20/10/2026). Disegno in ORGANICO_TURNI_NOTES.md.
--
-- 1. organico_hr + organico_e_hr(): chi sceglie il piano del mese che vale
--    (NZ: Veronica, Lilian, Patrizio). Se l'azienda non ha nessuno in elenco,
--    vale il profilo super_advisor.
-- 2. outlet_traffic_hourly: ingressi, scontrini e vendite per ora dai report
--    MODA «Statistica Situazione Vendite con Conversion Rate». E' la base del
--    fabbisogno: si distribuiscono le ore disponibili come gli ingressi.
-- 3. shift_plans: piu' piani per negozio e mese, con la regola dei weekend
--    (nessun libero, solo sabati, solo domeniche, sabato o domenica). Uno solo
--    «scelto» per negozio e mese, e lo sceglie la responsabile HR.
--    shift_plan_weekend_off: i sabati e le domeniche liberi assegnati dal
--    piano; quelli dei piani scelti sono lo storico che tiene la rotazione equa.
--    shifts.plan_id: il turno appartiene a un piano (NULL = turni di prima).
-- 4. Mese chiuso al cedolino: quando per un mese ci sono buste paga
--    (employee_cost_slips), turni e piani di quel mese non si modificano piu':
--    restano per la riprova con il cedolino e con le presenze People Smart.
-- 5. leave_counterproposals: chi decide le ferie puo' proporre altre date.
--    La richiesta originale si chiude come respinta con il motivo; se la
--    persona accetta, nasce una richiesta nuova gia' approvata.
--
-- Solo CREATE / ADD COLUMN. REGOLA #0: NZ + Made + Zago. I nomi delle HR di NZ
-- si inseriscono a parte, solo su NZ. Rollback: _ROLLBACK.sql a fianco.

-- ── 1. Responsabili HR ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organico_hr (
  company_id  uuid NOT NULL REFERENCES public.companies(id),
  user_id     uuid NOT NULL REFERENCES auth.users(id),
  nome        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);
COMMENT ON TABLE public.organico_hr IS
  'Responsabili HR: scelgono quale piano mensile dei turni vale. Senza righe per l''azienda vale il profilo super_advisor.';

CREATE OR REPLACE FUNCTION public.organico_e_hr()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.organico_hr h
                  WHERE h.company_id = public.get_my_company_id() AND h.user_id = auth.uid())
      OR (NOT EXISTS (SELECT 1 FROM public.organico_hr h WHERE h.company_id = public.get_my_company_id())
          AND COALESCE((SELECT public.get_my_role())::text, '') = 'super_advisor');
$$;
REVOKE ALL ON FUNCTION public.organico_e_hr() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.organico_e_hr() TO authenticated;

ALTER TABLE public.organico_hr ENABLE ROW LEVEL SECURITY;
CREATE POLICY organico_hr_select ON public.organico_hr FOR SELECT
  USING (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY organico_hr_write ON public.organico_hr FOR ALL
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_decidere_fabbisogno()))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_decidere_fabbisogno()));

-- ── 2. Traffico per ora (MODA) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.outlet_traffic_hourly (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id),
  outlet_id   uuid NOT NULL REFERENCES public.outlets(id),
  data        date NOT NULL,
  ora         smallint NOT NULL CHECK (ora BETWEEN 0 AND 23),
  ingressi    integer NOT NULL DEFAULT 0 CHECK (ingressi >= 0),
  scontrini   integer NOT NULL DEFAULT 0,
  vendite     numeric(12,2) NOT NULL DEFAULT 0,
  fonte       text NOT NULL DEFAULT 'moda',
  file_name   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outlet_id, data, ora)
);
CREATE INDEX IF NOT EXISTS outlet_traffic_hourly_company_idx ON public.outlet_traffic_hourly (company_id, outlet_id, data);
COMMENT ON TABLE public.outlet_traffic_hourly IS
  'Ingressi (N.P.), scontrini e vendite senza IVA per ora, dai report MODA con conversion rate. Base del fabbisogno dei turni.';

-- ── 3. Piani mensili ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shift_plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id),
  outlet_id       uuid NOT NULL REFERENCES public.outlets(id),
  mese            date NOT NULL CHECK (extract(day FROM mese) = 1),
  nome            text NOT NULL,
  regola_weekend  text NOT NULL CHECK (regola_weekend IN ('nessuno', 'solo_sabati', 'solo_domeniche', 'sabato_o_domenica')),
  stato           text NOT NULL DEFAULT 'bozza' CHECK (stato IN ('bozza', 'scelto')),
  riepilogo       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by      uuid DEFAULT auth.uid(),
  created_by_nome text,
  scelto_da_nome  text,
  scelto_il       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS shift_plans_un_scelto ON public.shift_plans (outlet_id, mese) WHERE stato = 'scelto';
CREATE INDEX IF NOT EXISTS shift_plans_company_idx ON public.shift_plans (company_id, outlet_id, mese);
COMMENT ON TABLE public.shift_plans IS
  'Piani mensili dei turni: piu'' varianti per negozio e mese (regola dei weekend liberi), una sola scelta dalla responsabile HR.';

CREATE TABLE IF NOT EXISTS public.shift_plan_weekend_off (
  plan_id      uuid NOT NULL REFERENCES public.shift_plans(id),
  company_id   uuid NOT NULL REFERENCES public.companies(id),
  employee_id  uuid NOT NULL REFERENCES public.employees(id),
  data         date NOT NULL,
  PRIMARY KEY (plan_id, employee_id, data)
);
COMMENT ON TABLE public.shift_plan_weekend_off IS
  'Sabati e domeniche liberi assegnati da un piano. Quelli dei piani scelti sono lo storico che tiene equa la rotazione da un mese all''altro.';

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.shift_plans(id);
CREATE INDEX IF NOT EXISTS shifts_plan_idx ON public.shifts (plan_id);
COMMENT ON COLUMN public.shifts.plan_id IS 'Piano mensile a cui appartiene il turno (NULL = turni settimanali di prima dei piani).';

-- Solo la responsabile HR sceglie il piano che vale.
CREATE OR REPLACE FUNCTION public.turni_scegli_piano(p_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.shift_plans%ROWTYPE;
  v_nome text;
BEGIN
  SELECT * INTO p FROM shift_plans WHERE id = p_plan_id AND company_id = (SELECT public.get_my_company_id());
  IF NOT FOUND THEN RAISE EXCEPTION 'Piano non trovato.'; END IF;
  IF NOT public.organico_e_hr() THEN
    RAISE EXCEPTION 'Il piano che vale lo sceglie la responsabile HR.';
  END IF;
  SELECT btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) INTO v_nome FROM user_profiles WHERE id = auth.uid();
  UPDATE shift_plans SET stato = 'bozza', updated_at = now()
   WHERE outlet_id = p.outlet_id AND mese = p.mese AND stato = 'scelto' AND id <> p.id;
  UPDATE shift_plans SET stato = 'scelto', scelto_da_nome = NULLIF(v_nome, ''), scelto_il = now(), updated_at = now()
   WHERE id = p.id;
END;
$$;
REVOKE ALL ON FUNCTION public.turni_scegli_piano(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.turni_scegli_piano(uuid) TO authenticated;

-- Lo stato «scelto» passa solo dalla funzione sopra.
CREATE OR REPLACE FUNCTION public.shift_plans_guardia()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.stato = 'scelto' AND (TG_OP = 'INSERT' OR OLD.stato IS DISTINCT FROM 'scelto') AND NOT public.organico_e_hr() THEN
    RAISE EXCEPTION 'Il piano che vale lo sceglie la responsabile HR.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_shift_plans_guardia
  BEFORE INSERT OR UPDATE ON public.shift_plans
  FOR EACH ROW EXECUTE FUNCTION public.shift_plans_guardia();

-- ── 4. Mese chiuso al cedolino ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.turni_mese_chiuso(p_company uuid, p_data date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM employee_cost_slips s
                  WHERE s.company_id = p_company
                    AND s.year = extract(year FROM p_data)::int
                    AND s.month = extract(month FROM p_data)::int);
$$;
COMMENT ON FUNCTION public.turni_mese_chiuso(uuid, date) IS
  'Vero se per quel mese sono arrivati i cedolini: turni e piani del mese restano com''erano, per la riprova.';
GRANT EXECUTE ON FUNCTION public.turni_mese_chiuso(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.turni_blocca_mese_chiuso()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_company uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.company_id ELSE NEW.company_id END;
  v_data date;
BEGIN
  IF TG_TABLE_NAME = 'shifts' THEN
    v_data := CASE WHEN TG_OP = 'DELETE' THEN OLD.data ELSE NEW.data END;
    IF TG_OP = 'UPDATE' AND public.turni_mese_chiuso(v_company, OLD.data) THEN
      RAISE EXCEPTION 'I turni di un mese con i cedolini arrivati non si modificano: servono per la riprova.';
    END IF;
  ELSIF TG_TABLE_NAME = 'shift_plan_weekend_off' THEN
    v_data := CASE WHEN TG_OP = 'DELETE' THEN OLD.data ELSE NEW.data END;
  ELSE
    v_data := CASE WHEN TG_OP = 'DELETE' THEN OLD.mese ELSE NEW.mese END;
  END IF;
  IF public.turni_mese_chiuso(v_company, v_data) THEN
    RAISE EXCEPTION 'Il mese ha i cedolini arrivati: turni e piani non si modificano piu'', servono per la riprova.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER trg_shifts_mese_chiuso
  BEFORE INSERT OR UPDATE OR DELETE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.turni_blocca_mese_chiuso();
CREATE TRIGGER trg_shift_plans_mese_chiuso
  BEFORE INSERT OR UPDATE OR DELETE ON public.shift_plans
  FOR EACH ROW EXECUTE FUNCTION public.turni_blocca_mese_chiuso();
CREATE TRIGGER trg_shift_plan_weekend_off_mese_chiuso
  BEFORE INSERT OR UPDATE OR DELETE ON public.shift_plan_weekend_off
  FOR EACH ROW EXECUTE FUNCTION public.turni_blocca_mese_chiuso();

-- ── RLS delle tabelle nuove dell'organico ──────────────────────────────
ALTER TABLE public.outlet_traffic_hourly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_plan_weekend_off ENABLE ROW LEVEL SECURITY;

CREATE POLICY outlet_traffic_hourly_select ON public.outlet_traffic_hourly FOR SELECT USING (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY outlet_traffic_hourly_write ON public.outlet_traffic_hourly FOR ALL
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_scrivere()))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_scrivere()));
CREATE POLICY shift_plans_select ON public.shift_plans FOR SELECT USING (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY shift_plans_write ON public.shift_plans FOR ALL
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_scrivere()))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_scrivere()));
CREATE POLICY shift_plan_weekend_off_select ON public.shift_plan_weekend_off FOR SELECT USING (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY shift_plan_weekend_off_write ON public.shift_plan_weekend_off FOR ALL
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_scrivere()))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_scrivere()));

CREATE POLICY cash_operator_block ON public.outlet_traffic_hourly AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa') WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa');
CREATE POLICY dipendente_block ON public.outlet_traffic_hourly AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente') WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente');
CREATE POLICY cash_operator_block ON public.shift_plans AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa') WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa');
CREATE POLICY dipendente_block ON public.shift_plans AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente') WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente');
CREATE POLICY cash_operator_block ON public.shift_plan_weekend_off AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa') WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa');
CREATE POLICY dipendente_block ON public.shift_plan_weekend_off AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente') WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente');

-- ── 5. Controproposte delle ferie ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leave_counterproposals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id),
  request_id        uuid NOT NULL REFERENCES public.leave_requests(id),
  employee_id       uuid NOT NULL REFERENCES public.employees(id),
  -- [{ "data": "2026-11-12", "voce": "F01", "tipo": "giornata", "ore": 6 }]
  giorni            jsonb NOT NULL CHECK (jsonb_typeof(giorni) = 'array' AND jsonb_array_length(giorni) > 0),
  motivo            text NOT NULL CHECK (length(btrim(motivo)) > 0),
  stato             text NOT NULL DEFAULT 'aperta' CHECK (stato IN ('aperta', 'accettata', 'rifiutata')),
  proposta_da       uuid DEFAULT auth.uid(),
  proposta_da_nome  text,
  proposta_il       timestamptz NOT NULL DEFAULT now(),
  esito_da_nome     text,
  esito_il          timestamptz,
  esito_nota        text,
  nuova_request_id  uuid REFERENCES public.leave_requests(id)
);
CREATE INDEX IF NOT EXISTS leave_counterproposals_company_idx ON public.leave_counterproposals (company_id, stato);
COMMENT ON TABLE public.leave_counterproposals IS
  'Altre date proposte da chi decide le ferie. La richiesta originale si chiude respinta con il motivo; se la persona accetta nasce una richiesta nuova gia'' approvata.';

ALTER TABLE public.leave_counterproposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY leave_counterproposals_select ON public.leave_counterproposals FOR SELECT USING (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY cash_operator_block ON public.leave_counterproposals AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa') WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa');
CREATE POLICY dipendente_block ON public.leave_counterproposals AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente') WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente');
-- Si scrive solo dalle due funzioni qui sotto.

CREATE OR REPLACE FUNCTION public.leave_controproponi(p_request_id uuid, p_giorni jsonb, p_motivo text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r public.leave_requests%ROWTYPE;
  v_id uuid;
  v_nome text;
  v_date text;
  v_motivo text := NULLIF(btrim(p_motivo), '');
BEGIN
  SELECT * INTO r FROM leave_requests WHERE id = p_request_id;
  IF NOT FOUND OR r.company_id <> public.get_my_company_id() THEN RAISE EXCEPTION 'Richiesta non trovata'; END IF;
  IF NOT public.posso_decidere_ferie() THEN RAISE EXCEPTION 'Non autorizzato a decidere sulle ferie' USING ERRCODE = '42501'; END IF;
  IF r.stato <> 'inviata' THEN RAISE EXCEPTION 'Si propongono altre date solo su una richiesta in attesa.'; END IF;
  IF v_motivo IS NULL THEN RAISE EXCEPTION 'Serve il motivo: chi riceve la proposta deve capire perche''.'; END IF;
  IF p_giorni IS NULL OR jsonb_typeof(p_giorni) <> 'array' OR jsonb_array_length(p_giorni) = 0 THEN
    RAISE EXCEPTION 'Indica almeno un giorno da proporre.';
  END IF;
  SELECT string_agg(to_char((g->>'data')::date, 'DD/MM'), ', ' ORDER BY (g->>'data')::date)
    INTO v_date FROM jsonb_array_elements(p_giorni) g;
  -- La richiesta originale si chiude respinta, con il perche' e le date nuove.
  PERFORM public.leave_decidi(p_request_id, '{}'::uuid[], 'Proposte altre date (' || v_date || '): ' || v_motivo);
  SELECT btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) INTO v_nome FROM user_profiles WHERE id = auth.uid();
  INSERT INTO leave_counterproposals (company_id, request_id, employee_id, giorni, motivo, proposta_da_nome)
  VALUES (r.company_id, r.id, r.employee_id, p_giorni, v_motivo, NULLIF(v_nome, ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.leave_controproponi(uuid, jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.leave_controproponi(uuid, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.leave_rispondi_controproposta(p_id uuid, p_accetta boolean, p_nota text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c public.leave_counterproposals%ROWTYPE;
  r public.leave_requests%ROWTYPE;
  v_nome text;
  v_new uuid;
BEGIN
  SELECT * INTO c FROM leave_counterproposals WHERE id = p_id;
  IF NOT FOUND OR c.company_id <> public.get_my_company_id() THEN RAISE EXCEPTION 'Proposta non trovata'; END IF;
  IF NOT ((public.get_my_role())::text = ANY (ARRAY['super_advisor', 'contabile', 'coo']) OR public.posso_decidere_ferie()) THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  IF c.stato <> 'aperta' THEN RAISE EXCEPTION 'A questa proposta e'' gia'' stata data una risposta.'; END IF;
  SELECT * INTO r FROM leave_requests WHERE id = c.request_id;
  SELECT btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) INTO v_nome FROM user_profiles WHERE id = auth.uid();
  IF p_accetta THEN
    INSERT INTO leave_requests (company_id, employee_id, outlet_code, stato, titolo, note_dipendente, origine,
                                compilata_da, compilata_da_nome, inviata_il, decisa_il, decisa_da, decisa_da_nome, motivazione)
    VALUES (c.company_id, c.employee_id, r.outlet_code, 'approvata', coalesce(r.titolo, 'Ferie') || ' (date proposte)',
            NULLIF(btrim(p_nota), ''), r.origine, auth.uid(), NULLIF(v_nome, ''), now(), now(), c.proposta_da, c.proposta_da_nome,
            'Date proposte da ' || coalesce(c.proposta_da_nome, 'chi decide le ferie') || ' e accettate.')
    RETURNING id INTO v_new;
    INSERT INTO leave_request_days (company_id, request_id, data, voce, tipo, ore, stato)
    SELECT c.company_id, v_new, (g->>'data')::date, g->>'voce', g->>'tipo', (g->>'ore')::numeric, 'approvato'
      FROM jsonb_array_elements(c.giorni) g;
  END IF;
  UPDATE leave_counterproposals
     SET stato = CASE WHEN p_accetta THEN 'accettata' ELSE 'rifiutata' END,
         esito_da_nome = NULLIF(v_nome, ''), esito_il = now(), esito_nota = NULLIF(btrim(p_nota), ''), nuova_request_id = v_new
   WHERE id = p_id;
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public.leave_rispondi_controproposta(uuid, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.leave_rispondi_controproposta(uuid, boolean, text) TO authenticated;
