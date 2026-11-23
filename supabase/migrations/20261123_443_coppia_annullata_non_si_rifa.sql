-- =====================================================================
-- 443 — Una coppia che una persona ha annullato non la rifà il motore. NZ + Zago.
-- =====================================================================
-- Il fatto (NZ, controllo settimanale del 23/11/2026). Mercoledì 19/11 Patrizio
-- ha annullato l'aggancio fra la fattura UNICOOP Firenze 044/000009 (250,00,
-- pagata con la carta BCC *3145 il 02/01/2026) e l'addebito SDD del 06/03/2026
-- da 251,22, che è un rimborso tax free Global Blue. Giovedì 20/11 alle 05:45
-- il giro notturno ha rifatto lo stesso aggancio, identico, nota compresa.
--
-- Finché il motore non sa che una persona ha escluso quella coppia, annullare a
-- mano non serve: la notte dopo torna. Serve un posto dove la decisione resta
-- scritta, e i rami automatici che lo leggono.
--
-- Cosa fa questa migration:
--  1. `reconciliation_coppie_escluse`: una riga per coppia (movimento, fattura)
--     esclusa, con il motivo, chi l'ha esclusa e quando. RLS e GRANT come
--     l'archivio: la leggono tutti quelli che vedono Banche, la scrivono solo
--     `super_advisor` e `contabile`.
--  2. `coppia_esclusa(bt, pay)`, `escludi_coppia(bt, pay, motivo)` e
--     `riammetti_coppia(bt, pay)`.
--  3. `undo_reconcile_movement`: quando una persona annulla un aggancio, la
--     coppia entra nell'elenco. Vale per entrambi i rami (solo aggancio e
--     riconciliazione piena).
--  4. `reconcile_movement`: una coppia esclusa non si riconcilia più da sola
--     (cron e service role senza utente: `ok = false`, `reason = coppia_esclusa`).
--     Se invece la rifà una PERSONA, comanda lei: l'aggancio passa e
--     l'esclusione cade, perché è il modo in cui si corregge un ripensamento.
--     Da qui passano tutti i rami `try_match_*`, quindi distinte, cumulativi,
--     gruppi, commissioni MPS e importo anonimo sono coperti in un punto solo.
--  5. `rerun_bijective_reconciliation`: è l'unico ramo che scrive il log da sé,
--     quindi il controllo va anche nella sua ricerca dei candidati.
--
-- NIENTE BACKFILL, di proposito. Nel log ci sono 638 righe `rejected`, ma la
-- maggioranza sono proposte chiuse dal motore stesso (prima della 361 le
-- superate si chiudevano come `rejected`, non come `superseded`): leggerle tutte
-- come «decisioni di una persona» bloccherebbe agganci giusti. L'elenco parte
-- vuoto e si riempie da oggi, con gli annullamenti veri. L'unica riga di
-- partenza è quella di UNICOOP, che è una decisione di Patrizio documentata:
-- la mette la NZ_ONLY 445.
--
-- NO DATA LOSS: crea una tabella nuova e riscrive tre funzioni. Nessuna riga
-- esistente viene toccata.
-- =====================================================================

BEGIN;

-- 1. L'elenco delle coppie escluse ------------------------------------------
CREATE TABLE IF NOT EXISTS public.reconciliation_coppie_escluse (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  bank_transaction_id uuid NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  payable_id uuid NOT NULL REFERENCES public.payables(id) ON DELETE CASCADE,
  motivo text,
  escluso_da uuid DEFAULT auth.uid(),
  escluso_il timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_coppie_escluse_coppia_unica UNIQUE (bank_transaction_id, payable_id)
);

COMMENT ON TABLE public.reconciliation_coppie_escluse IS
  '443: coppie (movimento, fattura) che una persona ha escluso. Il motore non le rifà. CASCADE sui due lati di proposito: se il movimento o la fattura non ci sono più, non c''è niente da escludere.';
COMMENT ON COLUMN public.reconciliation_coppie_escluse.motivo IS
  'Perché è stata esclusa, in chiaro. Lo scrive chi annulla; serve a chi guarda mesi dopo.';

CREATE INDEX IF NOT EXISTS idx_coppie_escluse_bt ON public.reconciliation_coppie_escluse(bank_transaction_id);
CREATE INDEX IF NOT EXISTS idx_coppie_escluse_pay ON public.reconciliation_coppie_escluse(payable_id);
CREATE INDEX IF NOT EXISTS idx_coppie_escluse_company ON public.reconciliation_coppie_escluse(company_id);

ALTER TABLE public.reconciliation_coppie_escluse ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coppie_escluse_read ON public.reconciliation_coppie_escluse;
CREATE POLICY coppie_escluse_read ON public.reconciliation_coppie_escluse FOR SELECT TO authenticated
  USING (
    company_id = (SELECT public.get_my_company_id())
    AND (SELECT public.get_my_role()) IS NOT NULL
    AND COALESCE((SELECT public.get_my_role())::text, '')
        NOT IN ('dipendente', 'operatore_cassa', 'responsabile')
  );

