-- =====================================================================
-- NZ_ONLY 409 — Roma Soratte accende il lunedi' a due persone
-- =====================================================================
-- PERCHE': Roma Soratte e' il negozio di prova (Patrizio, 12/11/2026); gli altri
-- restano come sono finche' non lo decide lui.
-- COSA: nella riga delle regole di Roma Soratte lunedi_due_persone = true.
-- ORDINE: dopo la 408 (senza la sua colonna va in errore e non cambia niente) e
-- INSIEME alla pubblicazione del frontend che conosce questa scelta.
-- NO DATA LOSS: un UPDATE su una riga; prima il valore era NULL (408 appena
-- applicata) e il ROLLBACK lo riporta a NULL. Nessun turno toccato.
-- =====================================================================

BEGIN;

UPDATE public.outlet_shift_rules
   SET lunedi_due_persone = true,
       updated_at = now()
 WHERE outlet_id = '8836bde0-3a78-4abe-afce-98b0c354c7c7';  -- Roma Soratte

-- la riga deve esserci: senza, la migration risulterebbe applicata senza aver fatto niente
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.outlet_shift_rules
                  WHERE outlet_id = '8836bde0-3a78-4abe-afce-98b0c354c7c7' AND lunedi_due_persone) THEN
    RAISE EXCEPTION '409: la riga delle regole di Roma Soratte non c''e'' o non e'' stata aggiornata';
  END IF;
END $$;

COMMIT;

-- Verifica:
-- SELECT lunedi_due_persone, giorni_pieni, riposi_min_settimana FROM public.outlet_shift_rules
--  WHERE outlet_id = '8836bde0-3a78-4abe-afce-98b0c354c7c7';   -- true, true, 2
-- SELECT count(*) FROM public.outlet_shift_rules WHERE lunedi_due_persone IS NOT NULL;  -- 1
