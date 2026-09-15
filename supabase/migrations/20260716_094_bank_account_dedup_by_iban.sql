-- =====================================================================
-- Migrazione 094 — Anti-doppione conti bancari per IBAN (ri-collegamento A-Cube)
-- =====================================================================
-- PROBLEMA: quando A-Cube (o la banca) cambia le credenziali e si rifà il
-- collegamento Open Banking, A-Cube può rilasciare un NUOVO id conto
-- (acube_account_uuid) per lo STESSO IBAN. Alcuni percorsi di sync creano allora
-- una NUOVA riga in bank_accounts invece di aggiornare quella esistente → conto
-- doppione nel menu, movimenti/pagamenti che si sdoppiano. È successo su NZ con MPS.
-- Poiché il ri-collegamento può capitare spesso, va blindato A MONTE.
--
-- FIX (robusto, indipendente dal percorso che inserisce): trigger BEFORE INSERT su
-- bank_accounts che, se esiste già un conto con lo stesso (company_id, IBAN):
--   • AGGIORNA il conto esistente (adotta il nuovo acube_account_uuid + saldo, lo
--     riattiva) → il ri-collegamento aggiorna, non duplica;
--   • ANNULLA l'inserimento del doppione (RETURN NULL) → nessuna riga nuova,
--     nessun errore lanciato al chiamante (sync idempotente).
-- I conti senza IBAN (casse, POS manuali) passano invariati.
--
-- Additiva/idempotente. ⚠️ REGOLA #0 — applicare su NZ + Made + Zago.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_bank_account_dedup_by_iban()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_id uuid;
BEGIN
  -- Solo conti con IBAN valorizzato: casse/POS senza IBAN passano.
  IF NEW.iban IS NOT NULL AND trim(NEW.iban) <> '' THEN
    -- Cerca un conto già esistente con lo stesso IBAN nella stessa azienda.
    -- Preferisci quello già collegato ad A-Cube, poi il più vecchio (canonico).
    SELECT id INTO v_existing_id
    FROM public.bank_accounts
    WHERE company_id = NEW.company_id
      AND iban = NEW.iban
    ORDER BY (acube_account_uuid IS NOT NULL) DESC, created_at ASC
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      -- Ri-collegamento: aggiorna il conto esistente invece di duplicarlo.
      UPDATE public.bank_accounts SET
        acube_account_uuid = COALESCE(NEW.acube_account_uuid, acube_account_uuid),
        current_balance    = COALESCE(NEW.current_balance, current_balance),
        balance_updated_at = COALESCE(NEW.balance_updated_at, balance_updated_at),
        bank_name          = COALESCE(NULLIF(trim(NEW.bank_name), ''), bank_name),
        is_active          = true,
        updated_at         = now()
      WHERE id = v_existing_id;

      -- Annulla l'INSERT del doppione: nessuna riga nuova, nessun errore.
      RETURN NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bank_account_dedup_by_iban ON public.bank_accounts;
CREATE TRIGGER trg_bank_account_dedup_by_iban
  BEFORE INSERT ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.fn_bank_account_dedup_by_iban();

-- =====================================================================
-- VERIFICA (sola lettura, dopo l'applicazione)
-- =====================================================================
-- SELECT tgname FROM pg_trigger WHERE tgrelid='public.bank_accounts'::regclass AND tgname='trg_bank_account_dedup_by_iban';
-- -- Non devono più esistere IBAN duplicati attivi:
-- SELECT iban, count(*) FROM bank_accounts WHERE iban IS NOT NULL AND is_active GROUP BY iban HAVING count(*)>1;
-- =====================================================================
