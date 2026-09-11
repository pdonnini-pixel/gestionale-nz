-- 20260911_213 — Il motore non ripropone ciò che è già stato proposto o rifiutato.
--
-- PERCHÉ (Patrizio, 11/09/2026, dopo il controllo delle distinte). Il pannello delle
-- proposte da confermare ne aveva 305, ma erano quasi tutte morte: 220 su movimenti già
-- riconciliati, 25 su fatture già agganciate a un altro movimento, 15 copie doppie della
-- stessa identica proposta. Vive ne restavano 45.
--
-- La causa è qui dentro: try_match_bank_transaction faceva sempre INSERT, senza guardare
-- se per quella coppia (movimento, fattura) una proposta esistesse già. Girando più volte
-- sugli stessi movimenti non riconciliati, le righe si accumulavano: quattro coppie
-- avevano 21-22 copie ciascuna, 87 righe per quattro abbinamenti.
--
-- Peggio: 23 proposte riguardavano coppie che erano già state RIFIUTATE. Una persona dice
-- no, e il sistema glielo ripropone. Questo è il difetto che dà più fastidio, perché
-- insegna a non fidarsi del pannello.
--
-- COSA CAMBIA — due guardie prima dell'INSERT:
--   · se per quella coppia esiste già una proposta in attesa, non se ne crea una seconda;
--   · se per quella coppia esiste un rifiuto, non si propone e non si applica nulla, mai
--     più. Il no di una persona vale più del punteggio del motore.
-- Il resto della funzione (punteggi, soglie, aggancio automatico sopra 80) è invariato.
--
-- Pulizia già eseguita separatamente sui dati: le 260 righe morte sono passate a
-- 'rejected' con la motivazione in `notes`, nessuna cancellata. Backup in
-- _bkp_reconlog_proposte_20260911.
--
-- Nessun dato cancellato. Rollback in _ROLLBACK.sql

-- ── 1. gemella SQL del filtro che il frontend ha già ────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bank_own_movement(p_descr text)
 RETURNS boolean LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(p_descr, '') ~* '(RATA DI MUTUO|RIMBORSO FINANZ|CANONE RAPPORTO|CANONE SET DI BASE|CANONE HOME BANKING|COMM/SPESE SU FIDEJUSSION|FONDO DI GARANZIA|PREL\.CONT|PRELEVAMENTO|PASSAGGIO CONTANTI|GIROCONTO|COSTITUZIONE PEGNO|A FAVORE NEXI PAYMENTS|A FAVORE GLOBAL BLUE|ADDEBITO DIRETTO CARTA|POSIZIONE CARTA)';
$function$;

COMMENT ON FUNCTION public.fn_bank_own_movement(text) IS
  'Vero se la causale e'' di un movimento della banca o di un giro interno (rata di mutuo, canone del rapporto, prelievo, giroconto, commissioni POS, addebito estratto carte): non ha una fattura dietro. Gemella di BANK_OWN_MOVEMENT_RE in src/lib/reconcileMatch.ts: se cambia una, cambiare l''altra.';

-- ── 2. il motore: tre guardie prima di proporre ─────────────────────────────
-- Il corpo e' quello della v5, invariato nei punteggi e nelle soglie. Le aggiunte:
--   a) movimento della banca  -> non si propone nulla;
--   b) coppia gia' rifiutata  -> non si propone e non si applica, mai piu';
--   c) coppia gia' proposta   -> non si crea una copia.
-- Il testo completo della funzione e' stato applicato ai tre tenant con
-- apply_migration; qui resta per la traccia versionata. Impronta condivisa:
--   try_match_bank_transaction = 8778a9491a548e96581a3183a9e7cdf7
--   fn_bank_own_movement       = 1afdb279d2d4a77a323193ac848cdd9d
-- (verificare con: SELECT md5(pg_get_functiondef(oid)) FROM pg_proc ...)
--
-- Il file con il corpo integrale e' 20260911_213_corpo_try_match.sql, a fianco.

-- ── 3. pulizia delle proposte morte (nessuna cancellata: passano a 'rejected') ──
UPDATE public.reconciliation_log r
   SET status='rejected',
       notes = COALESCE(r.notes,'') || ' | archiviata l''11/09/2026: movimento della banca, nessuna fattura dietro'
  FROM public.bank_transactions t
 WHERE t.id = r.bank_transaction_id AND r.status='to_confirm'
   AND public.fn_bank_own_movement(t.description);
