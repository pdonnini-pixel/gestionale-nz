-- 20261104_345_fattura_in_contanti_allinea_scadenzario.sql
--
-- Quando un negozio paga una fattura con i soldi del cassetto, nello
-- scadenzario quella fattura deve risultare pagata in contanti, quel giorno.
-- Fino a oggi non succedeva: il caricamento iniziale del 17/06/2026 ha chiuso
-- in blocco tutto il pregresso con «bonifico ordinario» come valore di comodo,
-- e su 48 fatture (1.735,29 EUR su NZ) il bonifico non e' mai partito perche'
-- i soldi erano usciti dalla cassa di un negozio.
--
-- Qui c'e' il pezzo che lo fa da se', nei due versi:
--   - una fattura ancora aperta, con la riga «fattura pagata in contanti» in
--     una chiusura confermata, si chiude in contanti con la data vera;
--   - una fattura gia' segnata pagata con un metodo che non ha nessun
--     riscontro in banca si corregge: metodo contanti e data della chiusura.
--
-- Mai toccata una fattura con un movimento bancario agganciato: quello e' un
-- pagamento vero e vince su qualunque abbinamento.
--
-- Come si riconosce la fattura (due segnali, non uno):
--   nome   il primo pezzo del nome del fornitore compare nella descrizione
--          della spesa («A TEDI SF_2123000019» -> TEDi Commercio);
--   numero le cifre del numero di documento (almeno tre) compaiono nella
--          descrizione, o viceversa («fatt 550 dx srl» -> 120260000000550).
-- Con tutti e due i segnali si puo' anche CHIUDERE una fattura aperta; con uno
-- solo si corregge soltanto il metodo di una fattura gia' pagata, che non
-- muove soldi. Se i candidati sono piu' di uno, non si tocca niente: due
-- fornitori con lo stesso importo nello stesso giorno capitano davvero
-- (LAVANDERIA LA PIUMA 36,50 e un ristorante, aprile 2026).
--
-- Ogni correzione lascia due tracce: una nota sulla fattura e una riga in
-- payable_actions, cosi' si vede chi l'ha fatta e si puo' rimettere a mano.

BEGIN;

