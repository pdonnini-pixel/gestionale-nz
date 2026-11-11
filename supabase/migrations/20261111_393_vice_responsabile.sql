-- =====================================================================
-- 393 — Vice responsabile del negozio e regola del lunedi'
--       (Patrizio, 11/11/2026)
-- =====================================================================
-- PERCHE'
--   Ogni negozio ha una responsabile (outlets.referente_employee_id, 319 e
--   337). Patrizio: serve anche una VICE, la persona che fa il versamento in
--   banca quando la responsabile non c'e'. Regola fissa: ogni LUNEDI' almeno
--   una delle due deve essere al lavoro in negozio. Quindi responsabile e
--   vice possono essere in ferie insieme, ma non se il periodo in comune
--   contiene un lunedi': la seconda richiesta va fermata, con il motivo
--   scritto chiaro. La malattia non si puo' impedire: quella si segnala nella
--   pagina dei turni (src/lib/guidaNegozio.ts), qui non c'e' niente.
--   «Prima si crea lo strumento, poi si inseriscono i nomi»: nessun nome
--   precaricato, la colonna nasce vuota e finche' un negozio non ha tutte e
--   due le figure la regola non ferma nessuno.
--
-- COME
--   1. outlets.vice_referente_employee_id: la vice di oggi. Non puo' essere
--      la stessa persona della responsabile (CHECK).
--   2. outlet_vice_storico: chi e' stata vice di quale negozio e da quando.
--      Tabella gemella di outlet_referenti_storico (337), NON una colonna
--      «ruolo» in piu' su quella: la 337 ha un indice unico «un solo periodo
--      aperto per negozio» e organico_imposta_referente_dal legge «il periodo
--      aperto del negozio»; con le righe della vice nella stessa tabella si
--      sarebbero dovuti cambiare indice, funzione e chi legge lo storico.
--   3. organico_imposta_vice(negozio, persona): gemella di
--      organico_imposta_referente, con le stesse guardie (364 e 380) e lo
--      stesso controllo di ruolo e di azienda. Persona vuota = negozio senza
--      vice.
--   4. Se la vice diventa responsabile (da Organico o da Turni, con le
--      funzioni della 337 che NON vengono toccate), il posto di vice si
--      libera da solo e lo storico lo registra (trigger su outlets, scatta
--      solo in quel caso).
--   5. La regola del lunedi' sulle ferie:
--        ferie_giorni_interi()      giorni di assenza a giornata intera
--        ferie_lunedi_conflitti()   i lunedi' in cui manca anche l'altra
--        ferie_lunedi_testo()       il motivo, in italiano
--        ferie_lunedi_senza_guida() e ferie_lunedi_motivo(): le due RPC per
--                                   il gestionale (controllo prima di salvare)
--      e il blocco vero: un trigger su leave_request_days.
--
-- PERCHE' UN TRIGGER E NON LE FUNZIONI DELLE RICHIESTE
--   Una richiesta di ferie nasce da piu' strade: app del dipendente
--   (app_dipendente_chiedi_ferie), scheda Richieste del gestionale (INSERT
--   diretto dal browser, nessuna funzione), ferie messe dal calendario dei
--   piani mensili (INSERT diretto), controproposte (320), approvazione
--   (leave_decidi). Diverse di quelle funzioni sono state riscritte sul
--   database vivo a partire da pg_get_functiondef (364, 378, 379, 380): il
--   testo nel repository non e' piu' quello che gira. Riscriverle da qui
--   rischierebbe di togliere una guardia. Tutte le strade pero' finiscono con
--   una riga in leave_request_days: il controllo sta li', una volta sola, e
--   nessuna funzione esistente cambia.
--
-- COSA FERMA, ESATTAMENTE
--   * Solo i lunedi' da oggi in poi (le ferie passate, ricopiate da un modulo,
--     non si fermano: sono gia' successe).
--   * Solo chi e' responsabile o vice di un negozio che ha TUTTE E DUE le
--     figure. Se ne manca una, niente blocco.
--   * Solo le assenze a giornata intera: una riga «giornata», oppure ore che
--     in quel giorno arrivano alla giornata della persona (l'app divide un
--     permesso di una giornata fra ex festivita' e ROL in due righe a ore).
--     Mezza giornata e permessi a ore non contano: la persona e' in negozio e
--     il versamento e' in cassa continua.
--   * Alla RICHIESTA conta l'assenza dell'altra sia in attesa sia approvata;
--     all'APPROVAZIONE conta solo quella gia' approvata (cosi' due richieste
--     vecchie in attesa sullo stesso lunedi' non si bloccano a vicenda: la
--     prima si approva, la seconda no).
--   * Le bozze non impegnano niente e non si controllano.
--
-- NO DATA LOSS: solo aggiunte (una colonna, una tabella, funzioni, tre
--   trigger). Nessun DROP di dati, nessun DELETE, nessun UPDATE di righe
--   esistenti. I DROP TRIGGER/POLICY IF EXISTS servono solo a poterla
--   rilanciare.
-- TENANT: NZ e Zago (Made non riceve piu' migration dal 03/11/2026).
-- ROLLBACK: 20261111_393_vice_responsabile_ROLLBACK.sql
-- =====================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. La vice di oggi
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.outlets
  ADD COLUMN IF NOT EXISTS vice_referente_employee_id uuid REFERENCES public.employees(id);

COMMENT ON COLUMN public.outlets.vice_referente_employee_id IS
  'Vice responsabile del negozio (Patrizio, 11/11/2026): fa il versamento quando la responsabile non c''e''. Si imposta con organico_imposta_vice. Ogni lunedi'' almeno una fra responsabile e vice deve essere in negozio.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'outlets_vice_diversa_da_responsabile'
                    AND conrelid = 'public.outlets'::regclass) THEN
    ALTER TABLE public.outlets
      ADD CONSTRAINT outlets_vice_diversa_da_responsabile
      CHECK (vice_referente_employee_id IS NULL
             OR vice_referente_employee_id IS DISTINCT FROM referente_employee_id);
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Lo storico delle vice (gemello di outlet_referenti_storico, 337)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.outlet_vice_storico (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  outlet_id       uuid NOT NULL REFERENCES public.outlets(id),
  employee_id     uuid REFERENCES public.employees(id),
  dal             date NOT NULL,
  al              date,
  created_by      uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outlet_vice_storico_periodo CHECK (al IS NULL OR al >= dal)
);

COMMENT ON TABLE public.outlet_vice_storico IS
  'Storico delle vice responsabili di negozio (Patrizio, 11/11/2026). La vice di oggi e'' outlets.vice_referente_employee_id. Si scrive solo con organico_imposta_vice.';

CREATE INDEX IF NOT EXISTS outlet_vice_storico_outlet_idx
  ON public.outlet_vice_storico (outlet_id, dal);
CREATE INDEX IF NOT EXISTS outlet_vice_storico_company_idx
  ON public.outlet_vice_storico (company_id);
-- Un solo periodo aperto per negozio.
CREATE UNIQUE INDEX IF NOT EXISTS outlet_vice_storico_aperto_uq
  ON public.outlet_vice_storico (outlet_id) WHERE al IS NULL;

ALTER TABLE public.outlet_vice_storico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outlet_vice_storico_select ON public.outlet_vice_storico;
CREATE POLICY outlet_vice_storico_select ON public.outlet_vice_storico
  FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()));
