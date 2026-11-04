-- 20261103_341_pagamento_fattura_in_contanti.sql
--
-- Il negozio a volte paga una fattura con i contanti della cassa (modalita'
-- MP01 sulla fattura elettronica). Finora quel pagamento si poteva scrivere
-- solo come "spesa", e allora il costo veniva contato due volte: una dalla
-- fattura nei fornitori, una dalle spese di cassa nei costi dell'outlet.
--
-- Caso che lo ha fatto emergere: Palmanova, chiusura del 3 novembre 2026, in
-- cassa mancavano 75,84 EUR. Erano la fattura RICA GEST 2540312521 del 28
-- ottobre, 75,84 EUR, MP01 contanti, pagata dal negozio e non scritta in
-- chiusura. Misura sui dati veri: 148 spese di cassa per 6.438,21 EUR, di cui
-- 24 combaciano per importo e data con fatture pagate in contanti o carta.
--
-- Qui si aggiunge il terzo tipo di riga, 'pagamento_fattura':
--   - esce dalla cassa come una spesa (cosi' la giornata quadra e la catena
--     del contante resta giusta, formule di quadratura invariate);
--   - NON entra nei costi dell'outlet (la vista prende solo kind = 'spesa').
--
-- Niente di distruttivo: il vincolo viene riscritto piu' largo, nessuna riga
-- esistente cambia tipo, nessun dato viene cancellato.

BEGIN;

-- ── 1. Il terzo tipo di riga ─────────────────────────────────────────────
ALTER TABLE public.outlet_daily_closing_expenses
  DROP CONSTRAINT IF EXISTS outlet_daily_closing_expenses_kind_check;

ALTER TABLE public.outlet_daily_closing_expenses
  ADD CONSTRAINT outlet_daily_closing_expenses_kind_check
  CHECK (kind = ANY (ARRAY['spesa'::text, 'rimborso_cliente'::text, 'pagamento_fattura'::text]));

COMMENT ON COLUMN public.outlet_daily_closing_expenses.kind IS
  'spesa = spesa del negozio pagata in contanti, e'' un costo dell''outlet; rimborso_cliente = soldi restituiti a un cliente; pagamento_fattura = fattura di un fornitore pagata con i contanti della cassa, esce dalla cassa ma il costo e'' gia'' nella fattura (migrazione 341).';

-- ── 2. La quadratura: il pagamento di una fattura esce dalla cassa ───────
CREATE OR REPLACE FUNCTION public.fn_cash_closing_compute()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_channels_total numeric(14,2) := 0;
  v_cash_line      numeric(14,2) := 0;
  v_invoices       numeric(14,2) := 0;
  v_expenses       numeric(14,2) := 0;
  v_refunds        numeric(14,2) := 0;
  v_expenses_note  text;
  v_prev_float     numeric(14,2);
  v_prev_pending   numeric(14,2);
  v_dep_total      numeric(14,2);
  v_dep_note       text;
BEGIN
  IF NEW.is_closed_day THEN
    NEW.total_receipts := 0;
    NEW.cash_deposit   := COALESCE(NEW.cash_deposit, 0);
  END IF;

  -- Mezzi di pagamento (senza le fatture), contanti, fatture
  SELECT
    COALESCE(SUM(CASE WHEN ch.counts_in_total AND ch.kind <> 'fattura' THEN l.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ch.kind = 'contanti' THEN l.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ch.kind = 'fattura' THEN l.amount ELSE 0 END), 0)
  INTO v_channels_total, v_cash_line, v_invoices
  FROM public.outlet_daily_closing_lines l
  JOIN public.outlet_payment_channels ch ON ch.id = l.channel_id
  WHERE l.closing_id = NEW.id;

  -- Spese di cassa: le spese vere e i pagamenti di fatture in contanti
  -- escono entrambi dal cassetto, quindi stanno insieme in cash_expenses.
  -- Nei costi dell'outlet ci va solo kind = 'spesa' (vedi la vista sotto).
  SELECT COALESCE(SUM(CASE WHEN e.kind IN ('spesa', 'pagamento_fattura') THEN e.amount ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN e.kind = 'rimborso_cliente' THEN e.amount ELSE 0 END), 0),
         NULLIF(string_agg(NULLIF(btrim(e.description), ''), ', ' ORDER BY e.sort_order)
                FILTER (WHERE e.kind IN ('spesa', 'pagamento_fattura')), '')
  INTO v_expenses, v_refunds, v_expenses_note
  FROM public.outlet_daily_closing_expenses e
  WHERE e.closing_id = NEW.id;

  -- Versamenti con piu' cedolini (337): se la giornata ha righe in
  -- outlet_daily_closing_deposits, versamento e causale sono la loro somma.
  -- Senza righe vale quanto scritto nel campo unico, come prima.
  IF EXISTS (SELECT 1 FROM public.outlet_daily_closing_deposits d WHERE d.closing_id = NEW.id) THEN
    SELECT COALESCE(SUM(d.amount), 0),
           NULLIF(string_agg(NULLIF(btrim(d.note), ''), ' + ' ORDER BY d.sort_order, d.id), '')
      INTO v_dep_total, v_dep_note
      FROM public.outlet_daily_closing_deposits d
     WHERE d.closing_id = NEW.id;
    NEW.cash_deposit      := v_dep_total;
    NEW.cash_deposit_note := v_dep_note;
  END IF;

  NEW.cash_expenses       := v_expenses;
  NEW.customer_refunds    := v_refunds;
  NEW.cash_expenses_note  := v_expenses_note;
  NEW.invoices_total      := v_invoices;
  NEW.channels_total      := v_channels_total;
  -- corrispettivi + fatture = totale incassato = somma dei mezzi di pagamento
  NEW.receipts_difference := COALESCE(NEW.total_receipts, 0) + v_invoices - v_channels_total;

  -- Partenza di stasera: fondo e contanti da versare dell'ultima chiusura confermata
  -- con il fondo contato; se non c'e', i valori iniziali scritti alla prima chiusura.
  SELECT c.cash_float_declared, COALESCE(c.cash_pending_declared, 0)
  INTO v_prev_float, v_prev_pending
  FROM public.outlet_daily_closings c
  WHERE c.outlet_id = NEW.outlet_id
    AND c.closing_date < NEW.closing_date
    AND c.status IN ('confermata', 'verificata')
    AND c.cash_float_declared IS NOT NULL
  ORDER BY c.closing_date DESC
  LIMIT 1;

  IF v_prev_float IS NULL THEN
    v_prev_float   := NEW.cash_float_opening;
    v_prev_pending := COALESCE(NEW.cash_pending_opening, 0);
  END IF;

  IF v_prev_float IS NULL THEN
    NEW.cash_float_expected := NULL;
    NEW.cash_difference     := NULL;
  ELSE
    NEW.cash_float_expected := v_prev_float + COALESCE(v_prev_pending, 0) + v_cash_line - v_expenses - v_refunds - COALESCE(NEW.cash_deposit, 0);
    NEW.cash_difference := CASE WHEN NEW.cash_float_declared IS NULL THEN NULL
                                ELSE NEW.cash_float_declared + COALESCE(NEW.cash_pending_declared, 0) - NEW.cash_float_expected END;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

