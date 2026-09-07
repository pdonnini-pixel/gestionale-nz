-- =============================================================================
-- Le tabelle di backup erano leggibili con la anon key
-- Applicato su NZ + Made + Zago il 04/09/2026.
-- =============================================================================
--
-- IL PROBLEMA. Il security advisor di Supabase segnalava 19 ERROR
-- `rls_disabled_in_public` su NZ: tutte tabelle `_bkp_*` create con
-- `CREATE TABLE AS`, che non eredita ne' la RLS ne' i grant dalla tabella di
-- origine. Dentro ci sono dati veri, non copie di comodo: scadenzario, movimenti
-- bancari, anagrafiche fornitori. `_bkp_close_incoming_20260903` da sola contiene
-- 7.766 righe di movimenti. Con la RLS spenta e il GRANT SELECT aperto ad `anon`,
-- bastava la chiave pubblica del sito per leggerle.
--
-- Le altre ~45 tabelle di backup piu' vecchie avevano gia' la RLS attiva senza
-- policy, quindi di fatto chiuse, ma molte conservavano il grant ad `anon` e
-- `authenticated`: inutile, e pericoloso il giorno in cui qualcuno disattivasse
-- la RLS su una di esse.
--
-- COSA FA. Su ogni tabella di backup dello schema public:
--   1. ENABLE ROW LEVEL SECURITY senza alcuna policy. Nessun ruolo applicativo
--      la legge; restano accessibili a service_role e al proprietario, che e'
--      esattamente cio' che serve a un backup.
--   2. REVOKE ALL da anon e authenticated: seconda barriera, indipendente dalla
--      RLS, che regge anche se un domani la RLS venisse disattivata.
--
-- Nessun dato viene toccato: i backup restano integri e consultabili dal
-- dashboard. Verificato su tutto src/ che il frontend non legga nessuna di
-- queste tabelle.
--
-- Il filtro sui nomi e' volutamente conservativo: solo i prefissi e i suffissi
-- usati finora. Se in futuro nascono backup con nomi diversi questa migration
-- non li copre, ed e' meglio cosi': allargare il pattern rischierebbe di colpire
-- una tabella viva.
--
-- ESITO su NZ: 73 tabelle messe in sicurezza, i 19 ERROR dell'advisor azzerati.
-- Restano 91 INFO `rls_enabled_no_policy`, che sono queste stesse tabelle nello
-- stato voluto: RLS accesa e nessuna policy.
-- =============================================================================

DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT c.oid, c.relname, c.relrowsecurity
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relkind = 'r'
      AND (c.relname LIKE '\_bkp\_%' OR c.relname LIKE '\_backup\_%'
           OR c.relname LIKE '%\_bkp\_%' OR c.relname LIKE '%\_backup\_%'
           OR c.relname LIKE '%bkp\_2026%' OR c.relname LIKE '%\_fix\_backup\_%'
           OR c.relname LIKE '%\_fix2\_backup\_%')
  LOOP
    IF NOT r.relrowsecurity THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    END IF;
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', r.relname);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Tabelle di backup messe in sicurezza: %', n;
END $$;

-- --- Verifica ---------------------------------------------------------------
-- select count(*) totale,
--        count(*) filter (where not c.relrowsecurity) senza_rls,
--        count(*) filter (where has_table_privilege('anon', c.oid, 'SELECT')) legge_anon
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname='public' and c.relkind='r' and (c.relname like '\_bkp\_%' or ...);
-- Atteso: senza_rls = 0, legge_anon = 0.
