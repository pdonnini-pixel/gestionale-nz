-- ROLLBACK della migrazione 355. ATTENZIONE: riporta cash_must_pay alla forma
-- sbagliata della 201 (blocco permissivo TO public), che apre la tabella anche
-- a chi non e' autenticato. Usarlo solo per il tempo di correggere un problema.
DROP POLICY IF EXISTS cash_operator_block ON public.cash_must_pay;
ALTER POLICY cash_operator_block_permissiva_201 ON public.cash_must_pay
  TO public
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa');
ALTER POLICY cash_operator_block_permissiva_201 ON public.cash_must_pay RENAME TO cash_operator_block;
