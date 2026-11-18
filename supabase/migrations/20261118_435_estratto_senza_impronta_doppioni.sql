-- 435 — Movimenti inseriti da un estratto conto: niente import_dedup_hash. NZ + Zago.
--
-- Il fatto (Zago, 18/11/2026, estratti BCC Pontassieve gennaio-ottobre): 37 commissioni su bonifico
-- (0,75 e 0,95, circa 34 euro) non sono entrate. Il 20/07 Firenze ha dieci bonifici delle
-- quattordicesime, ognuno con la sua commissione «Commissioni su bonifico tramite in» da 0,95: stesso
-- conto, giorno, importo e causale. trg_set_bank_tx_dedup_hash dava a ognuna la stessa impronta
-- (conto+data+importo+causale) e l'indice unico idx_bank_tx_import_dedup scartava dalla seconda in poi.
--
-- Regola: per source = 'estratto_conto' l'impronta resta NULL, come già per l'open banking A-Cube.
-- I doppioni da ricaricamento li riconosce apply_bank_statement, che abbina ogni riga a un movimento
-- già presente prima di inserirne uno (v_used, uno a uno): due righe uguali dello stesso estratto
-- diventano due movimenti, la stessa riga ricaricata resta una.
-- Le impronte già scritte restano: nessun dato toccato. Su NZ 0 righe scartate per questo motivo;
-- su Zago 40 righe di estratto (37 movimenti, con le sovrapposizioni fra mesi).

CREATE OR REPLACE FUNCTION public.trg_set_bank_tx_dedup_hash()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
BEGIN
  -- Fix 2026-06-01: la migration 051 ha rinominato source 'api_acube_ob' -> 'acube_ob',
  -- ma il trigger controllava ancora 'api_acube%'. Cosi' le righe A-Cube ricevevano un
  -- import_dedup_hash spurio (grossolano: conto+data+importo+descr) che fa collidere
  -- transazioni distinte stesso-giorno/stesso-importo. Le righe A-Cube deduplicano via
  -- transactionId/acube_dedup_hash, NON via import_dedup_hash -> per loro deve restare NULL.
  -- 435: lo stesso per le righe inserite da un estratto conto: le deduplica apply_bank_statement.
  IF NEW.source IS NULL OR (NEW.source NOT LIKE '%acube%' AND NEW.source <> 'estratto_conto') THEN
    NEW.import_dedup_hash := public.compute_bank_tx_dedup_hash(
      NEW.bank_account_id, NEW.transaction_date, NEW.amount, NEW.description
    );
  ELSE
    NEW.import_dedup_hash := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
