-- 20261104_346_allinea_fatture_recinti.sql
--
-- Recinti sull'allineamento della migrazione 345, dopo la revisione del
-- database. Sette cose, in ordine di gravita'.
--
-- 1. LE FUNZIONI ERANO APERTE A CHIUNQUE. Su Supabase PUBLIC ha EXECUTE di
--    default sulle funzioni in public, quindi /rest/v1/rpc raggiungeva
--    allinea_fatture_pagate_in_contanti anche SENZA login: un anonimo poteva
--    far girare lo scorrimento di tutto lo storico quando voleva, e quella
--    funzione scrive su payables. Misurato sul tenant vivo:
--    has_function_privilege('anon', ...) era true su tutte e due. Ora le
--    chiama solo service_role (il cron gira come postgres).
--
-- 2. IL TRIGGER NON SCATTAVA MAI PER IL NEGOZIO. La policy odce_write lascia
--    scrivere le righe di spesa solo mentre la chiusura e' in bozza, e la
--    funzione scarta le bozze: quando la cassiera salvava, l'allineamento
--    diceva «niente da fare», e il lavoro lo faceva il cron la notte dopo.
--    Adesso c'e' un trigger sulla chiusura: quando esce dalla bozza, le sue
--    righe «fattura pagata in contanti» si allineano subito.
--
-- 3. CHIUDERE UNA FATTURA APERTA E' LA COSA PIU' DELICATA, perche' la riga la
--    scrive la cassiera, che su payables non ha nessun permesso, e dopo la
--    chiusura il fornitore risulta pagato. Adesso serve tutto questo insieme:
--    chiusura di cassa «verificata» (il passaggio di una persona), stato della
--    fattura fra da_pagare, in_scadenza e scaduto, nessuna distinta di
--    pagamento che la contenga, nessuna rata, e il negozio della fattura, se
--    c'e' scritto, uguale a quello della cassa. Il controllo che resta e' la
--    cassa stessa: una riga finta lascia un ammanco che l'istruttoria segnala.
--
-- 4. SEGNALE TROPPO DEBOLE. Il nome bastava con due caratteri, e fornitori che
--    iniziano con «IL», «LA», «DI» combaciavano con quasi qualunque testo. Per
--    correggere il metodo di una fattura gia' pagata ora serve il numero di
--    documento, oppure un nome di almeno quattro caratteri. Conta perche' le
--    356 fatture «pagate per bonifico senza movimento» di NZ sono quasi tutte
--    bonifici veri non ancora agganciati: riscriverne una sarebbe un danno.
--
-- 5. CONTEGGIO E SCELTA ERANO DUE QUERY. Fra l'una e l'altra il riscontro
--    notturno puo' agganciare un movimento e cambiare l'insieme: la seconda
--    tornava vuota, v_pay restava NULL e l'INSERT in payable_actions moriva su
--    payable_id NOT NULL. Ora la ricerca e' una sola query e c'e' il controllo
--    su v_pay.id. Nel ciclo del cron ogni riga ha il suo EXCEPTION, cosi' un
--    intoppo su una non annulla tutta la notte.
--
-- 6. DUE RIGHE DI CASSA SULLA STESSA FATTURA facevano ballare la data ogni
--    notte: la prima la portava al giorno A, la seconda al giorno B. Se la
--    fattura e' gia' allineata da una chiusura di un altro giorno, non si
--    tocca piu'.
--
-- 7. TRACCIA PER TORNARE INDIETRO. La nota scrive anche la data di pagamento e
--    il conto di prima, non solo il metodo, e il conto si azzera solo quando
--    si viene via da un metodo bancario. Senza questo il ROLLBACK non bastava
--    a rimettere le cose come stavano.

BEGIN;

