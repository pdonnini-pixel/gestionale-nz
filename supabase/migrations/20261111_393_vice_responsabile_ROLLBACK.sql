-- ROLLBACK 393 — toglie il blocco del lunedi' e la RPC della vice.
--
-- Toglie SOLO il codice (trigger e funzioni): da subito le ferie tornano a
-- salvarsi come prima della 393.
--
-- NON si eliminano qui, perche' contengono dati veri (regola NO DATA LOSS):
--   * la colonna outlets.vice_referente_employee_id (le vice scelte);
--   * il vincolo outlets_vice_diversa_da_responsabile;
--   * la tabella outlet_vice_storico e il suo trigger «niente si cancella».
-- Restando li' non danno fastidio a nessuno: senza le funzioni nessuno le
-- legge per bloccare qualcosa. Se vanno tolte davvero, prima un backup
-- (SELECT * di outlets e di outlet_vice_storico) e la conferma di Patrizio.
BEGIN;

DROP TRIGGER IF EXISTS trg_leave_request_days_lunedi_ins ON public.leave_request_days;
DROP TRIGGER IF EXISTS trg_leave_request_days_lunedi_upd ON public.leave_request_days;
DROP TRIGGER IF EXISTS trg_outlets_vice_promossa ON public.outlets;

DROP FUNCTION IF EXISTS public.leave_request_days_lunedi();
DROP FUNCTION IF EXISTS public.outlets_vice_promossa();
DROP FUNCTION IF EXISTS public.ferie_lunedi_motivo(uuid, date[]);
DROP FUNCTION IF EXISTS public.ferie_lunedi_senza_guida(uuid, date[]);
DROP FUNCTION IF EXISTS public.ferie_lunedi_testo(uuid, date[], boolean);
DROP FUNCTION IF EXISTS public.ferie_lunedi_conflitti(uuid, date[], boolean);
DROP FUNCTION IF EXISTS public.ferie_giorni_interi(uuid, date[], boolean, uuid);
DROP FUNCTION IF EXISTS public.organico_imposta_vice(uuid, uuid);
DROP FUNCTION IF EXISTS public.organico_vice_storico_segna(uuid, uuid, uuid, date);

COMMIT;
