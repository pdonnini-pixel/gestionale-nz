-- NZ_ONLY Migrazione 282 — Altomugello a Barberino, MCA a Franciacorta (12/10/2026)
--
-- 1. ALTOMUGELLO SRL (P.IVA 00542820485): le righe delle fatture dicono
--    «Soggiorno presso Hotel Barberino». Deciso da Patrizio: Barberino.
--    La regola a mano «Diretto» alla sede si disattiva (non si cancella) e se ne
--    scrive una nuova, anch'essa a mano (non «Automatica:»), che il riparto
--    notturno non tocca.
-- 2. MCA SRL, Romano di Lombardia (BG): pernottamenti per Franciacorta. Deciso
--    da Patrizio: si aggiunge «romano di lombardia» ai luoghi di Franciacorta
--    (outlet_travel_places); il riparto notturno lo assegna da sé.

UPDATE public.supplier_allocation_rules r SET is_active = false, updated_at = now()
FROM public.suppliers s
WHERE r.supplier_id = s.id AND r.is_active
  AND s.vat_number = '00542820485' AND r.description = 'Diretto';

WITH ins AS (
  INSERT INTO public.supplier_allocation_rules (company_id, supplier_id, allocation_mode, description, is_active)
  SELECT s.company_id, s.id, 'DIRETTO',
         'Diretto a Barberino: Hotel Barberino (deciso da Patrizio il 12/10/2026, migrazione 282)', true
  FROM public.suppliers s
  WHERE s.vat_number = '00542820485'
    AND NOT EXISTS (SELECT 1 FROM public.supplier_allocation_rules r WHERE r.supplier_id = s.id AND r.is_active)
  RETURNING id, company_id
)
INSERT INTO public.supplier_allocation_details (rule_id, outlet_id, percentage)
SELECT ins.id, o.id, 100
FROM ins JOIN public.outlets o ON o.company_id = ins.company_id AND o.cost_center_key = 'barberino' AND o.is_active;

INSERT INTO public.outlet_travel_places (company_id, outlet_id, kind, place, note)
SELECT o.company_id, o.id, 'comune', 'romano di lombardia', 'MCA, pernottamenti (deciso da Patrizio il 12/10/2026, migrazione 282)'
FROM public.outlets o WHERE o.cost_center_key = 'franciacorta' AND o.is_active
ON CONFLICT (company_id, kind, place) DO NOTHING;
