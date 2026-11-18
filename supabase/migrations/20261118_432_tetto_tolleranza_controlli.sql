-- 20261118_432_tetto_tolleranza_controlli.sql
--
-- Un tetto alla tolleranza dei controlli delle chiusure.
--
-- Dal 18/11/2026 (PR #878) `daily_report_settings.checks_tolerance` decide ogni
-- confronto di soldi del report serale e dell'istruttoria: differenza dei
-- corrispettivi, differenza di cassa, foto contro campo scritto, somma delle
-- ricevute di versamento, singolo canale. Prima pesava solo sulla cassa.
--
-- Il revisore di sicurezza l'ha segnalato: la colonna e' `numeric(14,2) NOT NULL
-- DEFAULT 1.00` (migration 342) e nessun vincolo la limita. Scrivendoci 99999
-- tutti i controlli si spengono in silenzio: nessuna differenza supererebbe piu'
-- la soglia, il report direbbe ogni sera «nessuna anomalia» e l'istruttoria
-- «niente da fare». Non e' un'escalation (la colonna la scrive solo chi ha il
-- ruolo super_advisor o contabile, policy drs_write della migration 176) ma e'
-- un piede sbagliato che spegne un controllo contabile senza lasciare traccia.
--
-- Tetto scelto: 5,00 EUR, cinque volte il valore deciso da Patrizio
-- («fino a un euro si puo' sbagliare», 18/11/2026). Lascia spazio a un ritocco
-- futuro senza permettere di spegnere i controlli. Il tetto lo cambia solo
-- Patrizio: se un giorno dice un numero diverso, si cambia qui.
--
-- Zero e' ammesso: significa «segnala qualunque differenza», ed e' un uso
-- legittimo. I negativi no: nell'istruttoria una tolleranza negativa rende i
-- confronti piu' rigidi di zero in modo non evidente a chi legge.
--
-- Nessun dato viene toccato. Misurato prima di applicare: NZ ha una riga con
-- 1.00, Zago non ha ancora righe (il sottosistema non e' in uso). Il vincolo
-- viene validato subito perche' la tabella ha una riga per azienda.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.daily_report_settings'::regclass
       AND conname = 'daily_report_settings_checks_tolerance_range'
  ) THEN
    ALTER TABLE public.daily_report_settings
      ADD CONSTRAINT daily_report_settings_checks_tolerance_range
      CHECK (checks_tolerance >= 0 AND checks_tolerance <= 5);
  END IF;
END
$$;

COMMENT ON COLUMN public.daily_report_settings.checks_tolerance IS
  'Sotto questa cifra una differenza non si segnala a nessuno, in ogni controllo della chiusura: corrispettivi, cassa, foto contro campo scritto, ricevute di versamento, singolo canale (deciso da Patrizio il 04/11/2026 per la cassa e il 18/11/2026 per tutto il resto: 1,00 EUR). Ammessa da 0 a 5,00 EUR (vincolo daily_report_settings_checks_tolerance_range, migration 432): oltre si spegnerebbero i controlli.';

COMMIT;

-- Verifica, su NZ e su Zago:
--
-- SELECT conname, pg_get_constraintdef(oid) AS definizione
--   FROM pg_constraint
--  WHERE conrelid = 'public.daily_report_settings'::regclass
--    AND conname = 'daily_report_settings_checks_tolerance_range';
--
-- SELECT company_id, checks_tolerance FROM public.daily_report_settings;
--
-- Prova che il tetto morde (in una transazione annullata):
--
-- BEGIN;
--   UPDATE public.daily_report_settings SET checks_tolerance = 99999;  -- deve fallire
-- ROLLBACK;
