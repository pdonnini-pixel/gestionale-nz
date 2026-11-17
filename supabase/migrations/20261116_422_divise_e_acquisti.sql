-- =====================================================================
-- Migrazione 422 — Divise e acquisti delle dipendenti
-- =====================================================================
-- Richiesta di Patrizio del 16/11/2026. Tre voci, si tiene traccia di tutte:
--   * «Divisa fornita dall'azienda»: la dipendente non paga niente;
--   * «Divisa con sconto»: divisa pagata dalla dipendente con lo sconto divise;
--   * «Acquisto personale»: capi per se', pagati con lo sconto acquisti.
-- Una divisa e' un insieme libero di pezzi letti sotto lo stesso numero per
-- persona (Divisa 1, 2, 3; il numero lo da' il sistema). Una divisa e' tutta
-- fornita oppure tutta con sconto, mai meta' e meta'.
--
-- COME SI REGISTRA: sul telefono del negozio (/timbra), dopo il proprio QR (o
-- nome e PIN), solo da chi e' entrata oggi e non e' ancora uscita. Si legge il
-- codice a barre del produttore e si scrive il «prezzo outlet oggi»
-- (obbligatorio per divisa con sconto e acquisto personale, facoltativo per la
-- divisa fornita). Lo sconto della persona si FISSA sul capo in quel momento:
-- cambi successivi non toccano i capi gia' presi.
--
-- CHI GESTISCE: solo l'elenco «Chi gestisce divise e acquisti» (divise_gestori,
-- lo modifica solo il Super Advisor) piu' il Super Advisor. Correggono il prezzo
-- (resta quello scritto dalla dipendente), segnano «scaricato in MODA» e
-- «addebitato», cambiano lo sconto personale. Niente blocca niente: resta segnato.
-- Come si addebita (busta paga, cassa) e' ancora da decidere.
--
-- SICUREZZA: le tabelle si leggono con la RLS e si scrivono SOLO dalle
-- funzioni qui sotto (nessuna policy di scrittura per authenticated, nessun
-- GRANT di scrittura). Il registro (divise_registro) non si modifica ne' si
-- cancella. La timbratrice riusa le funzioni delle timbrature
-- (timbrature_puo_timbrare, timbrature_firma, timbrature_pin_controlla,
-- timbrature_pin_del_negozio): la formula della firma non e' duplicata.
-- QR o PIN sbagliati non sollevano errori ma rispondono {errore}: cosi' i tentativi del
-- PIN restano contati (blocco dopo 5). Il QR letto per entrare nella sezione vale 10 minuti,
-- come per le timbrature, e solo sul telefono del negozio della persona (stessa regola del
-- PIN: timbrature_pin_del_negozio). La sezione a video si chiude da sola dopo 30 secondi
-- senza tocchi. Ogni «Conferma» porta un id generato dal telefono (p_richiesta): se arriva
-- due volte (doppio tocco, rete che cade) si registra una volta sola (divise_richieste).
--
-- NESSUNO TOCCA I PROPRI CAPI (revisori, 16/11/2026, come «nessuno decide la propria» delle
-- ferie): correzioni, scarico, addebito, annullamento e sconti personali rifiutano la persona
-- collegata a chi chiama (employees.user_id o responsabile_dipendente), Super Advisor compreso.
-- Un capo registrato per sbaglio si ANNULLA con il motivo (mai cancellato): resta visibile
-- barrato e non conta piu' in contatori, importi e app.
-- Il profilo viewer (sola lettura) non gestisce mai.
--
-- NO DATA LOSS: solo tabelle e funzioni nuove. Le chiavi esterne verso
-- employees non hanno cascade: lo storico dei capi non si perde.
-- Tenant: NZ e Zago (Made non si aggiorna). Rollback: _ROLLBACK.sql
-- =====================================================================

BEGIN;

-- ── 1. Tabelle ───────────────────────────────────────────────────────────

-- Sconti standard dell'azienda (una riga per azienda; senza riga = 0%)
CREATE TABLE IF NOT EXISTS public.divise_impostazioni (
  company_id          uuid PRIMARY KEY REFERENCES public.companies(id),
  sconto_divise_pct   numeric(5,2) NOT NULL DEFAULT 0 CHECK (sconto_divise_pct BETWEEN 0 AND 100),
  sconto_acquisti_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (sconto_acquisti_pct BETWEEN 0 AND 100),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid
);

-- Chi gestisce divise e acquisti (oltre al Super Advisor, sempre)
CREATE TABLE IF NOT EXISTS public.divise_gestori (
  company_id   uuid NOT NULL REFERENCES public.companies(id),
  user_id      uuid NOT NULL,
  aggiunto_il  timestamptz NOT NULL DEFAULT now(),
  aggiunto_da  uuid,
  PRIMARY KEY (company_id, user_id)
);

-- Sconti personali: NULL = vale lo standard dell'azienda
CREATE TABLE IF NOT EXISTS public.employee_divise_sconti (
  employee_id         uuid PRIMARY KEY REFERENCES public.employees(id),
  company_id          uuid NOT NULL REFERENCES public.companies(id),
  sconto_divise_pct   numeric(5,2) CHECK (sconto_divise_pct BETWEEN 0 AND 100),
  sconto_acquisti_pct numeric(5,2) CHECK (sconto_acquisti_pct BETWEEN 0 AND 100),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid
);

