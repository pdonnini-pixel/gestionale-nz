-- 20260603_058_nz_backfill_net_vat.sql
-- PARTE 1 (one-off, SOLO NZ, additivo): popola imponibile/IVA dall'XML FatturaPA
-- gia' in xml_content. Somma TUTTI i blocchi DatiRiepilogo (piu' aliquote).
-- Aggiorna SOLO dove NULL; Totale/gross invariato. Eseguito via MCP il 2026-06-03.
-- Risultato: electronic_invoices 769/769 e active_invoices 27/27 con net/vat, 0 errori.
DO $$
DECLARE r record; v_imp numeric; v_iva numeric; v_xml xml;
BEGIN
  FOR r IN SELECT id, xml_content FROM public.electronic_invoices
           WHERE (net_amount IS NULL OR vat_amount IS NULL) AND xml_content IS NOT NULL LOOP
    BEGIN
      v_xml := r.xml_content::xml;
      SELECT COALESCE(sum(x::numeric),0) INTO v_imp FROM unnest(xpath('//*[local-name()="DatiRiepilogo"]/*[local-name()="ImponibileImporto"]/text()', v_xml)::text[]) x;
      SELECT COALESCE(sum(x::numeric),0) INTO v_iva FROM unnest(xpath('//*[local-name()="DatiRiepilogo"]/*[local-name()="Imposta"]/text()', v_xml)::text[]) x;
      UPDATE public.electronic_invoices SET net_amount = COALESCE(net_amount, v_imp), vat_amount = COALESCE(vat_amount, v_iva) WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
  FOR r IN SELECT id, xml_content FROM public.active_invoices
           WHERE (taxable_amount IS NULL OR vat_amount IS NULL) AND xml_content IS NOT NULL LOOP
    BEGIN
      v_xml := r.xml_content::xml;
      SELECT COALESCE(sum(x::numeric),0) INTO v_imp FROM unnest(xpath('//*[local-name()="DatiRiepilogo"]/*[local-name()="ImponibileImporto"]/text()', v_xml)::text[]) x;
      SELECT COALESCE(sum(x::numeric),0) INTO v_iva FROM unnest(xpath('//*[local-name()="DatiRiepilogo"]/*[local-name()="Imposta"]/text()', v_xml)::text[]) x;
      UPDATE public.active_invoices SET taxable_amount = COALESCE(taxable_amount, v_imp), vat_amount = COALESCE(vat_amount, v_iva) WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
END $$;
