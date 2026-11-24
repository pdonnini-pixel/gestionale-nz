-- =====================================================================
-- 443 — Una coppia che una persona ha annullato non la rifà il motore. NZ + Zago.
-- =====================================================================
-- Il fatto (NZ, controllo settimanale del 23/11/2026). Mercoledì 19/11 Patrizio
-- ha annullato l'aggancio fra la fattura UNICOOP Firenze 044/000009 (250,00,
-- pagata con la carta BCC *3145 il 02/01/2026) e l'addebito SDD del 06/03/2026
-- da 251,22, che è un rimborso tax free Global Blue. Giovedì 20/11 alle 05:45
-- il giro notturno ha rifatto lo stesso aggancio, identico, nota compresa.
--
-- Non era la prima volta. Misurato su tutto lo storico del log: le coppie
-- annullate A MANO e poi rifatte dal motore sono DUE, e sono queste.
--   * 05/09/2026 — GRUPPO SERVIZI ASSOCIATI V070012600909 da 315,00, annullata
--     il 5 e rifatta il 6 settembre dal ramo del flusso CBI anonimo;
--   * 20/11/2026 — UNICOOP, dal ramo «abbinamento per data».
-- Quindi i due rami da chiudere sono esattamente quei due. Non è una scelta
-- fatta a sentimento: le altre 37 coppie «rifiutate e poi riapplicate» nello
-- storico sono proposte che il motore aveva chiuso da sé, non decisioni di
-- persone, e rifarle era giusto.
--
-- ## Perché serve una tabella e non basta guardare le righe `rejected`
--
-- `try_match_bank_transaction` ha già la regola giusta, scritta così: «Il no di
-- una persona vale piu' del punteggio: coppia gia' rifiutata, non si insiste»,
-- e la verifica cercando una riga `rejected` per quella coppia. Copiare quella
-- riga negli altri rami sembra la via corta, e invece è troppo larga: nel log ci
-- sono 638 righe `rejected` su 466 coppie, e la maggioranza NON sono no di una
-- persona, sono proposte che il motore stesso ha chiuso (prima della migration
-- 361 le proposte superate si chiudevano come `rejected`, non come
-- `superseded`). Misurato: il solo ramo «abbinamento per data» ha rifatto 21
-- coppie che erano `rejected`, e 20 di quelle erano chiusure del motore, cioè
-- agganci giusti che con la regola larga sarebbero stati bloccati.
--
-- Serve quindi distinguere il no di una persona dalla chiusura del motore, e
-- quello il log non lo dice. Da qui `reconciliation_coppie_escluse`: ci finisce
-- dentro solo ciò che una persona ha annullato, da oggi in avanti.
--
-- ## Cosa fa questa migration
--  1. `reconciliation_coppie_escluse`: una riga per coppia (movimento, fattura)
--     esclusa, con il motivo, chi l'ha esclusa e quando. RLS, GRANT e REVOKE.
--  2. `coppia_esclusa(bt, pay)`, `escludi_coppia(bt, pay, motivo)` e
--     `riammetti_coppia(bt, pay)`.
--  3. `undo_reconcile_movement`: quando una persona annulla un aggancio, la
--     coppia entra nell'elenco. Vale per entrambi i rami della funzione (solo
--     aggancio e riconciliazione piena).
--  4. `reconcile_movement`: una coppia esclusa non si riconcilia, e **non fa
--     differenza chi chiama**. Questo è il punto che i revisori hanno corretto:
--     la prima stesura riammetteva la coppia quando `auth.uid()` non era nullo,
--     cioè «c'è una persona dietro». Ma una persona che carica un estratto conto
--     da ImportHub lancia `rerun_reconciliation`, che gira con il SUO token: il
--     giro di massa sarebbe passato per una decisione consapevole e avrebbe
--     cancellato l'esclusione. Il segnale deve venire dal gesto, non dall'utente:
--     per rifare a mano una coppia esclusa si chiama prima `riammetti_coppia`,
--     che è un gesto esplicito su quella coppia (lo fa il pulsante
--     dell'abbinamento manuale in Riconciliazione).
--  5. `rerun_bijective_reconciliation` e `try_match_amount_bank_transaction`: i
--     due rami che hanno rifatto una coppia annullata a mano. Il controllo va
--     nella ricerca dei candidati, dove non costa niente.
--
-- ## Cosa questa migration NON copre, detto chiaro
--
-- Nel motore sono **dodici** le funzioni che scrivono un aggancio
-- (`INSERT INTO public.reconciliation_log`): a parte le due di sopra e
-- `reconcile_movement`, restano fuori `reconcile_movement_group`,
-- `try_match_bank_transaction` (che però ha già il suo controllo),
-- `try_match_distinta_bank_transaction`, `try_match_group_bank_transaction`,
-- `try_match_group_numbers_bank_transaction`,
-- `try_match_effetti_ritirati_bank_transaction`,
-- `try_match_riba_effetti_bank_transaction`,
-- `try_match_rimborso_bank_transaction` e `try_match_sdd_sum_bank_transaction`.
-- In quei rami, oggi, un aggancio annullato a mano non è mai tornato (misurato
-- sopra), e quasi tutti nascono da un documento (distinta, effetti, estratto
-- carta), dove l'identità non è indovinata. Metterci il controllo vuol dire
-- innestare nove punti in nove funzioni: si fa, ma è un lavoro a parte, da
-- misurare e verificare uno per uno. Qui si chiudono i due rami che hanno
-- sbagliato davvero, e questa riga resta scritta perché nessuno creda che la
-- regola valga già per tutto il motore.
--
-- NO DATA LOSS: crea una tabella nuova e riscrive quattro funzioni. Nessuna
-- riga esistente viene toccata, nessun aggancio esistente viene disfatto.
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
  '443: coppie (movimento, fattura) che una persona ha escluso. Il motore non le rifà. CASCADE sui due lati di proposito: se il movimento o la fattura non ci sono più non c''è niente da escludere. Da sapere: un estratto reimportato che ricrea il movimento con un id nuovo si porta via l''esclusione, perché la coppia non è più la stessa.';
COMMENT ON COLUMN public.reconciliation_coppie_escluse.motivo IS
  'Perché è stata esclusa, in chiaro. Lo scrive chi annulla; serve a chi guarda mesi dopo.';

-- Niente indice su bank_transaction_id: ci pensa l'indice univoco, che comincia
-- da quella colonna.
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

-- La scrittura vale per gli stessi ruoli che possono riconciliare, cioè la
-- lista bianca della guardia 380/381. Tenerla più stretta (solo super_advisor e
-- contabile) avrebbe creato un'incoerenza: un `ceo` può annullare un aggancio
-- con `undo_reconcile_movement`, e quell'annullamento deve poter scrivere qui.
DROP POLICY IF EXISTS coppie_escluse_write ON public.reconciliation_coppie_escluse;
CREATE POLICY coppie_escluse_write ON public.reconciliation_coppie_escluse FOR ALL TO authenticated
  USING (
    company_id = (SELECT public.get_my_company_id())
    AND (SELECT public.get_my_role()) = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role,
                                                   'ceo'::user_role, 'cfo'::user_role, 'coo'::user_role])
  )
  WITH CHECK (
    company_id = (SELECT public.get_my_company_id())
    AND (SELECT public.get_my_role()) = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role,
                                                   'ceo'::user_role, 'cfo'::user_role, 'coo'::user_role])
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
  -- SECURITY DEFINER perché la leggono i rami del giro notturno, che non hanno
  -- un'azienda nel JWT. Risponde solo sì o no su due id che il chiamante ha già
  -- in mano, quindi non è una via per leggere dati di nessuno.
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
  v_pay_company uuid;
  v_bt_company uuid;
