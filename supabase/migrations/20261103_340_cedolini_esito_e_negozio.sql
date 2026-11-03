-- 340 — Cedolini di versamento: esito in banca coerente e negozio giusto
--
-- Sistema i limiti lasciati dalla 338 (revisione database del 03/11/2026,
-- richiesta di Patrizio dello stesso giorno). Tenant: NZ e Zago.
--
-- 1. Importo cambiato dopo una riapertura. Se una chiusura confermata viene
--    riaperta e la cassiera cambia l'importo di un cedolino che il riscontro
--    aveva gia' trovato in banca, l'esito restava «accreditato» con il vecchio
--    importo. Ora il cedolino torna «in attesa» e il movimento torna libero:
--      - si toglie il suo abbinamento a questa chiusura (una sola riga di
--        closing_bank_matches, chiusura + movimento + tipo 'versamento');
--      - se il movimento non e' legato a nient'altro (altri abbinamenti di
--        cassa, riconciliazioni, fatture, scadenze, F24, stipendi, commissioni)
--        torna «da riconciliare» e dalla sua nota si toglie solo la frase che
--        aveva scritto il riscontro di cassa. Importo, data e descrizione del
--        movimento non cambiano mai;
--      - il riepilogo sulla chiusura torna «in attesa».
--    La mattina dopo il riscontro lo cerca di nuovo con l'importo corretto.
--    Lo stesso vale se un cedolino gia' trovato viene tolto.
--
-- 2. Primo cedolino su una giornata gia' riscontrata. Se una chiusura con il
--    versamento unico gia' trovato in banca viene riaperta e si aggiunge un
--    secondo cedolino, l'abbinamento del versamento unico si libera allo
--    stesso modo, cosi' il riscontro puo' ritrovarlo per il cedolino giusto.
--
-- 3. Esito in banca scritto solo dal riscontro: authenticated puo' inserire e
--    modificare solo importo, causale e ordine dei cedolini.
--
-- 4. Cedolino del negozio giusto: la policy di scrittura controlla che
--    negozio e azienda del cedolino siano quelli della sua chiusura.
--
-- Nessun dato esistente cambia: al momento dell'applicazione la tabella dei
-- cedolini e' vuota (verificato su NZ il 03/11/2026).

BEGIN;

