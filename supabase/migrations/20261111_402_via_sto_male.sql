-- =====================================================================
-- Migrazione 402 — Via la causale «Sto male» dall'uscita anticipata
-- =====================================================================
-- Pacchetto privacy di Lilian (versione 1.1, 11/11/2026), decisione di New
-- Zago: la causale «Sto male» si elimina, perché porta un dato sulla salute
-- nei sistemi delle presenze. La malattia segue i canali aziendali
-- separati (certificato all'ufficio del personale), non l'app.
-- Da qui le nuove uscite anticipate accettano solo 'personale' e 'accordo':
--   - timbrature_evento_da_timbratura (scelta fatta al telefono del negozio);
--   - app_dipendente_motivo_evento (scelta fatta nell'app);
--   - presenze_causale_evento (scelta del responsabile).
-- I casi già registrati con 'malattia' restano come sono (nessun dato
-- cambiato) e presenze_decidi_evento li sa ancora decidere.
-- Tenant: NZ e Zago. Rollback: 20261111_402_via_sto_male_ROLLBACK.sql
-- =====================================================================
BEGIN;
DO $do$
DECLARE f text; d text; n text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.timbrature_evento_da_timbratura(uuid,text)',
                           'public.app_dipendente_motivo_evento(uuid,text,text)',
                           'public.presenze_causale_evento(uuid,text)'] LOOP
    d := pg_get_functiondef(f::regprocedure);
    n := replace(d, $x$('personale', 'malattia', 'accordo')$x$, $x$('personale', 'accordo')$x$);
    IF n = d THEN RAISE EXCEPTION '%: ancora non trovata', f; END IF;
    EXECUTE n;
  END LOOP;
END
$do$;
COMMIT;