BEGIN
  PERFORM public.ruoli_operativi_non_qui(); -- migration 380
  IF p_bt_id IS NULL OR p_payable_id IS NULL THEN
    RETURN;
  END IF;
  SELECT company_id INTO v_pay_company FROM public.payables WHERE id = p_payable_id;
  SELECT company_id INTO v_bt_company FROM public.bank_transactions WHERE id = p_bt_id;
  -- Il movimento e la fattura devono essere della stessa azienda, e di quella di
  -- chi sta scrivendo quando dietro c'è una persona (il giro notturno non ha
  -- azienda nel JWT e passa).
  IF v_pay_company IS NULL OR v_bt_company IS NULL OR v_pay_company <> v_bt_company THEN
    RETURN;
  END IF;
  IF auth.uid() IS NOT NULL
     AND (SELECT public.get_my_company_id()) IS NOT NULL
     AND (SELECT public.get_my_company_id()) <> v_pay_company THEN
    RAISE EXCEPTION 'Quella coppia non è di questa azienda' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.reconciliation_coppie_escluse AS e
         (company_id, bank_transaction_id, payable_id, motivo)
  VALUES (v_pay_company, p_bt_id, p_payable_id, p_motivo)
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
DECLARE
  v_riga RECORD;
BEGIN
  PERFORM public.ruoli_operativi_non_qui(); -- migration 380
  SELECT * INTO v_riga FROM public.reconciliation_coppie_escluse
   WHERE bank_transaction_id = p_bt_id AND payable_id = p_payable_id;
  IF v_riga IS NULL THEN
    RETURN;
  END IF;
  IF auth.uid() IS NOT NULL
     AND (SELECT public.get_my_company_id()) IS NOT NULL
     AND (SELECT public.get_my_company_id()) <> v_riga.company_id THEN
    RAISE EXCEPTION 'Quella coppia non è di questa azienda' USING ERRCODE = '42501';
  END IF;
  -- La riga si cancella, ma il motivo che c'era non si perde: finisce in coda
  -- alla nota dell'ultima riga di log di quella coppia, così fra sei mesi si
  -- legge che qualcuno l'aveva esclusa e perché.
  UPDATE public.reconciliation_log
     SET notes = COALESCE(notes, '') || ' | ' || to_char(now(), 'DD/MM/YYYY')
                 || ': coppia riammessa a mano. Era stata esclusa'
                 || CASE WHEN v_riga.motivo IS NULL THEN '' ELSE ': ' || v_riga.motivo END
   WHERE id = (
     SELECT l.id FROM public.reconciliation_log l
      WHERE l.bank_transaction_id = p_bt_id AND l.payable_id = p_payable_id
      ORDER BY l.performed_at DESC LIMIT 1
   );
  DELETE FROM public.reconciliation_coppie_escluse
   WHERE bank_transaction_id = p_bt_id AND payable_id = p_payable_id;