-- ── 3. I costi dell'outlet prendono solo le spese vere ───────────────────
CREATE OR REPLACE VIEW public.v_costi_outlet_da_fatture WITH (security_invoker = on) AS
WITH inv AS MATERIALIZED (
  SELECT DISTINCT ON (e.id) e.id AS invoice_id, e.company_id, e.invoice_date, p.supplier_id,
         CASE WHEN e.tipo_documento = 'TD04' THEN -abs(coalesce(e.net_amount, 0)) ELSE coalesce(e.net_amount, 0) END AS netto,
         nf.outlet_id AS ov_outlet, ov.gruppo AS ov_gruppo
  FROM public.electronic_invoices e
  LEFT JOIN public.payables p ON p.electronic_invoice_id = e.id
  LEFT JOIN public.invoice_cost_overrides ov ON ov.invoice_id = e.id
  LEFT JOIN public.v_negozio_fattura nf ON nf.invoice_id = e.id
  WHERE coalesce(e.tipo_documento, 'TD01') NOT IN ('TD16', 'TD17', 'TD18')
    AND NOT EXISTS (SELECT 1 FROM public.invoice_cost_flags f WHERE f.invoice_id = e.id)
  ORDER BY e.id, p.supplier_id NULLS LAST
),
quote AS MATERIALIZED (
  SELECT s.id AS supplier_id, o.id AS outlet_id, 100::numeric AS pct
  FROM public.suppliers s
  JOIN public.outlets o ON o.company_id = s.company_id AND o.cost_center_key = s.cost_center
  WHERE coalesce(nullif(s.cost_center, ''), 'all') <> 'all'
  UNION ALL
  SELECT r.supplier_id, d.outlet_id, d.percentage
  FROM public.supplier_allocation_rules r
  JOIN public.supplier_allocation_details d ON d.rule_id = r.id
  JOIN public.suppliers s ON s.id = r.supplier_id
  WHERE r.is_active AND coalesce(nullif(s.cost_center, ''), 'all') = 'all'
),
ol AS MATERIALIZED (
  SELECT o.id, o.company_id, o.name, o.cost_center_key FROM public.outlets o
),
cassa AS MATERIALIZED (
  -- Solo le spese vere: il pagamento in contanti di una fattura (kind
  -- 'pagamento_fattura') esce dalla cassa ma il costo e' gia' nella fattura,
  -- quindi qui non entra, altrimenti si conterebbe due volte (migrazione 341).
  SELECT e.outlet_id, d.closing_date, sum(e.amount) AS cash_expenses
  FROM public.outlet_daily_closing_expenses e
  JOIN public.outlet_daily_closings d ON d.id = e.closing_id
  WHERE e.kind = 'spesa' AND coalesce(d.status, '') <> 'bozza'
  GROUP BY e.outlet_id, d.closing_date
  HAVING sum(e.amount) <> 0
),
banca AS MATERIALIZED (
  SELECT b.id, b.company_id, b.transaction_date, b.amount, upper(b.description) AS d
  FROM public.bank_transactions b
  WHERE b.amount < 0 AND b.description ~* 'A FAVORE NEXI PAYMENTS|AMERICAN EXPRESS PAYMENTS'
),
contratti AS MATERIALIZED (
  SELECT c.company_id, c.outlet_id,
         CASE WHEN length(trim(c.merchant_code)) >= 8 THEN upper(trim(c.merchant_code)) END AS mc,
         CASE WHEN length(trim(c.payment_contract)) >= 8 THEN upper(trim(c.payment_contract)) END AS pc
  FROM public.acquirer_contracts c
  WHERE c.outlet_id IS NOT NULL
)
SELECT i.company_id,
       coalesce(i.ov_outlet, q.outlet_id) AS outlet_id,
       o.name AS outlet,
       o.cost_center_key,
       EXTRACT(YEAR FROM i.invoice_date)::int AS anno,
       EXTRACT(MONTH FROM i.invoice_date)::int AS mese,
       CASE WHEN i.ov_gruppo IS NOT NULL THEN i.ov_gruppo
            WHEN i.supplier_id IS NULL THEN 'senza_fornitore'
            WHEN c.code = 'ALLESTIMENTI' THEN 'allestimenti'
            ELSE coalesce(c.macro_group::text, 'senza_categoria') END AS gruppo,
       round(sum(i.netto * CASE WHEN i.ov_outlet IS NOT NULL THEN 100 ELSE coalesce(q.pct, 100) END / 100), 2) AS importo,
       count(DISTINCT i.invoice_id) AS fatture
