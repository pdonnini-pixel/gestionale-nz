-- =============================================================================
-- close_incoming_movements(boolean) era eseguibile da `anon`
-- Applicato su NZ il 04/09/2026 (Made e Zago erano gia' a posto: verificato).
-- =============================================================================
--
-- La migration 167 conteneva gia' `REVOKE ALL ... FROM PUBLIC, anon`, ma il
-- privilegio risultava comunque concesso: il security advisor la segnalava come
-- `anon_security_definer_function_executable` e has_function_privilege('anon', ...)
-- confermava. Verosimilmente il REVOKE e' stato annullato da un CREATE OR REPLACE
-- successivo, che riporta il default EXECUTE a PUBLIC.
--
-- Non e' un dettaglio formale: la funzione e' SECURITY DEFINER e, chiamata con
-- `false`, riscrive lo stato di riconciliazione di 7.766 movimenti bancari. Con
-- la anon key, che sta nel bundle del sito, era alla portata di chiunque.
--
-- DA RICORDARE. Dopo ogni CREATE OR REPLACE di una funzione SECURITY DEFINER
-- vanno ridichiarati i grant: il default torna a PUBLIC e i REVOKE precedenti
-- si perdono. Vale per tutte le funzioni che scrivono.
-- =============================================================================

REVOKE ALL ON FUNCTION public.close_incoming_movements(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_incoming_movements(boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.close_incoming_movements(boolean) TO authenticated, service_role;

-- --- Verifica ---------------------------------------------------------------
-- select has_function_privilege('anon', p.oid, 'EXECUTE') anon_puo
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname='public' and p.proname='close_incoming_movements';
-- Atteso: false.
