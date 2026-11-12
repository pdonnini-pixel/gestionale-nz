-- =====================================================================
-- NZ_ONLY 406 — Roma Soratte accende le regole del 12/11/2026
-- =====================================================================
-- PERCHE': Roma Soratte e' il negozio di prova (Patrizio, 11 e 12/11/2026); gli
-- altri sette restano come sono finche' non lo decide lui.
-- COSA: nella riga delle regole di Roma Soratte (che ha gia' giorni_pieni e
-- pausa_corta_pagata dalla NZ_ONLY 400): due riposi a testa nella settimana,
-- straordinari pari, festivi e giorni speciali con le fasce del sabato,
-- apertura e chiusura fra responsabile e vice a turno, chi apre resta 9 ore.
-- ORDINE: dopo la 405 (senza le sue colonne va in errore e non cambia niente)
-- e INSIEME alla pubblicazione del frontend che conosce queste scelte.
-- NO DATA LOSS: un UPDATE su una riga; prima i sette valori erano NULL (405
-- appena applicata) e il ROLLBACK li riporta a NULL. Nessun turno toccato.
-- I giorni liberi «a mano» della 395 li porta gia' la 405 in employee_riposi
-- (su NZ il 12/11/2026 la tabella era vuota: niente da portare).
-- =====================================================================

BEGIN;

UPDATE public.outlet_shift_rules
   SET riposi_min_settimana = 2,
       straordinari_pari = true,
       caldi_fasce_festivi = 'sabato',
       caldi_guida_apre_chiude = true,
       caldi_ore_apertura = 9,
       updated_at = now()
 WHERE outlet_id = '8836bde0-3a78-4abe-afce-98b0c354c7c7';  -- Roma Soratte

-- la riga deve esserci: senza, la migration risulterebbe applicata senza aver fatto niente
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.outlet_shift_rules
                  WHERE outlet_id = '8836bde0-3a78-4abe-afce-98b0c354c7c7' AND riposi_min_settimana = 2 AND caldi_guida_apre_chiude) THEN
    RAISE EXCEPTION '406: la riga delle regole di Roma Soratte non c''e'' o non e'' stata aggiornata';
  END IF;
END $$;

COMMIT;

-- Verifica:
-- SELECT riposi_min_settimana, straordinari_pari, caldi_fasce_festivi, caldi_guida_apre_chiude, caldi_ore_apertura, giorni_pieni, pausa_corta_pagata
--   FROM public.outlet_shift_rules WHERE outlet_id = '8836bde0-3a78-4abe-afce-98b0c354c7c7';   -- 2, true, sabato, true, 9, true, true
-- SELECT count(*) FROM public.outlet_shift_rules WHERE riposi_min_settimana IS NOT NULL OR straordinari_pari IS NOT NULL;  -- 1
