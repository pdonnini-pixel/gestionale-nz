-- =====================================================================
-- Migrazione 407 — Ferie e permessi: chi approva, quando si possono chiedere,
--                  eccezioni, elenco HR, lunedi' con la vice provvisoria
-- =====================================================================
-- PERCHE': scheda 9 di «Regole e orari» (Patrizio, 12/11/2026).
--   - La richiesta parte dall'app e arriva alla referente del negozio e all'HR.
--     Per negozio si decide chi approva ferie, permessi ed eccezioni (referente,
--     HR o tutte e due) e se basta un'approvazione o servono entrambe.
--   - Per negozio si decide quando si possono chiedere: feriali, sabato e
--     domenica, festivi e giorni speciali; per ogni evento, ferie e permessi
--     separati (outlet_events.regole -> 'ferie' / 'permessi'; gli eventi di prima
--     restano su blocca_ferie). Dove e' spento la richiesta passa solo come
--     ECCEZIONE, se il negozio ha indicato chi approva le eccezioni.
--   - HR: un elenco per azienda che solo il Super Advisor cambia (leave_hr).
--     Finche' e' vuoto, dal lato HR approva chi approva oggi.
--   - Responsabile e vice mai assenti insieme di lunedi' (393): vale anche con la
--     responsabile o la vice PROVVISORIA (piu' ore di contratto, poi anzianita',
--     poi identificativo), solo nei negozi con giorni caldi o riposi minimi.
--
-- TUTTO SPENTO = COME OGGI: senza una riga in outlet_leave_rules e senza le voci
-- nuove negli eventi le richieste si comportano come prima (blocca_ferie rifiuta
-- ferie e permessi con lo stesso messaggio; decide chi decideva).
--
-- COME: tabelle nuove outlet_leave_rules e leave_hr; tre colonne nullable su
-- leave_requests; funzioni nuove; quattro funzioni esistenti corrette sul testo
-- vivo (come la 392 e la 401): app_dipendente_chiedi_ferie, app_dipendente_ferie,
-- leave_decidi, responsabile_ferie_elenco; ferie_lunedi_conflitti riscritta e
-- leave_request_days_lunedi corretta per il ripiego.
--
-- DIPENDE da 393 (lunedi'), 399 e 405 (giorni_pieni, riposi_min_settimana,
-- outlet_events.tipo e regole). Verificato in lettura il 12/11/2026: le funzioni
-- da correggere sono identiche su NZ e Zago.
--
-- NO DATA LOSS: CREATE TABLE, ADD COLUMN senza default, funzioni. Nessuna riga
-- cambiata; nessuna richiesta esistente cambia stato.
-- Tenant: NZ e Zago (Made non riceve piu' migration dal 03/11/2026).
-- =====================================================================

BEGIN;

-- ── 1. Le scelte del negozio ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.outlet_leave_rules (
  outlet_id            uuid PRIMARY KEY REFERENCES public.outlets(id),
  company_id           uuid NOT NULL REFERENCES public.companies(id),
  -- chi approva (NULL = si', come oggi); entrambe NULL = ne basta una
  ferie_referente      boolean,
  ferie_hr             boolean,
  ferie_entrambe       boolean,
  permessi_referente   boolean,
  permessi_hr          boolean,
  permessi_entrambe    boolean,
  -- eccezioni: attive solo se almeno una delle due e' true
  eccezioni_referente  boolean,
  eccezioni_hr         boolean,
  eccezioni_entrambe   boolean,
  -- quando si possono chiedere (NULL = si', come oggi)
  ferie_feriali        boolean,
  permessi_feriali     boolean,
  ferie_weekend        boolean,
  permessi_weekend     boolean,
  ferie_festivi        boolean,
  permessi_festivi     boolean,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid DEFAULT auth.uid()
);
COMMENT ON TABLE public.outlet_leave_rules IS
  'Ferie e permessi per negozio (Patrizio, 12/11/2026): chi approva (referente del negozio, HR), se servono due approvazioni, e in quali giorni si possono chiedere. Colonne NULL o riga assente = come prima della 407. Dove un giorno e'' spento la richiesta passa solo come eccezione, se eccezioni_referente o eccezioni_hr e'' true.';
CREATE INDEX IF NOT EXISTS outlet_leave_rules_company_idx ON public.outlet_leave_rules (company_id);

ALTER TABLE public.outlet_leave_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outlet_leave_rules_select ON public.outlet_leave_rules;
CREATE POLICY outlet_leave_rules_select ON public.outlet_leave_rules FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()));
DROP POLICY IF EXISTS outlet_leave_rules_write ON public.outlet_leave_rules;
CREATE POLICY outlet_leave_rules_write ON public.outlet_leave_rules FOR ALL TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_scrivere()))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_scrivere()));
DROP POLICY IF EXISTS cash_operator_block ON public.outlet_leave_rules;
CREATE POLICY cash_operator_block ON public.outlet_leave_rules AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa');
DROP POLICY IF EXISTS dipendente_block ON public.outlet_leave_rules;
CREATE POLICY dipendente_block ON public.outlet_leave_rules AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente');
DROP POLICY IF EXISTS responsabile_block ON public.outlet_leave_rules;
CREATE POLICY responsabile_block ON public.outlet_leave_rules AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'responsabile')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'responsabile');
DROP POLICY IF EXISTS solo_con_profilo ON public.outlet_leave_rules;
CREATE POLICY solo_con_profilo ON public.outlet_leave_rules AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.get_my_role()) IS NOT NULL)
  WITH CHECK ((SELECT public.get_my_role()) IS NOT NULL);
