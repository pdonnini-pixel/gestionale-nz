-- =====================================================================
-- Migrazione 091 — Auto-compilazione P.IVA sul payable (prevenzione "payable senza P.IVA")
-- =====================================================================
-- PROBLEMA: alcuni payables risultavano con supplier_vat NULL, pur essendo collegati a una
-- e-fattura (electronic_invoices) che contiene sempre la P.IVA del fornitore (sender_vat da
-- A-Cube/SDI). Il percorso di creazione non copiava quel valore sul payable → aggancio per
-- P.IVA non affidabile, ricerche/partitario incoerenti.
--
-- FIX: trigger BEFORE INSERT/UPDATE che, se supplier_vat è vuoto, lo riempie automaticamente:
--   1) dalla e-fattura collegata (electronic_invoices.supplier_vat) — fonte A-Cube;
--   2) in fallback, dal fornitore in anagrafica (suppliers.partita_iva / vat_number).
-- Non tocca importi/stato; agisce solo sul campo supplier_vat quando è mancante.
--
-- Additiva e idempotente. ⚠️ REGOLA #0 — applicare su NZ + Made + Zago.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_payable_fill_supplier_vat()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vat text;
BEGIN
  IF NEW.supplier_vat IS NULL OR trim(NEW.supplier_vat) = '' THEN
    -- 1) dalla e-fattura collegata (sender_vat da A-Cube/SDI)
    IF NEW.electronic_invoice_id IS NOT NULL THEN
      SELECT nullif(trim(ei.supplier_vat), '')
        INTO v_vat
        FROM public.electronic_invoices ei
       WHERE ei.id = NEW.electronic_invoice_id;
    END IF;

    -- 2) fallback: dal fornitore in anagrafica
    IF v_vat IS NULL AND NEW.supplier_id IS NOT NULL THEN
      SELECT coalesce(nullif(trim(s.partita_iva), ''), nullif(trim(s.vat_number), ''))
        INTO v_vat
        FROM public.suppliers s
       WHERE s.id = NEW.supplier_id;
    END IF;

    IF v_vat IS NOT NULL THEN
      NEW.supplier_vat := v_vat;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payable_fill_supplier_vat ON public.payables;
CREATE TRIGGER trg_payable_fill_supplier_vat
  BEFORE INSERT OR UPDATE OF supplier_vat, electronic_invoice_id, supplier_id ON public.payables
  FOR EACH ROW EXECUTE FUNCTION public.fn_payable_fill_supplier_vat();

-- Nota: il nome 'trg_payable_fill_supplier_vat' precede alfabeticamente 'trg_payable_status',
-- quindi questo trigger BEFORE gira prima di update_payable_status (nessun conflitto: agisce
-- su un campo diverso).

-- =====================================================================
-- VERIFICA (sola lettura, dopo l'applicazione)
-- =====================================================================
-- SELECT tgname FROM pg_trigger WHERE tgrelid='public.payables'::regclass AND tgname='trg_payable_fill_supplier_vat';
-- -- payables ancora senza P.IVA ma con e-fattura che ce l'ha (dovrebbe tendere a 0 sui nuovi):
-- SELECT count(*) FROM payables p JOIN electronic_invoices ei ON ei.id=p.electronic_invoice_id
--   WHERE (p.supplier_vat IS NULL OR trim(p.supplier_vat)='') AND coalesce(nullif(trim(ei.supplier_vat),''),'') <> '';
-- =====================================================================
