-- ============================================================================
-- 333 — Una proposta già in elenco non si riscrive ogni notte
-- ============================================================================
-- Nata dal controllo settimanale del 02/11/2026. Il 27/10 sono partiti due bonifici
-- identici da 98,10 (97,60 più 0,50 di commissioni) e CORPO VIGILI aveva quattro
-- fatture aperte da 97,60 esatti: due movimenti per quattro candidate. Il motore non
-- sceglie, e fa bene. Però ogni notte **riscriveva le stesse proposte**: due funzioni
-- diverse propongono la stessa coppia (`try_match_amount_bank_transaction` a
-- confidenza 60, `try_match_distinta_bank_transaction` a 70), e nessuna delle due
-- guardava se quella coppia era già in elenco. Dal 28/10 al 02/11: dodici righe a
-- notte, 84 righe per otto coppie.
--
-- COSA FA
-- Un trigger BEFORE INSERT su `reconciliation_log`: se arriva una proposta
-- `to_confirm` per una coppia (movimento, fattura) che ha già una proposta aperta,
-- l'inserimento **non avviene**. Se la proposta nuova ha una confidenza più alta,
-- la riga esistente viene aggiornata (confidenza, nota, importo, tipo) e la data
-- rinfrescata, così resta la lettura migliore e non si perde il fatto che il motore
-- l'ha riproposta.
--
-- PERCHÉ AGGIORNARE E NON SOLO SCARTARE: la regola R14 delle proposte azionabili
-- (`src/lib/reconcileMatch.ts`) chiede confidenza >= 70. Scartando la riga a 70
-- perché quella a 60 è arrivata prima, una proposta sparirebbe dall'elenco di
-- Tesoreria: sarebbe un peggioramento travestito da pulizia.
--
-- COSA NON FA
-- · non tocca nessuna riga esistente (le 84 già scritte restano dove sono, e la
--   pagina le deduplica già per fattura con `pickActionableSuggestions`);
-- · non cambia nessun aggancio, nessun importo, nessuno stato di fattura;
-- · non tocca le righe `applied` o `rejected`: una proposta chiusa e una riproposta
--   dopo un rifiuto restano possibili come prima;
-- · non insegna al motore ad appaiare K movimenti identici con K gemelle disposte
--   in distinta: quella sarebbe un'altra regola, e il 02/11 Patrizio ha scelto di
--   non farla ora (il caso completo capita una volta sola sui dati di oggi).
--
-- SECURITY INVOKER di proposito: su `reconciliation_log` il ruolo `authenticated`
-- non-viewer ha già la policy di UPDATE, e un viewer non può inserire, quindi il
-- ramo dell'aggiornamento non lo raggiunge mai. Così la RLS resta in mezzo e il
-- trigger non diventa una scorciatoia per scrivere su righe di altre aziende: la
-- ricerca della proposta gemella filtra comunque per `company_id`.
-- ============================================================================

-- NOTA DEL 09/11/2026: il corpo qui sotto è stato riallineato al testo davvero
-- applicato sui tenant. Nella versione originale di questo file c'erano tre
-- commenti in più dentro la funzione («prima volta che questa coppia viene
-- proposta», «Già in elenco…», «niente riga nuova») che il 02/11 non sono finiti
-- nel payload inviato a NZ e Made: il file e il database dicevano cose diverse.
-- Trovato dal revisore mentre leggeva la 368. Chi rigioca questo file ora ottiene
-- esattamente ciò che vive su NZ e Zago (impronta 330ad5e1696f8ced222897d53c5f6616),
-- e il controllo di parità non segnala niente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reclog_skip_duplicate_proposal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
  v_conf numeric;
BEGIN
  -- Solo le proposte aperte con entrambi i lati valorizzati: tutto il resto passa.
  IF NEW.status IS DISTINCT FROM 'to_confirm'
     OR NEW.bank_transaction_id IS NULL
     OR NEW.payable_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT r.id, r.confidence
    INTO v_id, v_conf
    FROM public.reconciliation_log r
   WHERE r.status = 'to_confirm'
     AND r.bank_transaction_id = NEW.bank_transaction_id
     AND r.payable_id = NEW.payable_id
     AND r.company_id IS NOT DISTINCT FROM NEW.company_id
   ORDER BY r.confidence DESC NULLS LAST, r.performed_at DESC
   LIMIT 1;

  IF v_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.confidence, 0) > COALESCE(v_conf, 0) THEN
    UPDATE public.reconciliation_log
       SET confidence = NEW.confidence,
           match_type = NEW.match_type,
           applied_amount = NEW.applied_amount,
           notes = NEW.notes,
           performed_at = now()
     WHERE id = v_id;
  END IF;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reclog_skip_duplicate_proposal ON public.reconciliation_log;
CREATE TRIGGER trg_reclog_skip_duplicate_proposal
  BEFORE INSERT ON public.reconciliation_log
  FOR EACH ROW EXECUTE FUNCTION public.reclog_skip_duplicate_proposal();

-- ============================================================================
-- Verifica (su ognuno dei 3 tenant)
-- ============================================================================
--   SELECT count(*) AS trigger_presente FROM pg_trigger t
--     JOIN pg_class c ON c.oid = t.tgrelid
--    WHERE c.relname = 'reconciliation_log'
--      AND t.tgname = 'trg_reclog_skip_duplicate_proposal';
--   -- atteso: 1
--
-- Prova a vuoto, da annullare: inserire due volte la stessa coppia to_confirm
-- dentro un blocco che alza un'eccezione, e contare le righe. La seconda non deve
-- entrare, e con confidenza più alta deve aggiornare la prima.
-- ============================================================================
