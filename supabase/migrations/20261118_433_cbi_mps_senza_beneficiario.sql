-- 433 — Distinte CBI MPS scritte «A FAVORE DI DISPOSIZIONE FILIALE DISPONENTE»: niente beneficiario.
--
-- Il fatto (Zago, 18/11/2026): gli estratti conto MPS in Excel scaricati da Zago scrivono le
-- distinte CBI così: «(26) VOSTRA DISPOSIZIONE A FAVORE DI DISPOSIZIONE FILIALE DISPONENTE 2430
-- ID FLUSSO CBI: … IMPORTO BONIFICI: …». La funzione prende i 45 caratteri dopo «a favore di»,
-- che finiscono a metà di «FLUSSO»: la parola tronca «fluss» non è fra quelle da ignorare e il
-- movimento risultava con un beneficiario scritto. Così try_match_amount_bank_transaction
-- cercava il nome «fluss» nel fornitore e scartava ogni fattura: 49 distinte CBI di Zago
-- (423.114 €) mai agganciate, anche quelle con una sola fattura di pari importo netto.
-- Su NZ le stesse distinte arrivano come «Causale: … - Descrizione: FILIALE DISPONENTE …»,
-- senza «a favore di», e lì il problema non c'era (19 righe con la forma Zago, tutte già
-- riconciliate: nessun effetto).
--
-- Regola: «a favore di disposizione filiale disponente» non nomina nessuno, si toglie prima di
-- cercare il beneficiario. Tutto il resto della funzione è uguale.

CREATE OR REPLACE FUNCTION public.causale_has_named_beneficiary(p_text text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
  WITH t AS (
    SELECT regexp_replace(COALESCE(p_text, ''),
             'a\s+favore\s+di\s*:?\s*disposizione\s+filiale\s+disponente', 'FILIALE DISPONENTE', 'gi') AS s
  )
  SELECT EXISTS (
    SELECT 1
    FROM t, regexp_split_to_table(
      lower(COALESCE(
        substring(t.s from '(?i)a\s+favore\s+di\s*:?\s*(.{0,45})'),
        substring(t.s from '\*\s*([A-Za-z].{0,44})'),
        '')),
      '[^a-z0-9]+') w
    WHERE length(w) >= 4
      AND w ~ '[a-z]'
      AND w <> ALL (ARRAY[
        'srl','srls','spa','snc','sas','sapa','scarl','scrl','propco','group','gruppo',
        'holding','italia','italy','italiana','societa','coop','cooperativa','unipersonale',
        'socio','unico','associati','associato','servizi','service','services',
        'disposizione','filiale','disponente','favore','bonifici','bonifico','commissioni',
        'flusso','pagamenti','pagamento','importo','vostra','nostra','internet','banking',
        'tramite','disposto','causale','numero','aggiuntive','info','note','banca','beneficiario'
      ])
  );
$function$;
