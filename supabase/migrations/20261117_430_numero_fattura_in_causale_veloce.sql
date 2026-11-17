-- 430 — Numero di fattura nella causale: controllo rapido prima dell'espressione regolare
-- NZ + Zago. Nato il 17/11/2026: su Zago due estratti MPS (marzo-maggio e maggio-agosto 2026)
-- non si salvavano, «canceling statement due to statement timeout» su apply_bank_statement
-- (8 s per il ruolo authenticated). Per ogni uscita inserita il riconciliatore
-- (trg_auto_reconcile_bank_transaction) chiama try_match_bank_transaction,
-- try_match_group_bank_transaction e try_match_group_numbers_bank_transaction, che per ogni
-- fattura chiamano invoice_cited_in_text: un'espressione regolare costruita al volo per ogni
-- chiave. Con ~520 fatture su Zago (2.100 su NZ) costava 130-150 ms per uscita e funzione.
-- Il costo non era la regex ma la funzione: una funzione SQL con una sottoquery (EXISTS su
-- unnest) non si incorpora nella query e viene ripianificata a ogni chiamata, ~0,3 ms x fattura.
-- In PL/pgSQL il piano resta in memoria per la sessione. In piu' strpos davanti alla regex: le
-- chiavi di invoice_number_keys sono solo cifre, quindi la regex puo' riuscire solo se la chiave
-- compare cosi' com'e' nel testo, e il controllo non cambia nessun risultato.
-- NULL: invoice_number_keys restituisce sempre un array (ARRAY(...)), mai NULL; con p_descr o
-- p_min_len NULL la condizione e' NULL e il risultato false, come prima con EXISTS.
-- Misura su Zago (15 passate su tutte le fatture): 2.524 ms prima, 332 ms dopo; confronto su tutte
-- le uscite x tutte le fatture di Zago: 0 differenze.
-- Storia: una prima versione (solo strpos davanti alla regex, sempre SQL) era stata applicata il
-- 17/11/2026 e non cambiava i tempi; questa la sostituisce con CREATE OR REPLACE.
-- Rollback: 20261117_430_..._ROLLBACK.sql (rimette il corpo SQL originale).
CREATE OR REPLACE FUNCTION public.invoice_cited_in_text(p_inv text, p_descr text, p_min_len integer)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  k text;
BEGIN
  FOREACH k IN ARRAY public.invoice_number_keys(p_inv) LOOP
    IF length(k) >= p_min_len
       AND strpos(p_descr, k) > 0
       AND p_descr ~ ('(^|[^0-9])' || k || '([^0-9]|$)') THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END;
$function$;
