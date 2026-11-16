-- 421 — «Referente» e «vice referente» al posto di «responsabile» nei messaggi del database
-- (Patrizio, 16/11/2026: «la parola responsabile non va bene, è solo referente e vicereferente»).
-- Il frontend è cambiato con la PR 854; qui restano i messaggi che le funzioni mostrano a video.
-- Ogni funzione si prende com'è oggi (pg_get_functiondef), si cambiano SOLO le frasi elencate e si
-- riscrive: nessuna logica, nessun controllo, nessun permesso cambia. Se una frase attesa non si trova
-- la migration si ferma senza toccare niente. Non si tocca «responsabile HR» né il valore di ruolo
-- 'responsabile' usato nei controlli. Solo NZ e Zago (le 11 funzioni erano identiche sui due tenant).
DO $$
DECLARE
  v_cambi CONSTANT text[][] := ARRAY[
    ['app_dipendente_dichiara_entrata', 'ne parla il responsabile con chi segue il personale', 'ne parla il referente con chi segue il personale'],
    ['app_dipendente_dichiara_entrata', 'avvisa il responsabile', 'avvisa il referente'],
    ['ferie_lunedi_testo', 'una fra responsabile e vice deve essere in negozio', 'una fra referente e vice referente deve essere in negozio'],
    ['ferie_lunedi_testo', 'altra fra responsabile e vice del negozio', 'altra fra referente e vice referente del negozio'],
    ['ferie_motivo_scala', 'Per una responsabile o una vice decide l', 'Per una referente o una vice referente decide l'],
    ['ferie_motivo_scala', 'altra responsabile.', 'altra referente.'],
    ['ferie_proposta_sposta', 'Il lunedì una fra responsabile e vice è in negozio', 'Il lunedì una fra referente e vice referente è in negozio'],
    ['organico_imposta_referente_dal', 'Il responsabile attuale lo è dal', 'Il referente attuale lo è dal'],
    ['organico_imposta_referente_dal', 'Il responsabile lo imposta chi tiene', 'Il referente lo imposta chi tiene'],
    ['organico_imposta_referente_dal', 'Il responsabile si cambia dal giorno', 'Il referente si cambia dal giorno'],
    ['organico_imposta_vice', 'La vice responsabile la imposta', 'La vice referente la imposta'],
    ['organico_imposta_vice', 'È già la responsabile di questo negozio: la vice deve essere', 'È già la referente di questo negozio: la vice referente deve essere'],
    ['outlet_referenti_storico_no_delete', 'Lo storico dei responsabili non si cancella: si cambia il responsabile.', 'Lo storico dei referenti non si cancella: si cambia il referente.'],
    ['outlet_vice_storico_no_delete', 'Lo storico delle vice responsabili non si cancella: si cambia la vice.', 'Lo storico delle vice referenti non si cancella: si cambia la vice referente.'],
    ['presenze_decidi_evento', 'accordo con il responsabile: scegli', 'accordo con il referente: scegli'],
    ['presenze_non_su_di_me', 'un altro responsabile o un amministratore', 'un altro referente o un amministratore'],
    ['responsabile_non_qui', 'Non disponibile con il profilo responsabile', 'Non disponibile con il profilo referente']
  ];
  v_fn  text;
  v_def text;
  v_oid oid;
  i     int;
BEGIN
  FOR v_fn IN SELECT DISTINCT v_cambi[k][1] FROM generate_subscripts(v_cambi, 1) k LOOP
    -- STRICT: si ferma se la funzione manca o ha piu' versioni con lo stesso nome
    SELECT p.oid INTO STRICT v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_fn;
    v_def := pg_get_functiondef(v_oid);
    FOR i IN 1 .. array_length(v_cambi, 1) LOOP
      IF v_cambi[i][1] = v_fn THEN
        IF strpos(v_def, v_cambi[i][2]) = 0 THEN
          RAISE EXCEPTION 'Frase non trovata in %: %', v_fn, v_cambi[i][2];
        END IF;
        v_def := replace(v_def, v_cambi[i][2], v_cambi[i][3]);
      END IF;
    END LOOP;
    EXECUTE v_def;
  END LOOP;
END $$;
