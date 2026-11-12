-- ROLLBACK della NZ_ONLY 404: Roma Soratte torna senza le scelte del 12/11/2026.
BEGIN;
UPDATE public.outlet_shift_rules
   SET riposi_min_settimana = NULL, straordinari_pari = NULL, caldi_fasce_festivi = NULL,
       caldi_guida_apre_chiude = NULL, caldi_ore_apertura = NULL, updated_at = now()
 WHERE outlet_id = '8836bde0-3a78-4abe-afce-98b0c354c7c7';
COMMIT;