REVOKE ALL ON public.outlet_leave_rules FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outlet_leave_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outlet_leave_rules TO service_role;

-- ── 2. L'elenco HR: lo cambia solo il Super Advisor ────────────────────
CREATE TABLE IF NOT EXISTS public.leave_hr (
  company_id  uuid NOT NULL REFERENCES public.companies(id),
  user_id     uuid NOT NULL REFERENCES public.user_profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid DEFAULT auth.uid(),
  PRIMARY KEY (company_id, user_id)
);
COMMENT ON TABLE public.leave_hr IS
  'Chi e'' HR per ferie e permessi (Patrizio, 12/11/2026): un''appartenenza a parte, non un profilo; piu'' persone ammesse. La cambia solo il Super Advisor. Finche'' e'' vuota, dal lato HR approva chi approvava prima (posso_decidere_ferie). Non da'' da sola il diritto di decidere: quello resta posso_decidere_ferie().';

ALTER TABLE public.leave_hr ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leave_hr_select ON public.leave_hr;
CREATE POLICY leave_hr_select ON public.leave_hr FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()));
DROP POLICY IF EXISTS leave_hr_insert ON public.leave_hr;
CREATE POLICY leave_hr_insert ON public.leave_hr FOR INSERT TO authenticated
  WITH CHECK (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.get_my_role())::text = 'super_advisor');
DROP POLICY IF EXISTS leave_hr_delete ON public.leave_hr;
CREATE POLICY leave_hr_delete ON public.leave_hr FOR DELETE TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.get_my_role())::text = 'super_advisor');
DROP POLICY IF EXISTS cash_operator_block ON public.leave_hr;
CREATE POLICY cash_operator_block ON public.leave_hr AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa');
DROP POLICY IF EXISTS dipendente_block ON public.leave_hr;
CREATE POLICY dipendente_block ON public.leave_hr AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente');
DROP POLICY IF EXISTS responsabile_block ON public.leave_hr;
CREATE POLICY responsabile_block ON public.leave_hr AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'responsabile')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'responsabile');
DROP POLICY IF EXISTS solo_con_profilo ON public.leave_hr;
CREATE POLICY solo_con_profilo ON public.leave_hr AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.get_my_role()) IS NOT NULL)
  WITH CHECK ((SELECT public.get_my_role()) IS NOT NULL);
REVOKE ALL ON public.leave_hr FROM anon;
GRANT SELECT, INSERT, DELETE ON public.leave_hr TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_hr TO service_role;

-- ── 3. La richiesta: eccezione e prima approvazione ────────────────────
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS eccezione boolean,
  ADD COLUMN IF NOT EXISTS eccezione_motivo text,
  ADD COLUMN IF NOT EXISTS prima_decisione jsonb;
COMMENT ON COLUMN public.leave_requests.eccezione IS
  'true = chiesta come eccezione: almeno un giorno cade dove ferie o permessi non si possono chiedere (giorno caldo, evento, regola del negozio). NULL = richiesta normale.';
