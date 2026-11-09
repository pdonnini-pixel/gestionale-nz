-- ROLLBACK della migrazione 368 (dipendente di prova).
-- Toglie le policy e rimette le funzioni come nella 348/349/351/367.
-- La colonna employees.is_demo resta: se ci sono dipendenti di prova,
-- prima vanno disattivati (UPDATE employees SET is_active = false WHERE is_demo),
-- altrimenti tornerebbero visibili nel gestionale e nei conteggi.
-- Le funzioni originali sono in:
--   app_accessi_elenco, timbratrice_dati, timbrature_turni_ufficiali -> 20261105_348/349
--   app_dipendente_chiedi_ferie -> 20261105_351
--   app_push_stato, timbrature_avvisi_da_mandare -> 20261105_367
-- Riapplicare quelle definizioni dopo questo blocco.

BEGIN;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_policies WHERE policyname = 'demo_nascosto' LOOP
    EXECUTE format('DROP POLICY demo_nascosto ON %I.%I', r.schemaname, r.tablename);
  END LOOP;
END;
$$;
COMMIT;
