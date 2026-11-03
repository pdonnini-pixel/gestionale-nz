-- =====================================================================
-- Migrazione 340 — via l'allarme «pixel check rosso» dalla campanella
-- =====================================================================
--
-- PERCHÉ (Patrizio, 03/11/2026, piano di sicurezza)
-- Il repository gestionale-nz diventa PRIVATO. L'allarme della migrazione 130
-- leggeva l'esito del pixel check dall'API pubblica di GitHub senza token: da
-- privato riceverebbe «non trovato» e smetterebbe di avvisare in silenzio.
-- In più l'avviso compariva a tutti gli utenti dell'azienda, che non possono
-- farci niente. Scelta di Patrizio: togliere l'allarme; i rossi del pixel check
-- arrivano a lui con la mail di GitHub.
--
-- COSA FA
-- Toglie solo il job pg_cron «alert-pixel-check-rosso». La funzione
-- public.check_pixel_and_alert() resta (non si cancella niente) e le notifiche
-- già scritte restano come sono.
--
-- TENANT: NZ + Zago (regola del 03/11/2026: Made non riceve più modifiche al
-- database). Su Made il job resta e, a repository privato, non trova più
-- nessun esito: non scrive niente.
-- Rollback in 20261103_340_stop_alert_pixel_check_ROLLBACK.sql.
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'alert-pixel-check-rosso') THEN
    PERFORM cron.unschedule('alert-pixel-check-rosso');
  END IF;
END $$;

-- VERIFICA (deve tornare 0)
--   SELECT count(*) FROM cron.job WHERE jobname = 'alert-pixel-check-rosso';
