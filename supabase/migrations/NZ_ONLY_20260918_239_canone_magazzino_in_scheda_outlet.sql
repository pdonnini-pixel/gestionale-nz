-- ─────────────────────────────────────────────────────────────────────────────
-- NZ_ONLY 20260918_239 — Canone del magazzino anche nella scheda outlet.
--
-- La 238 aveva lasciato vuoto `outlets.rent_monthly` di SED apposta: il Cashflow
-- sommava il canone della scheda e quello delle ricorrenze senza confrontarli, e
-- il magazzino sarebbe uscito di cassa due volte (com'è successo a Roma Soratte).
-- Ora la regola è nel codice (`src/lib/cashflowRent.ts`): quando un centro di
-- costo ha un costo ricorrente attivo di categoria «Locazione outlet», il
-- cashflow prende quello e lascia da parte il canone della scheda.
--
-- Il campo può quindi tornare al suo valore vero, 2.500 € al mese al netto
-- dell'IVA, come per tutti gli altri punti vendita: serve alla scheda outlet
-- («Canone mensile», «Canone annuo») e ai margini di categoria, che ragionano
-- di costo e non di cassa.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE
  v_company uuid;
  v_outlet  uuid;
BEGIN
  SELECT id INTO v_company FROM public.companies WHERE vat_number = '07362100484' LIMIT 1;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Azienda New Zago (P.IVA 07362100484) non trovata: migration solo NZ';
  END IF;

  SELECT id INTO v_outlet FROM public.outlets WHERE company_id = v_company AND code = 'SED' LIMIT 1;
  IF v_outlet IS NULL THEN
    RAISE EXCEPTION 'Outlet SEDE / MAGAZZINO (SED) non trovato';
  END IF;

  UPDATE public.outlets SET
    rent_monthly = COALESCE(rent_monthly, 2500),
    -- 30.000 € l'anno su 805,3 mq.
    rent_per_sqm = COALESCE(rent_per_sqm, 37.25),
    notes = replace(
      notes,
      'Il campo «canone mensile» della scheda resta vuoto di proposito: il canone è registrato come costo ricorrente (Scadenzario → Ricorrenze), altrimenti il Cashflow lo conterebbe due volte.',
      'Il canone è scritto sia qui (2.500 €/mese, al netto dell''IVA) sia come costo ricorrente in Scadenzario → Ricorrenze (3.050 € lordi). Il Cashflow ne conta uno solo: quando un centro di costo ha una ricorrenza di categoria «Locazione outlet», prende quella e lascia da parte il canone della scheda.'
    ),
    updated_at = now()
  WHERE id = v_outlet;
END $$;

COMMIT;

-- ── Verifica (attesa: 2500,00 e nessuna frase «resta vuoto di proposito») ─
-- SELECT rent_monthly, rent_per_sqm, notes LIKE '%resta vuoto di proposito%' AS frase_vecchia
--   FROM outlets WHERE code = 'SED';
