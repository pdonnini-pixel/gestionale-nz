-- 20260908_201 — Report incassi serale anche su WhatsApp (Twilio).
--
-- Fuori dalla finestra di 24 ore WhatsApp accetta solo messaggi da modello
-- approvato da Meta: la Edge Function daily-cash-report-send manda il modello
-- (ContentSid) con le variabili del giorno ai numeri in whatsapp_recipients.
-- Credenziali nel Vault di ogni tenant: twilio_account_sid, twilio_auth_token,
-- twilio_whatsapp_from (whatsapp:+39...), twilio_whatsapp_content_sid (HX...).
-- Additiva: nuove colonne con default, nessun dato toccato. Applicata su NZ, Made e Zago.
ALTER TABLE public.daily_report_settings
  ADD COLUMN IF NOT EXISTS whatsapp_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_recipients text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.daily_report_log
  ADD COLUMN IF NOT EXISTS whatsapp_status text,
  ADD COLUMN IF NOT EXISTS whatsapp_error text;
ALTER TABLE public.daily_report_log DROP CONSTRAINT IF EXISTS daily_report_log_whatsapp_status_check;
ALTER TABLE public.daily_report_log ADD CONSTRAINT daily_report_log_whatsapp_status_check
  CHECK (whatsapp_status IS NULL OR whatsapp_status IN ('sent', 'partial', 'failed', 'skipped'));

-- Lette SOLO dalla Edge Function con service role (migrazione 154 docet: mai anon/authenticated).
CREATE OR REPLACE FUNCTION public.get_twilio_whatsapp_config()
RETURNS TABLE(account_sid text, auth_token text, from_number text, content_sid text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT
    (SELECT decrypted_secret::text FROM vault.decrypted_secrets WHERE name = 'twilio_account_sid' LIMIT 1),
    (SELECT decrypted_secret::text FROM vault.decrypted_secrets WHERE name = 'twilio_auth_token' LIMIT 1),
    (SELECT decrypted_secret::text FROM vault.decrypted_secrets WHERE name = 'twilio_whatsapp_from' LIMIT 1),
    (SELECT decrypted_secret::text FROM vault.decrypted_secrets WHERE name = 'twilio_whatsapp_content_sid' LIMIT 1);
$$;
REVOKE ALL ON FUNCTION public.get_twilio_whatsapp_config() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_twilio_whatsapp_config() FROM anon;
REVOKE ALL ON FUNCTION public.get_twilio_whatsapp_config() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_twilio_whatsapp_config() TO service_role;
