-- ============================================================================
-- 306 — Agganciare un movimento a una fattura già pagata, anche se ne ha già uno
-- ============================================================================
-- Nato dal caso MINGARDO 48 del 19/10/2026. La fattura (14.396,00) è stata pagata
-- con due bonifici: 7.198,00 il 05/06 e, dopo altri acconti, 2.802,00 il 05/10.
-- Il secondo ha chiuso la rata; il primo è rimasto non riconciliato in banca
-- perché A-Cube lo classifica «financials», categoria che il motore esclude.
-- Agganciarlo dall'interfaccia era impossibile, per tre motivi distinti:
--
--   1. `reconcile_movement` ha il ramo giusto («solo aggancio, nessuna doppia
--      scrittura»), ma scattava solo `IF status = 'pagato' AND
--      bank_transaction_id IS NULL`. In `payables` il movimento è un campo solo:
--      una fattura pagata da due bonifici ne tiene uno e basta, quindi per la
--      seconda metà il ramo non partiva e la funzione rispondeva `stale`.
--
--   2. `undo_reconcile_movement` sottraeva `applied_amount` da `amount_paid`
--      anche per le righe di solo aggancio, che quell'importo non l'avevano mai
--      aggiunto: annullare un aggancio riapriva una fattura pagata. Al 19/10 su
--      NZ le righe in quello stato erano 151, di cui 141 ancora attive. Il difetto
--      esisteva già e si raggiungeva dal pulsante «annulla» della vista
--      Riconciliati: aprire il ramo del punto 1 l'avrebbe moltiplicato.
--
--   3. (lato frontend, stessa PR) `handleManualReconcile` cercava la fattura
--      scelta solo fra le NON pagate, mentre la lista ne offriva anche di pagate:
--      chi ne selezionava una leggeva «Fattura non trovata».
--
-- Qui si chiudono il punto 1 e il punto 2. Le funzioni NON vengono riscritte:
-- si patcha la definizione viva letta da pg_get_functiondef, come nelle migration
-- 218 e 219, perché un CREATE OR REPLACE del testo intero ha già cancellato rami
-- altrui tre volte. Ogni ancora è verificata unica, e si alza un'eccezione se non
-- lo è: meglio fermarsi che applicare una patch a metà.
--
-- Additiva: una colonna con DEFAULT, un backfill, due funzioni patchate.
-- Nessun DROP, nessuna riga cancellata.
-- Rollback: 20261019_306_aggancio_su_fattura_gia_pagata_ROLLBACK.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. La colonna che distingue un aggancio da un pagamento
-- ---------------------------------------------------------------------------
ALTER TABLE public.reconciliation_log
  ADD COLUMN IF NOT EXISTS linked_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.reconciliation_log.linked_only IS
  'true = riga di solo aggancio: il movimento e'' stato collegato a una fattura gia'' pagata senza toccare gli importi. L''annullo non deve sottrarre applied_amount, altrimenti riapre una fattura pagata.';

