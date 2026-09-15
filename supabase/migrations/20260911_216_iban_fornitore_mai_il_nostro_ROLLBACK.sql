-- ROLLBACK 20260911_216

BEGIN;

DROP TRIGGER IF EXISTS trg_supplier_iban_mai_il_nostro ON public.suppliers;
DROP FUNCTION IF EXISTS public.fn_supplier_iban_mai_il_nostro();

COMMIT;

-- Gli IBAN svuotati NON si ripristinano: erano il nostro conto, non quello del
-- fornitore, quindi rimetterli sarebbe rimettere un dato sbagliato. Se serve
-- comunque, il backup di sessione dell'11/09/2026 elenca gli 11 fornitori NZ e
-- il valore era IT04V0103038020000000621460 (MPS) per tutti tranne
-- CNH INDUSTRIAL CAPITAL EUROPE (IT37H0845705463000000017334, BCC Valdarno).
