-- =====================================================================
-- 247 — Richiesta di riapertura chiusura cassa: destinatari della mail
--
-- Caso del 21/09/2026 (Valmontone): il negozio ha scritto nel punto 5 il
-- contante atteso (748,85) invece dei soli contanti da versare (248,60) e
-- ha chiesto la riapertura. La richiesta era partita regolarmente alle
-- 9:31, ma arrivava SOLO come avviso dentro il gestionale: nessuno l'aveva
-- ancora aperto, e per il negozio sembrava che la riapertura non fosse
-- possibile.
--
-- Da qui la mail: la stessa richiesta raggiunge l'amministrazione anche in
-- casella. Gli indirizzi si impostano in Impostazioni → Report incassi
-- serale; se il campo resta vuoto si usano i destinatari del report, così
-- la mail arriva comunque a qualcuno senza dover configurare niente.
--
-- Additiva: una colonna con default, nessun dato toccato.
-- Da applicare su NZ → Made → Zago.
-- =====================================================================
BEGIN;

ALTER TABLE public.daily_report_settings
  ADD COLUMN IF NOT EXISTS reopen_recipients text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.daily_report_settings.reopen_recipients IS
  'Destinatari della mail «richiesta di riapertura chiusura cassa». Vuoto = si usano i destinatari del report serale.';

COMMIT;

-- Verifica:
-- SELECT recipients, reopen_recipients FROM public.daily_report_settings;
