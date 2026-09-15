-- ROLLBACK migrazione 122 — ripristina EXECUTE ad authenticated su
-- try_match_amount_bank_transaction (stato pre-lockdown). ⚠️ NZ + Made + Zago.
GRANT EXECUTE ON FUNCTION public.try_match_amount_bank_transaction(uuid) TO authenticated;