-- ---------------------------------------------------------------------------
-- 2. Backfill delle righe storiche di solo aggancio
-- ---------------------------------------------------------------------------
-- Si riconoscono dalla nota che le ha scritte: il ramo di reconcile_movement
-- («aggancio a fattura gia' pagata senza movimento», «nessuna doppia scrittura»)
-- e il ramo distinta del motore («gia' pagata, solo aggancio»). Prudente per
-- costruzione: marca solo cio' che dichiara di non aver toccato gli importi.
UPDATE public.reconciliation_log
   SET linked_only = true
 WHERE linked_only = false
   AND (notes ILIKE '%solo aggancio%'
        OR notes ILIKE '%nessuna doppia scrittura%'
        OR notes ILIKE '%chiusa a mano%');

-- ---------------------------------------------------------------------------
-- 3. reconcile_movement: il ramo «solo aggancio» vale per ogni fattura pagata
-- ---------------------------------------------------------------------------
DO $patch_reconcile$
DECLARE
  v_src text;
  v_new text;
  v_ancora text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'reconcile_movement'
     AND pg_get_function_identity_arguments(p.oid) = 'p_bt_id uuid, p_payable_id uuid, p_log_id uuid';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'reconcile_movement non trovata: niente da patchare';
  END IF;

  -- (a) la condizione del ramo: non serve piu' che la fattura sia senza movimento.
  --
  -- Qui si accettano DUE forme, perche' il 19/10/2026 i tenant erano disallineati:
  -- la migration 114 del 24/07 («abbinabile OGNI fattura senza aggancio») era stata
  -- applicata solo su NZ, pur dichiarando nella sua intestazione «REGOLA #0 —
  -- applicare su NZ + Made + Zago». Su Made e Zago il ramo chiedeva ancora anche
  -- closed_manually, cioe' la forma pre-114. Riapplicare la 114 tale e quale non si
  -- poteva: e' un CREATE OR REPLACE del testo intero e avrebbe cancellato la 203,
  -- che su Made e Zago invece c'e'. Quindi si patcha la forma viva, qualunque sia,
  -- e i tre tenant finiscono identici.
  v_ancora := 'IF v_pay.status = ''pagato'' AND COALESCE(v_pay.closed_manually, false) AND v_pay.bank_transaction_id IS NULL THEN';
  IF v_src LIKE '%' || v_ancora || '%' THEN
    -- forma pre-114 (Made, Zago al 19/10/2026)
    IF (length(v_src) - length(replace(v_src, v_ancora, ''))) / length(v_ancora) <> 1 THEN
      RAISE EXCEPTION 'ancora (a, forma pre-114) non unica in reconcile_movement: patch non applicata';
    END IF;
    v_new := replace(v_src, v_ancora, 'IF v_pay.status = ''pagato'' THEN');
  ELSE
    v_ancora := 'IF v_pay.status = ''pagato'' AND v_pay.bank_transaction_id IS NULL THEN';
    IF v_src LIKE '%' || v_ancora || '%' THEN
      -- forma post-114 (NZ al 19/10/2026)
      IF (length(v_src) - length(replace(v_src, v_ancora, ''))) / length(v_ancora) <> 1 THEN
        RAISE EXCEPTION 'ancora (a, forma post-114) non unica in reconcile_movement: patch non applicata';
      END IF;
      v_new := replace(v_src, v_ancora, 'IF v_pay.status = ''pagato'' THEN');
    ELSIF v_src LIKE '%IF v_pay.status = ''pagato'' THEN%' THEN
      v_new := v_src;   -- gia' patchata: idempotente
    ELSE
      RAISE EXCEPTION 'il ramo «solo aggancio» di reconcile_movement non e'' piu'' riconoscibile: fermarsi e rileggere la funzione viva';
    END IF;
  END IF;

  -- (a-bis) il testo delle note e il commento del ramo, perche' i tre tenant
  --         restino identici anche a leggerli. Su Made e Zago le note dicevano
  --         «chiusa a mano», che dopo la 114 non e' piu' il caso coperto.
  v_new := replace(v_new,
    ''' | agganciato a fattura chiusa a mano''',
    ''' | agganciato a fattura già pagata senza movimento''');
  v_new := replace(v_new,
    '''aggancio a fattura chiusa a mano (nessuna doppia scrittura)''',
    '''aggancio a fattura già pagata senza movimento (nessuna doppia scrittura)''');
  v_new := replace(v_new,
    '  -- Ramo "solo aggancio": QUALSIASI fattura già pagata ma senza movimento agganciato
  -- (chiusa a mano o pagata all''import). Nessuna doppia scrittura: resta pagata.
', '');
  IF v_new NOT LIKE '%Ramo "solo aggancio" (306)%' THEN
    v_new := replace(v_new, '  IF v_pay.status = ''pagato'' THEN',
'  -- Ramo "solo aggancio" (306): QUALSIASI fattura già pagata, anche quando ha già
  -- un movimento agganciato. In payables il movimento è un campo solo, quindi una
  -- fattura pagata da due bonifici ne tiene uno e il secondo vive come riga di log.
  -- Nessuna doppia scrittura: gli importi non si toccano e la riga si marca
  -- linked_only, così annullarla non sottrae un pagamento mai aggiunto.
  IF v_pay.status = ''pagato'' THEN');
  END IF;

  -- (b) il movimento principale della fattura non si sovrascrive mai: chi ha
  --     chiuso la rata resta quello. Un aggancio aggiuntivo lo lascia dov'e'.
  v_ancora := 'UPDATE public.payables SET bank_transaction_id = p_bt_id, updated_at = now() WHERE id = p_payable_id;';
  IF v_new LIKE '%' || v_ancora || '%' THEN
    IF (length(v_new) - length(replace(v_new, v_ancora, ''))) / length(v_ancora) <> 1 THEN
      RAISE EXCEPTION 'ancora (b) non unica in reconcile_movement: patch non applicata';
    END IF;
    v_new := replace(v_new, v_ancora,
      'UPDATE public.payables SET bank_transaction_id = COALESCE(bank_transaction_id, p_bt_id), updated_at = now() WHERE id = p_payable_id;');
  ELSIF v_new NOT LIKE '%COALESCE(bank_transaction_id, p_bt_id)%' THEN
    RAISE EXCEPTION 'ancora (b) assente in reconcile_movement: fermarsi e rileggere la funzione viva';
  END IF;

  -- (c) le due scritture del log nel ramo marcano la riga come solo aggancio.
  --     L'ancora porta abs(v_bt.amount) perche' il ramo normale ha un INSERT con
  --     le stesse colonne ma l'importo applicato (v_applied).
  v_ancora := 'SET status = ''applied'', applied_amount = abs(v_bt.amount), confirmed_at = now(), performed_at = now(),';
  IF v_new LIKE '%' || v_ancora || '%' THEN
    IF (length(v_new) - length(replace(v_new, v_ancora, ''))) / length(v_ancora) <> 1 THEN
      RAISE EXCEPTION 'ancora (c1) non unica in reconcile_movement: patch non applicata';
    END IF;
    v_new := replace(v_new, v_ancora,
      'SET status = ''applied'', applied_amount = abs(v_bt.amount), linked_only = true, confirmed_at = now(), performed_at = now(),');
  ELSIF v_new NOT LIKE '%applied_amount = abs(v_bt.amount), linked_only = true%' THEN
    RAISE EXCEPTION 'ancora (c1) assente in reconcile_movement: fermarsi e rileggere la funzione viva';
  END IF;

  v_ancora := 'INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, notes)
      VALUES (v_pay.company_id, p_bt_id, p_payable_id, ''manual'', 100, ''applied'', abs(v_bt.amount),';
  IF v_new LIKE '%' || v_ancora || '%' THEN
    IF (length(v_new) - length(replace(v_new, v_ancora, ''))) / length(v_ancora) <> 1 THEN
      RAISE EXCEPTION 'ancora (c2) non unica in reconcile_movement: patch non applicata';
    END IF;
    v_new := replace(v_new, v_ancora,
      'INSERT INTO public.reconciliation_log (company_id, bank_transaction_id, payable_id, match_type, confidence, status, applied_amount, linked_only, notes)
      VALUES (v_pay.company_id, p_bt_id, p_payable_id, ''manual'', 100, ''applied'', abs(v_bt.amount), true,');
  ELSIF v_new NOT LIKE '%abs(v_bt.amount), true,%' THEN
    RAISE EXCEPTION 'ancora (c2) assente in reconcile_movement: fermarsi e rileggere la funzione viva';
  END IF;

  -- I rami che devono restare dopo la patch: se uno manca, non si applica niente.
  IF v_new NOT LIKE '%apply_credit_note_links%' THEN
    RAISE EXCEPTION 'la patch avrebbe perso la compensazione delle note di credito: annullata';
  END IF;
  IF v_new NOT LIKE '%Movimento e fattura appartengono ad aziende diverse%' THEN
    RAISE EXCEPTION 'la patch avrebbe perso il controllo sul company_id: annullata';
  END IF;
  IF v_new NOT LIKE '%v_applied := LEAST(abs(v_bt.amount), v_remaining);%' THEN
    RAISE EXCEPTION 'la patch avrebbe perso il ramo dei pagamenti parziali: annullata';
  END IF;

  EXECUTE v_new;
  RAISE NOTICE 'reconcile_movement patchata: il ramo «solo aggancio» vale per ogni fattura pagata';
END
$patch_reconcile$;

-- ---------------------------------------------------------------------------
-- 4. undo_reconcile_movement: annullare un aggancio non riapre una fattura
-- ---------------------------------------------------------------------------
DO $patch_undo$
DECLARE
  v_src text;
  v_new text;
  v_ancora text;
  v_ramo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'undo_reconcile_movement';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'undo_reconcile_movement non trovata: niente da patchare';
  END IF;

  IF v_src LIKE '%v_log.linked_only%' THEN
    RAISE NOTICE 'undo_reconcile_movement gia'' patchata: niente da fare';
    RETURN;
  END IF;

  v_ancora := '  SELECT * INTO v_pay FROM public.payables WHERE id = v_log.payable_id;
  IF v_pay IS NULL THEN
    RETURN jsonb_build_object(''ok'', false, ''reason'', ''payable_not_found'');
  END IF;';
  IF (length(v_src) - length(replace(v_src, v_ancora, ''))) / length(v_ancora) <> 1 THEN
    RAISE EXCEPTION 'ancora non unica (o assente) in undo_reconcile_movement: patch non applicata';
  END IF;

  -- Riga di solo aggancio: si scollega il movimento e basta. Gli importi non si
  -- toccano, perche' quell'aggancio non li aveva toccati: sottrarre applied_amount
  -- qui riaprirebbe una fattura regolarmente pagata. Il campo della fattura si
  -- azzera solo se puntava proprio a questo movimento: se la rata e' stata chiusa
  -- da un altro bonifico, quello resta al suo posto.
  v_ramo := v_ancora || '

  IF COALESCE(v_log.linked_only, false) THEN
    UPDATE public.payables
       SET bank_transaction_id = NULL, updated_at = now()
     WHERE id = v_pay.id
       AND bank_transaction_id = v_log.bank_transaction_id;

    IF v_log.bank_transaction_id IS NOT NULL THEN
      UPDATE public.bank_transactions
         SET is_reconciled = false, reconciled_at = NULL, reconciled_invoice_id = NULL
       WHERE id = v_log.bank_transaction_id;
    END IF;

    UPDATE public.reconciliation_log
       SET status = ''rejected'',
           notes = COALESCE(notes, '''') || '' | annullato manualmente il '' || to_char(now(), ''DD/MM/YYYY'')
                   || '' (solo aggancio: importi non toccati)''
     WHERE id = p_log_id;

    SELECT status INTO v_new_status FROM public.payables WHERE id = v_pay.id;
    RETURN jsonb_build_object(
      ''ok'', true, ''linked_only'', true, ''payable_id'', v_pay.id,
      ''restored_remaining'', 0, ''nc_restored'', 0, ''status'', v_new_status
    );
  END IF;';

  v_new := replace(v_src, v_ancora, v_ramo);

  -- I rami che devono restare: se uno manca, non si applica niente.
  IF v_new NOT LIKE '%payable_credit_note_links%' THEN
    RAISE EXCEPTION 'la patch avrebbe perso la riapertura delle note di credito: annullata';
  END IF;
  IF v_new NOT LIKE '%v_new_paid := GREATEST(0, COALESCE(v_pay.amount_paid, 0) - v_log.applied_amount - v_nc_restored);%' THEN
    RAISE EXCEPTION 'la patch avrebbe perso il calcolo del riaperto: annullata';
  END IF;

  EXECUTE v_new;
  RAISE NOTICE 'undo_reconcile_movement patchata: annullare un solo aggancio non riapre piu'' la fattura';
END
$patch_undo$;

COMMIT;

-- ============================================================================
-- Verifiche (da eseguire su ognuno dei 3 tenant dopo l'applicazione)
-- ============================================================================
-- 1) la colonna c'e' e il backfill ha marcato le righe di solo aggancio
--    SELECT count(*) FILTER (WHERE linked_only) AS solo_aggancio,
--           count(*) FILTER (WHERE NOT linked_only) AS pagamenti
--      FROM public.reconciliation_log;
--
-- 2) le due funzioni portano la patch, e i rami vecchi sono ancora al loro posto
--    SELECT (d LIKE '%IF v_pay.status = ''pagato'' THEN%')                    AS ramo_aperto,
--           (d LIKE '%COALESCE(bank_transaction_id, p_bt_id)%')               AS non_sovrascrive,
--           (d LIKE '%linked_only = true%')                                   AS marca_aggancio,
--           (d LIKE '%apply_credit_note_links%')                              AS nc_intatte,
--           (d LIKE '%v_applied := LEAST(abs(v_bt.amount), v_remaining);%')   AS parziali_intatti
--      FROM (SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p
--              JOIN pg_namespace n ON n.oid = p.pronamespace
--             WHERE n.nspname='public' AND p.proname='reconcile_movement') s;
--
--    SELECT (d LIKE '%COALESCE(v_log.linked_only, false)%')      AS rispetta_aggancio,
--           (d LIKE '%payable_credit_note_links%')               AS nc_intatte,
--           (d LIKE '%GREATEST(0, COALESCE(v_pay.amount_paid%')  AS riapertura_intatta
--      FROM (SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p
--              JOIN pg_namespace n ON n.oid = p.pronamespace
--             WHERE n.nspname='public' AND p.proname='undo_reconcile_movement') s;
--
-- 3) nessuna fattura pagata e' stata toccata dal backfill (deve dare 0)
--    SELECT count(*) FROM public.payables
--     WHERE status = 'pagato' AND amount_remaining > 0;
-- ============================================================================
