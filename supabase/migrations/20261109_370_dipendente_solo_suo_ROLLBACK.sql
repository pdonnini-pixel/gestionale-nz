-- ROLLBACK della migrazione 370: toglie le sette policy aggiunte.
BEGIN;
DROP POLICY IF EXISTS dipendente_block ON public.companies;
DROP POLICY IF EXISTS dipendente_block ON public.company_settings;
DROP POLICY IF EXISTS dipendente_block ON public.outlets;
DROP POLICY IF EXISTS dipendente_block ON public.user_outlet_access;
DROP POLICY IF EXISTS dipendente_block ON public.help_chat_messages;
DROP POLICY IF EXISTS dipendente_block ON public.help_chat_sessions;
DROP POLICY IF EXISTS dipendente_solo_suo ON public.user_profiles;
COMMIT;