END;
$function$;

-- EXECUTE: PostgreSQL concede le funzioni nuove a PUBLIC, quindi anche ad
-- `anon` (la chiave pubblica del sito). Si revoca e si concede a chi serve.
REVOKE ALL ON FUNCTION public.coppia_esclusa(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.escludi_coppia(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.riammetti_coppia(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coppia_esclusa(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.escludi_coppia(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.riammetti_coppia(uuid, uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public.coppia_esclusa(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.escludi_coppia(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.riammetti_coppia(uuid, uuid) TO authenticated, service_role;

-- =====================================================================
-- 3. Le quattro funzioni del motore
-- =====================================================================
-- Il testo NON si riscrive a mano: si legge quello vivo con pg_get_functiondef,
-- si innestano le righe nuove con replace() e si esegue solo se il testo di
-- partenza è quello atteso (md5). È la lezione del 09/11: riscrivendo a mano il
-- corpo della 333 si era perso un commento e il file nel repo aveva finito per
-- non combaciare col vivo. Così la riga
--   PERFORM public.ruoli_operativi_non_qui(); -- migration 380
-- resta dov'è per costruzione, e la migration si ferma da sé se su un tenant la
-- funzione non è quella che ho letto. Gli md5 e il numero di occorrenze di ogni
-- ancoraggio sono stati verificati su NZ e su Zago il 23/11/2026: uguali, e
-- ogni ancoraggio compare una volta sola.
-- Ogni blocco esce da sé se l'innesto c'è già, così il file si può rieseguire.

-- 3a. undo_reconcile_movement: chi annulla esclude la coppia ---------------
DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.undo_reconcile_movement(uuid)'::regprocedure) INTO v_def;
  IF v_def ~ 'escludi_coppia' THEN
    RAISE NOTICE 'undo_reconcile_movement: innesto già fatto, non faccio niente';
    RETURN;
  END IF;
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

  -- Devono essere andati a segno TUTTI E DUE i rami: si contano le occorrenze,
  -- non la lunghezza (con un solo innesto il conto dei caratteri tornava
  -- comunque e il controllo non se ne accorgeva).
  IF (length(v_new) - length(replace(v_new, 'escludi_coppia', ''))) / length('escludi_coppia') <> 2 THEN
    RAISE EXCEPTION 'undo_reconcile_movement: attesi due innesti, non eseguo';
  END IF;
  EXECUTE v_new;
END
$patch$;

-- 3b. reconcile_movement: una coppia esclusa non si riconcilia, e non conta
--     chi chiama -----------------------------------------------------------
DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.reconcile_movement(uuid,uuid,uuid)'::regprocedure) INTO v_def;
  IF v_def ~ 'coppia_esclusa' THEN
    RAISE NOTICE 'reconcile_movement: innesto già fatto, non faccio niente';
    RETURN;
  END IF;
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

  -- 443: coppia esclusa da una persona. Qui si ferma chiunque chiami, cron e
  -- persone comprese: un giro di massa lanciato da una persona (ImportHub, che
  -- chiama rerun_reconciliation col token di chi lo lancia) non è una decisione
  -- su questa coppia. Per rifarla a mano si chiama prima riammetti_coppia, che
  -- è un gesto esplicito su questa coppia e sola.
  IF public.coppia_esclusa(p_bt_id, p_payable_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'coppia_esclusa');
  END IF;$n$);

  IF v_new !~ 'coppia_esclusa' THEN
    RAISE EXCEPTION 'reconcile_movement: il punto di innesto non c''è, non eseguo';
  END IF;
  EXECUTE v_new;
END
$patch$;

-- 3c. rerun_bijective_reconciliation: il ramo del 20/11 -------------------
DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.rerun_bijective_reconciliation()'::regprocedure) INTO v_def;
  IF v_def ~ 'coppia_esclusa' THEN
    RAISE NOTICE 'rerun_bijective_reconciliation: innesto già fatto, non faccio niente';
    RETURN;
  END IF;
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

-- 3d. try_match_amount_bank_transaction: il ramo del 05/09 ----------------
DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.try_match_amount_bank_transaction(uuid)'::regprocedure) INTO v_def;
  IF v_def ~ 'coppia_esclusa' THEN
    RAISE NOTICE 'try_match_amount_bank_transaction: innesto già fatto, non faccio niente';
    RETURN;
  END IF;
  IF md5(v_def) <> 'e5245e83d8ead60ff7eef3fa8189d093' THEN
    RAISE EXCEPTION 'try_match_amount_bank_transaction: il testo vivo non è quello atteso (md5 %), non innesto niente', md5(v_def);
  END IF;

  v_new := replace(v_def,
$o$      AND COALESCE(p.is_placeholder, false) = false
$o$,
$n$      AND COALESCE(p.is_placeholder, false) = false
      -- 443: le coppie escluse da una persona non tornano. Qui serve perché il
      -- 06/09/2026 questo ramo ha rifatto l'aggancio GRUPPO SERVIZI 315,00 che
      -- il giorno prima era stato annullato a mano.
      AND NOT public.coppia_esclusa(p_bt_id, p.id)
$n$);

  IF v_new !~ 'coppia_esclusa' THEN
    RAISE EXCEPTION 'try_match_amount_bank_transaction: il punto di innesto non c''è, non eseguo';
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
--   SELECT has_function_privilege('anon','public.coppia_esclusa(uuid,uuid)','execute') AS anon_coppia,
--          has_function_privilege('anon','public.escludi_coppia(uuid,uuid,text)','execute') AS anon_escludi,
--          has_function_privilege('anon','public.riammetti_coppia(uuid,uuid)','execute') AS anon_riammetti;
--   -- attesi: false, false, false
--
--   SELECT count(*) FROM pg_policies
--    WHERE schemaname='public' AND tablename='reconciliation_coppie_escluse';
--   -- atteso: 3
--
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public'
--      AND p.proname IN ('undo_reconcile_movement','reconcile_movement',
--                        'rerun_bijective_reconciliation','try_match_amount_bank_transaction')
--      AND pg_get_functiondef(p.oid) ~ 'coppia_esclusa|escludi_coppia'
--    ORDER BY 1;
--   -- attese tutte e quattro
--
--   -- la guardia 380 è ancora in tutte e 52 le funzioni di finanza:
--   SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f'
--     AND pg_get_functiondef(oid) ~ 'PERFORM public.ruoli_operativi_non_qui\(\); -- migration 380';
--   -- atteso: 52
-- =====================================================================