-- Le divise di ogni persona, numerate (Divisa 1, 2, 3...)
CREATE TABLE IF NOT EXISTS public.employee_divise (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id),
  employee_id  uuid NOT NULL REFERENCES public.employees(id),
  numero       integer NOT NULL CHECK (numero BETWEEN 1 AND 999),
  tipo         text NOT NULL CHECK (tipo IN ('fornita', 'sconto')),
  outlet_id    uuid REFERENCES public.outlets(id),
  aperta_il    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, numero)
);
CREATE INDEX IF NOT EXISTS employee_divise_company_idx ON public.employee_divise (company_id);

-- I capi: ogni riga un pezzo letto in negozio
CREATE TABLE IF NOT EXISTS public.employee_capi (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id),
  employee_id      uuid NOT NULL REFERENCES public.employees(id),
  outlet_id        uuid REFERENCES public.outlets(id),
  divisa_id        uuid REFERENCES public.employee_divise(id),
  voce             text NOT NULL CHECK (voce IN ('divisa_fornita', 'divisa_sconto', 'acquisto')),
  codice           text NOT NULL CHECK (codice ~ '^[0-9A-Za-z.\-]{4,40}$'),
  -- il prezzo outlet scritto dalla dipendente in negozio (resta com'era)
  prezzo_outlet    numeric(10,2) CHECK (prezzo_outlet > 0 AND prezzo_outlet < 100000),
  -- la correzione della sede, se c'e': vale lei
  prezzo_corretto  numeric(10,2) CHECK (prezzo_corretto >= 0 AND prezzo_corretto < 100000),
  corretto_il      timestamptz,
  corretto_da      uuid,
  -- lo sconto fissato al momento della registrazione (NULL per la divisa fornita)
  sconto_pct       numeric(5,2) CHECK (sconto_pct BETWEEN 0 AND 100),
  registrato_il    timestamptz NOT NULL DEFAULT now(),
  registrato_con   text NOT NULL CHECK (registrato_con IN ('qr', 'pin')),
  scaricato_il     timestamptz,
  scaricato_da     uuid,
  addebitato_il    timestamptz,
  addebitato_da    uuid,
  -- annullato per sbaglio: resta visibile, non conta piu' (mai DELETE)
  annullato_il     timestamptz,
  annullato_da     uuid,
  annullato_motivo text,
  -- la «Conferma» del telefono che l'ha registrato (vedi divise_richieste)
  richiesta_id     uuid,
  CONSTRAINT employee_capi_annullato_motivo CHECK (
    annullato_il IS NULL OR length(btrim(COALESCE(annullato_motivo, ''))) BETWEEN 3 AND 300),
  CONSTRAINT employee_capi_divisa_coerente CHECK (
    (voce = 'acquisto' AND divisa_id IS NULL AND sconto_pct IS NOT NULL)
    OR (voce = 'divisa_sconto' AND divisa_id IS NOT NULL AND sconto_pct IS NOT NULL)
    OR (voce = 'divisa_fornita' AND divisa_id IS NOT NULL AND sconto_pct IS NULL)),
  CONSTRAINT employee_capi_prezzo_obbligatorio CHECK (voce = 'divisa_fornita' OR prezzo_outlet IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS employee_capi_employee_idx ON public.employee_capi (employee_id, registrato_il DESC);
CREATE INDEX IF NOT EXISTS employee_capi_company_idx ON public.employee_capi (company_id);
CREATE INDEX IF NOT EXISTS employee_capi_divisa_idx ON public.employee_capi (divisa_id);

-- Ogni «Conferma» del telefono del negozio, con l'esito restituito: la stessa richiesta
-- arrivata due volte restituisce lo stesso esito senza scrivere di nuovo.
CREATE TABLE IF NOT EXISTS public.divise_richieste (
  richiesta_id uuid PRIMARY KEY,
  company_id   uuid NOT NULL REFERENCES public.companies(id),
  employee_id  uuid NOT NULL REFERENCES public.employees(id),
  esito        jsonb NOT NULL,
  creato_il    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS divise_richieste_employee_idx ON public.divise_richieste (employee_id, creato_il DESC);

-- Registro di ogni azione: non si modifica e non si cancella
CREATE TABLE IF NOT EXISTS public.divise_registro (
  id           bigserial PRIMARY KEY,
  company_id   uuid NOT NULL REFERENCES public.companies(id),
  employee_id  uuid REFERENCES public.employees(id),
  capo_id      uuid REFERENCES public.employee_capi(id),
  azione       text NOT NULL,
  dettaglio    jsonb NOT NULL DEFAULT '{}'::jsonb,
  utente_id    uuid,
  utente_nome  text,
  creato_il    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS divise_registro_employee_idx ON public.divise_registro (employee_id, creato_il DESC);
CREATE INDEX IF NOT EXISTS divise_registro_company_idx ON public.divise_registro (company_id, creato_il DESC);

CREATE OR REPLACE FUNCTION public.divise_registro_fermo() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Il registro di divise e acquisti non si modifica e non si cancella.' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION public.divise_registro_fermo() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_divise_registro_fermo ON public.divise_registro;
CREATE TRIGGER trg_divise_registro_fermo BEFORE UPDATE OR DELETE ON public.divise_registro
  FOR EACH ROW EXECUTE FUNCTION public.divise_registro_fermo();

-- ── 2. Chi puo' gestire ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.divise_posso_gestire()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT public.get_my_role())::text, '') = 'super_advisor'
      OR EXISTS (SELECT 1 FROM public.divise_gestori g
                  WHERE g.company_id = (SELECT public.get_my_company_id()) AND g.user_id = (SELECT auth.uid())
                    AND COALESCE((SELECT public.get_my_role())::text, '') NOT IN ('', 'dipendente', 'operatore_cassa', 'viewer'));
$$;
REVOKE ALL ON FUNCTION public.divise_posso_gestire() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.divise_posso_gestire() TO authenticated, service_role;

-- ── 3. RLS: si legge solo chi gestisce; nessuna scrittura diretta ─────────

ALTER TABLE public.divise_impostazioni    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.divise_gestori         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_divise_sconti ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_divise        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_capi          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.divise_registro        ENABLE ROW LEVEL SECURITY;
-- le richieste del telefono non si leggono dall'API: servono solo a divise_registra
ALTER TABLE public.divise_richieste       ENABLE ROW LEVEL SECURITY;

-- Recinti per ruolo come le altre tabelle con dati di persone (migration 329): anche se un
-- giorno divise_posso_gestire cambiasse, operatore di cassa e dipendente restano fuori.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['divise_impostazioni', 'divise_gestori', 'employee_divise_sconti',
                           'employee_divise', 'employee_capi', 'divise_registro', 'divise_richieste'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS cash_operator_block ON public.%I', t);
    EXECUTE format($p$CREATE POLICY cash_operator_block ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa')
      WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa')$p$, t);
    EXECUTE format('DROP POLICY IF EXISTS dipendente_block ON public.%I', t);
    EXECUTE format($p$CREATE POLICY dipendente_block ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente')
      WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente')$p$, t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS divise_impostazioni_select ON public.divise_impostazioni;
CREATE POLICY divise_impostazioni_select ON public.divise_impostazioni FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.divise_posso_gestire()));
DROP POLICY IF EXISTS divise_gestori_select ON public.divise_gestori;
CREATE POLICY divise_gestori_select ON public.divise_gestori FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.divise_posso_gestire()));
DROP POLICY IF EXISTS employee_divise_sconti_select ON public.employee_divise_sconti;
CREATE POLICY employee_divise_sconti_select ON public.employee_divise_sconti FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.divise_posso_gestire()));
DROP POLICY IF EXISTS employee_divise_select ON public.employee_divise;
CREATE POLICY employee_divise_select ON public.employee_divise FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.divise_posso_gestire()));
DROP POLICY IF EXISTS employee_capi_select ON public.employee_capi;
CREATE POLICY employee_capi_select ON public.employee_capi FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.divise_posso_gestire()));
DROP POLICY IF EXISTS divise_registro_select ON public.divise_registro;
CREATE POLICY divise_registro_select ON public.divise_registro FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.divise_posso_gestire()));

