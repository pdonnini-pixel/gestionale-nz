-- Rollback 20260908_201 (le colonne restano: sono additive con default; togliere solo la funzione).
DROP FUNCTION IF EXISTS public.get_twilio_whatsapp_config();
-- Se davvero necessario (conferma esplicita di Patrizio):
-- ALTER TABLE public.daily_report_settings DROP COLUMN whatsapp_enabled, DROP COLUMN whatsapp_recipients;
-- ALTER TABLE public.daily_report_log DROP COLUMN whatsapp_status, DROP COLUMN whatsapp_error;
