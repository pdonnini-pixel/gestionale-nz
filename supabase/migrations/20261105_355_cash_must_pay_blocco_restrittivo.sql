-- =====================================================================
-- Migrazione 355 — cash_must_pay: il blocco della cassa torna a bloccare
-- =====================================================================
-- COSA NON ANDAVA: la 201 ha creato "cash_operator_block" su cash_must_pay
-- senza AS RESTRICTIVE e TO public. Permissiva, si somma in OR alle altre:
-- invece di togliere la tabella all'account di cassa la apriva in lettura e
-- scrittura a chiunque non fosse operatore_cassa, compreso un visitatore
-- non autenticato (anon ha i GRANT e per lui get_my_role() e' NULL). Cosi'
-- cadeva anche il limite di scrittura di cash_must_pay_write (solo
-- super_advisor, contabile, cfo, come scritto in SimulazioneFabbisogno.tsx).
-- Trovato il 05/11/2026 cercando policy «_block» permissive su NZ e Zago:
-- e' l'unica. La tabella e' vuota su tutti e due (0 righe).
--
-- COSA FA (nessun DROP, nessun dato toccato):
--   1. rinomina la policy sbagliata in cash_operator_block_permissiva_201 e
--      la rende innocua (TO authenticated, USING false / WITH CHECK false:
--      una permissiva sempre falsa non concede niente);
--   2. crea al suo posto "cash_operator_block" RESTRITTIVA, identica a
--      quella delle altre tabelle (172, 350).
-- Per chi usa la Simulazione fabbisogno (super_advisor, contabile, cfo)
-- non cambia nulla: leggono con cash_must_pay_select e scrivono con
-- cash_must_pay_write. L'account di cassa non apre quella pagina.
-- Rilanciabile.
--
-- PARITA' TENANT: dal 03/11/2026 NZ + Zago (niente Made).
-- =====================================================================

DO $$
BEGIN
  IF to_regclass('public.cash_must_pay') IS NULL THEN
    RAISE NOTICE 'cash_must_pay assente, saltata';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cash_must_pay'
               AND policyname = 'cash_operator_block' AND permissive = 'PERMISSIVE') THEN
    ALTER POLICY cash_operator_block ON public.cash_must_pay RENAME TO cash_operator_block_permissiva_201;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cash_must_pay'
               AND policyname = 'cash_operator_block_permissiva_201') THEN
    ALTER POLICY cash_operator_block_permissiva_201 ON public.cash_must_pay
      TO authenticated USING (false) WITH CHECK (false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cash_must_pay'
                   AND policyname = 'cash_operator_block') THEN
    CREATE POLICY cash_operator_block ON public.cash_must_pay
      AS RESTRICTIVE FOR ALL TO authenticated
      USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa')
      WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa');
  END IF;
END $$;

-- Verifica (attese: cash_operator_block RESTRICTIVE; la _permissiva_201
-- con qual = false; nessuna policy «_block» permissiva in public):
--   SELECT policyname, permissive, roles, qual FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'cash_must_pay' ORDER BY 1;
--   SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname = 'public' AND permissive = 'PERMISSIVE' AND policyname ~ '_block$';
