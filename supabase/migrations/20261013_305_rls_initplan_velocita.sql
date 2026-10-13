-- 20261013_305 — Velocità: regole RLS valutate una volta per richiesta, non per riga
--
-- PERCHÉ
-- Le policy RLS chiamano get_my_role(), get_my_company_id(), jwt_company_id(),
-- auth.uid() e auth.jwt() direttamente. Sono funzioni STABLE senza argomenti
-- (le prime due SECURITY DEFINER, quindi non inline-abili): Postgres le
-- ricalcola per OGNI riga letta, e ogni chiamata rilegge user_profiles.
-- Misurato su NZ il 13/10/2026 come utente reale:
--   bank_transactions, una pagina da 1000 (Banche): 199 ms -> 18 ms
--   v_payables_operative, una pagina da 1000 (Scadenzario): ~700 ms, fino a 3 s
-- Scritte come (SELECT f()) diventano un InitPlan: calcolate una volta sola per
-- istruzione. È la forma raccomandata da Supabase (advisor auth_rls_initplan).
--
-- COSA CAMBIA
-- Solo la scrittura delle policy dello schema public: f() -> (SELECT f()).
-- Le condizioni sono identiche (stesse funzioni, stesso valore dentro una
-- richiesta). Nessun dato, nessuna tabella, nessuna colonna toccata.
--
-- SICUREZZA DELLA MIGRATION
-- 1. Copia di tutte le policy in public._bkp_rls_policies_20261013 (con RLS,
--    nessuna policy: invisibile ad anon/authenticated). Scritta solo se vuota,
--    così un secondo lancio non sovrascrive la copia originale.
-- 2. lock_timeout 3s: se una tabella è occupata, errore e rollback completo.
-- 3. Controllo finale: ogni policy, tolto il (SELECT ...), deve coincidere con
--    la copia; stesso numero di policy. Una differenza => eccezione => rollback.
-- Idempotente: una policy già scritta (SELECT f()) non viene ri-avvolta.
--
-- Va applicata su NZ -> Made -> Zago. Rollback: _ROLLBACK.sql a fianco.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = public, extensions;

CREATE TABLE IF NOT EXISTS public._bkp_rls_policies_20261013 (
  tablename  text NOT NULL,
  policyname text NOT NULL,
  cmd        text,
  qual       text,
  with_check text,
  saved_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tablename, policyname)
);
ALTER TABLE public._bkp_rls_policies_20261013 ENABLE ROW LEVEL SECURITY;

INSERT INTO public._bkp_rls_policies_20261013 (tablename, policyname, cmd, qual, with_check)
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename <> '_bkp_rls_policies_20261013'
  AND NOT EXISTS (SELECT 1 FROM public._bkp_rls_policies_20261013);

DO $$
DECLARE
  r   record;
  nq  text;
  nw  text;
  n   int := 0;
  -- f() non preceduta da lettera/punto e non già dentro "SELECT "
  pat text := '(?<![\w.])(?<!SELECT )((?:public\.)?(?:get_my_role|get_my_company_id|jwt_company_id)\(\)|auth\.(?:uid|jwt)\(\))';
BEGIN
  FOR r IN
    SELECT tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    nq := regexp_replace(r.qual, pat, '(SELECT \1)', 'g');
    nw := regexp_replace(r.with_check, pat, '(SELECT \1)', 'g');
    IF nq IS DISTINCT FROM r.qual OR nw IS DISTINCT FROM r.with_check THEN
      EXECUTE format('ALTER POLICY %I ON public.%I', r.policyname, r.tablename)
        || CASE WHEN nq IS NULL THEN '' ELSE format(' USING (%s)', nq) END
        || CASE WHEN nw IS NULL THEN '' ELSE format(' WITH CHECK (%s)', nw) END;
      n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'policy riscritte: %', n;
END $$;

-- Controllo di equivalenza: tolto l'involucro, ogni policy deve essere identica alla copia.
DO $$
DECLARE
  unwrap text := '\( SELECT ((?:public\.)?(?:get_my_role|get_my_company_id|jwt_company_id)\(\)|auth\.(?:uid|jwt)\(\)) AS \w+\)';
  n_diff int;
  n_bkp  int;
  n_now  int;
BEGIN
  SELECT count(*) INTO n_bkp FROM public._bkp_rls_policies_20261013;
  SELECT count(*) INTO n_now FROM pg_policies
   WHERE schemaname = 'public' AND tablename <> '_bkp_rls_policies_20261013';
  IF n_bkp <> n_now THEN
    RAISE EXCEPTION 'numero policy diverso: copia %, ora %', n_bkp, n_now;
  END IF;

  SELECT count(*) INTO n_diff
  FROM public._bkp_rls_policies_20261013 b
  LEFT JOIN pg_policies p
    ON p.schemaname = 'public' AND p.tablename = b.tablename AND p.policyname = b.policyname
  WHERE p.policyname IS NULL
     OR p.cmd IS DISTINCT FROM b.cmd
     OR regexp_replace(p.qual, unwrap, '\1', 'g') IS DISTINCT FROM b.qual
     OR regexp_replace(p.with_check, unwrap, '\1', 'g') IS DISTINCT FROM b.with_check;
  IF n_diff > 0 THEN
    RAISE EXCEPTION 'policy non equivalenti alla copia: %', n_diff;
  END IF;
END $$;

COMMIT;