-- Solo lettura dall'API: le scritture passano dalle funzioni SECURITY DEFINER. Prima si tolgono
-- tutti i privilegi di default (anche TRUNCATE), poi si concede la sola SELECT.
REVOKE ALL ON public.divise_impostazioni, public.divise_gestori, public.employee_divise_sconti,
              public.employee_divise, public.employee_capi, public.divise_registro,
              public.divise_richieste FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.divise_impostazioni, public.divise_gestori, public.employee_divise_sconti,
               public.employee_divise, public.employee_capi, public.divise_registro TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.divise_impostazioni, public.divise_gestori, public.employee_divise_sconti,
               public.employee_divise, public.employee_capi TO service_role;
GRANT SELECT, INSERT ON public.divise_registro TO service_role;
GRANT SELECT, INSERT ON public.divise_richieste TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.divise_registro_id_seq TO service_role;

-- ── 4. Funzioni interne ──────────────────────────────────────────────────

-- Riga di registro con chi l'ha fatta
CREATE OR REPLACE FUNCTION public.divise_scrivi_registro(p_company uuid, p_employee uuid, p_capo uuid, p_azione text, p_dettaglio jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_nome text;
BEGIN
  SELECT NULLIF(btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') INTO v_nome
    FROM public.user_profiles u WHERE u.id = (SELECT auth.uid());
  INSERT INTO public.divise_registro (company_id, employee_id, capo_id, azione, dettaglio, utente_id, utente_nome)
  VALUES (p_company, p_employee, p_capo, p_azione, COALESCE(p_dettaglio, '{}'::jsonb), (SELECT auth.uid()), v_nome);
END $$;
REVOKE ALL ON FUNCTION public.divise_scrivi_registro(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.divise_scrivi_registro(uuid, uuid, uuid, text, jsonb) TO service_role;

-- Chi c'e' davanti al telefono del negozio: QR firmato (NZT1) o nome + PIN (NZP1),
-- con gli stessi controlli delle timbrature. Restituisce la persona e il modo, oppure
-- `errore` con il motivo in italiano. Per QR e PIN sbagliati NON si solleva un errore:
-- l'errore annullerebbe anche il conteggio dei tentativi del PIN (timbrature_pin_controlla),
-- e dal telefono del negozio si potrebbero provare PIN all'infinito. Chi chiama, con
-- `errore` valorizzato, risponde normalmente e il tentativo resta contato.
-- La persona deve essere entrata oggi e non ancora uscita.
CREATE OR REPLACE FUNCTION public.divise_chi_e(p_outlet_id uuid, p_codice text, OUT employee_id uuid, OUT modo text, OUT errore text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := (SELECT public.get_my_company_id());
  v_parti   text[];
  v_passo   bigint;
  v_segreto text;
  v_attivo  boolean;
  v_esito   text;
  v_oggi    date := (now() AT TIME ZONE 'Europe/Rome')::date;
  v_ultima  text;
BEGIN
  IF p_outlet_id IS NULL OR NOT public.timbrature_puo_timbrare(p_outlet_id) THEN
    RAISE EXCEPTION 'Da questo telefono non si registrano divise e acquisti per questo negozio.' USING ERRCODE = '42501';
  END IF;
  v_parti := string_to_array(COALESCE(p_codice, ''), '.');
  IF array_length(v_parti, 1) = 4 AND v_parti[1] = 'NZT1'
     AND v_parti[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND v_parti[3] ~ '^[0-9]{1,12}$' THEN
    employee_id := v_parti[2]::uuid;
    v_passo := v_parti[3]::bigint;
    SELECT a.segreto, COALESCE(e.is_active, true) INTO v_segreto, v_attivo
      FROM public.employee_app_access a JOIN public.employees e ON e.id = a.employee_id
     WHERE a.employee_id = divise_chi_e.employee_id AND e.company_id = v_company;
    IF NOT FOUND OR public.timbrature_firma(v_segreto, employee_id, v_passo) <> lower(v_parti[4]) THEN
      employee_id := NULL; errore := 'QR non valido: riapri l''app e avvicina di nuovo il QR.'; RETURN;
    END IF;
    -- il QR vale 10 minuti, come per le timbrature (revisore sicurezza, 16/11/2026)
    IF abs(extract(epoch FROM now()) - v_passo * 30) > 600 THEN
      employee_id := NULL; errore := 'Il QR è scaduto: avvicina di nuovo il QR del tuo telefono.'; RETURN;
    END IF;
    -- e solo sul telefono del proprio negozio (o di quello del turno di oggi), come il PIN
    IF NOT public.timbrature_pin_del_negozio(employee_id, p_outlet_id, v_oggi) THEN
      employee_id := NULL; errore := 'Divise e acquisti si registrano sul telefono del tuo negozio.'; RETURN;
    END IF;
    modo := 'qr';
  ELSIF array_length(v_parti, 1) = 3 AND v_parti[1] = 'NZP1'
     AND v_parti[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    employee_id := v_parti[2]::uuid;
    SELECT COALESCE(e.is_active, true) INTO v_attivo FROM public.employees e
     WHERE e.id = divise_chi_e.employee_id AND e.company_id = v_company;
    IF NOT FOUND THEN
      employee_id := NULL; errore := 'Persona non trovata.'; RETURN;
    END IF;
    IF NOT public.timbrature_pin_del_negozio(employee_id, p_outlet_id, v_oggi) THEN
      employee_id := NULL; errore := 'Con il PIN si usa solo il telefono del proprio negozio.'; RETURN;
    END IF;
    v_esito := public.timbrature_pin_controlla(employee_id, v_parti[3]);
    IF v_esito <> 'ok' THEN
      employee_id := NULL;
      errore := CASE v_esito WHEN 'pin_bloccato' THEN 'PIN bloccato: chiedi un PIN nuovo a chi segue il personale.'
                             WHEN 'pin_non_attivo' THEN 'Per te non c''è un PIN attivo.'
                             ELSE 'PIN sbagliato.' END;
      RETURN;
    END IF;
    modo := 'pin';
  ELSE
    errore := 'Codice non riconosciuto: avvicina il QR del tuo telefono.'; RETURN;
  END IF;
  IF NOT v_attivo THEN
    employee_id := NULL; errore := 'Non risulti in servizio.'; RETURN;
  END IF;
  -- dentro oggi: un'entrata di oggi e l'ultima timbratura non e' un'uscita
  SELECT a.tipo INTO v_ultima FROM public.attendance_punches a
   WHERE a.employee_id = divise_chi_e.employee_id AND NOT a.annullata
     AND a.ora >= (v_oggi::timestamp AT TIME ZONE 'Europe/Rome')
   ORDER BY a.ora DESC, a.created_at DESC LIMIT 1;
  IF v_ultima IS NULL OR v_ultima = 'uscita' OR NOT EXISTS (
       SELECT 1 FROM public.attendance_punches a
        WHERE a.employee_id = divise_chi_e.employee_id AND NOT a.annullata AND a.tipo = 'entrata'
          AND a.ora >= (v_oggi::timestamp AT TIME ZONE 'Europe/Rome')) THEN
    employee_id := NULL;
    errore := 'Divise e acquisti si registrano solo dopo l''entrata e prima dell''uscita. Se hai appena timbrato, riprova fra poco.';
    RETURN;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.divise_chi_e(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.divise_chi_e(uuid, text) TO service_role;

-- ── 5. Telefono del negozio ──────────────────────────────────────────────

-- La sezione esiste su questo tenant (il telefono mostra il tasto solo se risponde)
CREATE OR REPLACE FUNCTION public.divise_attive()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT true; $$;
REVOKE ALL ON FUNCTION public.divise_attive() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.divise_attive() TO authenticated, service_role;

-- Apre la sezione della persona: controlla chi e', restituisce le sue divise
CREATE OR REPLACE FUNCTION public.divise_timbratrice_apri(p_outlet_id uuid, p_codice text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM public.divise_chi_e(p_outlet_id, p_codice);
  IF c.errore IS NOT NULL THEN
    RETURN jsonb_build_object('errore', c.errore);
  END IF;
  RETURN jsonb_build_object(
    'divise', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'numero', d.numero, 'tipo', d.tipo, 'aperta_il', d.aperta_il,
                 'pezzi', (SELECT count(*) FROM public.employee_capi k WHERE k.divisa_id = d.id AND k.annullato_il IS NULL)) ORDER BY d.numero)
               FROM public.employee_divise d WHERE d.employee_id = c.employee_id), '[]'::jsonb),
    'prossima', COALESCE((SELECT max(d.numero) FROM public.employee_divise d WHERE d.employee_id = c.employee_id), 0) + 1);
END $$;
REVOKE ALL ON FUNCTION public.divise_timbratrice_apri(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.divise_timbratrice_apri(uuid, text) TO authenticated, service_role;

-- Registra i capi letti: tutto o niente, sconto fissato adesso.
-- p_voce: divisa_fornita | divisa_sconto | acquisto
-- p_divisa: numero di una divisa della persona dello stesso tipo, oppure NULL = nuova divisa
-- p_capi: [{ "codice": "8001234567913", "prezzo": 50.00 }, ...] (da 1 a 30)
-- p_richiesta: id generato dal telefono per ogni «Conferma»; la stessa richiesta arrivata due
-- volte (doppio tocco, rete che cade) restituisce lo stesso esito senza registrare di nuovo.
CREATE OR REPLACE FUNCTION public.divise_registra(p_outlet_id uuid, p_codice text, p_voce text, p_divisa integer, p_capi jsonb, p_richiesta uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c         record;
  v_company uuid := (SELECT public.get_my_company_id());
  v_tipo    text;
  v_div     public.employee_divise%ROWTYPE;
  v_sconto  numeric(5,2);
  r         jsonb;
  v_cod     text;
  v_prezzo  numeric;
  v_id      uuid;
  v_n       integer := 0;
  v_gia     public.divise_richieste%ROWTYPE;
  v_esito   jsonb;
BEGIN
  IF p_richiesta IS NULL THEN
    RAISE EXCEPTION 'Manca l''identificativo della conferma: ricarica la pagina.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public.divise_chi_e(p_outlet_id, p_codice);
  -- QR o PIN non validi: si risponde senza errore, cosi' il tentativo del PIN resta contato
  IF c.errore IS NOT NULL THEN
    RETURN jsonb_build_object('errore', c.errore);
  END IF;
  IF p_voce NOT IN ('divisa_fornita', 'divisa_sconto', 'acquisto') THEN
    RAISE EXCEPTION 'Scelta non valida.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_capi) IS DISTINCT FROM 'array' OR jsonb_array_length(p_capi) < 1 OR jsonb_array_length(p_capi) > 30 THEN
    RAISE EXCEPTION 'Da 1 a 30 capi alla volta.' USING ERRCODE = '22023';
  END IF;
  -- una registrazione alla volta per persona: il numero della divisa nuova non si doppia
  PERFORM pg_advisory_xact_lock(hashtext('divise:' || c.employee_id::text));
  -- la stessa «Conferma» arrivata di nuovo: stesso esito, niente di scritto
  SELECT * INTO v_gia FROM public.divise_richieste q WHERE q.richiesta_id = p_richiesta;
  IF FOUND THEN
    IF v_gia.employee_id <> c.employee_id OR v_gia.company_id <> v_company THEN
      RAISE EXCEPTION 'Conferma non valida: ricarica la pagina.' USING ERRCODE = '22023';
    END IF;
    RETURN v_gia.esito || jsonb_build_object('ripetuta', true);
  END IF;

  IF p_voce <> 'acquisto' THEN
    v_tipo := CASE p_voce WHEN 'divisa_fornita' THEN 'fornita' ELSE 'sconto' END;
    IF p_divisa IS NULL THEN
      INSERT INTO public.employee_divise (company_id, employee_id, numero, tipo, outlet_id)
      VALUES (v_company, c.employee_id,
              COALESCE((SELECT max(d.numero) FROM public.employee_divise d WHERE d.employee_id = c.employee_id), 0) + 1,
              v_tipo, p_outlet_id)
      RETURNING * INTO v_div;
      PERFORM public.divise_scrivi_registro(v_company, c.employee_id, NULL, 'divisa_aperta',
        jsonb_build_object('numero', v_div.numero, 'tipo', v_tipo, 'outlet_id', p_outlet_id));
    ELSE
      SELECT * INTO v_div FROM public.employee_divise d WHERE d.employee_id = c.employee_id AND d.numero = p_divisa;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'La divisa % non è tua.', p_divisa USING ERRCODE = '22023';
      END IF;
      IF v_div.tipo <> v_tipo THEN
        RAISE EXCEPTION 'La divisa % è %: una divisa è tutta fornita o tutta con sconto.', p_divisa,
          CASE v_div.tipo WHEN 'fornita' THEN 'fornita dall''azienda' ELSE 'con sconto' END USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  -- lo sconto si fissa adesso: personale se c'e', altrimenti lo standard dell'azienda
  IF p_voce = 'divisa_sconto' THEN
    SELECT COALESCE((SELECT s.sconto_divise_pct FROM public.employee_divise_sconti s WHERE s.employee_id = c.employee_id),
                    (SELECT i.sconto_divise_pct FROM public.divise_impostazioni i WHERE i.company_id = v_company), 0) INTO v_sconto;
  ELSIF p_voce = 'acquisto' THEN
    SELECT COALESCE((SELECT s.sconto_acquisti_pct FROM public.employee_divise_sconti s WHERE s.employee_id = c.employee_id),
                    (SELECT i.sconto_acquisti_pct FROM public.divise_impostazioni i WHERE i.company_id = v_company), 0) INTO v_sconto;
  ELSE
    v_sconto := NULL;
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_capi) LOOP
    v_cod := btrim(COALESCE(r->>'codice', ''));
    IF v_cod !~ '^[0-9A-Za-z.\-]{4,40}$' THEN
      RAISE EXCEPTION 'Codice non valido: %', left(v_cod, 40) USING ERRCODE = '22023';
    END IF;
    v_prezzo := NULL;
    IF jsonb_typeof(r->'prezzo') = 'number' THEN
      v_prezzo := round((r->>'prezzo')::numeric, 2);
    ELSIF COALESCE(r->>'prezzo', '') <> '' THEN
      RAISE EXCEPTION 'Prezzo non valido per il codice %', v_cod USING ERRCODE = '22023';
    END IF;
    IF v_prezzo IS NOT NULL AND (v_prezzo <= 0 OR v_prezzo >= 100000) THEN
      RAISE EXCEPTION 'Prezzo non valido per il codice %', v_cod USING ERRCODE = '22023';
    END IF;
    IF v_prezzo IS NULL AND p_voce <> 'divisa_fornita' THEN
      RAISE EXCEPTION 'Manca il prezzo outlet del codice %', v_cod USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.employee_capi (company_id, employee_id, outlet_id, divisa_id, voce, codice, prezzo_outlet, sconto_pct, registrato_con, richiesta_id)
    VALUES (v_company, c.employee_id, p_outlet_id, CASE WHEN p_voce = 'acquisto' THEN NULL ELSE v_div.id END,
            p_voce, v_cod, v_prezzo, v_sconto, c.modo, p_richiesta)
    RETURNING id INTO v_id;
    PERFORM public.divise_scrivi_registro(v_company, c.employee_id, v_id, 'capo_registrato',
      jsonb_build_object('voce', p_voce, 'codice', v_cod, 'prezzo_outlet', v_prezzo, 'sconto_pct', v_sconto,
                         'divisa', CASE WHEN p_voce = 'acquisto' THEN NULL ELSE v_div.numero END, 'outlet_id', p_outlet_id, 'modo', c.modo));
    v_n := v_n + 1;
  END LOOP;

  v_esito := jsonb_build_object('capi', v_n, 'divisa', CASE WHEN p_voce = 'acquisto' THEN NULL ELSE v_div.numero END,
    'pezzi_divisa', CASE WHEN p_voce = 'acquisto' THEN NULL
                         ELSE (SELECT count(*) FROM public.employee_capi k WHERE k.divisa_id = v_div.id AND k.annullato_il IS NULL) END);
  INSERT INTO public.divise_richieste (richiesta_id, company_id, employee_id, esito)
  VALUES (p_richiesta, v_company, c.employee_id, v_esito);
  RETURN v_esito;
END $$;
REVOKE ALL ON FUNCTION public.divise_registra(uuid, text, text, integer, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.divise_registra(uuid, text, text, integer, jsonb, uuid) TO authenticated, service_role;

-- ── 6. Sede: chi gestisce ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.divise_gestione_controlla()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.divise_posso_gestire() THEN
    RAISE EXCEPTION 'Divise e acquisti li gestisce solo chi è nell''elenco scelto dal Super Advisor.' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT public.get_my_company_id());
END $$;
REVOKE ALL ON FUNCTION public.divise_gestione_controlla() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.divise_gestione_controlla() TO service_role;

-- Nessuno tocca i propri capi ne' i propri sconti (revisori, 16/11/2026; come «nessuno decide
-- la propria» delle ferie), Super Advisor compreso: la persona collegata a chi chiama, dalla
-- scheda (employees.user_id) o dal collegamento dei referenti (responsabile_dipendente).
CREATE OR REPLACE FUNCTION public.divise_non_proprio(p_employee uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.employees e WHERE e.id = p_employee AND e.user_id = (SELECT auth.uid()))
     OR EXISTS (SELECT 1 FROM public.responsabile_dipendente r WHERE r.employee_id = p_employee AND r.user_id = (SELECT auth.uid())) THEN
    RAISE EXCEPTION 'Le tue divise e i tuoi acquisti li sistema un''altra persona.' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.divise_non_proprio(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.divise_non_proprio(uuid) TO service_role;

-- Segna (o toglie il segno) «scaricato in MODA» o «addebitato» su piu' capi
CREATE OR REPLACE FUNCTION public.divise_capi_segna(p_capi uuid[], p_cosa text, p_valore boolean)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := public.divise_gestione_controlla();
  k record;
  v_n integer := 0;
BEGIN
  IF p_cosa NOT IN ('scaricato', 'addebitato') OR p_valore IS NULL THEN
    RAISE EXCEPTION 'Scelta non valida.' USING ERRCODE = '22023';
  END IF;
  IF p_capi IS NULL OR cardinality(p_capi) = 0 OR cardinality(p_capi) > 500 THEN
    RAISE EXCEPTION 'Scegli da 1 a 500 capi.' USING ERRCODE = '22023';
  END IF;
  FOR k IN SELECT * FROM public.employee_capi c WHERE c.id = ANY (p_capi) AND c.company_id = v_company FOR UPDATE LOOP
    PERFORM public.divise_non_proprio(k.employee_id);
    IF k.annullato_il IS NOT NULL THEN CONTINUE; END IF;  -- un capo annullato non si segna piu'
    IF p_cosa = 'scaricato' THEN
      IF p_valore = (k.scaricato_il IS NOT NULL) THEN CONTINUE; END IF;
      UPDATE public.employee_capi SET scaricato_il = CASE WHEN p_valore THEN now() END,
                                      scaricato_da = CASE WHEN p_valore THEN (SELECT auth.uid()) END
       WHERE id = k.id;
    ELSE
      IF k.voce = 'divisa_fornita' THEN CONTINUE; END IF;  -- la divisa fornita non si addebita
      IF p_valore = (k.addebitato_il IS NOT NULL) THEN CONTINUE; END IF;
      UPDATE public.employee_capi SET addebitato_il = CASE WHEN p_valore THEN now() END,
                                      addebitato_da = CASE WHEN p_valore THEN (SELECT auth.uid()) END
       WHERE id = k.id;
    END IF;
    PERFORM public.divise_scrivi_registro(v_company, k.employee_id, k.id,
      CASE WHEN p_valore THEN p_cosa ELSE p_cosa || '_tolto' END, jsonb_build_object('codice', k.codice));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.divise_capi_segna(uuid[], text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.divise_capi_segna(uuid[], text, boolean) TO authenticated, service_role;

-- Corregge il prezzo di un capo (NULL = torna quello scritto dalla dipendente).
-- Niente blocca: anche dopo scarico o addebito si corregge, e resta segnato.
CREATE OR REPLACE FUNCTION public.divise_capo_correggi_prezzo(p_capo uuid, p_prezzo numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := public.divise_gestione_controlla();
  k public.employee_capi%ROWTYPE;
  v_prezzo numeric(10,2) := round(p_prezzo, 2);
BEGIN
  IF v_prezzo IS NOT NULL AND (v_prezzo < 0 OR v_prezzo >= 100000) THEN
    RAISE EXCEPTION 'Prezzo non valido.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO k FROM public.employee_capi c WHERE c.id = p_capo AND c.company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Capo non trovato.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.divise_non_proprio(k.employee_id);
  IF k.annullato_il IS NOT NULL THEN
    RAISE EXCEPTION 'Il capo è annullato: non si corregge.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.employee_capi SET prezzo_corretto = v_prezzo,
         corretto_il = CASE WHEN v_prezzo IS NULL THEN NULL ELSE now() END,
         corretto_da = CASE WHEN v_prezzo IS NULL THEN NULL ELSE (SELECT auth.uid()) END
   WHERE id = k.id;
  PERFORM public.divise_scrivi_registro(v_company, k.employee_id, k.id, 'prezzo_corretto',
    jsonb_build_object('codice', k.codice, 'prezzo_outlet', k.prezzo_outlet, 'prima', k.prezzo_corretto, 'dopo', v_prezzo,
                       'gia_scaricato', k.scaricato_il IS NOT NULL, 'gia_addebitato', k.addebitato_il IS NOT NULL));
END $$;
REVOKE ALL ON FUNCTION public.divise_capo_correggi_prezzo(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.divise_capo_correggi_prezzo(uuid, numeric) TO authenticated, service_role;

-- Annulla un capo registrato per sbaglio, con il motivo. Mai DELETE: resta visibile barrato e
-- non conta piu' in contatori, importi e app. L'annullamento non si toglie: se serve, si
-- registra di nuovo dal telefono del negozio.
CREATE OR REPLACE FUNCTION public.divise_capo_annulla(p_capo uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := public.divise_gestione_controlla();
  k public.employee_capi%ROWTYPE;
  v_motivo text := btrim(COALESCE(p_motivo, ''));
BEGIN
  IF length(v_motivo) < 3 OR length(v_motivo) > 300 THEN
    RAISE EXCEPTION 'Scrivi il motivo dell''annullamento (da 3 a 300 caratteri).' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO k FROM public.employee_capi c WHERE c.id = p_capo AND c.company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Capo non trovato.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.divise_non_proprio(k.employee_id);
  IF k.annullato_il IS NOT NULL THEN
    RAISE EXCEPTION 'Il capo è già annullato.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.employee_capi SET annullato_il = now(), annullato_da = (SELECT auth.uid()), annullato_motivo = v_motivo
   WHERE id = k.id;
  PERFORM public.divise_scrivi_registro(v_company, k.employee_id, k.id, 'capo_annullato',
    jsonb_build_object('codice', k.codice, 'motivo', v_motivo,
                       'gia_scaricato', k.scaricato_il IS NOT NULL, 'gia_addebitato', k.addebitato_il IS NOT NULL));
END $$;
REVOKE ALL ON FUNCTION public.divise_capo_annulla(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.divise_capo_annulla(uuid, text) TO authenticated, service_role;

-- Sconti personali della persona (NULL = vale lo standard). Non toccano i capi gia' presi.
CREATE OR REPLACE FUNCTION public.divise_sconti_persona_imposta(p_employee uuid, p_divise numeric, p_acquisti numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := public.divise_gestione_controlla();
  v_prima record;
BEGIN
  IF (p_divise IS NOT NULL AND (p_divise < 0 OR p_divise > 100)) OR (p_acquisti IS NOT NULL AND (p_acquisti < 0 OR p_acquisti > 100)) THEN
    RAISE EXCEPTION 'Lo sconto va da 0 a 100.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = p_employee AND e.company_id = v_company) THEN
    RAISE EXCEPTION 'Dipendente non trovata.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.divise_non_proprio(p_employee);
  SELECT s.sconto_divise_pct, s.sconto_acquisti_pct INTO v_prima FROM public.employee_divise_sconti s WHERE s.employee_id = p_employee;
  INSERT INTO public.employee_divise_sconti (employee_id, company_id, sconto_divise_pct, sconto_acquisti_pct, updated_at, updated_by)
  VALUES (p_employee, v_company, round(p_divise, 2), round(p_acquisti, 2), now(), (SELECT auth.uid()))
  ON CONFLICT (employee_id) DO UPDATE SET sconto_divise_pct = EXCLUDED.sconto_divise_pct,
     sconto_acquisti_pct = EXCLUDED.sconto_acquisti_pct, updated_at = now(), updated_by = (SELECT auth.uid());
  PERFORM public.divise_scrivi_registro(v_company, p_employee, NULL, 'sconti_persona',
    jsonb_build_object('divise_prima', v_prima.sconto_divise_pct, 'acquisti_prima', v_prima.sconto_acquisti_pct,
                       'divise', round(p_divise, 2), 'acquisti', round(p_acquisti, 2)));
END $$;
REVOKE ALL ON FUNCTION public.divise_sconti_persona_imposta(uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.divise_sconti_persona_imposta(uuid, numeric, numeric) TO authenticated, service_role;

-- ── 7. Solo il Super Advisor: sconti standard ed elenco dei gestori ───────

CREATE OR REPLACE FUNCTION public.divise_solo_super_advisor()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR COALESCE((SELECT public.get_my_role())::text, '') <> 'super_advisor' THEN
    RAISE EXCEPTION 'Lo decide solo il Super Advisor.' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT public.get_my_company_id());
END $$;
REVOKE ALL ON FUNCTION public.divise_solo_super_advisor() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.divise_solo_super_advisor() TO service_role;

CREATE OR REPLACE FUNCTION public.divise_impostazioni_salva(p_divise numeric, p_acquisti numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := public.divise_solo_super_advisor();
  v_prima record;
BEGIN
  IF p_divise IS NULL OR p_acquisti IS NULL OR p_divise < 0 OR p_divise > 100 OR p_acquisti < 0 OR p_acquisti > 100 THEN
    RAISE EXCEPTION 'Lo sconto va da 0 a 100.' USING ERRCODE = '22023';
  END IF;
  SELECT i.sconto_divise_pct, i.sconto_acquisti_pct INTO v_prima FROM public.divise_impostazioni i WHERE i.company_id = v_company;
  INSERT INTO public.divise_impostazioni (company_id, sconto_divise_pct, sconto_acquisti_pct, updated_at, updated_by)
  VALUES (v_company, round(p_divise, 2), round(p_acquisti, 2), now(), (SELECT auth.uid()))
  ON CONFLICT (company_id) DO UPDATE SET sconto_divise_pct = EXCLUDED.sconto_divise_pct,
     sconto_acquisti_pct = EXCLUDED.sconto_acquisti_pct, updated_at = now(), updated_by = (SELECT auth.uid());
  PERFORM public.divise_scrivi_registro(v_company, NULL, NULL, 'sconti_standard',
    jsonb_build_object('divise_prima', v_prima.sconto_divise_pct, 'acquisti_prima', v_prima.sconto_acquisti_pct,
                       'divise', round(p_divise, 2), 'acquisti', round(p_acquisti, 2)));
END $$;
REVOKE ALL ON FUNCTION public.divise_impostazioni_salva(numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.divise_impostazioni_salva(numeric, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.divise_gestore_imposta(p_user uuid, p_dentro boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := public.divise_solo_super_advisor();
BEGIN
  IF p_dentro IS NULL THEN
    RAISE EXCEPTION 'Scelta non valida.' USING ERRCODE = '22023';
  END IF;
  IF p_dentro THEN
    IF NOT EXISTS (SELECT 1 FROM public.user_profiles u WHERE u.id = p_user AND u.company_id = v_company
                     AND COALESCE(u.role::text, '') NOT IN ('', 'dipendente', 'operatore_cassa', 'viewer')) THEN
      RAISE EXCEPTION 'Si sceglie fra le persone con un profilo del gestionale di questa azienda.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.divise_gestori (company_id, user_id, aggiunto_da) VALUES (v_company, p_user, (SELECT auth.uid()))
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.divise_gestori WHERE company_id = v_company AND user_id = p_user;
  END IF;
  PERFORM public.divise_scrivi_registro(v_company, NULL, NULL, CASE WHEN p_dentro THEN 'gestore_aggiunto' ELSE 'gestore_tolto' END,
    jsonb_build_object('user_id', p_user));
END $$;
REVOKE ALL ON FUNCTION public.divise_gestore_imposta(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.divise_gestore_imposta(uuid, boolean) TO authenticated, service_role;

-- ── 8. App della dipendente: solo i suoi capi ────────────────────────────

CREATE OR REPLACE FUNCTION public.app_dipendente_divise()
RETURNS TABLE (id uuid, registrato_il timestamptz, voce text, divisa integer, codice text,
               prezzo_outlet numeric, sconto_pct numeric, prezzo numeric, annullato boolean, annullato_motivo text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT k.id, k.registrato_il, k.voce, d.numero, k.codice,
         COALESCE(k.prezzo_corretto, k.prezzo_outlet),
         k.sconto_pct,
         CASE WHEN k.voce = 'divisa_fornita' THEN 0
              ELSE round(COALESCE(k.prezzo_corretto, k.prezzo_outlet) * (100 - COALESCE(k.sconto_pct, 0)) / 100, 2) END,
         k.annullato_il IS NOT NULL, k.annullato_motivo
    FROM public.employee_capi k
    LEFT JOIN public.employee_divise d ON d.id = k.divisa_id
   WHERE k.employee_id = public.timbrature_mio_dipendente()
   ORDER BY k.registrato_il DESC;
$$;
REVOKE ALL ON FUNCTION public.app_dipendente_divise() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_dipendente_divise() TO authenticated, service_role;

COMMENT ON TABLE public.employee_capi IS
  'Divise e acquisti delle dipendenti: un capo per riga, letto in negozio. Si scrive solo dalle funzioni divise_* (migration 422).';
COMMENT ON TABLE public.divise_registro IS
  'Registro di divise e acquisti: ogni azione, chi e quando. Non si modifica e non si cancella (migration 422).';

COMMIT;
