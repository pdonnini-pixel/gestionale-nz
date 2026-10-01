-- ROLLBACK 259 — rimuove il riempimento del totale dal riepilogo IVA
DROP TRIGGER IF EXISTS trg_acube_sdi_fill_missing_total ON public.acube_sdi_invoices;
DROP FUNCTION IF EXISTS public.fn_acube_sdi_fill_missing_total();
DROP FUNCTION IF EXISTS public.fn_acube_total_from_riepilogo(jsonb, text);
