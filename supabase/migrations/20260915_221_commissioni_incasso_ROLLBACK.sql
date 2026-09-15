-- Rollback della 221. Toglie solo cio' che la 221 ha creato.
DROP VIEW IF EXISTS public.v_commissioni_incasso;
DROP TABLE IF EXISTS public.acquirer_fees;
DROP TABLE IF EXISTS public.acquirer_contracts;
