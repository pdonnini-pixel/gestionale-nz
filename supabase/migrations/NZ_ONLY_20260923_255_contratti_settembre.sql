-- =====================================================================
-- NZ_ONLY 255 — Proroghe e trasformazione di settembre 2026
-- =====================================================================
-- SOLO NEW ZAGO: dati di quattro persone, non una modifica di schema.
--
-- DA DOVE ARRIVANO: le lettere firmate mandate da Veronica il 23/09/2026.
-- Il dato e' scritto nel documento, quindi si legge e si scrive: non c'e'
-- niente da chiedere a nessuno.
--
--   1. SESTINI MATTIA — proroga 1: il determinato dal 22-06-2026 scadeva
--      il 21-09-2026, prorogato dal 22-09-2026 al 21-12-2026.
--      (Lettera del 21 settembre 2026, Reggello.)
--   2. BURATTA SARA — trasformazione da determinato a indeterminato a
--      tutele crescenti dal 26 settembre 2026.
--      (Lettera del 22 settembre 2026, Brugnato.)
--   3. GUERRA LAURA e 4. LANGELLA GIOVANNA FILOMENA — proroga 2: il
--      determinato dal 24-03-2026 scadeva il 23-09-2026, prorogato dal
--      24-09-2026 al 23-03-2027. (Lettere del 23 settembre 2026, Torino.)
--
-- DUE SCADENZE ERANO INDIETRO. I documenti dicono che il contratto di
-- Guerra e Langella correva "dal 24-03-2026 e fino al 23-09-2026", mentre
-- in anagrafica la scadenza era ferma al 23-06-2026: la prima proroga (da
-- giugno a settembre) non era mai stata registrata. Stessa cosa per
-- Buratta, scaduta sulla carta il 25-06-2026 e in realta' prorogata fino
-- a settembre, ora trasformata. Contarle e' il motivo per cui il campo
-- proroghe passa a 2: il documento dice "Proroga 2".
--
-- PROROGHE DISPONIBILI: il modello dell'azienda ne prevede quattro (in
-- anagrafica Guerra e Langella avevano 0 usate su 4). Quindi dopo due
-- proroghe ne restano due, e a Sestini dopo la prima ne restano tre.
-- Per Buratta i campi del determinato si azzerano, come fa gia' la scheda
-- quando il contratto non e' piu' a termine.
--
-- NO DATA LOSS: quattro UPDATE puntuali, nessuna riga cancellata. Il
-- valore precedente di ogni campo e' qui sotto.
--
-- COM'ERA PRIMA (backup del 23/09/2026):
--   SESTINI MATTIA   fb1331f1-a6e8-4708-874a-5ceb462adfcf
--     scadenza_td = NULL, proroghe = NULL, proroghe_disponibili = NULL, stato_td = NULL
--   BURATTA SARA     84c841ed-b7f3-47f7-9767-71628b1d469d
--     contratto_tipo = 'determinato', scadenza_td = 2026-06-25,
--     proroghe = 2, proroghe_disponibili = 2, stato_td = 'Prorogabile/Riassumibile'
--   GUERRA LAURA     a7ff2af8-4dc3-4556-a7c3-6b241b086d09
--     scadenza_td = 2026-06-23, proroghe = 0, proroghe_disponibili = 4
--   LANGELLA GIOVANNA FILOMENA  05085a15-65f1-4d0e-b2b2-b373f7c77af4
--     scadenza_td = 2026-06-23, proroghe = 0, proroghe_disponibili = 4
-- =====================================================================

BEGIN;

-- 1. Sestini: prima proroga, fino al 21/12/2026
UPDATE public.employees
   SET scadenza_td          = DATE '2026-12-21',
       proroghe             = 1,
       proroghe_disponibili = 3,
       stato_td             = 'Prorogabile/Riassumibile',
       note = concat_ws(' ', note,
         '[23/09/2026] Proroga 1 dal 22/09/2026 al 21/12/2026 (lettera del 21/09/2026).')
 WHERE id = 'fb1331f1-a6e8-4708-874a-5ceb462adfcf';

-- 2. Buratta: a tempo indeterminato dal 26/09/2026. I campi del contratto
--    a termine si azzerano, come fa la scheda quando il contratto cambia.
UPDATE public.employees
   SET contratto_tipo          = 'indeterminato',
       scadenza_td             = NULL,
       durata_mesi             = NULL,
       proroghe                = NULL,
       proroghe_disponibili    = NULL,
       mesi_disp_senza_causale = NULL,
       mesi_disp_con_causale   = NULL,
       stato_td                = NULL,
       note = concat_ws(' ', note,
         '[23/09/2026] Trasformazione a tempo indeterminato a tutele crescenti dal 26/09/2026 (lettera del 22/09/2026).')
 WHERE id = '84c841ed-b7f3-47f7-9767-71628b1d469d';

-- 3. e 4. Torino: seconda proroga, fino al 23/03/2027
UPDATE public.employees
   SET scadenza_td          = DATE '2027-03-23',
       proroghe             = 2,
       proroghe_disponibili = 2,
       stato_td             = 'Prorogabile/Riassumibile',
       note = concat_ws(' ', note,
         '[23/09/2026] Proroga 2 dal 24/09/2026 al 23/03/2027 (lettera del 23/09/2026). La prima proroga, fino al 23/09/2026, non era stata registrata.')
 WHERE id IN ('a7ff2af8-4dc3-4556-a7c3-6b241b086d09',
              '05085a15-65f1-4d0e-b2b2-b373f7c77af4');

COMMIT;

-- VERIFICA:
--   SELECT cognome, nome, contratto_tipo, scadenza_td, proroghe, proroghe_disponibili
--     FROM public.employees
--    WHERE id IN ('fb1331f1-a6e8-4708-874a-5ceb462adfcf',
--                 '84c841ed-b7f3-47f7-9767-71628b1d469d',
--                 'a7ff2af8-4dc3-4556-a7c3-6b241b086d09',
--                 '05085a15-65f1-4d0e-b2b2-b373f7c77af4')
--    ORDER BY cognome;
