-- =====================================================================
-- Migrazione 250 — Conteggi dell'import ratei: persone e righe separate
-- =====================================================================
-- COSA NON ANDAVA: l'elenco dei tabulati importati mostrava "41 / 85",
-- cioe' le PERSONE agganciate divise per le RIGHE lette. Due cose diverse
-- messe a confronto: un numero che non vuol dire niente e che infatti non
-- si capiva. Il campo righe_agganciate conteneva il numero di persone.
--
-- COSA FA:
--   1. aggiunge persone_agganciate, cioe' quante persone del tabulato sono
--      state riconosciute nell'anagrafica (il numero che serve davvero);
--   2. rimette a posto i due conteggi degli import gia' fatti, ricavandoli
--      dalle righe salvate invece che fidarsi di quello che era stato
--      scritto: righe_agganciate torna a contare le righe.
--
-- NO DATA LOSS: una colonna nuova e la correzione di due contatori, che
-- sono dati derivati e ricalcolabili dalle righe. Nessuna riga toccata.
-- REGOLA #0: da applicare su NZ + Made + Zago.
-- Rollback: 20260922_250_leave_import_conteggi_ROLLBACK.sql
-- =====================================================================

BEGIN;

ALTER TABLE public.leave_accrual_imports
  ADD COLUMN IF NOT EXISTS persone_agganciate int NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.leave_accrual_imports.persone_agganciate IS
  'Persone del tabulato riconosciute nell''anagrafica. Da non confondere con righe_agganciate, che conta le righe (una per persona e per voce).';

-- Ricalcolo dai dati veri, per gli import gia' salvati.
UPDATE public.leave_accrual_imports i
SET persone_agganciate = c.persone_ok,
    righe_agganciate   = c.righe_ok,
    righe_lette        = c.righe_tot,
    persone            = c.persone_tot
FROM (
  SELECT import_id,
         count(*)                                              AS righe_tot,
         count(*) FILTER (WHERE employee_id IS NOT NULL)        AS righe_ok,
         count(DISTINCT coalesce(matricola, '') || nominativo)  AS persone_tot,
         count(DISTINCT employee_id)                            AS persone_ok
  FROM public.leave_accrual_rows
  GROUP BY import_id
) c
WHERE c.import_id = i.id;

COMMIT;

-- VERIFICA (i due conteggi devono essere coerenti con le righe):
--   SELECT periodo_anno, periodo_mese, persone, persone_agganciate,
--          righe_lette, righe_agganciate
--     FROM public.leave_accrual_imports ORDER BY created_at DESC;
