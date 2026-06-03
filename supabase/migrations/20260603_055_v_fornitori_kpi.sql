-- 20260603_055_v_fornitori_kpi.sql
-- PARTE 1 — Fix timeout pagina Fornitori dopo il backfill (suppliers 2->210, 769 payables).
-- Aggregati per-fornitore calcolati lato DB (una sola query), invece di scaricare
-- tutte le payables + electronic_invoices (con xml_content) lato client.
-- security_invoker=true => rispetta la RLS di payables (isolamento company_id).
-- Replicabile su NZ/Made/Zago. Non distruttivo.
CREATE OR REPLACE VIEW public.v_fornitori_kpi
WITH (security_invoker = true) AS
SELECT
  p.company_id,
  p.supplier_id,
  count(*)::int AS pay_count,
  COALESCE(sum(p.gross_amount),0)::numeric AS gross_total,
  COALESCE(sum(p.gross_amount) FILTER (WHERE p.status::text='pagato'),0)::numeric AS paid,
  count(*) FILTER (WHERE p.status::text='pagato')::int AS paid_count,
  count(*) FILTER (WHERE p.status::text='pagato' AND p.cash_movement_id IS NOT NULL)::int AS reconciled_count,
  COALESCE(sum(p.amount_remaining) FILTER (WHERE p.status::text='scaduto'),0)::numeric AS overdue,
  COALESCE(sum(p.amount_remaining) FILTER (WHERE p.status::text NOT IN ('pagato','annullato','bloccato')),0)::numeric AS pending,
  max(p.invoice_date) AS last_date,
  COALESCE(sum(p.gross_amount) FILTER (WHERE p.status::text <> 'nota_credito' AND p.gross_amount > 0),0)::numeric AS gross_positive,
  COALESCE(sum(abs(p.gross_amount)) FILTER (WHERE p.status::text='nota_credito' OR p.gross_amount < 0),0)::numeric AS credito,
  COALESCE(sum(p.amount_remaining) FILTER (WHERE p.status::text NOT IN ('pagato','annullato','bloccato','nota_credito')),0)::numeric AS pending_excl_nc,
  array_remove(array_agg(DISTINCT p.payment_method::text), NULL) AS methods
FROM public.payables p
WHERE p.supplier_id IS NOT NULL
GROUP BY p.company_id, p.supplier_id;
