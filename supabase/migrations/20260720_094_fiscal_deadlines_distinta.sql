-- 20260720_094_fiscal_deadlines_distinta.sql
--
-- Scadenze fiscali (F24 / interne) nella DISTINTA pagamenti.
-- Finora le scadenze fiscali si potevano selezionare nello Scadenzario (scalavano i
-- saldi banca nella barra in basso) ma NON entravano davvero in distinta: la creazione
-- distinta cercava solo tra le fatture fornitori (tabella payables) e le scartava in
-- silenzio. Su richiesta: le scadenze fiscali devono entrare in distinta come le fatture
-- (anteprima, email, Storico) ed essere registrate alla conferma.
--
-- Le scadenze fiscali vivono su una tabella diversa (fiscal_deadlines), non su payables,
-- quindi la disposizione NON può stare in payable_actions (FK a payables). Si traccia
-- direttamente qui, con 4 colonne dedicate — speculari a payables.disposizione_*/
-- payment_bank_account_id. Niente FK sul conto (il nome banca lo risolve il frontend
-- via bank_accounts), per restare puramente additivi e senza vincoli nuovi.
--
-- Additivo e non distruttivo: solo ADD COLUMN IF NOT EXISTS (nullable, nessun default,
-- nessun backfill). Idempotente.
--
-- ⚠️ PARITÀ TENANT (Regola #0): applicare su TUTTI E 3 i tenant
--    NZ (xfvfxsvqpnpvibgeqpqp) / Made (wdgoebzvosspjqttitra) / Zago (jxlwvzjreukscnswkbjx).

BEGIN;

ALTER TABLE public.fiscal_deadlines
  ADD COLUMN IF NOT EXISTS disposizione_date            timestamptz,
  ADD COLUMN IF NOT EXISTS disposizione_bank_account_id uuid,
  ADD COLUMN IF NOT EXISTS disposizione_amount          numeric,
  ADD COLUMN IF NOT EXISTS disposizione_note            text;

COMMIT;

-- Verifica (attese: le 4 colonne presenti):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='fiscal_deadlines'
--     AND column_name LIKE 'disposizione%' ORDER BY column_name;
--
-- Rollback (se serve tornare indietro — nessun dato perso perché sono sempre state NULL):
--   ALTER TABLE public.fiscal_deadlines
--     DROP COLUMN IF EXISTS disposizione_date,
--     DROP COLUMN IF EXISTS disposizione_bank_account_id,
--     DROP COLUMN IF EXISTS disposizione_amount,
--     DROP COLUMN IF EXISTS disposizione_note;
