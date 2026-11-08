-- =====================================================================
-- NZ_ONLY 369 — Il dipendente di prova a Roma Soratte (solo New Zago)
-- =====================================================================
-- Patrizio (08/11/2026): un «Dipendente Demo» per provare l'app New Zago
-- e per la revisione di Apple e Google. Con la migration 368 non si vede
-- nel gestionale e non conta da nessuna parte.
-- Crea: la persona (is_demo = true) e due settimane di turni inventati
-- (09-22/11/2026, dal lunedi' al sabato 10:00-19:00 con un'ora di pausa,
-- domenica libera). Il codice di attivazione lo crea il trigger
-- trg_employees_accesso_app.
-- Idempotente: se il dipendente di prova esiste gia', non fa niente.
-- Toglierlo: UPDATE public.employees SET is_active = false WHERE is_demo;
-- =====================================================================

BEGIN;

DO $$
DECLARE
  v_outlet  uuid;
  v_company uuid;
  v_emp     uuid;
  g         date;
BEGIN
  IF EXISTS (SELECT 1 FROM public.employees WHERE is_demo) THEN
    RAISE NOTICE 'Dipendente di prova gia'' presente: niente da fare';
    RETURN;
  END IF;

  SELECT o.id, o.company_id INTO v_outlet, v_company FROM public.outlets o WHERE o.code = 'RSO';
  IF v_outlet IS NULL THEN
    RAISE EXCEPTION 'Negozio RSO (Roma Soratte) non trovato';
  END IF;

  INSERT INTO public.employees
    (company_id, outlet_id, first_name, last_name, nome, cognome, is_active, is_demo,
     contratto_tipo, ore_settimanali, ore_settimanali_paghe, data_assunzione, qualifica, note)
  VALUES
    (v_company, v_outlet, 'Demo', 'New Zago', 'Demo', 'New Zago', true, true,
     'indeterminato', 40, 40, DATE '2026-11-01', 'Addetta vendite (prova)',
     '08/11/2026: dipendente di prova per l''app New Zago e la revisione degli store (migration 368-369). Non e'' una persona vera.')
  RETURNING id INTO v_emp;

  FOR g IN SELECT generate_series(DATE '2026-11-09', DATE '2026-11-22', interval '1 day')::date LOOP
    IF extract(isodow FROM g) <> 7 THEN
      INSERT INTO public.shifts (company_id, outlet_id, employee_id, data, inizio, fine, pausa_minuti, origine, stato, nota)
      VALUES (v_company, v_outlet, v_emp, g, TIME '10:00', TIME '19:00', 60, 'manuale', 'pubblicato', 'Turno di prova (app New Zago)');
    END IF;
  END LOOP;
END;
$$;

COMMIT;

-- Verifica:
-- SELECT e.id, e.is_demo, (SELECT count(*) FROM public.shifts s WHERE s.employee_id = e.id) AS turni,
--        (SELECT a.codice IS NOT NULL FROM public.employee_app_access a WHERE a.employee_id = e.id) AS codice
--   FROM public.employees e WHERE e.is_demo;   -- 1 riga, 12 turni, codice true
