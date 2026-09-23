-- =====================================================================
-- NZ_ONLY 253 — Tre correzioni all'anagrafica, confermate dallo studio
-- =====================================================================
-- SOLO NEW ZAGO: sono dati di tre persone di NZ, non una modifica di
-- schema. Non si applica a Made ne' a Zago (eccezione documentata alla
-- REGOLA #0).
--
-- DA DOVE ARRIVANO: mail di Francesca Signorini (studio paghe) del
-- 23/09/2026, in risposta alle differenze trovate sul tabulato di agosto.
--   1. Bularca Ramona: cessata il 30/06/2026;
--   2. Niccoli Giuditta: cessata il 30/07/2026;
--   3. Sestini Mattia: doppio rapporto. Dal 03/06 al 19/06 a chiamata,
--      dal 22/06 tempo determinato part time. L'anagrafica teneva ancora
--      il primo rapporto.
--
-- LE MATRICOLE NON SI POSSONO ALLINEARE, e ora sappiamo perche': lo
-- studio le assegna in automatico, in ordine cronologico di assunzione, e
-- non puo' cambiarle. Un secondo rapporto prende una matricola nuova:
-- Sestini per noi era 0000087 (primo rapporto), per le paghe e' 0000092.
-- Ecco spiegati i 5 nominativi su 42 che non tornavano per matricola, e
-- perche' l'aggancio per nome + data di assunzione resta la strada buona.
-- La matricola vecchia non si perde: resta in employee_matricole, che
-- serve esattamente a questo.
--
-- LE DUE CESSAZIONI ERANO GIA' NEL TABULATO. Il documento di agosto le
-- portava scritte riga per riga, il lettore le ha salvate in
-- leave_accrual_rows.data_cessazione, e nessuno le ha usate per
-- aggiornare l'anagrafica. Da qui in avanti non serve piu' chiederlo a
-- nessuno: il caricamento del tabulato le applica da solo (vedi
-- RateiFerieImport).
--
-- NO DATA LOSS: nessuna riga cancellata. Le due persone restano in
-- archivio fra le cessate, con tutta la loro storia, e si riattivano
-- dall'interfaccia se serve. Il valore precedente di ogni campo e'
-- scritto qui sotto, cosi' il ripristino e' una copia e incolla.
--
-- COM'ERA PRIMA (backup del 23/09/2026, letto da employees):
--   BULARCA RAMONA   a81def2e-624e-4e3d-ab29-c2b45ebc1e0f
--     is_active = true, data_cessazione = NULL, termination_date = NULL
--   NICCOLI GIUDITTA f05bd5a5-a437-4818-9e2c-6c35274d1720
--     is_active = true, data_cessazione = NULL, termination_date = NULL
--   SESTINI MATTIA   fb1331f1-a6e8-4708-874a-5ceb462adfcf
--     data_assunzione = 2026-06-03, hire_date = 2026-06-03,
--     matricola = 0000087, contratto_tipo = 'a_chiamata',
--     scadenza_td = 2026-06-19, part_time_pct = NULL
--   employee_matricole: una sola riga, 0000087, is_current = true
-- =====================================================================

BEGIN;

-- 1. Bularca Ramona, cessata il 30/06/2026
UPDATE public.employees
   SET data_cessazione  = DATE '2026-06-30',
       termination_date = DATE '2026-06-30',
       is_active        = false,
       note             = concat_ws(' ', note, '[23/09/2026] Cessazione confermata dallo studio paghe.')
 WHERE id = 'a81def2e-624e-4e3d-ab29-c2b45ebc1e0f';

-- 2. Niccoli Giuditta, cessata il 30/07/2026
UPDATE public.employees
   SET data_cessazione  = DATE '2026-07-30',
       termination_date = DATE '2026-07-30',
       is_active        = false,
       note             = concat_ws(' ', note, '[23/09/2026] Cessazione confermata dallo studio paghe.')
 WHERE id = 'f05bd5a5-a437-4818-9e2c-6c35274d1720';

-- 3. Sestini Mattia: vale il secondo rapporto, quello ancora aperto.
--    part_time_pct = 70 perche' 28 ore su 40 (dato ricavato, non chiesto).
--    scadenza_td va a NULL: quella vecchia (19/06) era la fine del primo
--    rapporto, e la scadenza del nuovo determinato non la sappiamo ancora.
UPDATE public.employees
   SET data_assunzione = DATE '2026-06-22',
       hire_date       = DATE '2026-06-22',
       matricola       = '0000092',
       contratto_tipo  = 'determinato',
       part_time_pct   = 70,
       scadenza_td     = NULL,
       stato_td        = NULL,
       note            = concat_ws(' ', note,
         '[23/09/2026] Doppio rapporto: a chiamata dal 03/06 al 19/06, determinato part time dal 22/06 (studio paghe). Matricola del primo rapporto: 0000087.')
 WHERE id = 'fb1331f1-a6e8-4708-874a-5ceb462adfcf';

-- La matricola del primo rapporto resta, marcata come non piu' corrente.
UPDATE public.employee_matricole
   SET is_current = false,
       valid_to   = DATE '2026-06-19',
       note       = concat_ws(' ', note, 'Primo rapporto, a chiamata, chiuso il 19/06/2026.')
 WHERE employee_id = 'fb1331f1-a6e8-4708-874a-5ceb462adfcf'
   AND matricola = '0000087';

INSERT INTO public.employee_matricole (company_id, employee_id, matricola, is_current, valid_from, note)
SELECT e.company_id, e.id, '0000092', true, DATE '2026-06-22',
       'Secondo rapporto, determinato part time. Le matricole dello studio sono automatiche e cronologiche: un nuovo rapporto ne prende una nuova.'
  FROM public.employees e
 WHERE e.id = 'fb1331f1-a6e8-4708-874a-5ceb462adfcf'
   AND NOT EXISTS (
     SELECT 1 FROM public.employee_matricole m
      WHERE m.employee_id = e.id AND m.matricola = '0000092'
   );

COMMIT;

-- VERIFICA:
--   SELECT cognome, nome, matricola, data_assunzione, data_cessazione, is_active
--     FROM public.employees
--    WHERE id IN ('a81def2e-624e-4e3d-ab29-c2b45ebc1e0f',
--                 'f05bd5a5-a437-4818-9e2c-6c35274d1720',
--                 'fb1331f1-a6e8-4708-874a-5ceb462adfcf');
--   SELECT matricola, is_current, valid_from, valid_to
--     FROM public.employee_matricole
--    WHERE employee_id = 'fb1331f1-a6e8-4708-874a-5ceb462adfcf' ORDER BY valid_from;
