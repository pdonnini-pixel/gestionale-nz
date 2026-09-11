-- 20260911_217 — L'ultima rata quadra il totale della fattura
--
-- PERCHE'
-- Dividendo un importo in tre parti uguali resta un centesimo per strada.
-- La guida dello Scadenzario dice gia' che "l'ultima quadra il totale", ma il
-- piano generato non lo faceva sempre: al 11/09/2026 su NZ quattro fatture a
-- rate sommavano un centesimo in meno (o in piu') del documento — GRUPPO FB
-- 3797, MIAN 680, MIAN 697, SHINE 1103/26.
--
-- Un centesimo non sposta niente in bilancio, ma fa fallire i controlli che
-- confrontano al centesimo: la verifica degli importi quando si carica una
-- distinta Ri.Ba., e il confronto con l'elenco delle scadenze della banca.
-- E' successo proprio l'11/09 confrontando le Ri.Ba. del 30/09 di Shine.
--
-- COSA FA
-- Sposta la differenza sull'ULTIMA rata ancora aperta, e solo se:
--   * la fattura ha piu' di una rata viva;
--   * lo scarto e' sotto 1 euro, cioe' e' un arrotondamento e non un importo
--     sbagliato (uno scarto grosso e' un problema diverso e va guardato a mano);
--   * esiste almeno una rata non pagata su cui appoggiarlo.
-- Le rate gia' pagate non si toccano mai: cambiarle romperebbe la
-- riconciliazione bancaria.
--
-- ATTENZIONE AL SEGNO: in electronic_invoices il totale di una nota di credito
-- e' memorizzato POSITIVO, mentre le sue rate in payables sono NEGATIVE. Il
-- confronto va fatto sul valore assoluto, altrimenti ogni nota di credito
-- sembra sbagliata del doppio del suo importo (21 falsi positivi su 24).

BEGIN;

WITH somme AS (
  SELECT p.electronic_invoice_id AS eid,
         sum(p.gross_amount) AS somma_rate
  FROM public.payables p
  WHERE coalesce(p.is_placeholder, false) = false
    AND p.status <> 'annullato'
    AND p.electronic_invoice_id IS NOT NULL
  GROUP BY 1
  HAVING count(*) > 1
),
scarti AS (
  SELECT s.eid,
         round(sign(s.somma_rate) * abs(ei.gross_amount) - s.somma_rate, 2) AS delta
  FROM somme s
  JOIN public.electronic_invoices ei ON ei.id = s.eid
  WHERE abs(sign(s.somma_rate) * abs(ei.gross_amount) - s.somma_rate) >= 0.01
    AND abs(sign(s.somma_rate) * abs(ei.gross_amount) - s.somma_rate) <  1
),
bersaglio AS (
  -- l'ultima rata ancora aperta di ogni fattura da correggere
  SELECT DISTINCT ON (p.electronic_invoice_id)
         p.id, sc.delta
  FROM public.payables p
  JOIN scarti sc ON sc.eid = p.electronic_invoice_id
  WHERE coalesce(p.is_placeholder, false) = false
    AND p.status NOT IN ('pagato', 'annullato')
  ORDER BY p.electronic_invoice_id, p.due_date DESC, p.installment_number DESC, p.id
)
UPDATE public.payables p
SET gross_amount = p.gross_amount + b.delta,
    amount_remaining = CASE
                         WHEN coalesce(p.amount_paid, 0) = 0 THEN p.gross_amount + b.delta
                         ELSE p.amount_remaining + b.delta
                       END,
    notes = coalesce(p.notes || ' | ', '') || 'Ultima rata portata a quadrare il totale della fattura (arrotondamento di ' || to_char(b.delta, 'FM990D00') || ' euro sulla divisione in rate), 11/09/2026.',
    updated_at = now()
FROM bersaglio b
WHERE p.id = b.id;

COMMIT;

-- VERIFICA (deve dare 0)
-- WITH s AS (
--   SELECT electronic_invoice_id AS eid, sum(gross_amount) AS r FROM public.payables
--    WHERE coalesce(is_placeholder,false)=false AND status <> 'annullato' AND electronic_invoice_id IS NOT NULL
--    GROUP BY 1 HAVING count(*) > 1)
-- SELECT count(*) FROM s JOIN public.electronic_invoices ei ON ei.id = s.eid
--  WHERE abs(sign(s.r)*abs(ei.gross_amount) - s.r) >= 0.01
--    AND abs(sign(s.r)*abs(ei.gross_amount) - s.r) < 1;
