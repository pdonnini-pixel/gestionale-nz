-- ROLLBACK 435 — NZ + Zago. Torna al trigger di prima. I movimenti inseriti nel frattempo restano
-- (con impronta NULL): non si tocca nessuna riga.
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
  IF NEW.source IS NULL OR NEW.source NOT LIKE '%acube%' THEN
    NEW.import_dedup_hash := public.compute_bank_tx_dedup_hash(
      NEW.bank_account_id, NEW.transaction_date, NEW.amount, NEW.description
    );
  ELSE
    NEW.import_dedup_hash := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
