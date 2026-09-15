-- 20260911_215 — Ogni rata dichiara quante sono
--
-- PERCHE'
-- Nello Scadenzario due rate della stessa fattura che cadono lo stesso giorno
-- sembrano un doppione: la riga non dice "1 di 3", dice solo "rata 1" oppure
-- niente. E' successo con TANESINI 8/1789 (due righe al 30/09, in realta' le
-- due rate dichiarate dalla fattura: RIBA 31/08 e RIBA 30/09) e con le fatture
-- SHINE di giugno, dove la prima rata e' slittata al 30/09 accanto alla
-- seconda. Nessuna delle due era un doppione. Il difetto e' che il piano non
-- si dichiara.
--
-- Al 11/09/2026 su NZ: 76 righe, 4 fornitori (SHINE 36, MIAN 24, GRUPPO FB 15,
-- e un caso singolo TANESINI) senza installment_total; 44 anche senza metodo.
--
-- COSA FA
-- Per ogni fattura con piu' rate vive (niente placeholder, niente annullate):
--   * installment_total  <- numero di rate vive, SOLO se vuoto
--   * installment_number <- posizione per scadenza, SOLO se vuoto o fuori scala
--                           E SOLO se quel numero non e' gia' preso da un'altra
--                           riga della stessa fattura (vincolo unico su
--                           company+fornitore+numero+rata, righe nascoste comprese)
--   * payment_method     <- lo scaglione RiBa che segue quello della prima rata
--                           (riba_60 -> riba_90 -> riba_120, cap a 120), SOLO se vuoto
--
-- REGOLA NO DATA LOSS: solo UPDATE, solo su campi vuoti o palesemente
-- incoerenti (rata 3 su un piano da 2). Nessuna data toccata, nessuna riga
-- cancellata, nessun valore inserito a mano sovrascritto.

BEGIN;

WITH gruppi AS (
  SELECT p.id, p.company_id, p.due_date, p.installment_number, p.installment_total, p.payment_method,
         -- una fattura = una chiave: l'id della fattura elettronica quando c'e',
         -- altrimenti fornitore + numero + data.
         coalesce(
           p.electronic_invoice_id::text,
           p.supplier_id::text || '|' || coalesce(p.invoice_number, '') || '|' || coalesce(p.invoice_date::text, '')
         ) AS chiave
  FROM public.payables p
  WHERE coalesce(p.is_placeholder, false) = false
    AND p.status <> 'annullato'
    AND p.supplier_id IS NOT NULL
),
ordinate AS (
  SELECT g.*,
         row_number() OVER (PARTITION BY g.company_id, g.chiave
                            ORDER BY g.due_date NULLS LAST, g.installment_number NULLS LAST, g.id) AS rata,
         count(*)     OVER (PARTITION BY g.company_id, g.chiave) AS rate_totali
  FROM gruppi g
),
capofila AS (
  -- il metodo della prima rata da' lo scaglione di partenza per le successive
  SELECT company_id, chiave, max(payment_method::text) FILTER (WHERE rata = 1) AS metodo_prima
  FROM ordinate GROUP BY company_id, chiave
)
UPDATE public.payables p
SET installment_total  = coalesce(p.installment_total, o.rate_totali),
    installment_number = CASE
                           WHEN (p.installment_number IS NULL OR p.installment_number > o.rate_totali)
                             -- il posto deve essere libero: payables ha un unico
                             -- (company, fornitore, numero fattura, rata) e conta
                             -- anche le righe nascoste (doppioni gia' messi da parte).
                             AND NOT EXISTS (
                               SELECT 1 FROM public.payables q
                                WHERE q.company_id = p.company_id
                                  AND q.supplier_id = p.supplier_id
                                  AND q.invoice_number IS NOT DISTINCT FROM p.invoice_number
                                  AND q.installment_number = o.rata
                                  AND q.id <> p.id
                             )
                           THEN o.rata
                           ELSE p.installment_number
                         END,
    payment_method     = CASE
                           WHEN p.payment_method IS NOT NULL THEN p.payment_method
                           WHEN left(c.metodo_prima, 5) = 'riba_' THEN
                             (CASE least(120, (split_part(c.metodo_prima, '_', 2))::int + 30 * (o.rata - 1))
                                WHEN 30  THEN 'riba_30'
                                WHEN 60  THEN 'riba_60'
                                WHEN 90  THEN 'riba_90'
                                ELSE          'riba_120'
                              END)::payment_method
                           ELSE c.metodo_prima::payment_method
                         END,
    updated_at = now()
FROM ordinate o
JOIN capofila c ON c.company_id = o.company_id AND c.chiave = o.chiave
WHERE p.id = o.id
  AND o.rate_totali > 1
  AND (p.installment_total IS NULL
       OR p.installment_number IS NULL
       OR p.installment_number > o.rate_totali
       OR p.payment_method IS NULL);

COMMIT;

-- VERIFICA (deve dare 0)
-- WITH g AS (
--   SELECT p.id, p.company_id, p.installment_total,
--          coalesce(p.electronic_invoice_id::text,
--                   p.supplier_id::text||'|'||coalesce(p.invoice_number,'')||'|'||coalesce(p.invoice_date::text,'')) AS chiave
--   FROM public.payables p
--   WHERE coalesce(p.is_placeholder,false)=false AND p.status <> 'annullato' AND p.supplier_id IS NOT NULL
-- )
-- SELECT count(*) FROM (
--   SELECT id, installment_total, count(*) OVER (PARTITION BY company_id, chiave) AS n FROM g
-- ) x WHERE n > 1 AND installment_total IS NULL;