DROP POLICY IF EXISTS coppie_escluse_write ON public.reconciliation_coppie_escluse;
CREATE POLICY coppie_escluse_write ON public.reconciliation_coppie_escluse FOR ALL TO authenticated
  USING (
    company_id = (SELECT public.get_my_company_id())
    AND (SELECT public.get_my_role()) = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role])
  )
  WITH CHECK (
    company_id = (SELECT public.get_my_company_id())
    AND (SELECT public.get_my_role()) = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role])
  );

DROP POLICY IF EXISTS coppie_escluse_service ON public.reconciliation_coppie_escluse;
CREATE POLICY coppie_escluse_service ON public.reconciliation_coppie_escluse FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reconciliation_coppie_escluse TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reconciliation_coppie_escluse TO service_role;

-- 2. Le tre funzioni --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coppia_esclusa(p_bt_id uuid, p_payable_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- SECURITY DEFINER perché la deve leggere anche il giro notturno, che non ha
  -- un'azienda nel JWT. Risponde solo sì o no su due id che il chiamante ha già.
  SELECT EXISTS (
    SELECT 1 FROM public.reconciliation_coppie_escluse e
     WHERE e.bank_transaction_id = p_bt_id AND e.payable_id = p_payable_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.escludi_coppia(p_bt_id uuid, p_payable_id uuid, p_motivo text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid;
BEGIN
  PERFORM public.ruoli_operativi_non_qui(); -- migration 380
  IF p_bt_id IS NULL OR p_payable_id IS NULL THEN
    RETURN;
  END IF;
  SELECT company_id INTO v_company FROM public.payables WHERE id = p_payable_id;
  IF v_company IS NULL THEN
    SELECT company_id INTO v_company FROM public.bank_transactions WHERE id = p_bt_id;
  END IF;
  IF v_company IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.reconciliation_coppie_escluse AS e
         (company_id, bank_transaction_id, payable_id, motivo)
  VALUES (v_company, p_bt_id, p_payable_id, p_motivo)
  ON CONFLICT (bank_transaction_id, payable_id) DO UPDATE
    SET motivo = COALESCE(EXCLUDED.motivo, e.motivo),
        escluso_il = now(),
        escluso_da = COALESCE(auth.uid(), e.escluso_da);
END;
$function$;

CREATE OR REPLACE FUNCTION public.riammetti_coppia(p_bt_id uuid, p_payable_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.ruoli_operativi_non_qui(); -- migration 380
  DELETE FROM public.reconciliation_coppie_escluse
   WHERE bank_transaction_id = p_bt_id AND payable_id = p_payable_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.coppia_esclusa(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.escludi_coppia(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.riammetti_coppia(uuid, uuid) TO authenticated, service_role;

COMMIT;

-- =====================================================================
-- Parte 2 — le tre funzioni che leggono e scrivono l'elenco
-- =====================================================================
-- Le funzioni NON si riscrivono a mano: si legge il testo vivo con
-- pg_get_functiondef, si innestano le righe nuove con replace() e si esegue
-- solo se il testo di partenza è quello atteso (md5). È la lezione del 09/11:
-- riscrivendo a mano il corpo della 333 si era perso un commento, e il file nel
-- repo aveva finito per non combaciare col vivo. Così la riga
--   PERFORM public.ruoli_operativi_non_qui(); -- migration 380
-- resta dov'è per costruzione, e la migration si ferma da sé se su un tenant la
-- funzione non è quella che ho letto (md5 uguale su NZ e Zago al 23/11/2026).

BEGIN;

-- 2a. undo_reconcile_movement: chi annulla esclude la coppia ---------------
DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.undo_reconcile_movement(uuid)'::regprocedure) INTO v_def;
  IF md5(v_def) <> '6e68dcc1b81874251a047a5563000270' THEN
    RAISE EXCEPTION 'undo_reconcile_movement: il testo vivo non è quello atteso (md5 %), non innesto niente', md5(v_def);
  END IF;

  -- ramo "solo aggancio"
  v_new := replace(v_def,
$o$     WHERE id = p_log_id;

    SELECT status INTO v_new_status FROM public.payables WHERE id = v_pay.id;$o$,
$n$     WHERE id = p_log_id;

    -- 443: questa coppia l'ha esclusa una persona. Il motore non la rifà.
    PERFORM public.escludi_coppia(v_log.bank_transaction_id, v_log.payable_id,
      'annullato a mano il ' || to_char(now(), 'DD/MM/YYYY') || ' (solo aggancio)');

    SELECT status INTO v_new_status FROM public.payables WHERE id = v_pay.id;$n$);

  -- ramo riconciliazione piena
  v_new := replace(v_new,
$o$  WHERE id = p_log_id;

  RETURN jsonb_build_object(
    'ok', true,
    'payable_id', v_pay.id,$o$,
$n$  WHERE id = p_log_id;

  -- 443: questa coppia l'ha esclusa una persona. Il motore non la rifà.
  PERFORM public.escludi_coppia(v_log.bank_transaction_id, v_log.payable_id,
    'annullato a mano il ' || to_char(now(), 'DD/MM/YYYY'));

  RETURN jsonb_build_object(
    'ok', true,
    'payable_id', v_pay.id,$n$);

  IF v_new !~ 'escludi_coppia' OR (length(v_new) - length(v_def)) < 300 THEN
    RAISE EXCEPTION 'undo_reconcile_movement: i punti di innesto non ci sono, non eseguo';
  END IF;
  EXECUTE v_new;
END
$patch$;

-- 2b. reconcile_movement: una coppia esclusa non si riconcilia da sola -----
DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.reconcile_movement(uuid,uuid,uuid)'::regprocedure) INTO v_def;
  IF md5(v_def) <> 'cb6fc96a78cd8dfba3773b823d6298f0' THEN
    RAISE EXCEPTION 'reconcile_movement: il testo vivo non è quello atteso (md5 %), non innesto niente', md5(v_def);
  END IF;

  v_new := replace(v_def,
$o$  IF v_bt.company_id IS DISTINCT FROM v_pay.company_id THEN
    RAISE EXCEPTION 'Movimento e fattura appartengono ad aziende diverse';
  END IF;$o$,
$n$  IF v_bt.company_id IS DISTINCT FROM v_pay.company_id THEN
    RAISE EXCEPTION 'Movimento e fattura appartengono ad aziende diverse';
  END IF;

  -- 443: coppia esclusa da una persona. Il motore (cron, service role: nessun
  -- utente dietro) si ferma qui. Se invece la rifà una persona comanda lei:
  -- l'aggancio passa e l'esclusione cade, perché è così che si corregge un
  -- ripensamento. Da qui passano tutti i rami try_match_*.
  IF public.coppia_esclusa(p_bt_id, p_payable_id) THEN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coppia_esclusa');
    END IF;
    PERFORM public.riammetti_coppia(p_bt_id, p_payable_id);
  END IF;$n$);

  IF v_new !~ 'coppia_esclusa' THEN
    RAISE EXCEPTION 'reconcile_movement: il punto di innesto non c''è, non eseguo';
  END IF;
  EXECUTE v_new;
END
$patch$;

-- 2c. rerun_bijective_reconciliation: l'unico ramo che scrive il log da sé --
DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.rerun_bijective_reconciliation()'::regprocedure) INTO v_def;
  IF md5(v_def) <> 'fe93d9aeb01909c533741abccfdde0b2' THEN
    RAISE EXCEPTION 'rerun_bijective_reconciliation: il testo vivo non è quello atteso (md5 %), non innesto niente', md5(v_def);
  END IF;

  v_new := replace(v_def,
$o$      AND bt.transaction_date >= v_floor$o$,
$n$      AND bt.transaction_date >= v_floor
      -- 443: le coppie escluse da una persona non tornano.
      AND NOT public.coppia_esclusa(bt.id, v_pay.id)$n$);

  IF v_new !~ 'coppia_esclusa' THEN
    RAISE EXCEPTION 'rerun_bijective_reconciliation: il punto di innesto non c''è, non eseguo';
  END IF;
  EXECUTE v_new;
END
$patch$;

COMMIT;

-- =====================================================================
-- Verifica (su NZ e su Zago)
-- =====================================================================
--   SELECT has_table_privilege('authenticated','public.reconciliation_coppie_escluse','select') AS auth,
--          has_table_privilege('service_role','public.reconciliation_coppie_escluse','insert') AS srv;
--   -- attesi: true, true
--
--   SELECT count(*) FROM pg_policies
--    WHERE schemaname='public' AND tablename='reconciliation_coppie_escluse';
--   -- atteso: 3
--
--   SELECT p.proname
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public'
--      AND p.proname IN ('undo_reconcile_movement','reconcile_movement','rerun_bijective_reconciliation')
--      AND pg_get_functiondef(p.oid) ILIKE '%coppia%'
--    ORDER BY 1;
--   -- attese tutte e tre
--
--   -- la riga della guardia 380 è ancora al suo posto in tutte e tre:
--   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public'
--      AND p.proname IN ('undo_reconcile_movement','reconcile_movement','rerun_bijective_reconciliation')
--      AND pg_get_functiondef(p.oid) LIKE '%ruoli_operativi_non_qui%';
--   -- atteso: 3
-- =====================================================================
