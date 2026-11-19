-- ROLLBACK 442: torna alla funzione della 308 (solo XML) e ricalcola la
-- colonna generata. Le fatture JSON tornano a vat_non_detraibile = 0.
BEGIN;

CREATE OR REPLACE FUNCTION public.iva_art74_da_xml(p_xml text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $$
  SELECT COALESCE(round(sum(
           substring(r.part FROM '<(?:\w+:)?Imposta>\s*(-?[0-9]+(?:\.[0-9]+)?)\s*<')::numeric
         ), 2), 0)
  FROM (
    SELECT regexp_replace(ch, '^.*<(\w+:)?DatiRiepilogo[^>]*>', '') AS part
    FROM regexp_split_to_table(p_xml, '</(\w+:)?DatiRiepilogo>') AS ch
    WHERE p_xml ~* 'art\.?\s*74'
      AND ch ~ '<(\w+:)?DatiRiepilogo'
  ) r
  WHERE r.part ~* 'RiferimentoNormativo>[^<]*art\.?\s*74'
$$;

COMMENT ON FUNCTION public.iva_art74_da_xml(text) IS
  'IVA dei riepiloghi FatturaPA con RiferimentoNormativo art. 74 (IVA assolta a monte dall''operatore, es. telefonia prepagata): esposta in fattura ma non detraibile.';

ALTER TABLE public.electronic_invoices
  ALTER COLUMN vat_non_detraibile SET EXPRESSION AS (public.iva_art74_da_xml(xml_content));

COMMIT;
