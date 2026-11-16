-- =====================================================================
-- 415 — Riparto in parti uguali fra i negozi, scelta dell'azienda
-- =====================================================================
-- Patrizio, 16/11/2026, per Zago: «metà per negozio, e vale per tutti i
-- fornitori esclusi affitti e utenze».
--
-- Il riparto automatico notturno (fn_riparto_automatico, migrazioni 274-302)
-- manda i costi di struttura sugli outlet in proporzione ai ricavi o, senza
-- ricavi, alla sede (outlet del centro di costo con ruolo 'hq'). Zago non ha
-- un outlet di sede: il passaggio salta e i fornitori restano «Divisione:
-- manca» (es. SP Contabile).
--
-- Nuova scelta per azienda: company_settings.riparto_parti_uguali.
--   NULL o false = come prima (New Zago non cambia).
--   true = dove il sistema non trova il negozio (bollette, fattura che lo
--          nomina, nome del fornitore, preventivo della merce) il costo va in
--          parti uguali fra gli outlet attivi con ruolo 'outlet', al posto di
--          ricavi o sede. Restano fuori, senza ripiego:
--            - affitti: categorie del gruppo 'locazione';
--            - utenze: ENERG_GAS (luce e gas), TELEFON (linee telefoniche);
--            - ALLESTIMENTI: vanno al negozio che si apre (regola 274).
--          Con un outlet solo non si applica.
--   Le regole messe a mano non si toccano mai (come sempre in 274).
--   Attenzione: con la scelta accesa il passaggio «ricavi o sede» (284/285) si
--   spegne del tutto. Su Zago non cambia niente (non ha una sede, il passaggio
--   non partiva comunque); accenderla su un'azienda con sede sposterebbe anche
--   i costi di struttura oggi divisi per ricavi e le trasferte senza località.
--   Anche i negozi in apertura, se attivi, ricevono la loro parte.
--
-- La funzione si modifica partendo dalla sua definizione attuale (uguale su
-- NZ e Zago, md5 8142a9fab4b450682c649551f7f0fe90 il 16/11/2026): tre
-- sostituzioni, ognuna verificata. Se una non trova il suo punto la migration
-- si ferma senza cambiare niente.
-- Rollback: 20261116_415_riparto_parti_uguali_fra_negozi_ROLLBACK.sql
-- =====================================================================

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS riparto_parti_uguali boolean;

COMMENT ON COLUMN public.company_settings.riparto_parti_uguali IS
  'true: il riparto automatico divide in parti uguali fra i negozi i costi senza negozio ricavabile, esclusi affitti (locazione), utenze (ENERG_GAS, TELEFON) e allestimenti. NULL/false: ricavi o sede (migrazione 415).';

DO $migr$
DECLARE
  v_def text := pg_get_functiondef('public.fn_riparto_automatico(uuid,boolean)'::regprocedure);
  v_new text;
  a1 text := E'  v_piano  jsonb := \'[]\'::jsonb;  -- cosa è stato (o sarebbe, in prova) creato o sostituito\nBEGIN\n';
  b1 text := E'  v_piano  jsonb := \'[]\'::jsonb;  -- cosa è stato (o sarebbe, in prova) creato o sostituito\n'
          || E'  v_parti_uguali boolean;  -- scelta dell\'azienda (migrazione 415)\n'
          || E'  v_negozi  jsonb;         -- {outlet_id: 1} degli outlet attivi con ruolo \'outlet\'\n'
          || E'BEGIN\n'
          || E'  SELECT coalesce(cs.riparto_parti_uguali, false) INTO v_parti_uguali\n'
          || E'  FROM public.company_settings cs WHERE cs.company_id = p_company_id;\n'
          || E'  v_parti_uguali := coalesce(v_parti_uguali, false);\n'
          || E'  SELECT jsonb_object_agg(o.id, 1) INTO v_negozi\n'
          || E'  FROM public.outlets o\n'
          || E'  JOIN public.cost_centers cc ON cc.company_id = o.company_id AND cc.code = o.cost_center_key AND cc.role = \'outlet\'\n'
          || E'  WHERE o.company_id = p_company_id AND o.is_active;\n\n';
  a2 text := E'    IF v_want IS NULL AND v_hq IS NOT NULL\n       AND ((s.cat_group IN';
  b2 text := E'    IF v_want IS NULL AND v_hq IS NOT NULL AND NOT v_parti_uguali\n       AND ((s.cat_group IN';
  a3 text := E'    CONTINUE WHEN v_want IS NULL;\n';
  b3 text := E'    -- 5. Parti uguali fra i negozi, se l\'azienda lo ha scelto (migrazione 415):\n'
          || E'    --    affitti, utenze e allestimenti restano fuori.\n'
          || E'    IF v_want IS NULL AND v_parti_uguali AND v_negozi IS NOT NULL\n'
          || E'       AND (SELECT count(*) FROM jsonb_object_keys(v_negozi)) >= 2\n'
          || E'       AND coalesce(s.cat_group, \'\') <> \'locazione\'\n'
          || E'       AND coalesce(s.cat_code, \'\') NOT IN (\'ENERG_GAS\', \'TELEFON\', \'ALLESTIMENTI\') THEN\n'
          || E'      v_want := v_negozi;\n'
          || E'      v_motivo := \'parti uguali fra i negozi (scelta dell\'\'azienda)\';\n'
          || E'    END IF;\n\n'
          || E'    CONTINUE WHEN v_want IS NULL;\n';
BEGIN
  IF position('v_parti_uguali' IN v_def) > 0 THEN
    RAISE NOTICE '415: funzione già aggiornata, niente da fare';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1
     OR (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1
     OR (length(v_def) - length(replace(v_def, a3, ''))) / length(a3) <> 1 THEN
    RAISE EXCEPTION '415: la definizione di fn_riparto_automatico non è quella attesa, nessuna modifica';
  END IF;
  v_new := replace(replace(replace(v_def, a1, b1), a2, b2), a3, b3);
  EXECUTE v_new;
END
$migr$;
