-- ROLLBACK 430 — NZ + Zago. Rimette invoice_cited_in_text senza il controllo rapido.
CREATE OR REPLACE FUNCTION public.invoice_cited_in_text(p_inv text, p_descr text, p_min_len integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM unnest(public.invoice_number_keys(p_inv)) k
    WHERE length(k) >= p_min_len
      AND p_descr ~ ('(^|[^0-9])' || k || '([^0-9]|$)')
  );
$function$;
