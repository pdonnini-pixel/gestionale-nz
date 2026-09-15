-- =====================================================================
-- ROLLBACK migrazione 156 — AutoFix ticket: innesco automatico orario
-- =====================================================================
-- Spegne l'automatismo e rimuove le funzioni introdotte dalla 156.
--
-- NON tocca:
--   * le colonne tickets.autofix_* — sono dati (storia dei tentativi) e la
--     regola NO DATA LOSS vale anche qui. Restano innocue: senza cron
--     nessuno le scrive piu'.
--   * il vault 'autofix_cron_secret' — rimuoverlo a mano solo se si vuole
--     invalidare definitivamente il canale:
--       SELECT vault.delete_secret((SELECT id FROM vault.secrets WHERE name='autofix_cron_secret'));
--
-- Dopo il rollback l'unico innesco torna a essere il bottone "Risolvi con AI"
-- in /ticket/admin: aggiornare la guida in src/data/pageGuides.ts (chiave
-- 'ticket'), che promette il controllo orario, e il banner AutoFixCountdown.
--
-- ⚠️ REGOLA #0 — applicare su NZ + Made + Zago (3 project_id).
-- =====================================================================

SELECT cron.unschedule('ticket-autofix-hourly');

DROP FUNCTION IF EXISTS public.ticket_autofix_run(text, text, integer);
DROP FUNCTION IF EXISTS public.get_autofix_cron_secret();
