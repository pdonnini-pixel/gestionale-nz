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

COMMIT;

-- Verifica:
-- SELECT pausa_minuti, pausa_lunga_minuti, pausa_corta_pagata, giorni_pieni FROM outlet_shift_rules WHERE outlet_id = '8836bde0-3a78-4abe-afce-98b0c354c7c7';
-- Atteso: 10, 30, true, true. Gli altri negozi: SELECT count(*) FROM outlet_shift_rules WHERE pausa_corta_pagata OR giorni_pieni; atteso 1.
