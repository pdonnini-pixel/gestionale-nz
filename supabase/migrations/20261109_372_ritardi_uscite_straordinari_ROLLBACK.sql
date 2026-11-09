-- =====================================================================
-- ROLLBACK della migrazione 372 (ritardi, uscite anticipate, straordinari)
-- =====================================================================
-- Rimette timbrature_registra, timbratrice_dati e app_dipendente_oggi come
-- prima e toglie le funzioni nuove. Le tabelle attendance_eventi e
-- attendance_regole_dipendente e la colonna tolleranza_entrata_minuti
-- RESTANO (contengono dati veri): toglierle solo con backup e conferma di
-- Patrizio. Il margine dei negozi resta a 15: per tornare a 30
-- UPDATE public.attendance_settings SET margine_uscita_minuti = 30 WHERE margine_uscita_minuti = 15;
-- =====================================================================

BEGIN;

DO $$
DECLARE
  d text;
  n text;
BEGIN
  d := pg_get_functiondef('public.timbrature_registra(jsonb)'::regprocedure);
  n := replace(d, $x$    IF v_n = 1 AND v_verifica IN ('ok', 'da_confermare') THEN
      BEGIN
        PERFORM public.timbrature_evento_da_timbratura((r->>'id')::uuid, NULLIF(r->>'causale', ''));
      EXCEPTION WHEN others THEN
        RAISE WARNING 'timbrature_evento_da_timbratura: %', SQLERRM;
      END;
    END IF;
$x$, '');
  IF n = d THEN RAISE EXCEPTION 'timbrature_registra: pezzo della 372 non trovato'; END IF;
  EXECUTE n;

  d := pg_get_functiondef('public.timbratrice_dati(uuid)'::regprocedure);
  n := replace(d,
    $x$'persone', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'tolleranza', rg.tolleranza, 'margine', rg.margine) ORDER BY p.nome)
                            FROM persone p, LATERAL public.timbrature_regole(p.id, p_outlet_id) rg), '[]'::jsonb),$x$,
    $x$'persone', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome) ORDER BY p.nome) FROM persone p), '[]'::jsonb),$x$);
  IF n = d THEN RAISE EXCEPTION 'timbratrice_dati: pezzo della 372 non trovato'; END IF;
  EXECUTE n;

  d := pg_get_functiondef('public.app_dipendente_oggi()'::regprocedure);
  n := regexp_replace(d, ',\s*''regole'', \(SELECT.*?''\[\]''::jsonb\)\s*\) INTO v_out;', E'\n  ) INTO v_out;', 's');
  IF n = d THEN RAISE EXCEPTION 'app_dipendente_oggi: pezzo della 372 non trovato'; END IF;
  EXECUTE n;
END;
$$;

DROP FUNCTION IF EXISTS public.app_dipendente_motivo_evento(uuid, text, text);
DROP FUNCTION IF EXISTS public.timbrature_evento_da_timbratura(uuid, text);
DROP FUNCTION IF EXISTS public.timbrature_regole(uuid, uuid);

COMMIT;
