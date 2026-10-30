-- ROLLBACK 333 — spegne la sincronizzazione delle password.
-- Le password restano come sono: ognuno torna a cambiarla tenant per tenant.
DROP TRIGGER IF EXISTS trg_password_sync ON auth.users;
REVOKE EXECUTE ON FUNCTION public.password_sync_receive(text, text, timestamptz) FROM anon, authenticated;
-- Le tabelle password_sync_* restano (log e configurazione), sono innocue.
-- Per spegnere solo un tenant senza rollback: UPDATE public.password_sync_peers SET enabled = false;
