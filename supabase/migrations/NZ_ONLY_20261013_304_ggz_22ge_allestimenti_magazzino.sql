-- NZ_ONLY 304 — GGZ 22/GE negli allestimenti del magazzino (13/10/2026)
--
-- Deciso da Patrizio il 13/10/2026: la fattura GGZ 22/GE del 14/05/2026
-- (scaffalatura per appenderia del magazzino di Pian di Rona 1.400,00 +
-- 2 tecnici a ore 320,00) è attrezzatura del magazzino, non merce.
-- Classificazione della singola fattura (invoice_cost_overrides, migrazione 291):
-- outlet sede/magazzino al 100%, gruppo allestimenti. Le altre fatture GGZ
-- restano merce. Fornitore per P.IVA, outlet della sede dal ruolo 'hq'.
-- Rollback: DELETE FROM invoice_cost_overrides WHERE invoice_id = <id di 22/GE>
--           (riga creata qui, nessun dato preesistente).

INSERT INTO public.invoice_cost_overrides (invoice_id, company_id, outlet_id, gruppo, note)
SELECT DISTINCT e.id, e.company_id, o.id, 'allestimenti',
       'GGZ 22/GE: scaffalatura per appenderia e montaggio, magazzino Pian di Rona (deciso da Patrizio il 13/10/2026)'
  FROM public.electronic_invoices e
  JOIN public.payables p ON p.electronic_invoice_id = e.id
  JOIN public.suppliers s ON s.id = p.supplier_id AND s.partita_iva = '01767000282'
  JOIN public.cost_centers cc ON cc.company_id = e.company_id AND cc.role = 'hq'
  JOIN public.outlets o ON o.company_id = e.company_id AND o.cost_center_key = cc.code AND o.is_active
 WHERE e.company_id = '00000000-0000-0000-0000-000000000001'
   AND e.invoice_number = '22/GE'
ON CONFLICT (invoice_id) DO NOTHING;
