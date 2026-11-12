-- ROLLBACK della NZ_ONLY 409: Roma Soratte torna senza il lunedi' a due persone.
BEGIN;
UPDATE public.outlet_shift_rules
   SET lunedi_due_persone = NULL, updated_at = now()
 WHERE outlet_id = '8836bde0-3a78-4abe-afce-98b0c354c7c7';
COMMIT;
