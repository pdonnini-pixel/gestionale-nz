-- NZ_ONLY 429 — Consuntivi ricavi 2026 (gennaio-ottobre) riallineati alle chiusure di cassa
--
-- Patrizio, 17/11/2026: «sono corretti quelli che vedi tu, non quelli messi a mano».
-- Il consuntivo mensile (budget_confronto, cons_monthly) era stato scritto o ritoccato a
-- mano e si discostava dagli incassi veri (esempi: Brugnato ottobre 48.587,90 contro
-- 43.690,51; Valdichiana maggio 66.855,37 contro 68.790,17). Chiusure di cassa e registro
-- corrispettivi coincidono fra loro al centesimo (salvo arrotondamenti).
--
-- Regola usata, la stessa del consuntivo automatico (migration 428):
-- (corrispettivi + fatture delle chiusure non in bozza e non «negozio chiuso») / 1,22.
--
-- GIÀ APPLICATA su NZ il 17/11/2026 (Zago non ha righe di budget).
-- Copia di prima: public._bkp_20261117_budget_confronto_ricavi (68 consuntivi, 84 preventivi).
-- Esito: 68 celle calcolate, 55 cambiate, differenza totale +5.723,95; valore di prima
-- anche in budget_consuntivo_auto.valore_precedente.
-- Preventivi (rev_monthly) NON toccati: sono ancora uguali ai vecchi consuntivi nei mesi
-- gennaio-ottobre; il budget originale non è recuperabile dalle copie (quella del
-- 03/06/2026 ha solo segnaposto annuale/12). Decisione a Patrizio.

CREATE TABLE IF NOT EXISTS public._bkp_20261117_budget_confronto_ricavi AS
  SELECT * FROM public.budget_confronto WHERE year = 2026 AND entry_type IN ('rev_monthly','cons_monthly','rettifica','rett_monthly');
REVOKE ALL ON public._bkp_20261117_budget_confronto_ricavi FROM anon, authenticated;
ALTER TABLE public._bkp_20261117_budget_confronto_ricavi ENABLE ROW LEVEL SECURITY;

WITH calc AS (
  SELECT o.company_id, o.id outlet_id, o.cost_center_key cc, extract(month FROM c.closing_date)::int m,
         count(*) FILTER (WHERE c.status <> 'bozza') n,
         count(*) FILTER (WHERE c.status = 'bozza') bozze,
         round(sum(c.total_receipts + c.invoices_total) FILTER (WHERE c.status <> 'bozza' AND NOT c.is_closed_day), 2) lordo
  FROM public.outlet_daily_closings c JOIN public.outlets o ON o.id = c.outlet_id
  WHERE c.closing_date BETWEEN '2026-01-01' AND '2026-10-31' GROUP BY 1, 2, 3, 4),
tgt AS (
  SELECT bc.id, bc.company_id, bc.cost_center, bc.account_code, bc.month, bc.amount prec, calc.outlet_id, calc.n, calc.lordo,
         round(calc.lordo / 1.22, 2) netto
  FROM public.budget_confronto bc JOIN calc ON calc.cc = bc.cost_center AND calc.m = bc.month AND calc.company_id = bc.company_id
  WHERE bc.year = 2026 AND bc.entry_type = 'cons_monthly' AND calc.bozze = 0 AND calc.lordo > 0),
upd AS (
  UPDATE public.budget_confronto b SET amount = t.netto, stato = 'granitico', updated_at = now()
  FROM tgt t WHERE b.id = t.id AND b.amount IS DISTINCT FROM t.netto RETURNING b.id)
INSERT INTO public.budget_consuntivo_auto (company_id, year, month, cost_center, outlet_id, account_code, stato, lordo, netto, chiusure, bozze, valore_precedente, scritto_il, updated_at)
SELECT company_id, 2026, month, cost_center, outlet_id, account_code, 'scritto', lordo, netto, n, '{}', prec, now(), now() FROM tgt
ON CONFLICT (company_id, year, month, cost_center) DO NOTHING;
