-- =====================================================================
-- NZ_ONLY 254 — Via l'orario dedotto dai contratti a chiamata
-- =====================================================================
-- SOLO NEW ZAGO: e' un dato di una persona, non una modifica di schema.
-- Made e Zago non hanno ancora tabulati importati, quindi non hanno il
-- problema (eccezione documentata alla REGOLA #0).
--
-- PERCHE': nel contratto a chiamata il programma delle paghe non puo'
-- stimare la maturazione, quindi fa maturare il rateo PER INTERO, come
-- se fosse un tempo pieno (Francesca Signorini, studio paghe, 23/09/2026).
-- Il gestionale ricava l'orario settimanale dal rateo diviso 4,325: su un
-- rateo pieno di 168,00 ore ne usciva 38,84 ore a settimana, che non sono
-- le ore di nessuno. Da quel numero dipende quanto vale una giornata di
-- ferie: 7,77 ore, altrettanto finte.
--
-- Nello stesso contratto, sempre per quella mail, ferie e permessi sono
-- indennizzati ogni mese: il conteggio si azzera e non resta niente da
-- godere. Quindi per queste persone non c'e' nemmeno un saldo da mostrare,
-- e l'interfaccia ora lo dice invece di far vedere riquadri vuoti.
--
-- COSA FA: azzera ore_settimanali_paghe dove il contratto e' a chiamata.
-- Il dato torna vuoto, che e' la verita': l'orario di chi lavora a
-- chiamata non e' ricavabile dal rateo. La colonna ore_settimanali
-- inserita a mano non viene toccata.
--
-- NO DATA LOSS: si cancella un valore DEDOTTO e sbagliato, non un dato
-- inserito da una persona. Oggi riguarda una riga sola.
--
-- COM'ERA PRIMA (backup del 23/09/2026):
--   FOCARDI NICCOLO', contratto a chiamata:
--     ore_settimanali_paghe = 38.84  (dal rateo 168,00)
--     ore_settimanali       = 40     (a mano, non toccata)
-- =====================================================================

BEGIN;

UPDATE public.employees
   SET ore_settimanali_paghe           = NULL,
       ore_settimanali_paghe_at        = NULL,
       ore_settimanali_paghe_import_id = NULL,
       note = concat_ws(' ', note,
         '[23/09/2026] Orario dedotto dal rateo tolto: nel contratto a chiamata il rateo matura per intero e non dice le ore lavorate.')
 WHERE lower(regexp_replace(coalesce(contratto_tipo, ''), '[^a-zA-Z]', '', 'g')) = 'achiamata'
   AND ore_settimanali_paghe IS NOT NULL;

COMMIT;

-- VERIFICA (deve restare vuoto):
--   SELECT cognome, nome, contratto_tipo, ore_settimanali, ore_settimanali_paghe
--     FROM public.employees
--    WHERE lower(regexp_replace(coalesce(contratto_tipo, ''), '[^a-zA-Z]', '', 'g')) = 'achiamata';