FROM inv i
LEFT JOIN public.suppliers s ON s.id = i.supplier_id
LEFT JOIN public.cost_categories c ON c.id = s.default_cost_category_id
LEFT JOIN quote q ON i.ov_outlet IS NULL AND q.supplier_id = i.supplier_id
LEFT JOIN ol o ON o.id = coalesce(i.ov_outlet, q.outlet_id)
WHERE i.invoice_date IS NOT NULL
GROUP BY 1, 2, 3, 4, 5, 6, 7
UNION ALL
SELECT g.company_id,
       g.outlet_id,
       o.name AS outlet,
       o.cost_center_key,
       g.year AS anno,
       g.month AS mese,
       x.gruppo,
       round(sum(x.importo), 2) AS importo,
       0::bigint AS fatture
FROM public.v_personnel_gross_cost g
CROSS JOIN LATERAL (VALUES ('personale'::text, g.costo_lordo_outlet),
                           ('amministratori'::text, g.amministratori_totale)) x(gruppo, importo)
LEFT JOIN ol o ON o.id = g.outlet_id
WHERE x.importo <> 0
GROUP BY 1, 2, 3, 4, 5, 6, 7
UNION ALL
SELECT o.company_id, o.id, o.name, o.cost_center_key,
       EXTRACT(YEAR FROM d.closing_date)::int, EXTRACT(MONTH FROM d.closing_date)::int,
       'spese_cassa'::text, round(sum(d.cash_expenses), 2), 0::bigint
FROM cassa d
JOIN ol o ON o.id = d.outlet_id
GROUP BY 1, 2, 3, 4, 5, 6, 7
UNION ALL
SELECT x.company_id, x.outlet_id, o.name, o.cost_center_key,
       EXTRACT(YEAR FROM x.transaction_date)::int, EXTRACT(MONTH FROM x.transaction_date)::int,
       'commissioni_incasso'::text, round(sum(-x.amount), 2), 0::bigint
FROM (
  SELECT b.id, b.company_id, b.transaction_date, b.amount, min(c.outlet_id::text)::uuid AS outlet_id
  FROM banca b
  JOIN contratti c ON c.company_id = b.company_id
   AND ((c.mc IS NOT NULL AND position(c.mc IN b.d) > 0) OR (c.pc IS NOT NULL AND position(c.pc IN b.d) > 0))
  GROUP BY b.id, b.company_id, b.transaction_date, b.amount
  HAVING count(DISTINCT c.outlet_id) = 1
) x
LEFT JOIN ol o ON o.id = x.outlet_id
GROUP BY 1, 2, 3, 4, 5, 6, 7;

COMMENT ON VIEW public.v_costi_outlet_da_fatture IS
  'Costi per outlet/mese/gruppo: fatture passive sul negozio della singola fattura (v_negozio_fattura: classificazione a mano, poi outlet letto dal documento), altrimenti ripartite con le regole dei fornitori; personale e amministratori da v_personnel_gross_cost, spese di cassa delle chiusure (spese_cassa, solo kind spesa), commissioni Amex e Nexi addebitate in banca (commissioni_incasso). Sola lettura. outlet_id NULL = non assegnato. Esclusi TD16/17/18 e invoice_cost_flags. Migrazioni 285, 290, 291, 293, 294, 297, 306, 341.';

COMMIT;

-- Verifica, su ogni tenant:
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conname = 'outlet_daily_closing_expenses_kind_check';
-- SELECT count(*) FROM public.v_costi_outlet_da_fatture WHERE gruppo = 'spese_cassa';