CREATE OR REPLACE FUNCTION public.allinea_fattura_da_cassa(p_expense_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  e        record;
  v_pay    record;
  v_quanti integer;
  v_marker text;
  v_nota   text;
  v_coda   text;
  v_azione text;
BEGIN
  SELECT x.id, x.company_id, x.outlet_id, x.amount, coalesce(x.description, '') AS descr,
         d.closing_date, coalesce(d.status, '') AS stato_chiusura, coalesce(o.name, '') AS negozio,
         upper(regexp_replace(coalesce(x.description, ''), '[^A-Za-z0-9]', '', 'g')) AS desc_norm,
         regexp_replace(coalesce(x.description, ''), '\D', '', 'g') AS desc_cifre
    INTO e
    FROM public.outlet_daily_closing_expenses x
    JOIN public.outlet_daily_closings d ON d.id = x.closing_id
    LEFT JOIN public.outlets o ON o.id = x.outlet_id
   WHERE x.id = p_expense_id
     AND x.kind = 'pagamento_fattura'
     AND coalesce(d.status, '') <> 'bozza';
  IF NOT FOUND THEN RETURN jsonb_build_object('esito', 'niente_da_fare'); END IF;

  -- Una sola query: candidati con la loro forza. Stesso importo, fattura
  -- vicina, nessun movimento in banca, niente distinte, niente rate.
  WITH cand AS (
    SELECT pb.id,
           (length(upper(regexp_replace(split_part(coalesce(pb.supplier_name, ''), ' ', 1), '[^A-Za-z0-9]', '', 'g'))) >= 2
             AND e.desc_norm LIKE '%' || upper(regexp_replace(split_part(coalesce(pb.supplier_name, ''), ' ', 1), '[^A-Za-z0-9]', '', 'g')) || '%') AS nome_ok,
           (length(upper(regexp_replace(split_part(coalesce(pb.supplier_name, ''), ' ', 1), '[^A-Za-z0-9]', '', 'g'))) >= 4
             AND e.desc_norm LIKE '%' || upper(regexp_replace(split_part(coalesce(pb.supplier_name, ''), ' ', 1), '[^A-Za-z0-9]', '', 'g')) || '%') AS nome_forte,
           (length(regexp_replace(coalesce(pb.invoice_number, ''), '\D', '', 'g')) >= 3
             AND length(e.desc_cifre) >= 3
             AND (position(regexp_replace(coalesce(pb.invoice_number, ''), '\D', '', 'g') IN e.desc_cifre) > 0
               OR position(e.desc_cifre IN regexp_replace(coalesce(pb.invoice_number, ''), '\D', '', 'g')) > 0)) AS numero_ok
      FROM public.payables pb
     WHERE pb.company_id = e.company_id
       AND pb.gross_amount = e.amount
       AND abs(pb.invoice_date - e.closing_date) <= 10
       AND pb.bank_transaction_id IS NULL
       AND coalesce(pb.is_placeholder, false) = false
       AND coalesce(pb.is_forecast, false) = false
       AND (pb.outlet_id IS NULL OR pb.outlet_id = e.outlet_id)
       AND NOT EXISTS (SELECT 1 FROM public.payment_batch_items bi WHERE bi.payable_id = pb.id)
       AND pb.parent_payable_id IS NULL
       AND coalesce(pb.installment_total, 1) <= 1
  ),
  buoni AS (SELECT * FROM cand WHERE nome_ok OR numero_ok)
  SELECT count(*) OVER () AS quanti, pb2.*, b.nome_forte, b.numero_ok
    INTO v_pay
    FROM buoni b JOIN public.payables pb2 ON pb2.id = b.id
   LIMIT 1;

  IF v_pay.id IS NULL THEN RETURN jsonb_build_object('esito', 'nessuna_fattura'); END IF;
  v_quanti := v_pay.quanti;
  IF v_quanti > 1 THEN RETURN jsonb_build_object('esito', 'piu_di_una', 'quante', v_quanti); END IF;

  IF v_pay.payment_method::text = 'contanti' AND v_pay.payment_date = e.closing_date THEN
    RETURN jsonb_build_object('esito', 'gia_a_posto', 'payable_id', v_pay.id);
  END IF;

  v_marker := 'allineata dalla chiusura di cassa del ' || to_char(e.closing_date, 'DD/MM/YYYY');

  -- gia' allineata da una chiusura di un altro giorno: non si balla
  IF coalesce(v_pay.notes, '') LIKE '%allineata dalla chiusura di cassa del %'
     AND position(v_marker IN coalesce(v_pay.notes, '')) = 0 THEN
    RETURN jsonb_build_object('esito', 'gia_allineata_da_altra_riga', 'payable_id', v_pay.id);
  END IF;

  v_nota := 'Pagata in contanti dal negozio di ' || initcap(e.negozio) || ', ' || v_marker || '.';
  v_coda := CASE WHEN v_pay.payment_method::text <> 'contanti'
                 THEN ' Prima: metodo «' || v_pay.payment_method::text || '», data '
                      || coalesce(to_char(v_pay.payment_date, 'DD/MM/YYYY'), 'vuota')
                      || coalesce(', conto ' || v_pay.payment_bank_account_id::text, '')
                      || ', nessun movimento in banca.'
                 ELSE ' Data di pagamento portata al giorno della chiusura (prima: '
                      || coalesce(to_char(v_pay.payment_date, 'DD/MM/YYYY'), 'vuota') || ').' END;

  IF v_pay.status::text <> 'pagato' THEN
    -- Chiudere una fattura aperta muove un debito verso un fornitore: qui i
    -- recinti sono tutti, e se uno manca si lascia stare e si dice perche'.
    IF NOT (v_pay.nome_forte AND v_pay.numero_ok) THEN
      RETURN jsonb_build_object('esito', 'aperta_ma_segnale_debole', 'payable_id', v_pay.id);
    END IF;
    IF e.stato_chiusura <> 'verificata' THEN
      RETURN jsonb_build_object('esito', 'aperta_ma_chiusura_non_verificata', 'payable_id', v_pay.id);
    END IF;
    IF v_pay.status::text NOT IN ('da_pagare', 'in_scadenza', 'scaduto') THEN
      RETURN jsonb_build_object('esito', 'aperta_ma_stato_da_guardare',
                                'payable_id', v_pay.id, 'stato', v_pay.status::text);
    END IF;
    UPDATE public.payables
       SET status = 'pagato', amount_paid = gross_amount, amount_remaining = 0,
           payment_method = 'contanti', payment_method_code = 'MP01',
           payment_method_label = 'Contanti',
           payment_date = e.closing_date,
           payment_bank_account_id = NULL,
           closed_manually = true,
           manual_close_reason = coalesce(nullif(manual_close_reason, ''), v_nota),
           notes = CASE WHEN position(v_marker IN coalesce(notes, '')) > 0 THEN notes
                        ELSE coalesce(nullif(notes, '') || ' | ', '') || v_nota || v_coda END,
           updated_at = now()
     WHERE id = v_pay.id;
    v_azione := 'chiusa_in_contanti';
  ELSE
    -- Gia' pagata: non si muove un euro, si corregge come risulta pagata.
    -- Con il solo nome corto si rischia di riscrivere un bonifico vero che il
    -- riscontro non ha ancora agganciato, quindi serve il numero o un nome lungo.
    IF NOT (v_pay.numero_ok OR v_pay.nome_forte) THEN
      RETURN jsonb_build_object('esito', 'segnale_troppo_debole', 'payable_id', v_pay.id);
    END IF;
    UPDATE public.payables
       SET payment_method = 'contanti', payment_method_code = 'MP01',
           payment_method_label = 'Contanti',
           payment_date = e.closing_date,
           payment_bank_account_id = CASE WHEN v_pay.payment_method::text <> 'contanti'
                                          THEN NULL ELSE payment_bank_account_id END,
           notes = CASE WHEN position(v_marker IN coalesce(notes, '')) > 0 THEN notes
                        ELSE coalesce(nullif(notes, '') || ' | ', '') || v_nota || v_coda END,
           updated_at = now()
     WHERE id = v_pay.id;
    v_azione := CASE WHEN v_pay.payment_method::text <> 'contanti' THEN 'metodo_corretto' ELSE 'data_corretta' END;
  END IF;

  INSERT INTO public.payable_actions (payable_id, action_type, old_status, new_status, amount,
                                      payment_method, note, performed_at, operator_name)
  VALUES (v_pay.id, v_azione, v_pay.status, 'pagato', e.amount, 'contanti',
          v_nota || v_coda || ' Riga di cassa: ' || left(e.descr, 120), now(), 'istruttoria del gestionale');

  RETURN jsonb_build_object('esito', v_azione, 'payable_id', v_pay.id,
                            'data', e.closing_date, 'importo', e.amount);
END;
$function$;

-- Il ciclo del cron: ogni riga nel suo blocco, un intoppo non ferma la notte.
CREATE OR REPLACE FUNCTION public.allinea_fatture_pagate_in_contanti(p_giorni integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r          record;
  v_esito    jsonb;
  v_chiuse   integer := 0;
  v_corrette integer := 0;
  v_date     integer := 0;
  v_dubbie   integer := 0;
  v_errori   integer := 0;
BEGIN
  FOR r IN
    SELECT x.id
      FROM public.outlet_daily_closing_expenses x
      JOIN public.outlet_daily_closings d ON d.id = x.closing_id
     WHERE x.kind = 'pagamento_fattura'
       AND coalesce(d.status, '') <> 'bozza'
       AND d.closing_date >= current_date - greatest(coalesce(p_giorni, 60), 1)
     ORDER BY d.closing_date
  LOOP
    BEGIN
      v_esito := public.allinea_fattura_da_cassa(r.id);
      IF v_esito->>'esito' = 'chiusa_in_contanti' THEN v_chiuse := v_chiuse + 1;
      ELSIF v_esito->>'esito' = 'metodo_corretto' THEN v_corrette := v_corrette + 1;
      ELSIF v_esito->>'esito' = 'data_corretta' THEN v_date := v_date + 1;
      ELSIF v_esito->>'esito' IN ('piu_di_una', 'aperta_ma_segnale_debole', 'segnale_troppo_debole',
                                  'aperta_ma_chiusura_non_verificata', 'aperta_ma_stato_da_guardare')
        THEN v_dubbie := v_dubbie + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errori := v_errori + 1;
      RAISE WARNING 'allinea_fattura_da_cassa(%): %', r.id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object('chiuse_in_contanti', v_chiuse, 'metodi_corretti', v_corrette,
                            'date_corrette', v_date, 'da_guardare', v_dubbie,
                            'errori', v_errori, 'giorni', p_giorni, 'at', now());
END;
$function$;

-- Quando la chiusura esce dalla bozza, le sue fatture in contanti si allineano.
CREATE OR REPLACE FUNCTION public.trg_allinea_chiusura_confermata()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.outlet_daily_closing_expenses
            WHERE closing_id = NEW.id AND kind = 'pagamento_fattura'
  LOOP
    BEGIN
      PERFORM public.allinea_fattura_da_cassa(r.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'allinea_fattura_da_cassa(%): %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS allinea_chiusura_confermata ON public.outlet_daily_closings;
CREATE TRIGGER allinea_chiusura_confermata
  AFTER UPDATE OF status ON public.outlet_daily_closings
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status AND coalesce(NEW.status, '') <> 'bozza')
  EXECUTE FUNCTION public.trg_allinea_chiusura_confermata();

-- Le chiama solo il gestionale, non il browser: il cron gira come postgres.
REVOKE ALL ON FUNCTION public.allinea_fattura_da_cassa(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.allinea_fatture_pagate_in_contanti(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_allinea_fattura_da_cassa() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_allinea_chiusura_confermata() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allinea_fattura_da_cassa(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.allinea_fatture_pagate_in_contanti(integer) TO service_role;

COMMIT;

-- Verifica, su ogni tenant:
-- SELECT has_function_privilege('anon','public.allinea_fatture_pagate_in_contanti(integer)','execute') AS anon,
--        has_function_privilege('authenticated','public.allinea_fattura_da_cassa(uuid)','execute') AS auth,
--        has_function_privilege('service_role','public.allinea_fattura_da_cassa(uuid)','execute') AS srv;
-- (anon e auth devono essere false, srv true)
-- SELECT public.allinea_fatture_pagate_in_contanti(400);
