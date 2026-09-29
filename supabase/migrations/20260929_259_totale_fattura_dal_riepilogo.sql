-- ============================================================================
-- 259 — Totale fattura ricavato dal riepilogo IVA quando il documento non lo dichiara
-- ============================================================================
-- Problema (NZ, 29/09/2026): fatture passive con importo 0,00 nello Scadenzario
-- (IP Services 4077300000006518, BLU SERVICE 4214700000010678 / 10679).
--
-- <ImportoTotaleDocumento> è FACOLTATIVO nella FatturaPA. Quando manca, lo staging
-- acube_sdi_invoices salva total_amount = 0 e il trigger
-- sync_acube_sdi_passive_to_payable lo copia pari pari in electronic_invoices.gross_amount
-- e in payables.gross_amount. Con lordo 0, update_payable_status calcola residuo 0 e
-- chiude la scadenza come «pagato»: la fattura sparisce dai pagamenti senza importo.
--
-- Il dato però c'è nel documento: DatiRiepilogo (ImponibileImporto + Imposta) è
-- obbligatorio. Regola granitica «niente liste a mano»: si legge dal documento.
--
-- Fix non invasivo: un trigger BEFORE INSERT su acube_sdi_invoices riempie
-- total_amount SOLO quando è nullo o zero e il riepilogo dà un valore diverso da zero.
-- Il trigger AFTER INSERT (sync_acube_sdi_passive_to_payable) non si tocca: legge
-- NEW.total_amount già corretto. Una fattura davvero a zero (es. saldata da acconto,
-- OMNITEKSTORE 6128/2026) ha riepilogo zero e resta a zero.
--
-- Nessun dato esistente viene modificato da questa migration.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_acube_total_from_riepilogo(p_payload jsonb, p_xml text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tot numeric;
  v_xml text;
BEGIN
  -- 1) payload JSON A-Cube: somma imponibile + imposta di tutte le righe di riepilogo
  IF p_payload IS NOT NULL AND jsonb_typeof(p_payload) = 'object' THEN
    BEGIN
      SELECT sum(coalesce(nullif(r->>'imponibile_importo','')::numeric, 0)
               + coalesce(nullif(r->>'imposta','')::numeric, 0))
        INTO v_tot
      FROM jsonb_array_elements(coalesce(p_payload->'fattura_elettronica_body', '[]'::jsonb)) b
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(b #> '{dati_beni_servizi,dati_riepilogo}', '[]'::jsonb)) r;
    EXCEPTION WHEN OTHERS THEN v_tot := NULL;
    END;
  END IF;

  -- 2) XML FatturaPA: ImponibileImporto e Imposta compaiono solo dentro DatiRiepilogo
  IF coalesce(v_tot, 0) = 0 AND p_xml IS NOT NULL THEN
    v_xml := ltrim(p_xml, chr(65279) || E' \t\r\n');
    IF left(v_xml, 1) = '<' THEN
      BEGIN
        SELECT coalesce((SELECT sum(m[1]::numeric)
                           FROM regexp_matches(v_xml, '<(?:[A-Za-z0-9_]+:)?ImponibileImporto>\s*(-?[0-9]+(?:\.[0-9]+)?)\s*<', 'g') m), 0)
             + coalesce((SELECT sum(m[1]::numeric)
                           FROM regexp_matches(v_xml, '<(?:[A-Za-z0-9_]+:)?Imposta>\s*(-?[0-9]+(?:\.[0-9]+)?)\s*<', 'g') m), 0)
          INTO v_tot;
      EXCEPTION WHEN OTHERS THEN v_tot := NULL;
      END;
    END IF;
  END IF;

  RETURN round(v_tot, 2);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_acube_sdi_fill_missing_total()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tot numeric;
BEGIN
  -- Solo se il documento non dichiara un totale: un valore presente non si sovrascrive mai.
  IF coalesce(NEW.total_amount, 0) = 0 THEN
    v_tot := public.fn_acube_total_from_riepilogo(
               CASE WHEN jsonb_typeof(NEW.payload) = 'object' THEN NEW.payload END,
               NEW.xml_content);
    IF coalesce(v_tot, 0) <> 0 THEN
      NEW.total_amount := v_tot;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_acube_sdi_fill_missing_total ON public.acube_sdi_invoices;
CREATE TRIGGER trg_acube_sdi_fill_missing_total
  BEFORE INSERT ON public.acube_sdi_invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_acube_sdi_fill_missing_total();

-- Verifica (non modifica nulla): le fatture già importate che il trigger avrebbe corretto
-- SELECT invoice_number, sender_name, total_amount,
--        public.fn_acube_total_from_riepilogo(CASE WHEN jsonb_typeof(payload)='object' THEN payload END, xml_content) AS dal_riepilogo
-- FROM public.acube_sdi_invoices
-- WHERE coalesce(total_amount,0) = 0;
