-- 410: ferie e permessi «in linea con il mese» nel piano del mese (Patrizio, 14/11/2026).
--
-- «la regola e' far stare ferie e permessi in linea con il mese, cioe' se devo consumare ferie e
--  permessi li consumo che tanto ogni mese vado a riaccumularli, ma quando arrivo li' poi posso
--  approvarli o cancellarli o spostarli e lui ricalcola tutto, sia i residui che le ore.»
--
-- Quando l'HR crea il piano del mese il sistema propone, persona per persona, ferie e permessi pari
-- a quello che matura nel mese (rateo annuo del tabulato delle paghe diviso dodici, meno quello che
-- e' gia' chiesto o approvato, dall'app o dal gestionale). Le proposte restano PROPOSTE:
--   * sono richieste in bozza (stato 'bozza'), quindi non scalano il saldo (v_leave_disponibilita
--     le conta a parte in ore_in_bozza) e il dipendente non le vede nell'app (app_dipendente_ferie
--     esclude le bozze): verificato sulle funzioni vive di NZ e Zago il 14/11/2026;
--   * portano origine 'piano_mese' e il piano che le ha generate (plan_id), cosi' si distinguono
--     dalle bozze scritte da una persona e si tolgono insieme al piano;
--   * diventano vere solo con ferie_proposta_approva(), che le invia e le fa decidere a
--     leave_decidi: valgono quindi la scala di chi decide e tutti i controlli della 407.
--
-- Cosa cambia nello schema (solo aggiunte, nessuna riga toccata):
--   1. leave_requests.origine ammette anche 'piano_mese';
--   2. leave_requests.plan_id (NULL per tutte le richieste di oggi);
--   3. funzione ferie_proposta_approva(uuid, uuid[], text);
--   4. funzioni ferie_proposta_sposta(uuid, date) e ferie_proposta_togli(uuid): chi puo' decidere le
--      ferie (anche chi e' nell'elenco HR con un profilo di sola lettura) sposta e toglie una
--      proposta del piano (Patrizio, 16/11/2026: «anche la HR puo' spostare»);
--   5. funzione turni_proposti_riscrivi(uuid, date[], jsonb, jsonb): rifa' in un colpo solo i turni
--      proposti dal sistema ancora in bozza di un piano, dopo che una proposta e' stata spostata o
--      tolta. Mai un turno messo a mano o pubblicato, mai un mese chiuso.
-- Si applica a NZ e Zago. Dove manca (Made) il frontend non propone niente e resta com'era.
-- Rollback: 20261114_410_ferie_in_linea_con_il_mese_ROLLBACK.sql

BEGIN;

-- Il vincolo di prima si toglie cercandolo per quello che controlla, non solo per nome: su NZ e
-- Zago si chiama leave_requests_origine_check (letto il 14/11/2026), ma se avesse un altro nome
-- resterebbe in piedi e rifiuterebbe 'piano_mese'.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.leave_requests'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ~ '\morigine\M'
  LOOP
    EXECUTE format('ALTER TABLE public.leave_requests DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_origine_check
  CHECK (origine IN ('gestionale', 'modulo_cartaceo', 'mail', 'piano_mese'));

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.shift_plans(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.leave_requests.plan_id IS
  'Il piano del mese che ha proposto questa richiesta (origine = piano_mese). NULL per le richieste chieste da una persona. Se il piano si toglie resta NULL: la richiesta, se e'' gia'' stata approvata, non cambia.';
CREATE INDEX IF NOT EXISTS leave_requests_plan_idx ON public.leave_requests (plan_id) WHERE plan_id IS NOT NULL;

-- Approvare una proposta del piano: la bozza diventa inviata e la decide leave_decidi, che applica
-- chi puo' decidere (posso_decidere_ferie o la responsabile nei suoi negozi) e la scala (407:
-- nessuno la propria, la responsabile dall'HR, l'HR dal Super Advisor); la regola del lunedi' la
-- applicano i trigger sui giorni (393). Se leave_decidi rifiuta, l'eccezione annulla tutto e la
-- proposta resta in bozza.
--   * Una proposta rimasta senza piano (plan_id NULL: il piano e' stato tolto e la bozza no) non si
--     approva: si toglie, o si rifa' il piano.
--   * Approvare solo una parte dei giorni vuol dire respingere gli altri: serve il motivo vero
--     (p_motivo), che finisce nel registro. Senza motivo l'approvazione parziale e' rifiutata.
DROP FUNCTION IF EXISTS public.ferie_proposta_approva(uuid, uuid[]);
CREATE OR REPLACE FUNCTION public.ferie_proposta_approva(p_request_id uuid, p_giorni uuid[] DEFAULT NULL, p_motivo text DEFAULT NULL)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r        public.leave_requests%ROWTYPE;
  v_giorni uuid[];
  v_tutti  integer;
  v_motivo text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
BEGIN
  SELECT * INTO r FROM public.leave_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR r.company_id IS DISTINCT FROM (SELECT public.get_my_company_id()) THEN
    RAISE EXCEPTION 'Proposta non trovata.' USING ERRCODE = 'P0002';
  END IF;
  IF r.origine <> 'piano_mese' OR r.stato <> 'bozza' THEN
    RAISE EXCEPTION 'Questa non è una proposta del piano ancora da decidere.' USING ERRCODE = '22023';
  END IF;
  IF r.plan_id IS NULL THEN
    RAISE EXCEPTION 'Il piano di questa proposta non c''è più: toglila o rifai il piano.' USING ERRCODE = '22023';
  END IF;
  SELECT count(*), array_agg(d.id) FILTER (WHERE p_giorni IS NULL OR d.id = ANY (p_giorni))
    INTO v_tutti, v_giorni
    FROM public.leave_request_days d
   WHERE d.request_id = p_request_id;
  IF v_giorni IS NULL THEN
    RAISE EXCEPTION 'La proposta non ha giorni da approvare.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_giorni) < v_tutti AND v_motivo IS NULL THEN
    RAISE EXCEPTION 'Per approvare solo una parte dei giorni serve il motivo per quelli scartati.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.leave_requests SET stato = 'inviata', inviata_il = now() WHERE id = p_request_id;
  RETURN public.leave_decidi(p_request_id, v_giorni,
    CASE WHEN cardinality(v_giorni) < v_tutti THEN v_motivo ELSE 'Proposta del piano del mese, approvata' END);
END
$function$;
REVOKE ALL ON FUNCTION public.ferie_proposta_approva(uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferie_proposta_approva(uuid, uuid[], text) TO authenticated, service_role;

-- ── Spostare e togliere una proposta (Patrizio, 16/11/2026: «anche la HR puo' spostare») ──────────
-- Dalla tabella le richieste le scrivono solo Super Advisor, contabile e COO (policy della 251): una
-- persona dell'elenco HR con un profilo di sola lettura poteva approvare una proposta ma non
-- spostarla ne' toglierla. Le due funzioni qui sotto valgono per chi puo' decidere le ferie
-- (posso_decidere_ferie: gli stessi profili piu' l'elenco HR e i «Referenti ferie»), con la stessa
-- scala di chi decide: nessuno tocca una proposta propria, quella di una persona dell'HR la tocca
-- solo il Super Advisor. La responsabile di negozio non vede il piano del mese (recinto della 378
-- su shifts e shift_plans) e resta fuori.
-- Toccano SOLO le proposte del piano ancora da decidere (origine 'piano_mese', stato 'bozza'):
-- una richiesta chiesta da una persona, inviata o decisa non si sposta e non si cancella da qui.

-- I controlli comuni: la proposta, l'azienda, chi puo' decidere, la scala.
CREATE OR REPLACE FUNCTION public.ferie_proposta_mia(p_request_id uuid, p_serve_piano boolean)
 RETURNS public.leave_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r public.leave_requests%ROWTYPE;
BEGIN
  IF NOT COALESCE((SELECT public.posso_decidere_ferie()), false) THEN
    RAISE EXCEPTION 'Le proposte di ferie le sposta e le toglie chi può decidere le ferie.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.leave_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR r.company_id IS DISTINCT FROM (SELECT public.get_my_company_id()) THEN
    RAISE EXCEPTION 'Proposta non trovata.' USING ERRCODE = 'P0002';
  END IF;
  IF r.origine <> 'piano_mese' OR r.stato <> 'bozza' THEN
    RAISE EXCEPTION 'Questa non è una proposta del piano ancora da decidere.' USING ERRCODE = '22023';
  END IF;
  IF p_serve_piano AND r.plan_id IS NULL THEN
    RAISE EXCEPTION 'Il piano di questa proposta non c''è più: toglila o rifai il piano.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.ferie_controlla_scala(r.employee_id);
  RETURN r;
END
$function$;
REVOKE ALL ON FUNCTION public.ferie_proposta_mia(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ferie_proposta_mia(uuid, boolean) TO service_role;

-- Spostare: il giorno nuovo lo controlla il database, non la pagina. Stesso mese del piano, dopo
-- oggi, negozio aperto, mai un sabato, una domenica, un festivo o un giorno di evento (le proposte
-- non stanno nei giorni caldi), come dice la scheda 9 del negozio (ferie_blocco_giorno), mai una
-- giornata di lunedi' a responsabile e vice, nessun'altra assenza quel giorno, e per una giornata
-- intera nessun turno messo a mano o pubblicato. Poi scatta anche il trigger del lunedi' (393).
CREATE OR REPLACE FUNCTION public.ferie_proposta_sposta(p_request_id uuid, p_data date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r          public.leave_requests%ROWTYPE;
  pl         public.shift_plans%ROWTYPE;
  v_da       date;
  v_giornata boolean;
  v_ferie    boolean;
  v_blk      text;
  v_g        text := to_char(p_data, 'DD/MM/YYYY');
  v_nome     text;
BEGIN
  IF p_data IS NULL THEN
    RAISE EXCEPTION 'Manca il giorno nuovo.' USING ERRCODE = '22023';
  END IF;
  r := public.ferie_proposta_mia(p_request_id, true);
  SELECT * INTO pl FROM public.shift_plans WHERE id = r.plan_id;
  IF NOT FOUND OR pl.company_id IS DISTINCT FROM r.company_id OR COALESCE(pl.simulazione, false) THEN
    RAISE EXCEPTION 'Il piano di questa proposta non c''è più: toglila o rifai il piano.' USING ERRCODE = '22023';
  END IF;
  IF public.turni_mese_chiuso(r.company_id, pl.mese) THEN
    RAISE EXCEPTION 'Il mese è chiuso: le proposte non si spostano più.' USING ERRCODE = '22023';
  END IF;
  SELECT min(d.data), bool_or(d.tipo = 'giornata'), bool_or(d.voce = 'F01')
    INTO v_da, v_giornata, v_ferie
    FROM public.leave_request_days d WHERE d.request_id = r.id;
  IF v_da IS NULL THEN
    RAISE EXCEPTION 'La proposta non ha giorni da spostare.' USING ERRCODE = '22023';
  END IF;
  IF p_data = v_da THEN RETURN; END IF;
  IF date_trunc('month', p_data) <> date_trunc('month', pl.mese) THEN
    RAISE EXCEPTION 'Il % è fuori dal mese del piano.', v_g USING ERRCODE = '22023';
  END IF;
  IF p_data <= (now() AT TIME ZONE 'Europe/Rome')::date THEN
    RAISE EXCEPTION 'Una proposta si sposta solo su un giorno che deve ancora venire.' USING ERRCODE = '22023';
  END IF;
  IF extract(isodow FROM p_data) >= 6 OR public.festivo_italiano(p_data) THEN
    RAISE EXCEPTION 'Il % è un sabato, una domenica o un festivo: lì ferie e permessi non si propongono.', v_g USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.outlet_events ev
              WHERE ev.company_id = r.company_id
                AND p_data BETWEEN ev.data_dal AND COALESCE(ev.data_al, ev.data_dal)
                AND (ev.outlet_ids IS NULL OR pl.outlet_id = ANY (ev.outlet_ids))) THEN
    RAISE EXCEPTION 'Il % c''è un evento: lì ferie e permessi non si propongono.', v_g USING ERRCODE = '22023';
  END IF;
  IF COALESCE((SELECT s.chiuso FROM public.outlet_special_days s WHERE s.outlet_id = pl.outlet_id AND s.data = p_data LIMIT 1),
              (SELECT o.chiuso FROM public.outlet_opening_hours o WHERE o.outlet_id = pl.outlet_id AND o.giorno = extract(isodow FROM p_data)::int LIMIT 1),
              false) THEN
    RAISE EXCEPTION 'Il % il negozio è chiuso.', v_g USING ERRCODE = '22023';
  END IF;
  v_blk := public.ferie_blocco_giorno(r.employee_id, p_data, CASE WHEN v_ferie THEN 'ferie' ELSE 'permessi' END);
  IF v_blk IS NOT NULL THEN
    RAISE EXCEPTION '%', v_blk USING ERRCODE = '22023';
  END IF;
  IF v_giornata AND extract(isodow FROM p_data) = 1
     AND EXISTS (SELECT 1 FROM public.outlets o
                  WHERE o.company_id = r.company_id
                    AND r.employee_id IN (o.referente_employee_id, o.vice_referente_employee_id)) THEN
    RAISE EXCEPTION 'Il lunedì una fra responsabile e vice è in negozio: a loro una giornata di ferie di lunedì non si propone.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.leave_request_days d
               JOIN public.leave_requests q ON q.id = d.request_id
              WHERE q.employee_id = r.employee_id AND q.id <> r.id AND d.data = p_data
                AND q.stato NOT IN ('respinta', 'ritirata') AND d.stato <> 'respinto') THEN
    RAISE EXCEPTION 'Il % ha già ferie o un permesso.', v_g USING ERRCODE = '22023';
  END IF;
  IF v_giornata AND EXISTS (SELECT 1 FROM public.shifts s
                             WHERE s.employee_id = r.employee_id AND s.data = p_data AND s.stato <> 'annullato'
                               AND (s.plan_id = pl.id OR s.plan_id IS NULL)
                               AND (s.origine = 'manuale' OR s.stato = 'pubblicato')) THEN
    RAISE EXCEPTION 'Il % ha già un turno messo a mano o pubblicato: togli prima quello.', v_g USING ERRCODE = '22023';
  END IF;
  UPDATE public.leave_request_days SET data = p_data WHERE request_id = r.id;
  SELECT NULLIF(btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') INTO v_nome
    FROM public.user_profiles u WHERE u.id = auth.uid();
  INSERT INTO public.leave_request_events (company_id, request_id, evento, nota, dettaglio, utente_id, utente_nome)
  VALUES (r.company_id, r.id, 'proposta_spostata', 'Proposta del piano spostata dal ' || to_char(v_da, 'DD/MM/YYYY') || ' al ' || v_g,
          jsonb_build_object('dal', v_da, 'al', p_data), auth.uid(), v_nome);
END
$function$;
REVOKE ALL ON FUNCTION public.ferie_proposta_sposta(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferie_proposta_sposta(uuid, date) TO authenticated, service_role;

-- Togliere: la bozza sparisce con i suoi giorni. Vale anche per una proposta rimasta senza piano
-- (plan_id NULL), che altrimenti nessuno dell'HR potrebbe piu' togliere. Mai una richiesta vera.
CREATE OR REPLACE FUNCTION public.ferie_proposta_togli(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r public.leave_requests%ROWTYPE;
BEGIN
  r := public.ferie_proposta_mia(p_request_id, false);
  DELETE FROM public.leave_requests WHERE id = r.id AND origine = 'piano_mese' AND stato = 'bozza';
END
$function$;
REVOKE ALL ON FUNCTION public.ferie_proposta_togli(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferie_proposta_togli(uuid) TO authenticated, service_role;

-- ── Rifare i turni proposti dopo una modifica alle ferie ───────────────────────────────────────
-- «se lo modifica cancellando e spostando il sistema ricalcola tutto il mese se necessario». Il
-- conto lo fa la pagina (il motore dei turni); questa funzione scrive il risultato in un colpo
-- solo, cosi' non resta mai un mese con i turni vecchi tolti e quelli nuovi non salvati, e lo puo'
-- fare anche chi e' nell'elenco HR con un profilo che i turni non li scrive.
-- E' stretta apposta:
--   * la chiama chi gestisce i turni (organico_puo_scrivere) o chi puo' decidere le ferie;
--   * tocca SOLO i turni del piano indicato con origine 'proposta' e stato 'bozza', nelle date
--     indicate, tutte nel mese del piano: un turno messo a mano o pubblicato non si cancella, non si
--     cambia e non si sovrappone;
--   * mai una simulazione, mai un mese chiuso;
--   * ogni turno nuovo e' di una persona dell'azienda che lavora in quel negozio, sta dentro
--     l'orario di apertura di quel giorno, sulle mezz'ore, uno solo per persona e per giorno;
--   * nasce in bozza: nell'app non arriva niente finche' chi gestisce i turni non pubblica.
CREATE OR REPLACE FUNCTION public.turni_proposti_riscrivi(p_plan_id uuid, p_date date[], p_turni jsonb, p_riepilogo jsonb DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  pl     public.shift_plans%ROWTYPE;
  t      record;
  v_apre time;
  v_chiude time;
  v_chiuso boolean;
  v_ore  numeric;
  v_n    integer := 0;
  v_demo uuid[];
BEGIN
  IF NOT (COALESCE((SELECT public.organico_puo_scrivere()), false) OR COALESCE((SELECT public.posso_decidere_ferie()), false)) THEN
    RAISE EXCEPTION 'I turni proposti li rifà chi gestisce i turni o chi può decidere le ferie.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO pl FROM public.shift_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND OR pl.company_id IS DISTINCT FROM (SELECT public.get_my_company_id()) THEN
    RAISE EXCEPTION 'Piano non trovato.' USING ERRCODE = 'P0002';
  END IF;
  IF COALESCE(pl.simulazione, false) THEN
    RAISE EXCEPTION 'Una simulazione non si ricalcola da qui.' USING ERRCODE = '22023';
  END IF;
  IF public.turni_mese_chiuso(pl.company_id, pl.mese) THEN
    RAISE EXCEPTION 'Il mese è chiuso: i turni non si ricalcolano.' USING ERRCODE = '22023';
  END IF;
  IF p_date IS NULL OR cardinality(p_date) = 0 OR cardinality(p_date) > 62 THEN
    RAISE EXCEPTION 'Mancano i giorni da ricalcolare.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_date) AS d WHERE d IS NULL OR date_trunc('month', d) <> date_trunc('month', pl.mese)) THEN
    RAISE EXCEPTION 'I giorni da ricalcolare devono stare nel mese del piano.' USING ERRCODE = '22023';
  END IF;
  IF p_turni IS NULL OR jsonb_typeof(p_turni) <> 'array' OR jsonb_array_length(p_turni) > 800 THEN
    RAISE EXCEPTION 'Elenco dei turni non valido.' USING ERRCODE = '22023';
  END IF;
  IF p_riepilogo IS NOT NULL AND (jsonb_typeof(p_riepilogo) <> 'object' OR octet_length(p_riepilogo::text) > 1000000) THEN
    RAISE EXCEPTION 'Riepilogo del piano non valido.' USING ERRCODE = '22023';
  END IF;

  -- come dalla tabella (policy demo_nascosto): i turni della persona di prova non si toccano da qui
  v_demo := COALESCE((SELECT public.dipendenti_demo_ids())::uuid[], '{}'::uuid[]);
  DELETE FROM public.shifts
   WHERE plan_id = pl.id AND origine = 'proposta' AND stato = 'bozza' AND data = ANY (p_date)
     AND employee_id <> ALL (v_demo);

  FOR t IN
    SELECT x.employee_id, x.data, x.inizio, x.fine, COALESCE(x.pausa_minuti, 0) AS pausa_minuti, COALESCE(x.ore_straordinario, 0) AS ore_straordinario
      FROM jsonb_to_recordset(p_turni) AS x(employee_id uuid, data date, inizio time, fine time, pausa_minuti integer, ore_straordinario numeric)
  LOOP
    IF t.employee_id IS NULL OR t.data IS NULL OR t.inizio IS NULL OR t.fine IS NULL OR NOT (t.data = ANY (p_date)) THEN
      RAISE EXCEPTION 'Un turno è fuori dai giorni da ricalcolare o è incompleto.' USING ERRCODE = '22023';
    END IF;
    IF t.fine <= t.inizio OR extract(minute FROM t.inizio)::int NOT IN (0, 30) OR extract(minute FROM t.fine)::int NOT IN (0, 30)
       OR extract(second FROM t.inizio) <> 0 OR extract(second FROM t.fine) <> 0 THEN
      RAISE EXCEPTION 'Orario di un turno non valido (%-% del %).', to_char(t.inizio, 'HH24:MI'), to_char(t.fine, 'HH24:MI'), to_char(t.data, 'DD/MM') USING ERRCODE = '22023';
    END IF;
    v_ore := extract(epoch FROM (t.fine - t.inizio)) / 3600.0;
    IF t.pausa_minuti < 0 OR t.pausa_minuti > 180 OR t.ore_straordinario < 0 OR t.ore_straordinario > v_ore THEN
      RAISE EXCEPTION 'Pausa o straordinario di un turno non validi (%).', to_char(t.data, 'DD/MM') USING ERRCODE = '22023';
    END IF;
    IF t.employee_id = ANY (v_demo) OR NOT EXISTS (SELECT 1 FROM public.employees e
                    WHERE e.id = t.employee_id AND e.company_id = pl.company_id
                      AND (e.outlet_id = pl.outlet_id
                           OR EXISTS (SELECT 1 FROM public.shifts s WHERE s.employee_id = e.id AND s.outlet_id = pl.outlet_id))) THEN
      RAISE EXCEPTION 'Un turno è di una persona che non lavora in questo negozio.' USING ERRCODE = '22023';
    END IF;
    -- l'orario di apertura di quel giorno: prima il giorno speciale, poi l'orario tipo
    v_apre := NULL; v_chiude := NULL; v_chiuso := NULL;
    SELECT s.chiuso, s.apre, s.chiude INTO v_chiuso, v_apre, v_chiude
      FROM public.outlet_special_days s WHERE s.outlet_id = pl.outlet_id AND s.data = t.data LIMIT 1;
    IF NOT FOUND OR (NOT COALESCE(v_chiuso, false) AND (v_apre IS NULL OR v_chiude IS NULL)) THEN
      SELECT COALESCE(v_chiuso, o.chiuso), COALESCE(v_apre, o.apre), COALESCE(v_chiude, o.chiude) INTO v_chiuso, v_apre, v_chiude
        FROM public.outlet_opening_hours o WHERE o.outlet_id = pl.outlet_id AND o.giorno = extract(isodow FROM t.data)::int LIMIT 1;
    END IF;
    IF COALESCE(v_chiuso, false) THEN
      RAISE EXCEPTION 'Il % il negozio è chiuso: lì non si mettono turni.', to_char(t.data, 'DD/MM') USING ERRCODE = '22023';
    END IF;
    -- un periodo speciale puo' avere un orario suo (outlet_events.regole): li' vale quello del motore
    IF ((v_apre IS NOT NULL AND t.inizio < v_apre) OR (v_chiude IS NOT NULL AND t.fine > v_chiude))
       AND NOT EXISTS (SELECT 1 FROM public.outlet_events ev
                        WHERE ev.company_id = pl.company_id
                          AND t.data BETWEEN ev.data_dal AND COALESCE(ev.data_al, ev.data_dal)
                          AND (ev.outlet_ids IS NULL OR pl.outlet_id = ANY (ev.outlet_ids))) THEN
      RAISE EXCEPTION 'Un turno del % esce dall''orario di apertura del negozio.', to_char(t.data, 'DD/MM') USING ERRCODE = '22023';
    END IF;
    -- mai sopra un turno messo a mano o pubblicato, e uno solo proposto per persona e per giorno
    IF EXISTS (SELECT 1 FROM public.shifts s
                WHERE s.employee_id = t.employee_id AND s.data = t.data AND s.stato <> 'annullato'
                  AND ((s.plan_id = pl.id AND s.origine = 'proposta' AND s.stato = 'bozza')
                       OR ((s.plan_id = pl.id OR s.plan_id IS NULL) AND (s.origine = 'manuale' OR s.stato = 'pubblicato')
                           AND s.inizio < t.fine AND s.fine > t.inizio))) THEN
      RAISE EXCEPTION 'Un turno del % si sovrappone a un altro turno della stessa persona.', to_char(t.data, 'DD/MM') USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.shifts (company_id, outlet_id, employee_id, data, inizio, fine, pausa_minuti, origine, stato, plan_id, straordinario, ore_straordinario)
    VALUES (pl.company_id, pl.outlet_id, t.employee_id, t.data, t.inizio, t.fine, t.pausa_minuti, 'proposta', 'bozza', pl.id, t.ore_straordinario > 0, t.ore_straordinario);
    v_n := v_n + 1;
  END LOOP;

  IF p_riepilogo IS NOT NULL THEN
    UPDATE public.shift_plans SET riepilogo = p_riepilogo WHERE id = pl.id;
  END IF;
  RETURN v_n;
END
$function$;
REVOKE ALL ON FUNCTION public.turni_proposti_riscrivi(uuid, date[], jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.turni_proposti_riscrivi(uuid, date[], jsonb, jsonb) TO authenticated, service_role;

COMMIT;

-- VERIFICA (su NZ e su Zago, dopo l'applicazione):
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'leave_requests_origine_check';  -- con 'piano_mese'
-- SELECT count(*) FILTER (WHERE plan_id IS NOT NULL) AS con_piano, count(*) AS tutte FROM public.leave_requests;  -- 0 e il totale di prima
-- SELECT has_function_privilege('authenticated', 'public.ferie_proposta_approva(uuid,uuid[],text)', 'execute') AS auth,
--        has_function_privilege('anon', 'public.ferie_proposta_approva(uuid,uuid[],text)', 'execute') AS anon;  -- true, false
-- SELECT count(*) FROM public.leave_requests WHERE origine = 'piano_mese' AND stato = 'bozza' AND plan_id IS NULL;  -- 0: nessuna proposta rimasta senza piano
-- SELECT p.oid::regprocedure::text AS f, has_function_privilege('authenticated', p.oid, 'execute') AS auth, has_function_privilege('anon', p.oid, 'execute') AS anon
--   FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
--    AND p.proname IN ('ferie_proposta_mia', 'ferie_proposta_sposta', 'ferie_proposta_togli', 'turni_proposti_riscrivi');
--   -- ferie_proposta_mia: false, false; le altre tre: true, false
