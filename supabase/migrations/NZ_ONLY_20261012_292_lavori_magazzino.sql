-- NZ_ONLY Migrazione 292 — lavori del magazzino di Pian di Rona (12/10/2026)
--
-- Deciso da Patrizio il 12/10/2026: i lavori del magazzino vanno fra gli
-- allestimenti, il resto del magazzino resta in sede. Fatture lette riga per
-- riga (le autofatture TD16 di integrazione IVA sono già escluse dalla vista).
-- Allestimenti sede/magazzino (cantiere feb-lug 2026): 26.459,75 €.
-- Per fattura, perché Marco Ghezzi lavora anche ai negozi.

INSERT INTO public.invoice_cost_overrides (invoice_id, company_id, outlet_id, gruppo, note)
SELECT e.id, e.company_id, o.id, x.gruppo, x.nota
FROM (VALUES
  ('1606e038-1efc-4317-9a1a-bccd6552da57'::uuid, 'sede_magazzino', 'allestimenti', 'Iosub n.8: scaffali e montaggio, magazzino'),
  ('a84dd632-2c83-4276-b318-f19be959ad3b'::uuid, 'sede_magazzino', 'allestimenti', 'Iosub n.9: cartongesso capannone'),
  ('d8197816-9f5c-4258-9c80-25e1b09621b7'::uuid, 'sede_magazzino', 'allestimenti', 'Iosub n.18: saldo lavori magazzino'),
  ('fa2e007e-d586-44e1-ae4d-5c577c0331b6'::uuid, 'sede_magazzino', 'allestimenti', 'Ghezzi n.43: acconto impianto uffici, bagni, illuminazione magazzino'),
  ('5afa5b84-41b3-43f1-bb0f-18437fefa041'::uuid, 'sede_magazzino', 'allestimenti', 'Ghezzi n.59: saldo impianto uffici, bagni, illuminazione magazzino'),
  ('a1efa84b-bcb1-4233-9f43-a100f5110d85'::uuid, 'sede_magazzino', 'allestimenti', 'Andreoni FPR 28/26: pratica CILA capannone'),
  ('4033f393-ee20-4caa-ae3f-22924bf2cb08'::uuid, 'sede_magazzino', 'allestimenti', 'Marchetti n.24: piano di sicurezza opere'),
  ('fc99d5cc-9068-42bd-903e-dd7a00cd8063'::uuid, 'sede_magazzino', 'allestimenti', 'Rocciola n.26: progetto impianto elettrico e rischio incendio'),
  ('6d69bc37-6bc2-485a-ba0b-fd668cc1a81e'::uuid, 'sede_magazzino', NULL,           'Ghezzi n.92: manutenzione impianto capannone, costo corrente della sede'),
  ('85c22bda-62c6-48e3-a288-968fa1fd7102'::uuid, 'barberino',      NULL,           'Ghezzi n.93: barriera lama d''aria negozio Barberino')
) AS x(invoice_id, cc_key, gruppo, nota)
JOIN public.electronic_invoices e ON e.id = x.invoice_id
JOIN public.outlets o ON o.company_id = e.company_id AND o.cost_center_key = x.cc_key AND o.is_active
ON CONFLICT (invoice_id) DO NOTHING;