COMMENT ON COLUMN public.leave_requests.eccezione_motivo IS 'Perche'' e'' un''eccezione: i giorni e la regola, come li ha visti chi ha chiesto.';
COMMENT ON COLUMN public.leave_requests.prima_decisione IS
  'Dove servono due approvazioni: la prima { lato: referente|hr, utente, nome, giorni: [id dei giorni concessi], motivo, quando }. La richiesta resta inviata finche'' non arriva la seconda.';

-- ── 4. Festivi italiani (come festivitaItaliane in src/lib/ferieRichiesta.ts) ──
CREATE OR REPLACE FUNCTION public.festivo_italiano(p_data date)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  y int := extract(year FROM p_data)::int;
  a int := y % 19; b int := y / 100; c int := y % 100;
  d int := b / 4;  e int := b % 4;   f int := (b + 8) / 25;
  g int := (b - f + 1) / 3;
  h int := (19 * a + b - d - g + 15) % 30;
  i int := c / 4;  k int := c % 4;
  l int := (32 + 2 * e + 2 * i - h - k) % 7;
  m int := (a + 11 * h + 22 * l) / 451;
  pasqua date := make_date(y, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
BEGIN
  RETURN to_char(p_data, 'MM-DD') IN ('01-01', '01-06', '04-25', '05-01', '06-02', '08-15', '11-01', '12-08', '12-25', '12-26')
      OR p_data IN (pasqua, pasqua + 1);
END
$function$;
REVOKE ALL ON FUNCTION public.festivo_italiano(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.festivo_italiano(date) TO authenticated, service_role;

-- ── 5. Responsabile e vice del negozio, con il ripiego ─────────────────
-- Come guidaConRipiego in src/lib/guidaNegozio.ts: dove il negozio ha i giorni caldi
-- o i riposi minimi, chi manca e' la prima per ore di contratto, poi per anzianita',
-- poi per identificativo, fra le persone attive del negozio. Altrove: quelle caricate.
CREATE OR REPLACE FUNCTION public.guida_negozio_effettiva(p_outlet_id uuid)
 RETURNS TABLE (responsabile uuid, vice uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_resp uuid;
  v_vice uuid;
  v_ripiego boolean;
BEGIN
  SELECT o.referente_employee_id, o.vice_referente_employee_id INTO v_resp, v_vice
    FROM public.outlets o WHERE o.id = p_outlet_id;
  SELECT (COALESCE(r.giorni_pieni, false) OR r.riposi_min_settimana IS NOT NULL) INTO v_ripiego
    FROM public.outlet_shift_rules r WHERE r.outlet_id = p_outlet_id;
  IF COALESCE(v_ripiego, false) THEN
    IF v_vice IS NOT NULL AND v_vice = v_resp THEN v_vice := NULL; END IF;
    IF v_resp IS NULL THEN
      SELECT e.id INTO v_resp FROM public.employees e
       WHERE e.outlet_id = p_outlet_id AND COALESCE(e.is_active, true) AND NOT COALESCE(e.is_demo, false)
         AND COALESCE(e.data_cessazione, e.termination_date, DATE '9999-12-31') >= (now() AT TIME ZONE 'Europe/Rome')::date
         AND COALESCE(e.ore_settimanali, e.weekly_hours, 0) > 0
         AND e.id IS DISTINCT FROM v_vice
       ORDER BY COALESCE(e.ore_settimanali, e.weekly_hours, 0) DESC,
                COALESCE(e.data_assunzione, e.hire_date, DATE '9999-12-31'), e.id::text
       LIMIT 1;
    END IF;
    IF v_vice IS NULL THEN
      SELECT e.id INTO v_vice FROM public.employees e
       WHERE e.outlet_id = p_outlet_id AND COALESCE(e.is_active, true) AND NOT COALESCE(e.is_demo, false)
         AND COALESCE(e.data_cessazione, e.termination_date, DATE '9999-12-31') >= (now() AT TIME ZONE 'Europe/Rome')::date
         AND COALESCE(e.ore_settimanali, e.weekly_hours, 0) > 0
         AND e.id IS DISTINCT FROM v_resp
       ORDER BY COALESCE(e.ore_settimanali, e.weekly_hours, 0) DESC,
                COALESCE(e.data_assunzione, e.hire_date, DATE '9999-12-31'), e.id::text
       LIMIT 1;
    END IF;
  END IF;
  responsabile := v_resp;
  vice := v_vice;
  RETURN NEXT;
END
$function$;
REVOKE ALL ON FUNCTION public.guida_negozio_effettiva(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guida_negozio_effettiva(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ferie_lunedi_ce_guida()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.outlets o CROSS JOIN LATERAL public.guida_negozio_effettiva(o.id) g
     WHERE g.responsabile IS NOT NULL AND g.vice IS NOT NULL);
$function$;
REVOKE ALL ON FUNCTION public.ferie_lunedi_ce_guida() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ferie_lunedi_ce_guida() TO service_role;

-- Stessa funzione della 393, ma «l'altra» e' quella effettiva (caricata o provvisoria).
CREATE OR REPLACE FUNCTION public.ferie_lunedi_conflitti(
  p_employee_id uuid, p_date date[], p_solo_approvate boolean DEFAULT false)
RETURNS TABLE (data date, altra_id uuid)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH lunedi AS (
    SELECT COALESCE(array_agg(DISTINCT x), '{}'::date[]) AS date
      FROM unnest(p_date) AS x
     WHERE extract(isodow FROM x) = 1
       AND x >= (now() AT TIME ZONE 'Europe/Rome')::date
  ), altre AS (
    SELECT DISTINCT CASE WHEN gn.responsabile = p_employee_id THEN gn.vice ELSE gn.responsabile END AS altra_id
      FROM public.outlets o
      CROSS JOIN LATERAL public.guida_negozio_effettiva(o.id) gn
     WHERE gn.responsabile IS NOT NULL
       AND gn.vice IS NOT NULL
       AND COALESCE(o.is_active, true)
       AND p_employee_id IN (gn.responsabile, gn.vice)
  )
  SELECT g.data, a.altra_id
    FROM lunedi l
    CROSS JOIN altre a
    CROSS JOIN LATERAL unnest(public.ferie_giorni_interi(a.altra_id, l.date, p_solo_approvate, NULL)) AS g(data)
   WHERE cardinality(l.date) > 0
   ORDER BY g.data;
$$;
REVOKE ALL ON FUNCTION public.ferie_lunedi_conflitti(uuid, date[], boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ferie_lunedi_conflitti(uuid, date[], boolean) TO service_role;

-- ── 6. Quando si possono chiedere ──────────────────────────────────────
-- NULL = ammessa. Altrimenti il motivo, in parole per chi chiede.
CREATE OR REPLACE FUNCTION public.ferie_blocco_giorno(p_employee_id uuid, p_data date, p_cosa text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  e        public.employees%ROWTYPE;
  ev       record;
  reg      public.outlet_leave_rules%ROWTYPE;
  v_chiave text := CASE WHEN p_cosa = 'ferie' THEN 'ferie' ELSE 'permessi' END;
  v_cosa   text := CASE WHEN p_cosa = 'ferie' THEN 'ferie' ELSE 'permessi' END;
  v_deciso boolean := false;   -- un evento ha detto la sua: le regole del giorno non contano
  v_speciale boolean := false; -- giorno speciale singolo: vale come un festivo
  v_ammessa boolean;
  v_g      text := to_char(p_data, 'DD/MM/YYYY');
BEGIN
  SELECT * INTO e FROM public.employees WHERE id = p_employee_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  FOR ev IN
    SELECT x.nome, x.blocca_ferie, x.regole, x.tipo
      FROM public.outlet_events x
     WHERE x.company_id = e.company_id
       AND p_data BETWEEN x.data_dal AND COALESCE(x.data_al, x.data_dal)
       AND (x.outlet_ids IS NULL OR e.outlet_id IS NULL OR e.outlet_id = ANY (x.outlet_ids))
     ORDER BY x.data_dal, x.nome
  LOOP
    IF jsonb_typeof(ev.regole -> v_chiave) = 'boolean' THEN
      v_deciso := true;
      IF NOT (ev.regole ->> v_chiave)::boolean THEN
        RETURN format('Il %s c''è %s: niente %s.', v_g, ev.nome, v_cosa);
      END IF;
    ELSIF ev.blocca_ferie THEN
      -- evento di prima della 407: stesso messaggio di sempre
      RETURN format('Il %s c''è %s: niente ferie né permessi.', v_g, ev.nome);
    END IF;
    IF ev.tipo = 'giorno' THEN v_speciale := true; END IF;
  END LOOP;
  IF v_deciso THEN RETURN NULL; END IF;

  SELECT * INTO reg FROM public.outlet_leave_rules WHERE outlet_id = e.outlet_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_speciale OR public.festivo_italiano(p_data) THEN
    v_ammessa := COALESCE(CASE WHEN v_chiave = 'ferie' THEN reg.ferie_festivi ELSE reg.permessi_festivi END, true);
    IF NOT v_ammessa THEN
      RETURN format('Il %s è un giorno festivo o speciale: in quei giorni il negozio lavora al completo, niente %s.', v_g, v_cosa);
    END IF;
  ELSIF extract(isodow FROM p_data) >= 6 THEN
    v_ammessa := COALESCE(CASE WHEN v_chiave = 'ferie' THEN reg.ferie_weekend ELSE reg.permessi_weekend END, true);
    IF NOT v_ammessa THEN
      RETURN format('Il %s è %s: il sabato e la domenica il negozio lavora al completo, niente %s.', v_g,
                    CASE WHEN extract(isodow FROM p_data) = 6 THEN 'sabato' ELSE 'domenica' END, v_cosa);
    END IF;
  ELSE
    v_ammessa := COALESCE(CASE WHEN v_chiave = 'ferie' THEN reg.ferie_feriali ELSE reg.permessi_feriali END, true);
    IF NOT v_ammessa THEN
      RETURN format('Il %s: in questo negozio nei giorni feriali non si chiedono %s dall''app.', v_g, v_cosa);
    END IF;
  END IF;
  RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION public.ferie_blocco_giorno(uuid, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ferie_blocco_giorno(uuid, date, text) TO service_role;

CREATE OR REPLACE FUNCTION public.ferie_eccezioni_attive(p_outlet_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((SELECT COALESCE(r.eccezioni_referente, false) OR COALESCE(r.eccezioni_hr, false)
                     FROM public.outlet_leave_rules r WHERE r.outlet_id = p_outlet_id), false);
$function$;
REVOKE ALL ON FUNCTION public.ferie_eccezioni_attive(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ferie_eccezioni_attive(uuid) TO service_role;

-- ── 7. Chi approva ─────────────────────────────────────────────────────
-- Le scelte del negozio per QUESTA richiesta: { referente, hr, entrambe }. NULL = negozio senza regole.
CREATE OR REPLACE FUNCTION public.ferie_regole_richiesta(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  q    public.leave_requests%ROWTYPE;
  reg  public.outlet_leave_rules%ROWTYPE;
  v_f  boolean;
  v_p  boolean;
  v_ref boolean;
  v_hr  boolean;
  v_due boolean;
BEGIN
  SELECT * INTO q FROM public.leave_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO reg FROM public.outlet_leave_rules WHERE outlet_id = public.ferie_negozio_richiesta(p_request_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF COALESCE(q.eccezione, false) THEN
    v_ref := COALESCE(reg.eccezioni_referente, false);
    v_hr  := COALESCE(reg.eccezioni_hr, false);
    v_due := COALESCE(reg.eccezioni_entrambe, false);
  ELSE
    v_f := EXISTS (SELECT 1 FROM public.leave_request_days d WHERE d.request_id = p_request_id AND d.voce = 'F01');
    v_p := EXISTS (SELECT 1 FROM public.leave_request_days d WHERE d.request_id = p_request_id AND d.voce <> 'F01');
    -- una richiesta con ferie e permessi insieme: deve poter decidere chi puo' tutte e due
    v_ref := (NOT v_f OR COALESCE(reg.ferie_referente, true)) AND (NOT v_p OR COALESCE(reg.permessi_referente, true));
    v_hr  := (NOT v_f OR COALESCE(reg.ferie_hr, true)) AND (NOT v_p OR COALESCE(reg.permessi_hr, true));
    v_due := (v_f AND COALESCE(reg.ferie_entrambe, false)) OR (v_p AND COALESCE(reg.permessi_entrambe, false));
  END IF;
  RETURN jsonb_build_object('referente', v_ref, 'hr', v_hr, 'entrambe', v_due AND v_ref AND v_hr);
END
$function$;
REVOKE ALL ON FUNCTION public.ferie_regole_richiesta(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ferie_regole_richiesta(uuid) TO service_role;

-- Da che lato decide chi chiama: la referente del negozio (profilo responsabile) o l'HR.
CREATE OR REPLACE FUNCTION public.ferie_mio_lato()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN COALESCE((SELECT public.get_my_role())::text, '') = 'responsabile' THEN 'referente' ELSE 'hr' END;
$function$;
REVOKE ALL ON FUNCTION public.ferie_mio_lato() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ferie_mio_lato() TO service_role;

-- Chi chiama puo' decidere questa richiesta, per le scelte del negozio? (i permessi di base li
-- controlla leave_decidi come prima). Il Super Advisor passa sempre.
CREATE OR REPLACE FUNCTION public.ferie_lato_puo(p_request_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reg  jsonb := public.ferie_regole_richiesta(p_request_id);
  v_lato text := public.ferie_mio_lato();
BEGIN
  IF v_reg IS NULL OR COALESCE((SELECT public.get_my_role())::text, '') = 'super_advisor' THEN RETURN true; END IF;
  IF v_lato = 'referente' THEN RETURN (v_reg ->> 'referente')::boolean; END IF;
  IF NOT (v_reg ->> 'hr')::boolean THEN RETURN false; END IF;
  -- elenco HR: vuoto = chi decideva prima; altrimenti solo chi e' nell'elenco
  IF NOT EXISTS (SELECT 1 FROM public.leave_hr h WHERE h.company_id = (SELECT public.get_my_company_id())) THEN RETURN true; END IF;
  RETURN EXISTS (SELECT 1 FROM public.leave_hr h
                  WHERE h.company_id = (SELECT public.get_my_company_id()) AND h.user_id = (SELECT auth.uid()));
END
$function$;
REVOKE ALL ON FUNCTION public.ferie_lato_puo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferie_lato_puo(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ferie_controlla_lato(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.ferie_lato_puo(p_request_id) THEN
    RAISE EXCEPTION '%', CASE WHEN public.ferie_mio_lato() = 'referente'
      THEN 'In questo negozio questa richiesta la decide l''HR.'
      ELSE 'In questo negozio questa richiesta non la decidi tu: guarda in «Regole e orari» chi approva ferie e permessi.' END
      USING ERRCODE = '42501';
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION public.ferie_controlla_lato(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ferie_controlla_lato(uuid) TO service_role;

-- Due approvazioni: NULL = si decide come sempre; {attesa:true} = prima approvazione salvata,
-- la richiesta resta inviata; {giorni:[...], motivo} = seconda approvazione, vale l'intersezione.
CREATE OR REPLACE FUNCTION public.ferie_doppia_approvazione(p_request_id uuid, p_giorni uuid[], p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  q       public.leave_requests%ROWTYPE;
  v_reg   jsonb := public.ferie_regole_richiesta(p_request_id);
  v_lato  text := public.ferie_mio_lato();
  v_super boolean := COALESCE((SELECT public.get_my_role())::text, '') = 'super_advisor';
  v_nome  text;
  v_ok    uuid[];
BEGIN
  IF v_reg IS NULL OR NOT (v_reg ->> 'entrambe')::boolean THEN RETURN NULL; END IF;
  SELECT * INTO q FROM public.leave_requests WHERE id = p_request_id FOR UPDATE;
  IF q.stato <> 'inviata' THEN RETURN NULL; END IF;  -- una decisione gia' presa si corregge come sempre
  SELECT COALESCE(array_agg(d.id), '{}') INTO v_ok
    FROM public.leave_request_days d WHERE d.request_id = p_request_id AND d.id = ANY (p_giorni);

  IF q.prima_decisione IS NULL THEN
    IF cardinality(v_ok) = 0 THEN RETURN NULL; END IF;  -- un rifiuto basta da solo
    SELECT btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) INTO v_nome
      FROM public.user_profiles WHERE id = (SELECT auth.uid());
    UPDATE public.leave_requests
       SET prima_decisione = jsonb_build_object('lato', v_lato, 'utente', (SELECT auth.uid()), 'nome', NULLIF(v_nome, ''),
                                                'giorni', to_jsonb(v_ok), 'motivo', p_motivo, 'quando', now())
     WHERE id = p_request_id;
    INSERT INTO public.leave_request_events (company_id, request_id, evento, stato_a, nota, dettaglio, utente_id, utente_nome)
    VALUES (q.company_id, p_request_id, 'prima_approvazione', 'inviata', p_motivo,
            jsonb_build_object('lato', v_lato, 'giorni_approvati', cardinality(v_ok)), (SELECT auth.uid()), NULLIF(v_nome, ''));
    RETURN jsonb_build_object('attesa', true);
  END IF;

  IF (q.prima_decisione ->> 'lato') = v_lato AND NOT v_super THEN
    RAISE EXCEPTION '%', CASE WHEN v_lato = 'hr'
      THEN 'L''HR ha già approvato: manca l''approvazione della referente del negozio.'
      ELSE 'La referente ha già approvato: manca l''approvazione dell''HR.' END USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'giorni', COALESCE((SELECT jsonb_agg(x) FROM unnest(v_ok) x
                         WHERE x::text IN (SELECT jsonb_array_elements_text(q.prima_decisione -> 'giorni'))), '[]'::jsonb),
    'motivo', q.prima_decisione ->> 'motivo');
END
$function$;
REVOKE ALL ON FUNCTION public.ferie_doppia_approvazione(uuid, uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ferie_doppia_approvazione(uuid, uuid[], text) TO service_role;

-- ── 8. Le funzioni esistenti, corrette sul testo vivo ──────────────────
DO $do$
DECLARE
  f record;
  d text;
  n text;
  i int;
BEGIN
  FOR f IN
    SELECT * FROM (VALUES
      -- la richiesta dall'app: il controllo nuovo prima del vecchio, che non scatta piu'
      ('public.app_dipendente_chiedi_ferie(jsonb,text)', ARRAY[
        $x$  v_con_saldo boolean;$x$,
        $x$    SELECT ev.nome INTO v_ev FROM public.outlet_events ev$x$,
        $x$AND ev.blocca_ferie$x$,
        $x$  RETURNING id INTO v_req;$x$], ARRAY[
        $x$  v_con_saldo boolean;
  v_ecc      text;  -- 407$x$,
        $x$    -- 407: quando si possono chiedere (eventi, giorni caldi, regole del negozio) e le eccezioni
    v_ev := public.ferie_blocco_giorno(v_emp, v_data, CASE WHEN COALESCE(g->>'voce', 'ferie') = 'ferie' THEN 'ferie' ELSE 'permessi' END);
    IF v_ev IS NOT NULL THEN
      IF NOT public.ferie_eccezioni_attive(e.outlet_id) THEN
        RAISE EXCEPTION '%', v_ev USING ERRCODE = '22023';
      ELSIF COALESCE(g->>'eccezione', '') <> 'true' THEN
        RAISE EXCEPTION '% Si può chiedere solo come eccezione.', v_ev USING ERRCODE = '22023', HINT = 'eccezione';
      END IF;
      v_ecc := left(concat_ws(' ', v_ecc, v_ev), 500);
    END IF;
    SELECT ev.nome INTO v_ev FROM public.outlet_events ev$x$,
        $x$AND false /* 407: decide ferie_blocco_giorno */$x$,
        $x$  RETURNING id INTO v_req;
  IF v_ecc IS NOT NULL THEN  -- 407
    UPDATE public.leave_requests SET eccezione = true, eccezione_motivo = v_ecc WHERE id = v_req;
  END IF;$x$]),
      -- cosa vede la dipendente
      ('public.app_dipendente_ferie()', ARRAY[
        $x$'id', q.id, 'stato', q.stato, 'note', q.note_dipendente,$x$,
        $x$    'senza_ferie', COALESCE(($x$], ARRAY[
        $x$'id', q.id, 'stato', q.stato, 'eccezione', COALESCE(q.eccezione, false), 'attesa_seconda', (q.stato = 'inviata' AND q.prima_decisione IS NOT NULL), 'note', q.note_dipendente,$x$,
        $x$    'eccezioni', public.ferie_eccezioni_attive(e.outlet_id),  -- 407
    'senza_ferie', COALESCE(($x$]),
      -- la decisione
      ('public.leave_decidi(uuid,uuid[],text)', ARRAY[
        $x$  v_motivo     text := NULLIF(btrim(p_motivazione), '');$x$,
        $x$  IF r.stato NOT IN ('inviata', 'approvata', 'approvata_parziale', 'respinta') THEN$x$,
        $x$  UPDATE public.leave_request_days$x$], ARRAY[
        $x$  v_motivo     text := NULLIF(btrim(p_motivazione), '');
  v_407        jsonb;$x$,
        $x$  PERFORM public.ferie_controlla_lato(p_request_id);  -- 407: chi approva, per negozio

  IF r.stato NOT IN ('inviata', 'approvata', 'approvata_parziale', 'respinta') THEN$x$,
        $x$  -- 407: dove servono due approvazioni
  v_407 := public.ferie_doppia_approvazione(p_request_id, p_giorni_approvati, v_motivo);
  IF v_407 ? 'attesa' THEN
    RETURN 'attesa_seconda';
  END IF;
  IF v_407 ? 'giorni' THEN
    p_giorni_approvati := ARRAY(SELECT jsonb_array_elements_text(v_407 -> 'giorni')::uuid);
    v_ok := (SELECT count(*) FROM public.leave_request_days
              WHERE request_id = p_request_id AND id = ANY (p_giorni_approvati));
    v_motivo := COALESCE(v_motivo, NULLIF(v_407 ->> 'motivo', ''));
    IF v_ok < v_tot AND v_motivo IS NULL THEN
      v_motivo := 'Giorni non concessi dalla prima approvazione.';
    END IF;
  END IF;

  UPDATE public.leave_request_days$x$]),
      -- l'elenco della referente
      ('public.responsabile_ferie_elenco(boolean)', ARRAY[
        $x$'prova', e.is_demo, 'titolo', q.titolo,$x$], ARRAY[
        $x$'prova', e.is_demo, 'eccezione', COALESCE(q.eccezione, false), 'eccezione_motivo', q.eccezione_motivo, 'prima_decisione', q.prima_decisione, 'posso', public.ferie_lato_puo(q.id), 'titolo', q.titolo,$x$])
    ) AS v(firma, ancore, nuovi)
  LOOP
    d := pg_get_functiondef(f.firma::regprocedure);
    IF position('407' in d) > 0 OR position('ferie_lato_puo' in d) > 0 OR position('ferie_eccezioni_attive' in d) > 0 THEN CONTINUE; END IF;  -- gia' fatta
    n := d;
    FOR i IN 1 .. array_length(f.ancore, 1) LOOP
      IF (length(n) - length(replace(n, f.ancore[i], ''))) / length(f.ancore[i]) <> 1 THEN
        RAISE EXCEPTION '407: ancora % non trovata una e una sola volta in %', i, f.firma;
      END IF;
      n := replace(n, f.ancore[i], f.nuovi[i]);
    END LOOP;
    EXECUTE n;
  END LOOP;

  -- il trigger del lunedi': c'e' qualcosa da controllare anche con la guida provvisoria
  d := pg_get_functiondef('public.leave_request_days_lunedi()'::regprocedure);
  IF position('ferie_lunedi_ce_guida' in d) = 0 THEN
    n := regexp_replace(d,
      'IF NOT EXISTS \(SELECT 1 FROM public\.outlets o\s+WHERE o\.referente_employee_id IS NOT NULL\s+AND o\.vice_referente_employee_id IS NOT NULL\) THEN',
      'IF NOT public.ferie_lunedi_ce_guida() THEN');
    IF n = d THEN
      RAISE EXCEPTION '407: controllo iniziale non trovato in leave_request_days_lunedi';
    END IF;
    EXECUTE n;
  END IF;
END
$do$;

COMMIT;

-- VERIFICA (su ogni tenant):
-- SELECT (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.outlet_leave_rules'::regclass) AS pol_regole,   -- 6
--        (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.leave_hr'::regclass) AS pol_hr,                 -- 7
--        has_table_privilege('authenticated', 'public.outlet_leave_rules', 'select') AS auth,                       -- true
--        has_table_privilege('anon', 'public.leave_hr', 'select') AS anon,                                           -- false
--        has_table_privilege('authenticated', 'public.leave_hr', 'update') AS hr_update,                             -- false
--        (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leave_requests'
--           AND column_name IN ('eccezione', 'eccezione_motivo', 'prima_decisione')) AS colonne,                     -- 3
--        (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
--           AND p.proname IN ('app_dipendente_chiedi_ferie', 'app_dipendente_ferie', 'leave_decidi', 'responsabile_ferie_elenco')
--           AND (p.prosrc ~ '407' OR p.prosrc ~ 'ferie_lato_puo' OR p.prosrc ~ 'ferie_eccezioni_attive')) AS corrette, -- 4
--        (SELECT prosrc ~ 'ferie_lunedi_ce_guida' FROM pg_proc WHERE proname = 'leave_request_days_lunedi') AS lunedi, -- true
--        public.festivo_italiano(DATE '2026-04-06') AS pasquetta_2026,                                              -- true
--        (SELECT count(*) FROM public.outlet_leave_rules) AS regole, (SELECT count(*) FROM public.leave_hr) AS hr,  -- 0, 0
--        (SELECT count(*) FROM public.leave_requests WHERE eccezione IS NOT NULL OR prima_decisione IS NOT NULL) AS toccate; -- 0
