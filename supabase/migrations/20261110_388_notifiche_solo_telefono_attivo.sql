-- =====================================================================
-- Migrazione 388 — Notifiche solo sul telefono attivo
-- =====================================================================
-- Dalla prova di Patrizio del 10/11/2026: il dipendente demo attivato
-- sull'Android aveva ancora l'iPhone (non piu' attivo) fra i telefoni con le
-- notifiche, e l'iPhone si riregistra a ogni apertura dell'app.
-- 1. app_dipendente_consuma_codice (attivazione con un codice nuovo) spegne
--    le notifiche di tutti i telefoni della persona e le segna
--    «disattivato_per_cambio»: il telefono che si attiva le riaccende subito
--    dopo, registrandosi.
-- 2. app_registra_push_token: un telefono spento per cambio non si riaccende
--    da solo, salvo nei 15 minuti dopo l'attivazione (e' il telefono appena
--    attivato). Dalla versione 1.3 l'app manda l'impronta del suo segreto
--    (p_impronta): se non coincide con quella attuale non si riaccende mai.
-- 3. Una tantum: si spengono i telefoni registrati per la prima volta prima
--    dell'ultima attivazione della persona (oggi: l'iPhone del dipendente
--    demo, registrato il 09/11; l'Android attivato il 10/11 alle 14:10 resta).
-- Tenant: NZ e Zago. Rollback: 20261110_388_notifiche_solo_telefono_attivo_ROLLBACK.sql
-- =====================================================================
BEGIN;

ALTER TABLE public.employee_push_tokens ADD COLUMN IF NOT EXISTS disattivato_per_cambio boolean NOT NULL DEFAULT false;

DO $do$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.app_dipendente_consuma_codice(text)'::regprocedure);
  n := replace(d, $x$         codice = NULL, codice_scade = NULL, attivata_il = now(), updated_at = now()
   WHERE a.employee_id = v_emp;
$x$, $x$         codice = NULL, codice_scade = NULL, attivata_il = now(), updated_at = now()
   WHERE a.employee_id = v_emp;
  -- 388: le notifiche vanno solo al telefono che si sta attivando (si riregistra subito dopo)
  UPDATE public.employee_push_tokens t
     SET attivo = false, disattivato_per_cambio = true, aggiornato_il = now()
   WHERE t.employee_id = v_emp AND t.attivo;
$x$);
  IF n = d THEN RAISE EXCEPTION 'app_dipendente_consuma_codice: ancora non trovata'; END IF;
  EXECUTE n;
END
$do$;

DROP FUNCTION public.app_registra_push_token(text, text);
CREATE FUNCTION public.app_registra_push_token(p_token text, p_piattaforma text, p_impronta text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_emp   uuid := public.timbrature_mio_dipendente();
  v_comp  uuid;
  v_imp   text;
  v_attiv timestamptz;
  v_ok    boolean;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Accesso non collegato a un dipendente' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_piattaforma, '') NOT IN ('android', 'ios') OR length(COALESCE(p_token, '')) NOT BETWEEN 20 AND 4096 THEN
    RAISE EXCEPTION 'Telefono non valido' USING ERRCODE = '22023';
  END IF;
  SELECT company_id INTO v_comp FROM public.employees WHERE id = v_emp;
  SELECT left(encode(sha256(convert_to(a.segreto, 'UTF8')), 'hex'), 16), a.attivata_il
    INTO v_imp, v_attiv FROM public.employee_app_access a WHERE a.employee_id = v_emp;

  -- Il telefono e' quello attivo? Con l'impronta (app 1.3) si sa; senza (app
  -- 1.2 e prima) un telefono spento per cambio si riaccende solo subito dopo
  -- l'attivazione.
  IF p_impronta IS NOT NULL THEN
    v_ok := p_impronta = v_imp;
  ELSE
    v_ok := NOT EXISTS (SELECT 1 FROM public.employee_push_tokens t
                         WHERE t.token = p_token AND t.employee_id = v_emp AND t.disattivato_per_cambio)
            OR now() - v_attiv < interval '15 minutes';
  END IF;

  INSERT INTO public.employee_push_tokens (company_id, employee_id, user_id, token, piattaforma, attivo, disattivato_per_cambio)
  VALUES (v_comp, v_emp, (SELECT auth.uid()), p_token, p_piattaforma, v_ok, NOT v_ok)
  ON CONFLICT (token) DO UPDATE
     SET company_id = EXCLUDED.company_id, employee_id = EXCLUDED.employee_id, user_id = EXCLUDED.user_id,
         piattaforma = EXCLUDED.piattaforma, attivo = v_ok, disattivato_per_cambio = NOT v_ok, aggiornato_il = now();
END;
$fn$;
REVOKE ALL ON FUNCTION public.app_registra_push_token(text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_registra_push_token(text, text, text) TO authenticated, service_role;

-- 3. Una tantum: telefoni registrati prima dell'ultima attivazione
UPDATE public.employee_push_tokens t
   SET attivo = false, disattivato_per_cambio = true, aggiornato_il = now()
  FROM public.employee_app_access a
 WHERE a.employee_id = t.employee_id AND t.attivo AND a.attivata_il IS NOT NULL
   AND t.created_at < a.attivata_il;

COMMIT;
