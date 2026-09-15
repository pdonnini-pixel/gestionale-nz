-- =====================================================================
-- ROLLBACK migrazione 155 — chat assistente AI
-- =====================================================================
-- ⚠️ ATTENZIONE — NO DATA LOSS: eseguire questo script CANCELLA l'archivio
-- delle chat (domande e risposte gia' salvate). Usarlo SOLO se la feature
-- viene ritirata prima di essere usata davvero, e solo dopo:
--   1. SELECT * FROM public.help_chat_sessions;   -- backup
--   2. SELECT * FROM public.help_chat_messages;   -- backup
--   3. conferma binaria di Patrizio.
-- Se le tabelle contengono chat reali, NON eseguire: la feature si spegne
-- lato frontend, senza toccare il DB.
-- =====================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_help_chat_touch_session ON public.help_chat_messages;
DROP FUNCTION IF EXISTS public.fn_help_chat_touch_session();

DROP TABLE IF EXISTS public.help_chat_messages;
DROP TABLE IF EXISTS public.help_chat_sessions;

COMMIT;
