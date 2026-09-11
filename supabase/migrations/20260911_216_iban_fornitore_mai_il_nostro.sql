-- 20260911_216 — L'IBAN del fornitore non puo' essere il nostro
--
-- PERCHE'
-- Nella fattura elettronica pagata con RiBa o addebito diretto il blocco
-- DatiPagamento porta l'IBAN del DEBITORE, cioe' il nostro conto, non quello
-- del creditore. Esempio verificato l'11/09/2026 su NZ: TANESINI 8/1789,
-- faliero grafica 149/2026 e S.R.T. 143 dichiarano tutte
-- <ModalitaPagamento>MP12</ModalitaPagamento> e, dentro lo stesso
-- DettaglioPagamento, l'IBAN del conto MPS di New Zago con
-- <IstitutoFinanziario>MONTE DEI PASCHI - REGGELLO</IstitutoFinanziario>.
--
-- La 204 ("fornitore configurato dalla fattura") lo leggeva come IBAN del
-- fornitore e lo copiava in anagrafica. Su NZ ha colpito 11 fornitori:
-- Best Tool, BMG Barberino, CNH Industrial Capital Europe (conto BCC),
-- Consorzio Shopinn, DWS Grundbesitz, Ego Communication, faliero grafica,
-- Realcart, S.R.T., San Mauro, TANESINI.
--
-- COSA FA
-- 1. Pulisce: svuota l'IBAN dei fornitori che porta un IBAN presente in
--    bank_accounts della stessa azienda, e toglie 'iban' dalla traccia di
--    provenienza (il campo torna vuoto, quindi ricompilabile dal dato vero).
-- 2. Impedisce che succeda ancora: trigger BEFORE INSERT/UPDATE su suppliers.
--    Sta sulla tabella e non dentro una funzione condivisa, cosi' vale per
--    qualunque strada scriva l'anagrafica (la 204, l'UI Fornitori, un import)
--    e nessuna sessione parallela puo' toglierlo per sbaglio riscrivendo una
--    funzione.
--
-- NON cancella righe e non tocca payables: l'IBAN di pagamento delle scadenze
-- vive su payables.iban e sul conto di addebito, campi diversi da questo.

BEGIN;

-- 1. La guardia
CREATE OR REPLACE FUNCTION public.fn_supplier_iban_mai_il_nostro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_norm text;
BEGIN
  v_norm := upper(regexp_replace(coalesce(NEW.iban, ''), '\s', '', 'g'));
  IF v_norm = '' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bank_accounts ba
     WHERE ba.company_id = NEW.company_id
       AND upper(regexp_replace(coalesce(ba.iban, ''), '\s', '', 'g')) = v_norm
  ) THEN
    -- e' un nostro conto: il campo resta vuoto, non e' l'IBAN del fornitore
    NEW.iban := NULL;
    NEW.profile_from_invoice_fields := (
      SELECT array_agg(f)
        FROM unnest(coalesce(NEW.profile_from_invoice_fields, ARRAY[]::text[])) f
       WHERE f <> 'iban'
    );
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_supplier_iban_mai_il_nostro() IS
  'Azzera suppliers.iban quando coincide con un conto dell''azienda in bank_accounts. Serve perche'' nelle fatture RiBa/addebito il tag IBAN di DatiPagamento e'' il conto del debitore (il nostro), non quello del creditore.';

DROP TRIGGER IF EXISTS trg_supplier_iban_mai_il_nostro ON public.suppliers;
CREATE TRIGGER trg_supplier_iban_mai_il_nostro
  BEFORE INSERT OR UPDATE OF iban ON public.suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_supplier_iban_mai_il_nostro();

-- 2. La pulizia dell'esistente
UPDATE public.suppliers s
SET iban = NULL,
    profile_from_invoice_fields = (
      SELECT array_agg(f)
        FROM unnest(coalesce(s.profile_from_invoice_fields, ARRAY[]::text[])) f
       WHERE f <> 'iban'
    ),
    updated_at = now()
WHERE nullif(btrim(coalesce(s.iban, '')), '') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.bank_accounts ba
     WHERE ba.company_id = s.company_id
       AND upper(regexp_replace(coalesce(ba.iban, ''), '\s', '', 'g'))
         = upper(regexp_replace(s.iban, '\s', '', 'g'))
  );

COMMIT;

-- VERIFICA (deve dare 0)
-- SELECT count(*) FROM public.suppliers s
--  WHERE nullif(s.iban,'') IS NOT NULL
--    AND EXISTS (SELECT 1 FROM public.bank_accounts ba
--                 WHERE ba.company_id = s.company_id
--                   AND upper(regexp_replace(coalesce(ba.iban,''),'\s','','g'))
--                     = upper(regexp_replace(s.iban,'\s','','g')));
