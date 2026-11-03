-- 340 — Cedolini di versamento: esito in banca coerente e negozio giusto
--
-- Sistema i due limiti lasciati dalla 338 (revisione database del 03/11/2026,
-- richiesta di Patrizio dello stesso giorno). Tenant: NZ e Zago.
--
-- 1. Importo cambiato dopo una riapertura. Se una chiusura confermata viene
--    riaperta e la cassiera cambia l'importo di un cedolino che il riscontro
--    aveva gia' trovato in banca, l'esito restava «accreditato» con il vecchio
--    importo e la giornata poteva risultare verificata con cifre diverse.
--    Ora, quando l'importo cambia, il cedolino torna «in attesa», perde il
--    movimento abbinato e quel movimento torna libero per il riscontro (si
--    toglie solo il suo abbinamento a questa chiusura, una riga di
--    closing_bank_matches; il movimento di banca resta intatto). La mattina
--    dopo il riscontro lo cerca di nuovo con l'importo corretto.
--    Lo stesso vale se un cedolino gia' trovato viene tolto: il suo
--    abbinamento si libera.
--
-- 2. Esito in banca scritto solo dal riscontro. Le colonne bank_* dei
--    cedolini non sono piu' scrivibili dalla pagina: authenticated puo'
--    inserire e modificare solo importo, causale e ordine. Il riscontro gira
--    come proprietario (SECURITY DEFINER) e non cambia.
--
-- 3. Cedolino del negozio giusto. La policy di scrittura ora controlla che
--    negozio e azienda del cedolino siano quelli della sua chiusura.
--
-- Nessun dato esistente cambia: al momento dell'applicazione la tabella dei
-- cedolini e' vuota su NZ (verificato il 03/11/2026).

BEGIN;

-- 1. Importo cambiato o cedolino tolto: esito azzerato e movimento liberato
CREATE OR REPLACE FUNCTION public.fn_cash_deposit_bank_reset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.bank_transaction_id IS NOT NULL THEN
      DELETE FROM public.closing_bank_matches m
       WHERE m.closing_id = OLD.closing_id
         AND m.bank_transaction_id = OLD.bank_transaction_id
         AND m.match_type = 'versamento';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.amount IS DISTINCT FROM OLD.amount
     AND (OLD.bank_transaction_id IS NOT NULL OR OLD.bank_status <> 'in_attesa') THEN
    IF OLD.bank_transaction_id IS NOT NULL THEN
      DELETE FROM public.closing_bank_matches m
       WHERE m.closing_id = OLD.closing_id
         AND m.bank_transaction_id = OLD.bank_transaction_id
         AND m.match_type = 'versamento';
    END IF;
    NEW.bank_status         := 'in_attesa';
    NEW.bank_amount         := NULL;
    NEW.bank_transaction_id := NULL;
    NEW.bank_matched_at     := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_cash_deposit_bank_reset() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cash_deposit_bank_reset ON public.outlet_daily_closing_deposits;
CREATE TRIGGER trg_cash_deposit_bank_reset
  BEFORE UPDATE OF amount OR DELETE ON public.outlet_daily_closing_deposits
  FOR EACH ROW EXECUTE FUNCTION public.fn_cash_deposit_bank_reset();

-- 2. La pagina scrive solo i campi della cassiera
REVOKE INSERT, UPDATE ON public.outlet_daily_closing_deposits FROM authenticated;
GRANT INSERT (closing_id, company_id, outlet_id, amount, note, sort_order) ON public.outlet_daily_closing_deposits TO authenticated;
GRANT UPDATE (amount, note, sort_order, updated_at) ON public.outlet_daily_closing_deposits TO authenticated;

-- 3. Cedolino del negozio e dell'azienda della sua chiusura
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
--   SELECT has_column_privilege('authenticated','public.outlet_daily_closing_deposits','amount','UPDATE') AS importo,
--          has_column_privilege('authenticated','public.outlet_daily_closing_deposits','bank_status','UPDATE') AS esito, -- false
--          has_table_privilege('authenticated','public.outlet_daily_closing_deposits','select') AS lettura;
