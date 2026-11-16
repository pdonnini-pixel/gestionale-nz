-- Rollback della 421: stesse frasi al contrario (vedi la 421). Cambia solo testi.
DO $$
DECLARE
  v_cambi CONSTANT text[][] := ARRAY[
    ['app_dipendente_dichiara_entrata', 'ne parla il referente con chi segue il personale', 'ne parla il responsabile con chi segue il personale'],
    ['app_dipendente_dichiara_entrata', 'avvisa il referente', 'avvisa il responsabile'],
    ['ferie_lunedi_testo', 'una fra referente e vice referente deve essere in negozio', 'una fra responsabile e vice deve essere in negozio'],
    ['ferie_lunedi_testo', 'altra fra referente e vice referente del negozio', 'altra fra responsabile e vice del negozio'],
    ['ferie_motivo_scala', 'Per una referente o una vice referente decide l', 'Per una responsabile o una vice decide l'],
    ['ferie_motivo_scala', 'altra referente.', 'altra responsabile.'],
    ['ferie_proposta_sposta', 'Il lunedì una fra referente e vice referente è in negozio', 'Il lunedì una fra responsabile e vice è in negozio'],
    ['organico_imposta_referente_dal', 'Il referente attuale lo è dal', 'Il responsabile attuale lo è dal'],
    ['organico_imposta_referente_dal', 'Il referente lo imposta chi tiene', 'Il responsabile lo imposta chi tiene'],
    ['organico_imposta_referente_dal', 'Il referente si cambia dal giorno', 'Il responsabile si cambia dal giorno'],
    ['organico_imposta_vice', 'La vice referente la imposta', 'La vice responsabile la imposta'],
    ['organico_imposta_vice', 'È già la referente di questo negozio: la vice referente deve essere', 'È già la responsabile di questo negozio: la vice deve essere'],
    ['outlet_referenti_storico_no_delete', 'Lo storico dei referenti non si cancella: si cambia il referente.', 'Lo storico dei responsabili non si cancella: si cambia il responsabile.'],
    ['outlet_vice_storico_no_delete', 'Lo storico delle vice referenti non si cancella: si cambia la vice referente.', 'Lo storico delle vice responsabili non si cancella: si cambia la vice.'],
    ['presenze_decidi_evento', 'accordo con il referente: scegli', 'accordo con il responsabile: scegli'],
    ['presenze_non_su_di_me', 'un altro referente o un amministratore', 'un altro responsabile o un amministratore'],
    ['responsabile_non_qui', 'Non disponibile con il profilo referente', 'Non disponibile con il profilo responsabile']
  ];
  v_fn text; v_def text; v_oid oid; i int;
BEGIN
  FOR v_fn IN SELECT DISTINCT v_cambi[k][1] FROM generate_subscripts(v_cambi, 1) k LOOP
    SELECT p.oid INTO STRICT v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = v_fn;
    v_def := pg_get_functiondef(v_oid);
    FOR i IN 1 .. array_length(v_cambi, 1) LOOP
      IF v_cambi[i][1] = v_fn THEN v_def := replace(v_def, v_cambi[i][2], v_cambi[i][3]); END IF;
    END LOOP;
    EXECUTE v_def;
  END LOOP;
END $$;
