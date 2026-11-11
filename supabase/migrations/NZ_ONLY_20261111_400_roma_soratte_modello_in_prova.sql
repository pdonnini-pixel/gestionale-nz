-- =====================================================================
-- NZ_ONLY 400 — Roma Soratte accende il modello in prova dei turni
-- =====================================================================
-- PERCHE': Patrizio, 11/11/2026: «stiamo rilavorando su Roma Soratte per poi
-- capire se diventa il nuovo modello per tutti gli altri outlet». Gli altri
-- sette negozi restano come sono, pause salvate comprese.
--
-- COSA: nella riga delle regole di Roma Soratte si accendono le due scelte
-- della 399 e le pause passano da 30 e 60 minuti a 10 e 30.
--
-- ORDINE: 399 (le scelte del negozio) → 401 (pausa pagata nelle timbrature) → questa.
-- Senza la 401 questa migration si ferma con un errore (colonna pausa_pagata_minuti
-- assente) e non cambia niente: e' voluto, la pausa pagata senza timbrature non va accesa.
--
-- DA APPLICARE INSIEME ALLA PUBBLICAZIONE DEL FRONTEND che conosce la pausa
-- corta pagata: con il frontend di prima i 10 minuti verrebbero tolti dalle ore.
--
-- NO DATA LOSS: un UPDATE su una riga; i valori di prima sono scritti qui sotto
-- e nel ROLLBACK (pausa_minuti 30, pausa_lunga_minuti 60, scelte NULL).
-- =====================================================================

BEGIN;

UPDATE public.outlet_shift_rules r
   SET pausa_minuti = 10, pausa_lunga_minuti = 30, pausa_corta_pagata = true, giorni_pieni = true, updated_at = now()
  FROM public.outlets o
 WHERE o.id = r.outlet_id AND o.id = '8836bde0-3a78-4abe-afce-98b0c354c7c7';  -- Roma Soratte

-- I turni di Roma Soratte da oggi in avanti prendono la pausa pagata (10 minuti nei turni
-- oltre 6 e fino a 8 ore senza pausa tolta). Lo fa gia' il trigger della 401 quando cambiano
-- le regole; questa riga lo ripete, non fa danni se e' gia' a posto, e ferma tutto se la 401 manca.
UPDATE public.shifts s
   SET pausa_pagata_minuti = public.pausa_pagata_del_turno(s.outlet_id, s.inizio, s.fine, s.pausa_minuti)
 WHERE s.outlet_id = '8836bde0-3a78-4abe-afce-98b0c354c7c7'
   AND s.data >= (now() AT TIME ZONE 'Europe/Rome')::date
   AND NOT public.turni_mese_chiuso(s.company_id, s.data)
   AND s.pausa_pagata_minuti IS DISTINCT FROM public.pausa_pagata_del_turno(s.outlet_id, s.inizio, s.fine, s.pausa_minuti);

COMMIT;

-- Verifica:
-- SELECT pausa_minuti, pausa_lunga_minuti, pausa_corta_pagata, giorni_pieni FROM outlet_shift_rules WHERE outlet_id = '8836bde0-3a78-4abe-afce-98b0c354c7c7';
-- Atteso: 10, 30, true, true. Gli altri negozi: SELECT count(*) FROM outlet_shift_rules WHERE pausa_corta_pagata OR giorni_pieni; atteso 1.
-- Turni futuri con la pausa pagata: SELECT data, inizio, fine, pausa_minuti, pausa_pagata_minuti FROM shifts
--   WHERE outlet_id = '8836bde0-3a78-4abe-afce-98b0c354c7c7' AND data >= current_date AND stato <> 'annullato' ORDER BY data, inizio;
-- Atteso: 10 nei turni da 6 ore e mezza a 8 ore senza pausa, 0 negli altri. Negli altri negozi:
--   SELECT count(*) FROM shifts WHERE pausa_pagata_minuti <> 0 AND outlet_id <> '8836bde0-3a78-4abe-afce-98b0c354c7c7'; atteso 0.
