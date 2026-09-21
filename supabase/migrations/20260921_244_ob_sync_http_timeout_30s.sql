-- 20260921_244 — Sync banche: timeout HTTP a 30 secondi come gli altri due feed
--
-- Problema osservato su NZ il 21/09/2026: la run banche delle 00:00 si è chiusa
-- "Parziale" con questo errore visibile in Report sincronizzazioni:
--   07362100484: Operation timed out after 5002 milliseconds with 0 bytes received
-- (07362100484 è la P.IVA della company, cioè il business registry su cui A-Cube
-- espone i conti). La run successiva delle 06:00 ha recuperato tutto: nessun
-- movimento perso, ma sei ore di saldi fermi e un allarme rosso in pagina.
--
-- Causa: `acube_ob_sync_all_production` è l'unica delle tre funzioni di sync che
-- non alza il timeout di curl, quindi resta sul default dell'estensione http
-- (5 secondi). Le due funzioni fatture fanno già, in testa all'esecuzione:
--   PERFORM set_config('statement_timeout','170000', true);
--   PERFORM http_set_curlopt('CURLOPT_TIMEOUT','30');
--
-- Rimedio: le stesse due righe, in testa anche a questa funzione. Il corpo NON
-- viene riscritto a mano: si rilegge il sorgente installato con
-- pg_get_functiondef e ci si inserisce solo il preambolo, così la logica di
-- sincronizzazione resta identica byte per byte e i tre tenant restano allineati
-- anche se una migration precedente aveva già toccato la funzione.
-- Idempotente: se il timeout è già impostato, non fa nulla.
--
-- Nota: la via più breve (ALTER FUNCTION … SET "http.timeout_msec") non è
-- percorribile, il GUC dell'estensione http richiede privilegi di superuser.

DO $mig$
DECLARE
  v_def  text;
  v_new  text;
  v_anchor text := E'BEGIN\n  SELECT id INTO v_company_id FROM public.companies LIMIT 1;';
  v_preambolo text := E'BEGIN\n'
    || E'  -- Timeout: 30s per chiamata HTTP (il default dell''estensione http è 5s e\n'
    || E'  -- bastava un rallentamento di A-Cube per far fallire il giro), 170s per\n'
    || E'  -- l''intera funzione, come già fanno le due sync fatture. Il secondo serve\n'
    || E'  -- al lancio manuale dal frontend, dove il ruolo authenticated si ferma a 8s.\n'
    || E'  PERFORM set_config(''statement_timeout'',''170000'', true);\n'
    || E'  PERFORM http_set_curlopt(''CURLOPT_TIMEOUT'',''30'');\n'
    || E'\n'
    || E'  SELECT id INTO v_company_id FROM public.companies LIMIT 1;';
BEGIN
  SELECT pg_get_functiondef('public.acube_ob_sync_all_production(text)'::regprocedure) INTO v_def;

  IF position('CURLOPT_TIMEOUT' in v_def) > 0 THEN
    RAISE NOTICE 'acube_ob_sync_all_production: timeout già impostato, nessuna modifica';
    RETURN;
  END IF;

  v_new := replace(v_def, v_anchor, v_preambolo);
  IF v_new = v_def THEN
    RAISE EXCEPTION 'acube_ob_sync_all_production: preambolo non agganciato, il sorgente è cambiato — verificare a mano';
  END IF;

  EXECUTE v_new;
END
$mig$;

-- Verifica (attesa: true su tutti e tre i tenant):
--   SELECT position('CURLOPT_TIMEOUT' in
--            pg_get_functiondef('public.acube_ob_sync_all_production(text)'::regprocedure)) > 0 AS timeout_ok;
