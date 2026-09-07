-- =============================================================================
-- 177 — File di traccia: funzioni della ritenuta d'acconto (NZ + Made + Zago)
-- =============================================================================
--
-- fn_invoice_withholding e fn_electronic_invoice_withholding (con il suo
-- trigger su electronic_invoices) esistevano su tutti e 3 i tenant ma NON
-- avevano un file di migration nel repo: erano state applicate a mano.
-- Questo file le versiona senza cambiarle: e' la copia esatta della
-- definizione gia' in produzione, riapplicabile a piacere (idempotente).
-- Controllo fatto al momento dell'applicazione: md5(pg_get_functiondef)
-- identico prima e dopo su NZ, Made e Zago.
--
-- COSA FANNO
--   fn_invoice_withholding(xml, payload) legge l'importo della ritenuta
--   d'acconto: prima da XML vero (DatiGeneraliDocumento/DatiRitenuta/
--   ImportoRitenuta, somma di tutte le occorrenze), altrimenti dal payload JSON
--   di A-Cube (fattura_elettronica_body[].dati_generali.dati_generali_documento
--   .dati_ritenuta[].importo_ritenuta). Torna 0 se non c'e'.
--
--   fn_electronic_invoice_withholding e' il trigger BEFORE INSERT OR UPDATE OF
--   xml_content su electronic_invoices che valorizza withholding_amount.
--   Attenzione: scatta solo su INSERT o quando cambia xml_content. Le fatture
--   entrate prima che il trigger esistesse hanno withholding_amount = 0 anche
--   se la ritenuta c'e' nel payload (era il caso della 563 di SIGNORINI su NZ,
--   sistemato con NZ_ONLY_20260904_176).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_invoice_withholding(p_xml text, p_payload jsonb DEFAULT NULL::jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_realxml text; v_xml xml; v_nodes xml[]; v_node xml; v_txt text;
  v_tot numeric := 0; v_found boolean := false;
  v_body jsonb; v_r jsonb; v_e jsonb; v_bodies jsonb;
BEGIN
  v_realxml := ltrim(p_xml, chr(65279) || E' \t\r\n');
  IF v_realxml IS NOT NULL AND left(v_realxml, 1) = '<' THEN
    BEGIN
      v_xml := v_realxml::xml;
      v_nodes := xpath('//*[local-name()="DatiGeneraliDocumento"]/*[local-name()="DatiRitenuta"]/*[local-name()="ImportoRitenuta"]/text()', v_xml);
      IF array_length(v_nodes, 1) IS NOT NULL THEN
        FOREACH v_node IN ARRAY v_nodes LOOP
          v_txt := v_node::text;
          BEGIN
            v_tot := v_tot + nullif(trim(v_txt), '')::numeric;
            v_found := true;
          EXCEPTION WHEN OTHERS THEN NULL; END;
        END LOOP;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_found := false; v_tot := 0;
    END;
    IF v_found THEN RETURN round(v_tot, 2); END IF;
  END IF;

  IF p_payload IS NOT NULL AND jsonb_typeof(p_payload) = 'object' THEN
    v_bodies := p_payload->'fattura_elettronica_body';
    IF v_bodies IS NOT NULL AND jsonb_typeof(v_bodies) = 'array' THEN
      FOR v_body IN SELECT * FROM jsonb_array_elements(v_bodies) LOOP
        v_r := v_body #> '{dati_generali,dati_generali_documento,dati_ritenuta}';
        IF v_r IS NULL THEN CONTINUE; END IF;
        IF jsonb_typeof(v_r) = 'array' THEN
          FOR v_e IN SELECT * FROM jsonb_array_elements(v_r) LOOP
            BEGIN v_tot := v_tot + nullif(trim(coalesce(v_e->>'importo_ritenuta', '')), '')::numeric;
            EXCEPTION WHEN OTHERS THEN NULL; END;
          END LOOP;
        ELSIF jsonb_typeof(v_r) = 'object' THEN
          BEGIN v_tot := v_tot + nullif(trim(coalesce(v_r->>'importo_ritenuta', '')), '')::numeric;
          EXCEPTION WHEN OTHERS THEN NULL; END;
        END IF;
      END LOOP;
    END IF;
  END IF;
  RETURN round(coalesce(v_tot, 0), 2);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_electronic_invoice_withholding()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_payload jsonb := NULL; v_wh numeric;
BEGIN
  IF NEW.xml_content IS NULL OR btrim(NEW.xml_content) = '' THEN RETURN NEW; END IF;
  IF left(ltrim(NEW.xml_content, chr(65279) || E' \t\r\n'), 1) = '{' THEN
    BEGIN v_payload := NEW.xml_content::jsonb; EXCEPTION WHEN OTHERS THEN v_payload := NULL; END;
  END IF;
  v_wh := public.fn_invoice_withholding(NEW.xml_content, v_payload);
  IF coalesce(v_wh, 0) <> 0 OR coalesce(NEW.withholding_amount, 0) = 0 THEN
    NEW.withholding_amount := coalesce(v_wh, 0);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_electronic_invoice_withholding ON public.electronic_invoices;
CREATE TRIGGER trg_electronic_invoice_withholding
  BEFORE INSERT OR UPDATE OF xml_content ON public.electronic_invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_electronic_invoice_withholding();

COMMIT;