-- Nessuna policy di scrittura: si scrive solo dalle funzioni SECURITY DEFINER.
-- Stessi recinti dello storico dei responsabili (337).
DROP POLICY IF EXISTS cash_operator_block ON public.outlet_vice_storico;
CREATE POLICY cash_operator_block ON public.outlet_vice_storico AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa');
DROP POLICY IF EXISTS dipendente_block ON public.outlet_vice_storico;
CREATE POLICY dipendente_block ON public.outlet_vice_storico AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente');

REVOKE ALL ON public.outlet_vice_storico FROM anon;
GRANT SELECT ON public.outlet_vice_storico TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outlet_vice_storico TO service_role;

-- Niente si cancella (come lo storico dei responsabili).
CREATE OR REPLACE FUNCTION public.outlet_vice_storico_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Lo storico delle vice responsabili non si cancella: si cambia la vice.';
END;
$$;

DROP TRIGGER IF EXISTS trg_outlet_vice_storico_no_delete ON public.outlet_vice_storico;
CREATE TRIGGER trg_outlet_vice_storico_no_delete
  BEFORE DELETE ON public.outlet_vice_storico
  FOR EACH ROW EXECUTE FUNCTION public.outlet_vice_storico_no_delete();

-- Scrive lo storico: stessa logica dei periodi della 337. Interna (la usano
-- organico_imposta_vice e il trigger della promozione), nessun ruolo dell'API
-- la chiama.
CREATE OR REPLACE FUNCTION public.organico_vice_storico_segna(
  p_company_id uuid, p_outlet_id uuid, p_employee_id uuid, p_dal date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_aperto public.outlet_vice_storico%ROWTYPE;
BEGIN
  SELECT * INTO v_aperto FROM public.outlet_vice_storico
   WHERE outlet_id = p_outlet_id AND al IS NULL
   FOR UPDATE;

  IF FOUND AND v_aperto.employee_id IS NOT DISTINCT FROM p_employee_id THEN
    NULL; -- stessa vice: lo storico non cambia
  ELSIF NOT FOUND AND p_employee_id IS NULL THEN
    NULL; -- non c'era e non c'e': niente da scrivere
  ELSIF FOUND AND p_dal <= v_aperto.dal THEN
    -- Cambio nello stesso giorno dell'ultimo: era una correzione.
    UPDATE public.outlet_vice_storico SET employee_id = p_employee_id WHERE id = v_aperto.id;
  ELSE
    IF FOUND THEN
      UPDATE public.outlet_vice_storico SET al = p_dal - 1 WHERE id = v_aperto.id;
    END IF;
    INSERT INTO public.outlet_vice_storico (company_id, outlet_id, employee_id, dal)
    VALUES (p_company_id, p_outlet_id, p_employee_id, p_dal);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.organico_vice_storico_segna(uuid, uuid, uuid, date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organico_vice_storico_segna(uuid, uuid, uuid, date) TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 3. La RPC: imposta la vice
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.organico_imposta_vice(p_outlet_id uuid, p_employee_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
  v_resp    uuid;
  v_oggi    date := (now() AT TIME ZONE 'Europe/Rome')::date;
BEGIN
  -- Le stesse guardie che organico_imposta_referente ha sul database vivo.
  PERFORM public.richiedi_profilo_gestionale(); -- come la 364
  PERFORM public.ruoli_operativi_non_qui(); -- come la 380

  v_company := (SELECT public.get_my_company_id());

  IF NOT public.organico_puo_scrivere() THEN
    RAISE EXCEPTION 'La vice responsabile la imposta chi tiene l''organico.';
  END IF;

  SELECT o.referente_employee_id INTO v_resp
    FROM public.outlets o
   WHERE o.id = p_outlet_id AND o.company_id = v_company
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Negozio non trovato.';
  END IF;
  IF p_employee_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_employee_id AND company_id = v_company) THEN
    RAISE EXCEPTION 'Persona non trovata.';
  END IF;
  IF p_employee_id IS NOT NULL AND p_employee_id = v_resp THEN
    RAISE EXCEPTION 'È già la responsabile di questo negozio: la vice deve essere un''altra persona.';
  END IF;

  PERFORM public.organico_vice_storico_segna(v_company, p_outlet_id, p_employee_id, v_oggi);

  UPDATE public.outlets SET vice_referente_employee_id = p_employee_id, updated_at = now()
   WHERE id = p_outlet_id AND company_id = v_company;
END;
$$;

REVOKE ALL ON FUNCTION public.organico_imposta_vice(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.organico_imposta_vice(uuid, uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 4. La vice che diventa responsabile lascia libero il posto di vice
-- ─────────────────────────────────────────────────────────────────────
-- Le funzioni della 337 (organico_imposta_referente_dal) non si toccano:
-- quando mettono come responsabile la persona che e' vice, questo trigger
-- svuota la vice nella stessa riga e chiude il suo periodo nello storico.
-- Scatta SOLO in quel caso (clausola WHEN): ogni altro UPDATE di outlets non
-- lo vede.
CREATE OR REPLACE FUNCTION public.outlets_vice_promossa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.organico_vice_storico_segna(
    NEW.company_id, NEW.id, NULL, (now() AT TIME ZONE 'Europe/Rome')::date);
  NEW.vice_referente_employee_id := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.outlets_vice_promossa() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_outlets_vice_promossa ON public.outlets;
CREATE TRIGGER trg_outlets_vice_promossa
  BEFORE UPDATE ON public.outlets
  FOR EACH ROW
  WHEN (NEW.referente_employee_id IS NOT NULL
        AND NEW.referente_employee_id = NEW.vice_referente_employee_id
        AND NEW.referente_employee_id IS DISTINCT FROM OLD.referente_employee_id)
  EXECUTE FUNCTION public.outlets_vice_promossa();

-- ─────────────────────────────────────────────────────────────────────
-- 5. La regola del lunedi' sulle ferie
-- ─────────────────────────────────────────────────────────────────────

-- 5a. In quali di queste date la persona e' assente a giornata intera.
--     p_solo_approvate = false: richieste in attesa e approvate;
--                        true : solo giorni gia' approvati.
--     p_request_id: i giorni di QUESTA richiesta contano comunque (servono al
--     trigger: mentre si decide, la richiesta non e' ancora «approvata»).
--     Interna.
CREATE OR REPLACE FUNCTION public.ferie_giorni_interi(
  p_employee_id uuid, p_date date[], p_solo_approvate boolean DEFAULT false, p_request_id uuid DEFAULT NULL)
RETURNS date[]
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH giornata AS (
    -- Le ore di una giornata, come le calcola app_dipendente_chiedi_ferie (351).
    SELECT COALESCE(
      (SELECT min(v.ore_giornata_dedotte) FROM public.v_leave_disponibilita v
        WHERE v.employee_id = p_employee_id AND v.ore_giornata_dedotte > 0),
      (SELECT COALESCE(NULLIF(e.ore_settimanali_paghe, 0) / 5.0, NULLIF(e.ore_settimanali, 0) / 5.0)
         FROM public.employees e WHERE e.id = p_employee_id),
      8)::numeric AS ore
  ), per_data AS (
    SELECT d.data, bool_or(d.tipo = 'giornata') AS intera, sum(d.ore) AS ore
      FROM public.leave_request_days d
      JOIN public.leave_requests q ON q.id = d.request_id
     WHERE q.employee_id = p_employee_id
       AND d.data = ANY (p_date)
       AND d.stato IN ('richiesto', 'approvato')
       AND (   q.id = p_request_id
            OR (NOT COALESCE(p_solo_approvate, false)
                AND q.stato IN ('inviata', 'approvata', 'approvata_parziale', 'chiusa'))
            OR (COALESCE(p_solo_approvate, false)
                AND q.stato IN ('approvata', 'approvata_parziale', 'chiusa')
                AND d.stato = 'approvato'))
     GROUP BY d.data
  )
  SELECT COALESCE(array_agg(p.data ORDER BY p.data), '{}'::date[])
    FROM per_data p CROSS JOIN giornata g
   WHERE p.intera OR p.ore >= g.ore - 0.01;
$$;

REVOKE ALL ON FUNCTION public.ferie_giorni_interi(uuid, date[], boolean, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ferie_giorni_interi(uuid, date[], boolean, uuid) TO service_role;

-- 5b. Fra le date in cui la persona sarebbe assente, i lunedi' (da oggi in
--     poi) in cui e' assente a giornata intera anche l'altra figura dello
--     stesso negozio. Se il negozio non ha tutte e due le figure: niente.
--     Interna.
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
    SELECT DISTINCT CASE WHEN o.referente_employee_id = p_employee_id
                         THEN o.vice_referente_employee_id
                         ELSE o.referente_employee_id END AS altra_id
      FROM public.outlets o
     WHERE o.referente_employee_id IS NOT NULL
       AND o.vice_referente_employee_id IS NOT NULL
       AND COALESCE(o.is_active, true)
       AND p_employee_id IN (o.referente_employee_id, o.vice_referente_employee_id)
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

-- 5c. Il motivo, in italiano. NULL = nessun problema. Interna.
CREATE OR REPLACE FUNCTION public.ferie_lunedi_testo(
  p_employee_id uuid, p_date date[], p_solo_approvate boolean DEFAULT false)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH c AS (
    SELECT k.altra_id, array_agg(DISTINCT k.data ORDER BY k.data) AS date
      FROM public.ferie_lunedi_conflitti(p_employee_id, p_date, p_solo_approvate) k
     GROUP BY k.altra_id
     ORDER BY min(k.data)
     LIMIT 1
  )
  SELECT 'Lunedì '
         || (SELECT string_agg(to_char(x, 'DD/MM'), ', ' ORDER BY x) FROM unnest(c.date) AS x)
         || ' è già in ferie o in permesso '
         || COALESCE(NULLIF(btrim(COALESCE(e.nome, e.first_name, '') || ' ' || COALESCE(e.cognome, e.last_name, '')), ''),
                     'l''altra fra responsabile e vice')
         || ': il lunedì una fra responsabile e vice deve essere in negozio per il versamento. '
         || CASE WHEN COALESCE(p_solo_approvate, false)
                 THEN CASE WHEN cardinality(c.date) = 1 THEN 'Quel lunedì non si può approvare.'
                           ELSE 'Quei lunedì non si possono approvare.' END
                 ELSE CASE WHEN cardinality(c.date) = 1 THEN 'Togli quel lunedì dalla richiesta.'
                           ELSE 'Togli quei lunedì dalla richiesta.' END
            END
    FROM c LEFT JOIN public.employees e ON e.id = c.altra_id;
$$;

REVOKE ALL ON FUNCTION public.ferie_lunedi_testo(uuid, date[], boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ferie_lunedi_testo(uuid, date[], boolean) TO service_role;

-- 5d. Le due RPC per il gestionale: «se questa persona fosse assente in
--     queste date, quali lunedi' resterebbero senza responsabile e senza
--     vice?». Servono a controllare PRIMA di salvare una richiesta. Non per
--     l'app del dipendente ne' per l'account di cassa: li' il motivo arriva
--     dal blocco stesso.
CREATE OR REPLACE FUNCTION public.ferie_lunedi_senza_guida(p_employee_id uuid, p_date date[])
RETURNS date[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ruolo text := COALESCE((SELECT public.get_my_role())::text, '');
BEGIN
  IF COALESCE(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF v_ruolo IN ('', 'operatore_cassa', 'dipendente') THEN
      RAISE EXCEPTION 'Non disponibile con questo profilo' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.employees e
                    WHERE e.id = p_employee_id AND e.company_id = (SELECT public.get_my_company_id())) THEN
      RETURN '{}'::date[];
    END IF;
  END IF;
  RETURN COALESCE(
    (SELECT array_agg(DISTINCT k.data ORDER BY k.data)
       FROM public.ferie_lunedi_conflitti(p_employee_id, COALESCE(p_date, '{}'::date[]), false) k),
    '{}'::date[]);
END;
$$;

REVOKE ALL ON FUNCTION public.ferie_lunedi_senza_guida(uuid, date[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ferie_lunedi_senza_guida(uuid, date[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ferie_lunedi_motivo(p_employee_id uuid, p_date date[])
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ruolo text := COALESCE((SELECT public.get_my_role())::text, '');
BEGIN
  IF COALESCE(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF v_ruolo IN ('', 'operatore_cassa', 'dipendente') THEN
      RAISE EXCEPTION 'Non disponibile con questo profilo' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.employees e
                    WHERE e.id = p_employee_id AND e.company_id = (SELECT public.get_my_company_id())) THEN
      RETURN NULL;
    END IF;
  END IF;
  RETURN public.ferie_lunedi_testo(p_employee_id, COALESCE(p_date, '{}'::date[]), false);
END;
$$;

REVOKE ALL ON FUNCTION public.ferie_lunedi_motivo(uuid, date[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ferie_lunedi_motivo(uuid, date[]) TO authenticated, service_role;

-- 5e. Il blocco: dopo ogni INSERT o UPDATE dei giorni di una richiesta.
--     A livello di istruzione, con le righe toccate (transition table): cosi'
--     vede insieme le due righe a ore in cui l'app divide un permesso di una
--     giornata.
CREATE OR REPLACE FUNCTION public.leave_request_days_lunedi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_oggi date := (now() AT TIME ZONE 'Europe/Rome')::date;
  r      record;
  v_msg  text;
BEGIN
  -- Finche' nessun negozio ha sia la responsabile sia la vice non c'e' niente
  -- da controllare: lo strumento va prima riempito.
  IF NOT EXISTS (SELECT 1 FROM public.outlets o
                  WHERE o.referente_employee_id IS NOT NULL
                    AND o.vice_referente_employee_id IS NOT NULL) THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    FOR r IN
      SELECT q.id AS request_id, q.employee_id, (n.stato = 'approvato') AS solo_approvate,
             array_agg(DISTINCT n.data) AS date
        FROM righe_nuove n
        JOIN public.leave_requests q ON q.id = n.request_id
       WHERE extract(isodow FROM n.data) = 1
         AND n.data >= v_oggi
         AND (n.stato = 'approvato'
              OR (n.stato = 'richiesto'
                  AND q.stato IN ('inviata', 'approvata', 'approvata_parziale', 'chiusa')))
       GROUP BY q.id, q.employee_id, (n.stato = 'approvato')
    LOOP
      v_msg := public.ferie_lunedi_testo(
        r.employee_id,
        public.ferie_giorni_interi(r.employee_id, r.date, false, r.request_id),
        r.solo_approvate);
      IF v_msg IS NOT NULL THEN
        RAISE EXCEPTION '%', v_msg USING ERRCODE = '22023';
      END IF;
    END LOOP;
  ELSE
    -- UPDATE: solo le righe in cui e' cambiato qualcosa che conta (una nota
    -- corretta su una riga vecchia non deve fermare nessuno).
    FOR r IN
      SELECT q.id AS request_id, q.employee_id, (n.stato = 'approvato') AS solo_approvate,
             array_agg(DISTINCT n.data) AS date
        FROM righe_nuove n
        JOIN righe_vecchie v ON v.id = n.id
        JOIN public.leave_requests q ON q.id = n.request_id
       WHERE (v.stato, v.data, v.tipo, v.ore) IS DISTINCT FROM (n.stato, n.data, n.tipo, n.ore)
         AND extract(isodow FROM n.data) = 1
         AND n.data >= v_oggi
         AND (n.stato = 'approvato'
              OR (n.stato = 'richiesto'
                  AND q.stato IN ('inviata', 'approvata', 'approvata_parziale', 'chiusa')))
       GROUP BY q.id, q.employee_id, (n.stato = 'approvato')
    LOOP
      v_msg := public.ferie_lunedi_testo(
        r.employee_id,
        public.ferie_giorni_interi(r.employee_id, r.date, false, r.request_id),
        r.solo_approvate);
      IF v_msg IS NOT NULL THEN
        RAISE EXCEPTION '%', v_msg USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.leave_request_days_lunedi() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_leave_request_days_lunedi_ins ON public.leave_request_days;
CREATE TRIGGER trg_leave_request_days_lunedi_ins
  AFTER INSERT ON public.leave_request_days
  REFERENCING NEW TABLE AS righe_nuove
  FOR EACH STATEMENT EXECUTE FUNCTION public.leave_request_days_lunedi();

DROP TRIGGER IF EXISTS trg_leave_request_days_lunedi_upd ON public.leave_request_days;
CREATE TRIGGER trg_leave_request_days_lunedi_upd
  AFTER UPDATE ON public.leave_request_days
  REFERENCING OLD TABLE AS righe_vecchie NEW TABLE AS righe_nuove
  FOR EACH STATEMENT EXECUTE FUNCTION public.leave_request_days_lunedi();

COMMIT;

-- VERIFICA (dopo l'applicazione, su ogni tenant):
--   SELECT has_table_privilege('authenticated','public.outlet_vice_storico','select') AS auth,
--          has_table_privilege('service_role','public.outlet_vice_storico','insert') AS srv;      -- true, true
--   SELECT count(*) FROM public.outlets WHERE vice_referente_employee_id IS NOT NULL;              -- 0
--   SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_leave_request_days_lunedi_ins',
--          'trg_leave_request_days_lunedi_upd','trg_outlets_vice_promossa') ORDER BY 1;            -- 3 righe
--   SELECT has_function_privilege('authenticated','public.organico_imposta_vice(uuid,uuid)','execute') AS vice,
--          has_function_privilege('authenticated','public.ferie_lunedi_conflitti(uuid,date[],boolean)','execute') AS interna;
--                                                                                                  -- true, false
