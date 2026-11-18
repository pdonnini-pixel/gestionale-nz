-- ROLLBACK 433: torna alla definizione precedente di causale_has_named_beneficiary.
-- Non tocca gli agganci fatti nel frattempo dal motore.
CREATE OR REPLACE FUNCTION public.causale_has_named_beneficiary(p_text text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM regexp_split_to_table(
      lower(COALESCE(
        substring(COALESCE(p_text,'') from '(?i)a\s+favore\s+di\s*:?\s*(.{0,45})'),
        substring(COALESCE(p_text,'') from '\*\s*([A-Za-z].{0,44})'),
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
