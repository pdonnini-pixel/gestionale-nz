-- ROLLBACK di 20260904_174_gate_identita_parola_intera.sql
-- Rimette la versione che cercava sottostringhe e non escludeva il lessico
-- bancario. Da usare solo se il confronto per parola intera facesse perdere
-- agganci legittimi: i test dicono di no (1 solo su 241, e anche quello spurio).

CREATE OR REPLACE FUNCTION public.supplier_confirmed_in_text(p_name text, p_vat text, p_text text)
 RETURNS boolean LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
  SELECT
    (p_vat IS NOT NULL AND p_vat <> '' AND position(lower(p_vat) in lower(coalesce(p_text, ''))) > 0)
    OR EXISTS (
      SELECT 1 FROM regexp_split_to_table(lower(coalesce(p_name, '')), '[^a-z0-9]+') w
      WHERE length(w) >= 4
        AND w NOT IN (
          'srl','srls','spa','snc','sas','sapa','scarl','scrl','propco','group','gruppo',
          'holding','italia','italy','italiana','societa','coop','cooperativa',
          'unipersonale','socio','unico','associati','associato','servizi','service','services'
        )
        AND position(w in lower(coalesce(p_text, ''))) > 0
    );
$function$;
