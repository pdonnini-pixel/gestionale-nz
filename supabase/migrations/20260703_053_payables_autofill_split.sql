-- 20260703_053_payables_autofill_split.sql
--
-- FIX DEFINITIVO: imponibile/IVA (net_amount/vat_amount) mancanti sui payables
-- importati da A-Cube.
--
-- Contesto: il bridge trigger `trg_sync_acube_sdi_passive` (migr. 029, poi
-- modificato da 039/042) crea i payables valorizzando solo gross_amount. Lo
-- split imponibile/IVA c'è però nella electronic_invoice collegata. Finora la
-- Scheda Contabile Fornitore mostrava 0 e serviva un backfill manuale.
--
-- Questa migrazione NON tocca il trigger 029 (per non regredire i fix
-- successivi). Aggiunge un trigger SEPARATO e ADDITIVO su `payables` che, in
-- INSERT/UPDATE, riempie net/vat dalla electronic_invoice collegata quando
-- mancano. Idempotente: agisce solo se net_amount è NULL/0 e gross != 0.
--
-- PARITÀ TENANT (Regola #0): applicare su NZ + Made + Zago.

CREATE OR REPLACE FUNCTION public.fn_payable_autofill_split()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_ei_net   numeric;
  v_ei_vat   numeric;
  v_ei_gross numeric;
  v_net      numeric;
BEGIN
  -- Agisci solo se lo split manca ma c'è un totale e una fattura collegata.
  IF (NEW.net_amount IS NULL OR NEW.net_amount = 0)
     AND NEW.gross_amount IS NOT NULL AND NEW.gross_amount <> 0
     AND NEW.electronic_invoice_id IS NOT NULL
  THEN
    SELECT net_amount, vat_amount, gross_amount
      INTO v_ei_net, v_ei_vat, v_ei_gross
      FROM public.electronic_invoices
      WHERE id = NEW.electronic_invoice_id;

    -- Serve un e-invoice con imponibile e totale validi per proporzionare.
    IF v_ei_gross IS NOT NULL AND v_ei_gross <> 0
       AND v_ei_net IS NOT NULL AND v_ei_net <> 0
    THEN
      -- Split proporzionale al gross della rata; vat = gross - net così la
      -- somma torna esatta su ogni rata (gestisce anche le note credito: se
      -- gross è negativo, il rapporto resta positivo e il segno segue gross).
      v_net := round(v_ei_net * (NEW.gross_amount / v_ei_gross), 2);
      NEW.net_amount := v_net;
      NEW.vat_amount := round(NEW.gross_amount - v_net, 2);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payable_autofill_split ON public.payables;
CREATE TRIGGER trg_payable_autofill_split
  BEFORE INSERT OR UPDATE OF gross_amount, electronic_invoice_id, net_amount
  ON public.payables
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_payable_autofill_split();

COMMENT ON FUNCTION public.fn_payable_autofill_split() IS
  'Riempie payables.net_amount/vat_amount dallo split della electronic_invoice collegata quando mancano (import A-Cube). Additivo, non modifica il bridge 029.';