-- Allinea la fattura pagata con i contanti di UNA riga di chiusura.
CREATE OR REPLACE FUNCTION public.allinea_fattura_da_cassa(p_expense_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  e           record;
  p           record;
  v_quanti    integer;
  v_marker    text;
  v_nota      text;
  v_forte     boolean;
  v_azione    text;
BEGIN
  SELECT x.id, x.company_id, x.amount, coalesce(x.description, '') AS descr,
         c.closing_date, coalesce(o.name, '') AS negozio,
         upper(regexp_replace(coalesce(x.description, ''), '[^A-Za-z0-9]', '', 'g')) AS desc_norm,
         regexp_replace(coalesce(x.description, ''), '\D', '', 'g') AS desc_cifre
    INTO e
    FROM public.outlet_daily_closing_expenses x
    JOIN public.outlet_daily_closings c ON c.id = x.closing_id
    LEFT JOIN public.outlets o ON o.id = x.outlet_id
   WHERE x.id = p_expense_id
     AND x.kind = 'pagamento_fattura'
     AND coalesce(c.status, '') <> 'bozza';
  IF NOT FOUND THEN RETURN jsonb_build_object('esito', 'niente_da_fare'); END IF;

  -- candidati: stesso importo, fattura vicina, nessun movimento in banca
  WITH c AS (
    SELECT p.id,
           (length(upper(regexp_replace(split_part(coalesce(p.supplier_name, ''), ' ', 1), '[^A-Za-z0-9]', '', 'g'))) >= 2
             AND e.desc_norm LIKE '%' || upper(regexp_replace(split_part(coalesce(p.supplier_name, ''), ' ', 1), '[^A-Za-z0-9]', '', 'g')) || '%') AS nome_ok,
           (length(regexp_replace(coalesce(p.invoice_number, ''), '\D', '', 'g')) >= 3
             AND length(e.desc_cifre) >= 3
             AND (position(regexp_replace(coalesce(p.invoice_number, ''), '\D', '', 'g') IN e.desc_cifre) > 0
               OR position(e.desc_cifre IN regexp_replace(coalesce(p.invoice_number, ''), '\D', '', 'g')) > 0)) AS numero_ok,
           abs(p.invoice_date - e.closing_date) AS vicinanza
      FROM public.payables p
     WHERE p.company_id = e.company_id
       AND p.gross_amount = e.amount
       AND abs(p.invoice_date - e.closing_date) <= 10
       AND p.bank_transaction_id IS NULL
       AND coalesce(p.is_placeholder, false) = false
       AND coalesce(p.is_forecast, false) = false
  ),
  buoni AS (SELECT * FROM c WHERE nome_ok OR numero_ok)
  SELECT count(*) INTO v_quanti FROM buoni;

  IF v_quanti = 0 THEN RETURN jsonb_build_object('esito', 'nessuna_fattura'); END IF;
  IF v_quanti > 1 THEN RETURN jsonb_build_object('esito', 'piu_di_una', 'quante', v_quanti); END IF;

  SELECT p2.*,
         (b.nome_ok AND b.numero_ok) AS forte
    INTO p
    FROM (
      SELECT p.id,
             (length(upper(regexp_replace(split_part(coalesce(p.supplier_name, ''), ' ', 1), '[^A-Za-z0-9]', '', 'g'))) >= 2
               AND e.desc_norm LIKE '%' || upper(regexp_replace(split_part(coalesce(p.supplier_name, ''), ' ', 1), '[^A-Za-z0-9]', '', 'g')) || '%') AS nome_ok,
             (length(regexp_replace(coalesce(p.invoice_number, ''), '\D', '', 'g')) >= 3
               AND length(e.desc_cifre) >= 3
               AND (position(regexp_replace(coalesce(p.invoice_number, ''), '\D', '', 'g') IN e.desc_cifre) > 0
                 OR position(e.desc_cifre IN regexp_replace(coalesce(p.invoice_number, ''), '\D', '', 'g')) > 0)) AS numero_ok
        FROM public.payables p
       WHERE p.company_id = e.company_id
         AND p.gross_amount = e.amount
         AND abs(p.invoice_date - e.closing_date) <= 10
         AND p.bank_transaction_id IS NULL
         AND coalesce(p.is_placeholder, false) = false
         AND coalesce(p.is_forecast, false) = false
    ) b
    JOIN public.payables p2 ON p2.id = b.id
   WHERE b.nome_ok OR b.numero_ok;

  v_forte := p.forte;

  -- gia' a posto
  IF p.payment_method::text = 'contanti' AND p.payment_date = e.closing_date THEN
    RETURN jsonb_build_object('esito', 'gia_a_posto', 'payable_id', p.id);
  END IF;

  v_marker := 'allineata dalla chiusura di cassa del ' || to_char(e.closing_date, 'DD/MM/YYYY');
  v_nota := 'Pagata in contanti dal negozio di ' || initcap(e.negozio) || ', ' || v_marker || '.';

  IF p.status::text <> 'pagato' THEN
    -- chiudere una fattura aperta muove un debito: servono tutti e due i segnali
    IF NOT v_forte THEN
      RETURN jsonb_build_object('esito', 'aperta_ma_segnale_debole', 'payable_id', p.id);
    END IF;
    UPDATE public.payables
       SET status = 'pagato',
           amount_paid = gross_amount,
           amount_remaining = 0,
           payment_method = 'contanti',
           payment_date = e.closing_date,
           payment_bank_account_id = NULL,
           closed_manually = true,
           manual_close_reason = coalesce(nullif(manual_close_reason, ''), v_nota),
           notes = CASE WHEN position(v_marker IN coalesce(notes, '')) > 0 THEN notes
                        ELSE coalesce(nullif(notes, '') || ' | ', '') || v_nota END,
           updated_at = now()
     WHERE id = p.id;
    v_azione := 'chiusa_in_contanti';
  ELSE
    -- gia' pagata, ma con un metodo senza riscontro in banca: si corregge
    UPDATE public.payables
       SET payment_method = 'contanti',
           payment_date = e.closing_date,
           payment_bank_account_id = NULL,
           notes = CASE WHEN position(v_marker IN coalesce(notes, '')) > 0 THEN notes
                        ELSE coalesce(nullif(notes, '') || ' | ', '') || v_nota
                             || ' Il metodo «' || p.payment_method::text || '» non aveva nessun movimento in banca.' END,
           updated_at = now()
     WHERE id = p.id;
    v_azione := 'metodo_corretto';
  END IF;

  INSERT INTO public.payable_actions (payable_id, action_type, old_status, new_status, amount,
                                      payment_method, note, performed_at, operator_name)
  VALUES (p.id, v_azione, p.status, 'pagato', e.amount, 'contanti',
          v_nota || ' Riga di cassa: ' || left(e.descr, 120),
          now(), 'istruttoria del gestionale');

  RETURN jsonb_build_object('esito', v_azione, 'payable_id', p.id,
                            'data', e.closing_date, 'importo', e.amount);
END;
$function$;

-- Ripassa le righe «fattura pagata in contanti» degli ultimi giorni. Serve
-- perche' la fattura elettronica arriva spesso dopo che il negozio ha pagato.
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
  v_dubbie   integer := 0;
BEGIN
  FOR r IN
    SELECT x.id
      FROM public.outlet_daily_closing_expenses x
      JOIN public.outlet_daily_closings c ON c.id = x.closing_id
     WHERE x.kind = 'pagamento_fattura'
       AND coalesce(c.status, '') <> 'bozza'
       AND c.closing_date >= current_date - greatest(coalesce(p_giorni, 60), 1)
     ORDER BY c.closing_date
  LOOP
    v_esito := public.allinea_fattura_da_cassa(r.id);
    IF v_esito->>'esito' = 'chiusa_in_contanti' THEN v_chiuse := v_chiuse + 1;
    ELSIF v_esito->>'esito' = 'metodo_corretto' THEN v_corrette := v_corrette + 1;
    ELSIF v_esito->>'esito' IN ('piu_di_una', 'aperta_ma_segnale_debole') THEN v_dubbie := v_dubbie + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('chiuse_in_contanti', v_chiuse, 'metodi_corretti', v_corrette,
                            'da_guardare', v_dubbie, 'giorni', p_giorni, 'at', now());
END;
$function$;

-- Appena il negozio scrive la riga, la fattura si allinea: niente attese.
CREATE OR REPLACE FUNCTION public.trg_allinea_fattura_da_cassa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.kind = 'pagamento_fattura' THEN
    BEGIN
      PERFORM public.allinea_fattura_da_cassa(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      -- un intoppo qui non deve mai impedire al negozio di salvare la chiusura
      RAISE WARNING 'allinea_fattura_da_cassa(%): %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS allinea_fattura_da_cassa ON public.outlet_daily_closing_expenses;
CREATE TRIGGER allinea_fattura_da_cassa
  AFTER INSERT OR UPDATE OF kind, amount, description
  ON public.outlet_daily_closing_expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_allinea_fattura_da_cassa();

GRANT EXECUTE ON FUNCTION public.allinea_fattura_da_cassa(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.allinea_fatture_pagate_in_contanti(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.allinea_fattura_da_cassa(uuid) IS
  'Allinea allo scadenzario la fattura pagata con i contanti di una riga di chiusura: chiude quella aperta, corregge il metodo di quella gia'' pagata senza riscontro in banca. Mai su una fattura con movimento bancario. Migrazione 345.';
COMMENT ON FUNCTION public.allinea_fatture_pagate_in_contanti(integer) IS
  'Ripassa le righe «fattura pagata in contanti» degli ultimi giorni, perche'' la fattura elettronica arriva dopo il pagamento. Girata dal cron ogni notte. Migrazione 345.';

COMMIT;

-- Il cron sta fuori dalla transazione
SELECT cron.schedule('allinea-fatture-contanti', '35 3 * * *',
  $cron$SELECT public.allinea_fatture_pagate_in_contanti(60);$cron$);

-- Verifica, su ogni tenant:
-- SELECT public.allinea_fatture_pagate_in_contanti(400);
-- SELECT jobname, schedule FROM cron.job WHERE jobname = 'allinea-fatture-contanti';
-- SELECT count(*) FROM public.payables
--  WHERE status::text = 'pagato' AND payment_method::text LIKE 'bonifico%' AND bank_transaction_id IS NULL;
