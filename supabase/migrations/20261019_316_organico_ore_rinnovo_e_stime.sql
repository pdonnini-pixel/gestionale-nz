-- =====================================================================
-- Migrazione 316 — Rinnovi con orario diverso, orari e fabbisogno stimati
-- =====================================================================
-- 1. Patrizio (19/10/2026): un rinnovo a tempo determinato, o il passaggio
--    a indeterminato, puo' portare piu' o meno ore. Il cambiamento ha gia'
--    la colonna ore_settimanali; qui la riconciliazione la controlla: una
--    proroga (o una trasformazione) con ore si chiude solo quando lo studio
--    riporta anche le ore.
-- 2. Orari e fabbisogno partivano vuoti. Si possono stimare dai dati
--    (chiusure di cassa: ora di chiusura e incasso per giorno della
--    settimana; ore di contratto del negozio). Una stima non e' una scelta
--    umana: la colonna origine la distingue ('stima' / 'manuale'), e il
--    salvataggio da una persona la rende 'manuale'.
--
-- NO DATA LOSS: solo ADD COLUMN (con default) e CREATE OR REPLACE FUNCTION.
-- REGOLA #0: NZ + Made + Zago. Rollback: _ROLLBACK.sql
-- =====================================================================

ALTER TABLE public.outlet_opening_hours
  ADD COLUMN IF NOT EXISTS origine text NOT NULL DEFAULT 'manuale'
  CHECK (origine IN ('manuale', 'stima'));
COMMENT ON COLUMN public.outlet_opening_hours.origine IS
  'manuale = inserito da una persona; stima = ricavato dalle chiusure di cassa (ora di chiusura), apertura standard 10:00. Una stima si sostituisce appena qualcuno salva.';

ALTER TABLE public.outlet_staffing_needs
  ADD COLUMN IF NOT EXISTS origine text NOT NULL DEFAULT 'manuale'
  CHECK (origine IN ('manuale', 'stima'));
COMMENT ON COLUMN public.outlet_staffing_needs.origine IS
  'manuale = deciso da Patrizio; stima = proposto dai dati (incasso per giorno della settimana e ore di contratto del negozio), da confermare.';

CREATE OR REPLACE FUNCTION public.organico_riconcilia()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_n integer := 0;
  v_k integer;
BEGIN
  IF v_company IS NULL OR NOT public.organico_puo_scrivere() THEN
    RETURN 0;
  END IF;
  UPDATE public.employee_events ev
     SET stato = 'confermato',
         esito_nota = 'Confermato dall''anagrafica allineata ai documenti dello studio paghe.',
         esito_il = now()
    FROM public.employees e
   WHERE ev.company_id = v_company
     AND ev.stato = 'da_confermare'
     AND e.id = ev.employee_id
     AND (
          (ev.tipo = 'cambio_orario' AND ev.ore_settimanali IS NOT NULL AND e.ore_settimanali = ev.ore_settimanali)
       OR (ev.tipo = 'proroga' AND ev.data_al IS NOT NULL AND e.scadenza_td = ev.data_al
             AND (ev.ore_settimanali IS NULL OR e.ore_settimanali = ev.ore_settimanali))
       OR (ev.tipo = 'trasformazione_indeterminato' AND e.contratto_tipo = 'indeterminato'
             AND (ev.ore_settimanali IS NULL OR e.ore_settimanali = ev.ore_settimanali))
       OR (ev.tipo IN ('cessazione', 'non_rinnovo') AND COALESCE(e.data_cessazione, e.termination_date) IS NOT NULL)
       OR (ev.tipo = 'cambio_negozio' AND ev.outlet_id IS NOT NULL AND e.outlet_id = ev.outlet_id)
     );
  GET DIAGNOSTICS v_k = ROW_COUNT;
  v_n := v_n + v_k;
  UPDATE public.employee_events ev
     SET stato = 'confermato',
         esito_nota = 'Confermato: lo studio paghe ha elaborato il cedolino.',
         esito_il = now()
   WHERE ev.company_id = v_company
     AND ev.stato = 'da_confermare'
     AND ev.tipo = 'assunzione'
     AND EXISTS (
       SELECT 1 FROM public.employee_cost_slips s
        WHERE s.employee_id = ev.employee_id
          AND make_date(s.year, s.month, 1) >= date_trunc('month', ev.data_dal)::date
     );
  GET DIAGNOSTICS v_k = ROW_COUNT;
  v_n := v_n + v_k;
  RETURN v_n;
END;
$$;