-- Libera un movimento abbinato come versamento a una chiusura.
CREATE OR REPLACE FUNCTION public.fn_cash_deposit_free_tx(p_closing_id uuid, p_tx_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phrase text;
BEGIN
  IF p_closing_id IS NULL OR p_tx_id IS NULL THEN RETURN; END IF;

  DELETE FROM public.closing_bank_matches m
   WHERE m.closing_id = p_closing_id
     AND m.bank_transaction_id = p_tx_id
     AND m.match_type = 'versamento';
  IF NOT FOUND THEN RETURN; END IF;

  -- Il segno «riconciliato» si toglie solo se il movimento non e' legato ad altro.
  IF EXISTS (SELECT 1 FROM public.closing_bank_matches WHERE bank_transaction_id = p_tx_id)
     OR EXISTS (SELECT 1 FROM public.reconciliation_log WHERE bank_transaction_id = p_tx_id)
     OR EXISTS (SELECT 1 FROM public.payables WHERE bank_transaction_id = p_tx_id)
     OR EXISTS (SELECT 1 FROM public.electronic_invoices WHERE bank_transaction_id = p_tx_id)
     OR EXISTS (SELECT 1 FROM public.fiscal_deadlines WHERE bank_transaction_id = p_tx_id)
     OR EXISTS (SELECT 1 FROM public.payroll_payment_links WHERE bank_transaction_id = p_tx_id)
     OR EXISTS (SELECT 1 FROM public.acquirer_fees WHERE bank_transaction_id = p_tx_id) THEN
    RETURN;
  END IF;

  SELECT 'versamento della chiusura cassa del ' || to_char(c.closing_date, 'DD/MM/YYYY')
    INTO v_phrase
    FROM public.outlet_daily_closings c WHERE c.id = p_closing_id;

  UPDATE public.bank_transactions bt
     SET is_reconciled = false,
         reconciled_at = NULL,
         note = CASE WHEN v_phrase IS NULL THEN bt.note
                     ELSE NULLIF(replace(replace(COALESCE(bt.note, ''), ' | ' || v_phrase, ''), v_phrase, ''), '') END
   WHERE bt.id = p_tx_id;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_cash_deposit_free_tx(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 1. Importo cambiato o cedolino tolto
CREATE OR REPLACE FUNCTION public.fn_cash_deposit_bank_reset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Anche durante la cancellazione dell'intera giornata: il movimento torna libero.
    -- (In quel caso la chiusura non c'e' gia' piu' e l'UPDATE non trova righe.)
    IF OLD.bank_transaction_id IS NOT NULL THEN
      PERFORM public.fn_cash_deposit_free_tx(OLD.closing_id, OLD.bank_transaction_id);
      UPDATE public.outlet_daily_closings
         SET deposit_bank_status = 'in_attesa', deposit_bank_amount = NULL, deposit_bank_transaction_id = NULL
       WHERE id = OLD.closing_id;
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.amount IS DISTINCT FROM OLD.amount
     AND (OLD.bank_transaction_id IS NOT NULL OR OLD.bank_status <> 'in_attesa') THEN
    PERFORM public.fn_cash_deposit_free_tx(OLD.closing_id, OLD.bank_transaction_id);
    NEW.bank_status         := 'in_attesa';
    NEW.bank_amount         := NULL;
    NEW.bank_transaction_id := NULL;
    NEW.bank_matched_at     := NULL;
    UPDATE public.outlet_daily_closings
       SET deposit_bank_status = 'in_attesa', deposit_bank_amount = NULL, deposit_bank_transaction_id = NULL
     WHERE id = NEW.closing_id
       AND (deposit_bank_status IS DISTINCT FROM 'in_attesa' OR deposit_bank_amount IS NOT NULL OR deposit_bank_transaction_id IS NOT NULL);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_cash_deposit_bank_reset() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cash_deposit_bank_reset ON public.outlet_daily_closing_deposits;
CREATE TRIGGER trg_cash_deposit_bank_reset
  BEFORE UPDATE OF amount OR DELETE ON public.outlet_daily_closing_deposits
  FOR EACH ROW EXECUTE FUNCTION public.fn_cash_deposit_bank_reset();

-- 2. Primo cedolino su una giornata col versamento unico gia' trovato in banca
CREATE OR REPLACE FUNCTION public.fn_cash_deposit_first_rows()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tx uuid;
BEGIN
  SELECT c.deposit_bank_transaction_id INTO v_tx
    FROM public.outlet_daily_closings c WHERE c.id = NEW.closing_id;
  IF v_tx IS NULL THEN RETURN NEW; END IF;
  -- Gia' preso da un cedolino: niente da fare.
  IF EXISTS (SELECT 1 FROM public.outlet_daily_closing_deposits d
              WHERE d.closing_id = NEW.closing_id AND d.bank_transaction_id = v_tx) THEN
    RETURN NEW;
  END IF;
  PERFORM public.fn_cash_deposit_free_tx(NEW.closing_id, v_tx);
  UPDATE public.outlet_daily_closings
     SET deposit_bank_status = 'in_attesa', deposit_bank_amount = NULL, deposit_bank_transaction_id = NULL
   WHERE id = NEW.closing_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_cash_deposit_first_rows() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cash_deposit_first_rows ON public.outlet_daily_closing_deposits;
CREATE TRIGGER trg_cash_deposit_first_rows
  AFTER INSERT ON public.outlet_daily_closing_deposits
  FOR EACH ROW EXECUTE FUNCTION public.fn_cash_deposit_first_rows();

-- 3. La pagina scrive solo i campi della cassiera
REVOKE INSERT, UPDATE ON public.outlet_daily_closing_deposits FROM authenticated;
GRANT INSERT (closing_id, company_id, outlet_id, amount, note, sort_order) ON public.outlet_daily_closing_deposits TO authenticated;
GRANT UPDATE (amount, note, sort_order, updated_at) ON public.outlet_daily_closing_deposits TO authenticated;

-- 4. Cedolino del negozio e dell'azienda della sua chiusura
ALTER POLICY odcd_write ON public.outlet_daily_closing_deposits
  USING (company_id = (SELECT get_my_company_id()) AND can_write_cash_closing(outlet_id)
         AND EXISTS (SELECT 1 FROM public.outlet_daily_closings c
                      WHERE c.id = outlet_daily_closing_deposits.closing_id AND c.status = 'bozza'
                        AND c.outlet_id = outlet_daily_closing_deposits.outlet_id
                        AND c.company_id = outlet_daily_closing_deposits.company_id))
  WITH CHECK (company_id = (SELECT get_my_company_id()) AND can_write_cash_closing(outlet_id)
         AND EXISTS (SELECT 1 FROM public.outlet_daily_closings c
                      WHERE c.id = outlet_daily_closing_deposits.closing_id AND c.status = 'bozza'
                        AND c.outlet_id = outlet_daily_closing_deposits.outlet_id
                        AND c.company_id = outlet_daily_closing_deposits.company_id));

COMMIT;

-- Verifica:
--   SELECT has_column_privilege('authenticated','public.outlet_daily_closing_deposits','amount','UPDATE') AS importo,       -- true
--          has_column_privilege('authenticated','public.outlet_daily_closing_deposits','bank_status','UPDATE') AS esito,    -- false
--          has_column_privilege('authenticated','public.outlet_daily_closing_deposits','bank_transaction_id','INSERT') AS ins_bank, -- false
--          has_table_privilege('authenticated','public.outlet_daily_closing_deposits','delete') AS cancella;               -- true
