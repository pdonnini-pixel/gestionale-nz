-- =====================================================================
-- Migrazione 407 — Ferie e permessi: chi approva, quando si possono chiedere,
--                  eccezioni, elenco HR, lunedi' con la vice provvisoria
-- =====================================================================
-- PERCHE': scheda 9 di «Regole e orari» (Patrizio, 12/11/2026).
--   - La richiesta parte dall'app e arriva alla referente del negozio e all'HR.
--     Per negozio si decide chi approva ferie, permessi ed eccezioni (referente,
--     HR o una qualsiasi delle due). L'approvazione e' SEMPRE una sola: chi e'
--     autorizzato approva, sotto la sua responsabilita', e resta nel registro
--     (leave_request_events). Niente doppia approvazione (Patrizio, 12/11/2026).
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
-- REVISIONE (12/11/2026, dopo i tre revisori):
--   - eventi gia' salvati con UNA sola voce spenta (blocca_ferie = true): oggi bloccano
--     tutte e due; la 407 li porta a tutte e due spente (il valore di prima resta in
--     regole.prima_407) finche' non vengono risalvati. Unico UPDATE su righe esistenti:
--     cambia due chiavi di un jsonb e ne aggiunge una, non perde niente.
--   - giorno speciale singolo senza voci sue: segue la riga «Festivi e giorni speciali»
--     della scheda; nei negozi senza scheda resta bloccato come oggi.
--   - trigger leave_requests_campi_protetti: eccezione e i passaggi di stato che
--     decidono non si scrivono piu' direttamente dalla tabella.
--   - lunedi' con la guida provvisoria: messaggio senza «e' gia' assente l'altra».
--
-- TERZO GIRO (12/11/2026, revisore di sicurezza):
--   - controproposte: leave_rispondi_controproposta (320) creava una richiesta gia'
--     approvata con una firma sola e senza guardare i giorni vietati. Ora la richiesta
--     nata dalla controproposta rispetta le regole del negozio: un giorno vietato passa
--     solo come eccezione (se il negozio le ha accese) e decide solo chi puo' decidere
--     in quel negozio. Poi nasce approvata, come prima.
--   - negozio, persona e azienda di una richiesta non in bozza non si cambiano dalla
--     tabella: per cambiarla si ritira e si rifa'.
--
-- QUARTO GIRO (12/11/2026, Patrizio): «se un responsabile approva una ferie o un
--   permesso, lo approva solo una persona, punto». Tolta la doppia approvazione da
--   tutto: niente colonne *_entrambe, niente prima_decisione, niente seconda firma.
--
-- DIPENDE da 393 (lunedi'), 399 e 405 (giorni_pieni, riposi_min_settimana,
-- outlet_events.tipo e regole). Verificato in lettura il 12/11/2026: le funzioni
-- da correggere sono identiche su NZ e Zago.
--
-- NO DATA LOSS: CREATE TABLE, ADD COLUMN senza default, funzioni. Nessuna richiesta
-- esistente cambia stato (unico UPDATE: gli eventi con una voce sola, vedi sopra).
-- Tenant: NZ e Zago (Made non riceve piu' migration dal 03/11/2026).
-- =====================================================================

BEGIN;

-- ── 1. Le scelte del negozio ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.outlet_leave_rules (
  outlet_id            uuid PRIMARY KEY REFERENCES public.outlets(id),
  company_id           uuid NOT NULL REFERENCES public.companies(id),
  -- chi approva (NULL = si', come oggi). Accese tutte e due = approva una qualsiasi delle due
  ferie_referente      boolean,
  ferie_hr             boolean,
  permessi_referente   boolean,
  permessi_hr          boolean,
  -- eccezioni: attive solo se almeno una delle due e' true
  eccezioni_referente  boolean,
  eccezioni_hr         boolean,
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
-- una voce che nessuno puo' approvare non si salva (le eccezioni si': tutte e due spente = niente eccezioni)
ALTER TABLE public.outlet_leave_rules DROP CONSTRAINT IF EXISTS outlet_leave_rules_ferie_qualcuno;
ALTER TABLE public.outlet_leave_rules ADD CONSTRAINT outlet_leave_rules_ferie_qualcuno
  CHECK (COALESCE(ferie_referente, true) OR COALESCE(ferie_hr, true));
ALTER TABLE public.outlet_leave_rules DROP CONSTRAINT IF EXISTS outlet_leave_rules_permessi_qualcuno;
ALTER TABLE public.outlet_leave_rules ADD CONSTRAINT outlet_leave_rules_permessi_qualcuno
  CHECK (COALESCE(permessi_referente, true) OR COALESCE(permessi_hr, true));
COMMENT ON TABLE public.outlet_leave_rules IS
  'Ferie e permessi per negozio (Patrizio, 12/11/2026): chi approva (referente del negozio, HR: l''approvazione e'' sempre una sola, di chi e'' autorizzato) e in quali giorni si possono chiedere. Colonne NULL o riga assente = come prima della 407. Dove un giorno e'' spento la richiesta passa solo come eccezione, se eccezioni_referente o eccezioni_hr e'' true.';
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
REVOKE ALL ON public.outlet_leave_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outlet_leave_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outlet_leave_rules TO service_role;

-- ── 2. L'elenco HR: lo cambia solo il Super Advisor ────────────────────
CREATE TABLE IF NOT EXISTS public.leave_hr (
  company_id  uuid NOT NULL REFERENCES public.companies(id),
  user_id     uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,  -- togliere un utente lo toglie dall'elenco
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid DEFAULT auth.uid(),
  PRIMARY KEY (company_id, user_id)
);
COMMENT ON TABLE public.leave_hr IS
  'Chi e'' HR per ferie e permessi (Patrizio, 12/11/2026): un''appartenenza a parte, non un profilo; piu'' persone ammesse. La cambia solo il Super Advisor. Finche'' e'' vuota, dal lato HR approva chi approvava prima (posso_decidere_ferie). Chi e'' in elenco puo'' decidere le richieste (posso_decidere_ferie la riconosce), salvo i profili dipendente, operatore di cassa e responsabile.';

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
REVOKE ALL ON public.leave_hr FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.leave_hr TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_hr TO service_role;

-- ── 3. La richiesta: eccezione ─────────────────────────────────────────
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS eccezione boolean,
  ADD COLUMN IF NOT EXISTS eccezione_motivo text;
COMMENT ON COLUMN public.leave_requests.eccezione IS
  'true = chiesta come eccezione: almeno un giorno cade dove ferie o permessi non si possono chiedere (giorno caldo, evento, regola del negozio). NULL = richiesta normale.';
COMMENT ON COLUMN public.leave_requests.eccezione_motivo IS 'Perche'' e'' un''eccezione: i giorni e la regola, come li ha visti chi ha chiesto.';
-- Eventi salvati prima della 407 con una sola voce spenta: blocca_ferie = true li faceva
-- bloccare tutte e due. Restano cosi' (tutte e due spente) finche' non vengono risalvati;
-- il valore di prima resta in regole.prima_407 (lo usa il rollback).
UPDATE public.outlet_events
   SET regole = regole || jsonb_build_object('ferie', false, 'permessi', false,
         'prima_407', jsonb_build_object('ferie', regole -> 'ferie', 'permessi', regole -> 'permessi'))
 WHERE blocca_ferie
   AND jsonb_typeof(regole) = 'object'
   AND NOT (regole ? 'prima_407')
   AND (COALESCE(regole ->> 'ferie', '') = 'true' OR COALESCE(regole ->> 'permessi', '') = 'true');

-- Eccezione e decisione si scrivono solo dalle funzioni delle ferie
-- (SECURITY DEFINER: dentro di loro current_user non e' piu' authenticated). Dalla tabella,
-- con il proprio profilo, restano i passaggi che il gestionale fa gia': bozza e inviata
-- all'inserimento, bozza <-> inviata, e «ritirata» (scheda Richieste).
CREATE OR REPLACE FUNCTION public.leave_requests_campi_protetti()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.eccezione IS NOT NULL OR NEW.eccezione_motivo IS NOT NULL THEN
      RAISE EXCEPTION 'L''eccezione di una richiesta si scrive solo dall''app e da Approvazioni.' USING ERRCODE = '42501';
    END IF;
    IF NEW.stato NOT IN ('bozza', 'inviata') THEN
      RAISE EXCEPTION 'Una richiesta nasce in bozza o inviata: la decisione passa da Approvazioni.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.eccezione, NEW.eccezione_motivo) IS DISTINCT FROM (OLD.eccezione, OLD.eccezione_motivo) THEN
    RAISE EXCEPTION 'L''eccezione di una richiesta si scrive solo dall''app e da Approvazioni.' USING ERRCODE = '42501';
  END IF;
  IF NEW.stato IS DISTINCT FROM OLD.stato
     AND NEW.stato <> 'ritirata'
     AND NOT (OLD.stato IN ('bozza', 'inviata') AND NEW.stato IN ('bozza', 'inviata')) THEN
    RAISE EXCEPTION 'Lo stato di una richiesta decisa si cambia solo da Approvazioni.' USING ERRCODE = '42501';
  END IF;
  -- negozio, persona e azienda decidono chi approva: fuori dalla bozza non si cambiano
  IF OLD.stato <> 'bozza'
     AND (NEW.outlet_code, NEW.employee_id, NEW.company_id) IS DISTINCT FROM (OLD.outlet_code, OLD.employee_id, OLD.company_id) THEN
    RAISE EXCEPTION 'Negozio e persona di una richiesta già inviata non si cambiano: ritirala e rifalla.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.leave_requests_campi_protetti() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_leave_requests_campi_protetti ON public.leave_requests;
CREATE TRIGGER trg_leave_requests_campi_protetti
  BEFORE INSERT OR UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.leave_requests_campi_protetti();

-- Lo stesso per i giorni: la decisione vive anche in leave_request_days.stato, e il saldo conta i
-- giorni approvati. Dalla tabella, con il proprio profilo, i giorni si scrivono solo «richiesti» e
-- solo finche' la richiesta e' in bozza o inviata (e' quello che fa il gestionale: Richieste, la
-- finestra del turno, la proposta dal piano del mese). Decidere passa dalle funzioni delle ferie.
CREATE OR REPLACE FUNCTION public.leave_request_days_campi_protetti()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_stato text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT q.stato INTO v_stato FROM public.leave_requests q
   WHERE q.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.request_id ELSE NEW.request_id END;
  IF TG_OP = 'DELETE' THEN
    IF v_stato IS NOT NULL AND v_stato NOT IN ('bozza', 'inviata') THEN
      RAISE EXCEPTION 'I giorni di una richiesta decisa si cambiano solo da Approvazioni.' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.stato IS DISTINCT FROM 'richiesto' OR COALESCE(v_stato, 'bozza') NOT IN ('bozza', 'inviata') THEN
      RAISE EXCEPTION 'I giorni si aggiungono solo a una richiesta ancora da decidere, come richiesti: la decisione passa da Approvazioni.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.stato IS DISTINCT FROM OLD.stato OR NEW.request_id IS DISTINCT FROM OLD.request_id THEN
    RAISE EXCEPTION 'La decisione sui giorni di una richiesta passa da Approvazioni.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_stato, 'bozza') NOT IN ('bozza', 'inviata')
     AND (NEW.ore, NEW.voce, NEW.data, NEW.tipo) IS DISTINCT FROM (OLD.ore, OLD.voce, OLD.data, OLD.tipo) THEN
    RAISE EXCEPTION 'I giorni di una richiesta decisa si cambiano solo da Approvazioni.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.leave_request_days_campi_protetti() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_leave_request_days_campi_protetti ON public.leave_request_days;
CREATE TRIGGER trg_leave_request_days_campi_protetti
  BEFORE INSERT OR UPDATE OR DELETE ON public.leave_request_days
  FOR EACH ROW EXECUTE FUNCTION public.leave_request_days_campi_protetti();

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

-- La persona e' responsabile o vice PROVVISORIA (o lo e' l'altra)? Allora il messaggio del
-- lunedi' non deve dire che l'altra e' assente: non sanno di essere una coppia.
CREATE OR REPLACE FUNCTION public.ferie_lunedi_provvisoria(p_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.outlets o CROSS JOIN LATERAL public.guida_negozio_effettiva(o.id) g
     WHERE p_employee_id IN (g.responsabile, g.vice)
       AND (o.referente_employee_id IS NULL OR o.vice_referente_employee_id IS NULL
            OR o.referente_employee_id = o.vice_referente_employee_id));
$function$;
REVOKE ALL ON FUNCTION public.ferie_lunedi_provvisoria(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ferie_lunedi_provvisoria(uuid) TO service_role;

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
  v_speciale boolean := false; -- giorno speciale singolo senza voci sue: segue la riga dei festivi
  v_giorno_nome text;          -- il suo nome, per il messaggio
  v_giorno_blocca text;        -- il suo nome se ha blocca_ferie: nei negozi senza scheda blocca come oggi
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
    ELSIF ev.tipo = 'giorno' THEN
      -- giorno speciale singolo: decide la riga «Festivi e giorni speciali» del negozio
      v_speciale := true;
      v_giorno_nome := ev.nome;
      IF ev.blocca_ferie THEN v_giorno_blocca := ev.nome; END IF;
    ELSIF ev.blocca_ferie THEN
      -- evento di prima della 407: stesso messaggio di sempre
      RETURN format('Il %s c''è %s: niente ferie né permessi.', v_g, ev.nome);
    END IF;
  END LOOP;
  IF v_deciso THEN RETURN NULL; END IF;

  SELECT * INTO reg FROM public.outlet_leave_rules WHERE outlet_id = e.outlet_id;
  IF NOT FOUND THEN
    -- negozio senza scheda: il giorno speciale blocca come ha sempre fatto
    IF v_giorno_blocca IS NOT NULL THEN
      RETURN format('Il %s c''è %s: niente ferie né permessi.', v_g, v_giorno_blocca);
    END IF;
    RETURN NULL;
  END IF;

  IF v_speciale OR public.festivo_italiano(p_data) THEN
    v_ammessa := COALESCE(CASE WHEN v_chiave = 'ferie' THEN reg.ferie_festivi ELSE reg.permessi_festivi END, true);
    IF NOT v_ammessa AND v_giorno_nome IS NOT NULL THEN
      RETURN format('Il %s c''è %s: nei giorni speciali il negozio lavora al completo, niente %s.', v_g, v_giorno_nome, v_cosa);
    END IF;
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
-- Le scelte del negozio per QUESTA richiesta: { referente, hr }. NULL = negozio senza regole.
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
BEGIN
  SELECT * INTO q FROM public.leave_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO reg FROM public.outlet_leave_rules WHERE outlet_id = public.ferie_negozio_richiesta(p_request_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF COALESCE(q.eccezione, false) THEN
    v_ref := COALESCE(reg.eccezioni_referente, false);
    v_hr  := COALESCE(reg.eccezioni_hr, false);
  ELSE
    v_f := EXISTS (SELECT 1 FROM public.leave_request_days d WHERE d.request_id = p_request_id AND d.voce = 'F01');
    v_p := EXISTS (SELECT 1 FROM public.leave_request_days d WHERE d.request_id = p_request_id AND d.voce <> 'F01');
    -- una richiesta con ferie e permessi insieme: deve poter decidere chi puo' tutte e due
    v_ref := (NOT v_f OR COALESCE(reg.ferie_referente, true)) AND (NOT v_p OR COALESCE(reg.permessi_referente, true));
    v_hr  := (NOT v_f OR COALESCE(reg.ferie_hr, true)) AND (NOT v_p OR COALESCE(reg.permessi_hr, true));
  END IF;
  -- nessuno dei due lati potrebbe decidere (ferie e permessi insieme con lati diversi, oppure
  -- eccezioni spente dopo che la richiesta e' partita): una richiesta non resta senza giudice
  IF NOT v_ref AND NOT v_hr THEN
    v_ref := true; v_hr := true;
  END IF;
  RETURN jsonb_build_object('referente', v_ref, 'hr', v_hr);
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
-- controlla leave_decidi come prima). L'approvazione e' una sola: chi puo' decidere decide.
CREATE OR REPLACE FUNCTION public.ferie_lato_puo(p_request_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  q       public.leave_requests%ROWTYPE;
  v_reg   jsonb;
  v_lato  text := public.ferie_mio_lato();
  v_super boolean := COALESCE((SELECT public.get_my_role())::text, '') = 'super_advisor';
BEGIN
  SELECT * INTO q FROM public.leave_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RETURN false; END IF;
  -- solo le richieste della propria azienda (chi non ha un utente, cron e service role, non passa da qui)
  IF (SELECT auth.uid()) IS NOT NULL AND q.company_id IS DISTINCT FROM (SELECT public.get_my_company_id()) THEN RETURN false; END IF;
  v_reg := public.ferie_regole_richiesta(p_request_id);
  IF v_reg IS NULL THEN RETURN true; END IF;
  IF v_super THEN RETURN true; END IF;
  IF v_lato = 'referente' THEN RETURN (v_reg ->> 'referente')::boolean; END IF;
  IF NOT (v_reg ->> 'hr')::boolean THEN RETURN false; END IF;
  -- elenco HR: vuoto = chi decideva prima; altrimenti solo chi e' nell'elenco
  IF NOT EXISTS (SELECT 1 FROM public.leave_hr h WHERE h.company_id = q.company_id) THEN RETURN true; END IF;
  RETURN EXISTS (SELECT 1 FROM public.leave_hr h
                  WHERE h.company_id = q.company_id AND h.user_id = (SELECT auth.uid()));
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
DECLARE
  v_lato  text := public.ferie_mio_lato();
BEGIN
  IF public.ferie_lato_puo(p_request_id) THEN RETURN; END IF;
  RAISE EXCEPTION '%', CASE WHEN v_lato = 'referente'
    THEN 'In questo negozio questa richiesta la decide l''HR.'
    ELSE 'In questo negozio questa richiesta non la decidi tu: guarda in «Regole e orari» chi approva ferie e permessi.' END
    USING ERRCODE = '42501';
END
$function$;
REVOKE ALL ON FUNCTION public.ferie_controlla_lato(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ferie_controlla_lato(uuid) TO service_role;

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
        $x$'id', q.id, 'stato', q.stato, 'eccezione', COALESCE(q.eccezione, false), 'note', q.note_dipendente,$x$,
        $x$    'eccezioni', public.ferie_eccezioni_attive(e.outlet_id),  -- 407
    'senza_ferie', COALESCE(($x$]),
      -- la decisione
      ('public.leave_decidi(uuid,uuid[],text)', ARRAY[
        $x$  IF r.stato NOT IN ('inviata', 'approvata', 'approvata_parziale', 'respinta') THEN$x$], ARRAY[
        $x$  PERFORM public.ferie_controlla_lato(p_request_id);  -- 407: chi approva, per negozio

  IF r.stato NOT IN ('inviata', 'approvata', 'approvata_parziale', 'respinta') THEN$x$]),
      -- l'elenco della referente
      ('public.responsabile_ferie_elenco(boolean)', ARRAY[
        $x$'prova', e.is_demo, 'titolo', q.titolo,$x$], ARRAY[
        $x$'prova', e.is_demo, 'eccezione', COALESCE(q.eccezione, false), 'eccezione_motivo', q.eccezione_motivo, 'posso', public.ferie_lato_puo(q.id), 'titolo', q.titolo,$x$])
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

  -- la controproposta accettata rispetta le regole del negozio (terzo giro): la richiesta nasce
  -- inviata, si guardano i giorni vietati e chi puo' decidere, poi e' approvata (una sola firma)
  d := pg_get_functiondef('public.leave_rispondi_controproposta(uuid,boolean,text)'::regprocedure);
  IF position('407' in d) = 0 THEN
    n := d;
    FOR f IN
      SELECT * FROM (VALUES
        ($x$  v_new uuid;$x$,
         $x$  v_new uuid;
  v_407 record;  -- 407
  v_blk text;
  v_ecc text;$x$),
        ($x$r.outlet_code, 'approvata', coalesce(r.titolo, 'Ferie') || ' (date proposte)',$x$,
         $x$r.outlet_code, 'inviata', coalesce(r.titolo, 'Ferie') || ' (date proposte)',$x$),
        ($x$NULLIF(v_nome, ''), now(), now(), c.proposta_da, c.proposta_da_nome,
            'Date proposte da ' || coalesce(c.proposta_da_nome, 'chi decide le ferie') || ' e accettate.')$x$,
         $x$NULLIF(v_nome, ''), now(), NULL, NULL, NULL,
            NULL)$x$),
        ($x$(g->>'ore')::numeric, 'approvato'
      FROM jsonb_array_elements(c.giorni) g;$x$,
         $x$(g->>'ore')::numeric, 'richiesto'
      FROM jsonb_array_elements(c.giorni) g;
    -- 407: i giorni dove ferie o permessi non si possono chiedere passano solo come eccezione
    FOR v_407 IN SELECT d.data, d.voce FROM leave_request_days d WHERE d.request_id = v_new ORDER BY d.data LOOP
      v_blk := public.ferie_blocco_giorno(c.employee_id, v_407.data, CASE WHEN v_407.voce = 'F01' THEN 'ferie' ELSE 'permessi' END);
      IF v_blk IS NOT NULL THEN
        IF NOT public.ferie_eccezioni_attive((SELECT e.outlet_id FROM employees e WHERE e.id = c.employee_id)) THEN
          RAISE EXCEPTION '%', v_blk USING ERRCODE = '22023';
        END IF;
        v_ecc := left(concat_ws(' ', v_ecc, v_blk), 500);
      END IF;
    END LOOP;
    IF v_ecc IS NOT NULL THEN
      UPDATE leave_requests SET eccezione = true, eccezione_motivo = v_ecc WHERE id = v_new;
    END IF;
    -- 407: chi approva, per negozio
    PERFORM public.ferie_controlla_lato(v_new);
    UPDATE leave_request_days SET stato = 'approvato' WHERE request_id = v_new;
    UPDATE leave_requests
       SET stato = 'approvata', decisa_il = now(), decisa_da = c.proposta_da, decisa_da_nome = c.proposta_da_nome,
           motivazione = 'Date proposte da ' || coalesce(c.proposta_da_nome, 'chi decide le ferie') || ' e accettate.'
     WHERE id = v_new;
    -- 407: nel registro resta chi ha registrato l'accettazione
    INSERT INTO leave_request_events (company_id, request_id, evento, stato_a, nota, dettaglio, utente_id, utente_nome)
    VALUES (c.company_id, v_new, 'decisione', 'approvata', 'Date proposte e accettate',
            jsonb_build_object('controproposta', c.id, 'proposta_da', c.proposta_da_nome), auth.uid(), NULLIF(v_nome, ''));$x$),
        ($x$  UPDATE leave_counterproposals
     SET stato = CASE WHEN p_accetta THEN 'accettata' ELSE 'rifiutata' END,$x$,
         $x$  -- 407: la risposta alla proposta resta nel registro della richiesta di partenza
  INSERT INTO leave_request_events (company_id, request_id, evento, nota, dettaglio, utente_id, utente_nome)
  VALUES (c.company_id, c.request_id, CASE WHEN p_accetta THEN 'controproposta_accettata' ELSE 'controproposta_rifiutata' END,
          NULLIF(btrim(p_nota), ''), jsonb_build_object('controproposta', c.id, 'nuova_richiesta', v_new), auth.uid(), NULLIF(v_nome, ''));
  UPDATE leave_counterproposals
     SET stato = CASE WHEN p_accetta THEN 'accettata' ELSE 'rifiutata' END,$x$)
      ) AS v(ancora, nuovo)
    LOOP
      IF (length(n) - length(replace(n, f.ancora, ''))) / length(f.ancora) <> 1 THEN
        RAISE EXCEPTION '407: ancora non trovata una e una sola volta in leave_rispondi_controproposta: %', left(f.ancora, 60);
      END IF;
      n := replace(n, f.ancora, f.nuovo);
    END LOOP;
    EXECUTE n;
  END IF;

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

  -- il messaggio del lunedi': con la guida provvisoria non dice che l'altra e' assente
  d := pg_get_functiondef('public.ferie_lunedi_testo(uuid,date[],boolean)'::regprocedure);
  IF position('ferie_lunedi_provvisoria' in d) = 0 THEN
    n := replace(d, $x$|| ' è già assente l''altra fra responsabile e vice del negozio'$x$,
      $x$|| CASE WHEN public.ferie_lunedi_provvisoria(p_employee_id) THEN '' ELSE ' è già assente l''altra fra responsabile e vice del negozio' END$x$);
    IF n = d THEN
      RAISE EXCEPTION '407: frase non trovata in ferie_lunedi_testo';
    END IF;
    EXECUTE n;
  END IF;

  -- chi puo' decidere: l'elenco HR basta (Patrizio, 12/11/2026), senza stare anche fra i
  -- «Referenti ferie». Vale per i profili che gia' leggono le richieste nel gestionale: non
  -- per dipendente e operatore di cassa, e non per il profilo responsabile, che resta nel suo
  -- recinto dei negozi (ferie_responsabile_puo). posso_decidere_ferie() la usano solo le
  -- funzioni delle ferie: essere HR non apre altro.
  d := pg_get_functiondef('public.posso_decidere_ferie()'::regprocedure);
  IF position('leave_hr' in d) = 0 THEN
    IF (length(d) - length(replace(d, $x$        AND a.attivo
    )$x$, ''))) / length($x$        AND a.attivo
    )$x$) <> 1 THEN
      RAISE EXCEPTION '407: ancora non trovata una e una sola volta in posso_decidere_ferie';
    END IF;
    n := replace(d, $x$        AND a.attivo
    )$x$, $x$        AND a.attivo
    )
    OR (  -- 407: l'elenco HR basta per decidere
      COALESCE((public.get_my_role())::text, '') NOT IN ('', 'dipendente', 'operatore_cassa', 'responsabile')
      AND EXISTS (
        SELECT 1 FROM public.leave_hr h
        WHERE h.user_id = auth.uid()
          AND h.company_id = public.get_my_company_id()
      )
    )$x$);
    EXECUTE n;
  END IF;
