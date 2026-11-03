-- NZ_ONLY_20261102_336 — Ripartizione per chi e' entrato da «Organico di oggi»
--
-- Patrizio, 02/11/2026: «nessuno deve restare mai senza un outlet
-- assegnato in New Zago». Le 6 persone aggiunte da Organico prima della
-- 335 avevano il negozio nella scheda ma nessuna ripartizione, e in
-- Dipendenti stavano in «Senza sede». Fotografia prima del recupero:
--   ANGELINI TANIA            ROMA SORATTE  dal 03/11/2026
--   BASILE LETIZIA            ROMA SORATTE  dal 02/11/2026
--   BIANCHI MARTINA           ROMA SORATTE  dal 02/11/2026
--   GENTILI MARIA             ROMA SORATTE  dal 02/11/2026
--   URBANETTI ROBERTA         ROMA SORATTE  dal 02/11/2026
--   CAPRIOLI PAGANINI ANITA   BRUGNATO      dal 15/10/2026
-- Ognuna riceve la ripartizione al 100% sul negozio della propria scheda.
-- Solo inserimenti, nessun dato esistente cambia. Nessuna ha cedolini:
-- nessun costo gia' registrato cambia negozio.
-- Solo NZ: Made non ha dipendenti; Zago ha 12 persone senza ripartizione,
-- da decidere a parte (i costi del personale di Zago cambierebbero negozio).

INSERT INTO public.employee_outlet_allocations
  (employee_id, company_id, outlet_code, allocation_pct, is_primary, valid_from)
SELECT e.id, e.company_id, o.name, 100, true, COALESCE(e.data_assunzione, e.hire_date, CURRENT_DATE)
  FROM public.employees e
  JOIN public.outlets o ON o.id = e.outlet_id AND o.company_id = e.company_id
 WHERE e.is_active
   AND NOT EXISTS (SELECT 1 FROM public.employee_outlet_allocations a WHERE a.employee_id = e.id);
