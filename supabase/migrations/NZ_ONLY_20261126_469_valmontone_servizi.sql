-- =====================================================================
-- NZ_ONLY 469 · Valmontone: scarico merce e pulizie (Patrizio, 26/11/2026)
-- =====================================================================
-- PERCHE': Valmontone riceve la merce il martedì, la consegna arriva all'apertura (10:00) e
-- per lo scarico servono due persone per due ore. Il lunedì e il venerdì il negozio apre alle 9
-- per le pulizie (lavoro vero, non vendita). L'8/12/2026 (Immacolata) nessuna persona serve per
-- la consegna: chi consegna ha le chiavi ed è esterno al personale del negozio.
-- ORDINE: dopo la 468 (tabelle). Solo NZ: Valmontone è un negozio di New Zago.
-- NO DATA LOSS: solo INSERT in tabelle nuove e vuote. ROLLBACK: _ROLLBACK.
-- =====================================================================

BEGIN;

INSERT INTO public.outlet_servizi (company_id, outlet_id, tipo, giorno, dalle, alle, persone)
SELECT o.company_id, o.id, v.tipo, v.giorno, v.dalle::time, v.alle::time, v.persone
  FROM public.outlets o
  CROSS JOIN (VALUES ('scarico', 2, '10:00', '12:00', 2),
                     ('pulizie', 1, '09:00', '10:00', 1),
                     ('pulizie', 5, '09:00', '10:00', 1)) AS v(tipo, giorno, dalle, alle, persone)
 WHERE o.id = '8dcb3b9f-c5ba-4213-93ac-839adcbafd03'   -- VALMONTONE
ON CONFLICT (outlet_id, tipo, giorno) DO NOTHING;

INSERT INTO public.outlet_consegne (company_id, outlet_id, data, annullata, nota)
SELECT o.company_id, o.id, DATE '2026-12-08', true, 'Immacolata: chi consegna ha le chiavi, non serve personale'
  FROM public.outlets o WHERE o.id = '8dcb3b9f-c5ba-4213-93ac-839adcbafd03'
ON CONFLICT (outlet_id, data) DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.outlet_servizi WHERE outlet_id = '8dcb3b9f-c5ba-4213-93ac-839adcbafd03') <> 3 THEN
    RAISE EXCEPTION '469: i servizi di Valmontone non sono tre';
  END IF;
END $$;

COMMIT;

-- Verifica:
--   SELECT tipo, giorno, dalle, alle, persone FROM public.outlet_servizi WHERE outlet_id = '8dcb3b9f-c5ba-4213-93ac-839adcbafd03';
--   SELECT data, annullata, nota FROM public.outlet_consegne WHERE outlet_id = '8dcb3b9f-c5ba-4213-93ac-839adcbafd03';