END
$do$;

COMMENT ON TABLE public.leave_counterproposals IS
  'Altre date proposte da chi decide le ferie. La richiesta originale si chiude respinta con il motivo; se la persona accetta nasce una richiesta nuova che segue le regole del negozio (407): nasce approvata (una sola approvazione), come eccezione se tocca un giorno vietato; l''accetta solo chi puo'' decidere in quel negozio.';

COMMIT;

-- VERIFICA (su ogni tenant):
-- SELECT (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.outlet_leave_rules'::regclass) AS pol_regole,   -- 6
--        (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.leave_hr'::regclass) AS pol_hr,                 -- 7
--        has_table_privilege('authenticated', 'public.outlet_leave_rules', 'select') AS auth,                       -- true
--        has_table_privilege('anon', 'public.leave_hr', 'select') AS anon,                                           -- false
--        has_table_privilege('authenticated', 'public.leave_hr', 'update') AS hr_update,                             -- false
--        (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leave_requests'
--           AND column_name IN ('eccezione', 'eccezione_motivo')) AS colonne,                                        -- 2
--        (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
--           AND p.proname IN ('app_dipendente_chiedi_ferie', 'app_dipendente_ferie', 'leave_decidi', 'responsabile_ferie_elenco')
--           AND (p.prosrc ~ '407' OR p.prosrc ~ 'ferie_lato_puo' OR p.prosrc ~ 'ferie_eccezioni_attive')) AS corrette, -- 4
--        (SELECT prosrc ~ 'ferie_lunedi_ce_guida' FROM pg_proc WHERE proname = 'leave_request_days_lunedi') AS lunedi, -- true
--        public.festivo_italiano(DATE '2026-04-06') AS pasquetta_2026,                                              -- true
--        (SELECT prosrc ~ 'ferie_lunedi_provvisoria' FROM pg_proc WHERE proname = 'ferie_lunedi_testo') AS lunedi_testo, -- true
--        (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_leave_requests_campi_protetti', 'trg_leave_request_days_campi_protetti')) AS trigger_campi, -- 2
--        (SELECT prosrc ~ 'leave_hr' FROM pg_proc WHERE proname = 'posso_decidere_ferie') AS hr_decide,               -- true
--        (SELECT prosrc ~ 'ferie_controlla_lato' FROM pg_proc WHERE proname = 'leave_rispondi_controproposta') AS controproposta, -- true
--        has_table_privilege('authenticated', 'public.leave_hr', 'truncate') AS hr_truncate,                         -- false
--        (SELECT count(*) FROM public.outlet_events WHERE regole ? 'prima_407') AS eventi_allineati,                 -- quanti erano con una voce sola
--        (SELECT count(*) FROM public.outlet_leave_rules) AS regole, (SELECT count(*) FROM public.leave_hr) AS hr,  -- 0, 0
--        (SELECT count(*) FROM public.leave_requests WHERE eccezione IS NOT NULL) AS toccate; -- 0
