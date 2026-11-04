-- 20261104_343_messaggi_ai_negozi_risposte.sql
--
-- Instradamento dei messaggi che il gestionale manda al singolo negozio
-- (deciso da Patrizio il 04/11/2026):
--   - la mail parte dal mittente del gestionale, mai da una casella personale;
--   - va all'indirizzo del negozio in anagrafica outlet;
--   - se il negozio schiaccia «rispondi», la risposta arriva
--     all'amministrazione (checks_store_reply_to);
--   - chi guida resta in copia nascosta sull'uscita (checks_store_bcc), così
--     vede cosa è stato scritto senza comparire agli occhi del negozio.
--
-- Nota: la copia nascosta su una RISPOSTA non si può imporre da qui, la
-- decide chi scrive. Per ricevere anche le risposte senza comparire serve un
-- inoltro sulla casella dell'amministrazione.

BEGIN;

ALTER TABLE public.daily_report_settings
  ADD COLUMN IF NOT EXISTS checks_store_reply_to text,
  ADD COLUMN IF NOT EXISTS checks_store_bcc text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.daily_report_settings.checks_store_reply_to IS
  'Dove tornano le risposte dei negozi ai messaggi del gestionale (di norma la casella dell''amministrazione). Vuoto = nessun rispondi-a.';
COMMENT ON COLUMN public.daily_report_settings.checks_store_bcc IS
  'Chi riceve in copia nascosta i messaggi mandati ai negozi.';

COMMIT;

-- Verifica, su ogni tenant:
-- SELECT checks_store_reply_to, checks_store_bcc FROM public.daily_report_settings;
