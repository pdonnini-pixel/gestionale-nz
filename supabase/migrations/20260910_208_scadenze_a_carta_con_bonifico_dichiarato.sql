-- 20260910_208 — Scadenze aperte portate a carta mentre la fattura dichiarava altro
--
-- Conseguenza sui dati della 207. Su NZ sono le 11 fatture Amazon ancora aperte (371,22):
-- MP05 in fattura, cioe' bonifico, ma categoria «Acquisti on line» con addebito su carta,
-- quindi metodo carta e scadenza al 20 del mese dopo. Patrizio conferma che Amazon si paga
-- a bonifico, e in banca si vede: bonifici ad «Amazon Payments Europe» su tre conti, spesso
-- a saldo di piu' fatture insieme.
--
-- Le righe tornano al metodo dichiarato e alla scadenza che dice la fattura; dove la fattura
-- non porta una scadenza propria (e' il caso Amazon: `data_scadenza_pagamento` nullo) si
-- applica il piano del fornitore, che per Amazon e' fine mese 30 giorni in una rata. Le
-- scadenze passano quindi dal 20 del mese a fine mese (30/09 e 31/10). Importi e stato
-- invariati, verificato riga per riga contro il backup.
--
-- VA APPLICATA DOPO LA 207: altrimenti il trigger rimette la carta nella stessa transazione.
-- Backup in payables_backup_carta_20260910 + una riga di audit per scadenza.
-- Rollback in _ROLLBACK.sql

CREATE TABLE IF NOT EXISTS public.payables_backup_carta_20260910 AS
  SELECT p.*
    FROM public.payables p
    JOIN public.electronic_invoices ei ON ei.id = p.electronic_invoice_id
   WHERE coalesce(p.status::text, '') NOT IN ('pagato', 'annullato', 'nota_credito')
     AND coalesce(p.is_placeholder, false) = false
     AND p.payment_method::text IN ('carta_credito', 'carta_debito')
     AND coalesce(p.payment_method_code,
                  substring(ei.xml_content from '"modalita_pagamento":\s*"(MP[0-9]{2})"'),
                  substring(ei.xml_content from '<ModalitaPagamento>(MP[0-9]{2})<')) NOT IN ('MP08', 'MP01');
ALTER TABLE public.payables_backup_carta_20260910 ENABLE ROW LEVEL SECURITY;

WITH calc AS (
  SELECT b.id,
         coalesce(b.payment_method_code,
                  substring(ei.xml_content from '"modalita_pagamento":\s*"(MP[0-9]{2})"'),
                  substring(ei.xml_content from '<ModalitaPagamento>(MP[0-9]{2})<')) AS mp,
         coalesce(
           (SELECT min(due_date) FROM public.fn_parse_invoice_payments_json(
              CASE WHEN left(btrim(ei.xml_content), 1) = '{' THEN ei.xml_content::jsonb ELSE NULL END)),
           (SELECT due_date FROM public.fn_supplier_installment_schedule(
              b.invoice_date, s.payment_base, s.prima_scadenza_gg, 1, b.gross_amount) LIMIT 1),
           b.due_date) AS nuova_scadenza,
         s.default_payment_method::text AS sup_method
    FROM public.payables_backup_carta_20260910 b
    JOIN public.electronic_invoices ei ON ei.id = b.electronic_invoice_id
    LEFT JOIN public.suppliers s ON s.id = b.supplier_id
)
INSERT INTO public.payable_actions (payable_id, action_type, payment_method, old_due_date, new_due_date, note, performed_at, operator_name)
SELECT b.id, 'allineamento_metodo_fattura',
       public.fn_sdi_mp_to_payment_method(c.mp, c.sup_method),
       b.due_date, c.nuova_scadenza,
       'Metodo e scadenza riportati a quanto dichiara la fattura (' || c.mp || '): era '
         || b.payment_method::text || ' al ' || b.due_date,
       now(), 'sistema'
  FROM public.payables_backup_carta_20260910 b
  JOIN calc c ON c.id = b.id;

WITH calc AS (
  SELECT b.id,
         coalesce(b.payment_method_code,
                  substring(ei.xml_content from '"modalita_pagamento":\s*"(MP[0-9]{2})"'),
                  substring(ei.xml_content from '<ModalitaPagamento>(MP[0-9]{2})<')) AS mp,
         coalesce(
           (SELECT min(due_date) FROM public.fn_parse_invoice_payments_json(
              CASE WHEN left(btrim(ei.xml_content), 1) = '{' THEN ei.xml_content::jsonb ELSE NULL END)),
           (SELECT due_date FROM public.fn_supplier_installment_schedule(
              b.invoice_date, s.payment_base, s.prima_scadenza_gg, 1, b.gross_amount) LIMIT 1),
           b.due_date) AS nuova_scadenza,
         s.default_payment_method::text AS sup_method
    FROM public.payables_backup_carta_20260910 b
    JOIN public.electronic_invoices ei ON ei.id = b.electronic_invoice_id
    LEFT JOIN public.suppliers s ON s.id = b.supplier_id
)
UPDATE public.payables p SET
  payment_method       = public.fn_sdi_mp_to_payment_method(c.mp, c.sup_method),
  payment_method_code  = coalesce(p.payment_method_code, c.mp),
  payment_method_label = public.fn_sdi_mp_label(c.mp),
  is_auto_debit        = false,
  due_date             = c.nuova_scadenza,
  updated_at           = now()
FROM calc c
WHERE p.id = c.id;

-- VERIFICA (deve tornare 0): scadenze aperte ancora a carta con un MP diverso da MP08/MP01
-- SELECT count(*) FROM public.payables p
--   JOIN public.electronic_invoices ei ON ei.id = p.electronic_invoice_id
--  WHERE coalesce(p.status::text,'') NOT IN ('pagato','annullato','nota_credito')
--    AND coalesce(p.is_placeholder,false) = false
--    AND p.payment_method::text IN ('carta_credito','carta_debito')
--    AND coalesce(p.payment_method_code,
--                 substring(ei.xml_content from '"modalita_pagamento":\s*"(MP[0-9]{2})"'),
--                 substring(ei.xml_content from '<ModalitaPagamento>(MP[0-9]{2})<')) NOT IN ('MP08','MP01');
