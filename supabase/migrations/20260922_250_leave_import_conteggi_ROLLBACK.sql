-- Rollback della migrazione 250.
-- Toglie la colonna dei conteggi per persona. I contatori corretti restano
-- come sono: erano sbagliati prima, non c'e' niente da ripristinare.
BEGIN;
ALTER TABLE public.leave_accrual_imports DROP COLUMN IF EXISTS persone_agganciate;
COMMIT;
