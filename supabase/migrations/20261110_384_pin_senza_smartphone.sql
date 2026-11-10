-- =====================================================================
-- Migrazione 384 — Presenze: PIN sul telefono del negozio per chi non ha
-- lo smartphone
-- =====================================================================
-- Richiesta di Patrizio del 10/11/2026 («ora fai il PIN per chi non ha lo
-- smartphone»). Chi non ha l'app timbra sul telefono del negozio scegliendo
-- il proprio nome e scrivendo un PIN di 4 cifre.
--
-- REGOLE:
--   * Il PIN lo crea chi segue il personale (timbrature_gestore) in
--     Dipendenti → Presenze → App del dipendente: lo vede una volta sola e lo
--     consegna alla persona. Nel database resta solo cifrato (bcrypt,
--     employee_app_access.pin_hash, tabella chiusa all'API).
--   * 5 PIN sbagliati di fila: il PIN si blocca finche' non se ne crea uno
--     nuovo (niente tentativi a ripetizione sul telefono del negozio).
--   * La timbratura con il PIN vale come quella con il QR (verifica 'ok'),
--     segnata origine 'pin' per distinguerla: il QR resta il modo normale.
--     Il PIN non porta l'ora dentro come il QR: se arriva al server piu' di
--     2 ore dopo (coda offline) resta 'da_confermare'.
--   * Offline il telefono la mette in coda come sempre; il PIN si controlla
--     all'invio (come la firma del QR). Con la rete si controlla subito.
--
-- COSA INTRODUCE:
--   1. employee_app_access: pin_hash, pin_tentativi, pin_creato_il,
--      pin_creato_da. attendance_punches.origine: 'pin'.
--   2. timbrature_pin_controlla(persona, pin) (interna), timbratrice_verifica_pin
--      (telefono del negozio), timbrature_pin_nuovo, timbrature_pin_togli
--      (chi segue il personale).
--   3. timbrature_registra: codice 'NZP1.<employee_id>.<pin>' oltre al QR.
--   4. timbratrice_dati: per persona, se ha il PIN.
--   5. app_accessi_elenco: se la persona ha il PIN e se e' bloccato.
--
-- NO DATA LOSS: colonne e vincoli solo aggiunti o allargati.
-- Tenant: NZ e Zago. Rollback: 20261110_384_pin_senza_smartphone_ROLLBACK.sql
-- =====================================================================

BEGIN;

-- 1. Colonne e vincolo -----------------------------------------------------
ALTER TABLE public.employee_app_access
  ADD COLUMN IF NOT EXISTS pin_hash text,
  ADD COLUMN IF NOT EXISTS pin_tentativi smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_creato_il timestamptz,
  ADD COLUMN IF NOT EXISTS pin_creato_da uuid;

ALTER TABLE public.attendance_punches DROP CONSTRAINT attendance_punches_origine_check;
ALTER TABLE public.attendance_punches ADD CONSTRAINT attendance_punches_origine_check
  CHECK (origine = ANY (ARRAY['cellulare_negozio', 'dichiarata', 'manuale', 'pin']));

-- 2. Controllo del PIN (interno) -------------------------------------------
CREATE OR REPLACE FUNCTION public.timbrature_pin_controlla(p_emp uuid, p_pin text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
  v_hash text;
  v_tent smallint;
BEGIN
  SELECT a.pin_hash, a.pin_tentativi INTO v_hash, v_tent
    FROM public.employee_app_access a WHERE a.employee_id = p_emp FOR UPDATE;
  IF v_hash IS NULL THEN
    RETURN 'pin_non_attivo';
  END IF;
  IF v_tent >= 5 THEN
    RETURN 'pin_bloccato';
  END IF;
  IF COALESCE(p_pin, '') ~ '^[0-9]{4}$' AND extensions.crypt(p_pin, v_hash) = v_hash THEN
    IF v_tent > 0 THEN
      UPDATE public.employee_app_access SET pin_tentativi = 0 WHERE employee_id = p_emp;
    END IF;
    RETURN 'ok';
  END IF;
  UPDATE public.employee_app_access SET pin_tentativi = pin_tentativi + 1 WHERE employee_id = p_emp;
  RETURN CASE WHEN v_tent + 1 >= 5 THEN 'pin_bloccato' ELSE 'pin_errato' END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.timbrature_pin_controlla(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.timbrature_pin_controlla(uuid, text) TO service_role;

-- Telefono del negozio: controllo subito, con la rete
CREATE OR REPLACE FUNCTION public.timbratrice_verifica_pin(p_outlet_id uuid, p_employee uuid, p_pin text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT public.timbrature_puo_timbrare(p_outlet_id) THEN
    RAISE EXCEPTION 'Non puoi timbrare in questo negozio' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees e
                  WHERE e.id = p_employee AND e.company_id = (SELECT public.get_my_company_id()) AND COALESCE(e.is_active, true)) THEN
    RETURN 'pin_non_attivo';
  END IF;
  RETURN public.timbrature_pin_controlla(p_employee, p_pin);
END;
$fn$;
REVOKE ALL ON FUNCTION public.timbratrice_verifica_pin(uuid, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.timbratrice_verifica_pin(uuid, uuid, text) TO authenticated, service_role;

-- Chi segue il personale: crea (o rifà) il PIN e lo vede una volta sola
CREATE OR REPLACE FUNCTION public.timbrature_pin_nuovo(p_employee uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
  v_comp uuid;
  v_pin  text;
BEGIN
  IF NOT public.timbrature_gestore() THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  PERFORM public.presenze_non_su_di_me(p_employee);
  SELECT company_id INTO v_comp FROM public.employees
   WHERE id = p_employee AND company_id = (SELECT public.get_my_company_id());
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'Dipendente non trovato' USING ERRCODE = '22023';
  END IF;
  -- 4 cifre a caso, senza le sequenze piu' ovvie
  LOOP
    v_pin := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 10000)::text, 4, '0');
    EXIT WHEN v_pin NOT IN ('0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '0123', '9876');
  END LOOP;
  INSERT INTO public.employee_app_access (employee_id, company_id, segreto, pin_hash, pin_tentativi, pin_creato_il, pin_creato_da)
  VALUES (p_employee, v_comp, encode(extensions.gen_random_bytes(20), 'hex'),
          extensions.crypt(v_pin, extensions.gen_salt('bf', 8)), 0, now(), auth.uid())
  ON CONFLICT (employee_id) DO UPDATE
     SET pin_hash = EXCLUDED.pin_hash, pin_tentativi = 0, pin_creato_il = now(), pin_creato_da = auth.uid(), updated_at = now();
  RETURN v_pin;
END;
$fn$;
REVOKE ALL ON FUNCTION public.timbrature_pin_nuovo(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.timbrature_pin_nuovo(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.timbrature_pin_togli(p_employee uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT public.timbrature_gestore() THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  UPDATE public.employee_app_access a
     SET pin_hash = NULL, pin_tentativi = 0, updated_at = now()
   WHERE a.employee_id = p_employee AND a.company_id = (SELECT public.get_my_company_id());
END;
$fn$;
REVOKE ALL ON FUNCTION public.timbrature_pin_togli(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.timbrature_pin_togli(uuid) TO authenticated, service_role;

-- 3-4. timbrature_registra e timbratrice_dati: ritocchi sul testo vivo --------
DO $do$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.timbrature_registra(jsonb)'::regprocedure);
  n := replace(d, $x$  v_ini     time;
BEGIN$x$, $x$  v_ini     time;
  v_pin     boolean;  -- 384: codice NZP1.<employee_id>.<pin>
BEGIN$x$);
  IF n = d THEN RAISE EXCEPTION 'timbrature_registra: ancora 1 non trovata'; END IF;
  d := n;
  n := replace(d, $x$    v_parti := string_to_array(COALESCE(r->>'codice', ''), '.');
    IF array_length(v_parti, 1) IS DISTINCT FROM 4 OR v_parti[1] <> 'NZT1'$x$,
  $x$    v_parti := string_to_array(COALESCE(r->>'codice', ''), '.');
    v_pin := COALESCE(array_length(v_parti, 1) = 3 AND v_parti[1] = 'NZP1'
             AND v_parti[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             AND v_parti[3] ~ '^[0-9]{4}$', false);
    IF NOT v_pin AND (array_length(v_parti, 1) IS DISTINCT FROM 4 OR v_parti[1] <> 'NZT1'$x$);
  IF n = d THEN RAISE EXCEPTION 'timbrature_registra: ancora 2 non trovata'; END IF;
  d := n;
  -- chiude la parentesi aperta sopra
  n := replace(d, $x$       OR v_parti[3] !~ '^[0-9]{1,12}$' THEN
      v_esiti := v_esiti || jsonb_build_object('id', r->>'id', 'esito', 'codice_illeggibile');$x$,
  $x$       OR v_parti[3] !~ '^[0-9]{1,12}$') THEN
      v_esiti := v_esiti || jsonb_build_object('id', r->>'id', 'esito', 'codice_illeggibile');$x$);
  IF n = d THEN RAISE EXCEPTION 'timbrature_registra: ancora 3 non trovata'; END IF;
  d := n;
  n := replace(d, $x$    v_passo := v_parti[3]::bigint;
$x$, $x$    v_passo := CASE WHEN v_pin THEN NULL ELSE v_parti[3]::bigint END;
$x$);
  IF n = d THEN RAISE EXCEPTION 'timbrature_registra: ancora 4 non trovata'; END IF;
  d := n;
  n := replace(d, $x$    IF public.timbrature_firma(v_segreto, v_emp, v_passo) <> lower(v_parti[4]) THEN
      v_verifica := 'firma_non_valida';$x$,
  $x$    IF v_pin THEN
      -- 384: PIN al posto del QR; sbagliato o bloccato = rifiutata
      v_verifica := public.timbrature_pin_controlla(v_emp, v_parti[3]);
      IF v_verifica <> 'ok' THEN
        v_esiti := v_esiti || jsonb_build_object('id', r->>'id', 'esito', v_verifica);
        CONTINUE;
      END IF;
      IF v_ora > now() + interval '5 minutes' THEN
        v_verifica := 'fuori_tempo';
      ELSIF now() - v_ora > interval '2 hours' THEN
        -- il PIN non ha l'ora dentro come il QR: arrivata tardi, la conferma chi segue il personale
        v_verifica := 'da_confermare';
      END IF;
    ELSIF public.timbrature_firma(v_segreto, v_emp, v_passo) <> lower(v_parti[4]) THEN
      v_verifica := 'firma_non_valida';$x$);
  IF n = d THEN RAISE EXCEPTION 'timbrature_registra: ancora 5 non trovata'; END IF;
  d := n;
  n := replace(d, $x$       CASE WHEN v_dich_ok THEN 'dichiarata' ELSE 'cellulare_negozio' END,$x$,
  $x$       CASE WHEN v_dich_ok THEN 'dichiarata' WHEN v_pin THEN 'pin' ELSE 'cellulare_negozio' END,$x$);
  IF n = d THEN RAISE EXCEPTION 'timbrature_registra: ancora 6 non trovata'; END IF;
  EXECUTE n;

  d := pg_get_functiondef('public.timbratrice_dati(uuid)'::regprocedure);
  n := replace(d, $x$jsonb_build_object('id', p.id, 'nome', p.nome, 'tolleranza', rg.tolleranza, 'margine', rg.margine)$x$,
    $x$jsonb_build_object('id', p.id, 'nome', p.nome, 'tolleranza', rg.tolleranza, 'margine', rg.margine,
                            'pin', EXISTS (SELECT 1 FROM public.employee_app_access x WHERE x.employee_id = p.id AND x.pin_hash IS NOT NULL))$x$);
  IF n = d THEN RAISE EXCEPTION 'timbratrice_dati: ancora non trovata'; END IF;
  EXECUTE n;
END
$do$;

-- 5. Elenco degli accessi con il PIN ---------------------------------------
DROP FUNCTION public.app_accessi_elenco(uuid);
CREATE FUNCTION public.app_accessi_elenco(p_outlet_id uuid)
RETURNS TABLE(employee_id uuid, nome text, telefono_whatsapp text, codice text, codice_scade timestamptz, attivata_il timestamptz,
              pin_attivo boolean, pin_bloccato boolean, pin_creato_il timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.timbrature_gestore() THEN
    RAISE EXCEPTION 'Non autorizzato' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT e.id, trim(COALESCE(e.nome, e.first_name, '') || ' ' || COALESCE(e.cognome, e.last_name, '')),
         e.telefono_whatsapp, a.codice, a.codice_scade, a.attivata_il,
         a.pin_hash IS NOT NULL, a.pin_hash IS NOT NULL AND a.pin_tentativi >= 5, a.pin_creato_il
    FROM public.employees e
    LEFT JOIN public.employee_app_access a ON a.employee_id = e.id
   WHERE e.company_id = (SELECT public.get_my_company_id())
     AND e.outlet_id = p_outlet_id AND COALESCE(e.is_active, true) AND NOT e.is_demo
   ORDER BY 2;
END;
$fn$;
REVOKE ALL ON FUNCTION public.app_accessi_elenco(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_accessi_elenco(uuid) TO authenticated, service_role;

COMMIT;

-- Verifica:
-- SELECT pg_get_functiondef('public.timbrature_registra(jsonb)'::regprocedure) ~ 'NZP1',
--        pg_get_functiondef('public.timbratrice_dati(uuid)'::regprocedure) ~ 'pin_hash';
-- SELECT has_function_privilege('authenticated', 'public.timbrature_pin_controlla(uuid,text)', 'execute'); -- false
