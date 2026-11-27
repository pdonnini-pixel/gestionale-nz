-- ROLLBACK 481 — toglie la funzione del cruscotto direzione (solo lettura, nessun dato coinvolto).
-- Prima di eseguirlo, la Dashboard deve essere tornata alla versione precedente.
DROP FUNCTION IF EXISTS public.cruscotto_direzione(integer);
