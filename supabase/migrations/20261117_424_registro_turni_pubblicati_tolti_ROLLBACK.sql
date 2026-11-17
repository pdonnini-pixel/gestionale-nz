-- Rollback 424: toglie il trigger che scrive il registro. La tabella del registro NON si cancella:
-- contiene dati veri (regola NO DATA LOSS). Se va tolta davvero, prima un backup e la conferma di Patrizio.

DROP TRIGGER IF EXISTS trg_shifts_registra_pubblicato_tolto ON public.shifts;
DROP FUNCTION IF EXISTS public.shifts_registra_pubblicato_tolto();
