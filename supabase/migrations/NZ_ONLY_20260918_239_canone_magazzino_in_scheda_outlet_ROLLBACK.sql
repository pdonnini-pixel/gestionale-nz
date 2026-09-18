-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK della NZ_ONLY 20260918_239: il canone torna fuori dalla scheda del
-- magazzino. Da usare solo se si torna indietro anche sul codice della
-- deduplica (src/lib/cashflowRent.ts), altrimenti il Cashflow riprende a
-- contare l'affitto due volte.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

UPDATE public.outlets o SET
  rent_monthly = NULL,
  rent_per_sqm = NULL,
  notes = replace(
    o.notes,
    'Il canone è scritto sia qui (2.500 €/mese, al netto dell''IVA) sia come costo ricorrente in Scadenzario → Ricorrenze (3.050 € lordi). Il Cashflow ne conta uno solo: quando un centro di costo ha una ricorrenza di categoria «Locazione outlet», prende quella e lascia da parte il canone della scheda.',
    'Il campo «canone mensile» della scheda resta vuoto di proposito: il canone è registrato come costo ricorrente (Scadenzario → Ricorrenze), altrimenti il Cashflow lo conterebbe due volte.'
  ),
  updated_at = now()
FROM public.companies c
WHERE c.id = o.company_id AND c.vat_number = '07362100484' AND o.code = 'SED';

COMMIT;
