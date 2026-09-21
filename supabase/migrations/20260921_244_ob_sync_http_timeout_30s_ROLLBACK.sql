-- ROLLBACK 20260921_244 — toglie il preambolo dei timeout dalla sync banche,
-- riportandola al default dell'estensione http (5 secondi per chiamata).
-- Stesso metodo della migration: si rilegge il sorgente installato e si rimuove
-- solo il blocco aggiunto, senza toccare la logica di sincronizzazione.

DO $rb$
DECLARE
  v_def text;
  v_new text;
  v_preambolo text := E'  -- Timeout: 30s per chiamata HTTP (il default dell''estensione http è 5s e\n'
    || E'  -- bastava un rallentamento di A-Cube per far fallire il giro), 170s per\n'
    || E'  -- l''intera funzione, come già fanno le due sync fatture. Il secondo serve\n'
    || E'  -- al lancio manuale dal frontend, dove il ruolo authenticated si ferma a 8s.\n'
    || E'  PERFORM set_config(''statement_timeout'',''170000'', true);\n'
    || E'  PERFORM http_set_curlopt(''CURLOPT_TIMEOUT'',''30'');\n'
    || E'\n';
BEGIN
  SELECT pg_get_functiondef('public.acube_ob_sync_all_production(text)'::regprocedure) INTO v_def;
  v_new := replace(v_def, v_preambolo, '');
  IF v_new = v_def THEN
    RAISE NOTICE 'acube_ob_sync_all_production: preambolo non presente, nessuna modifica';
    RETURN;
  END IF;
  EXECUTE v_new;
END
$rb$;
