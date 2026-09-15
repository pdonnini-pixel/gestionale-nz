-- ROLLBACK di NZ_ONLY_20260903_166_anagrafiche_doppie_e_metodi_riba.sql
-- Ripristina esattamente lo stato precedente leggendo dalle tabelle di backup
-- create prima dell'intervento. Nessun dato inventato.

BEGIN;

-- 1. Metodi di pagamento com'erano (bonifico ordinario)
UPDATE public.payables p
SET payment_method = (b.prima->>'payment_method')::payment_method, updated_at = now()
FROM public._bkp_riba_method_20260903 b
WHERE p.id::text = b.riga_id;

-- 2. Schede fornitore com'erano (is_active precedente)
UPDATE public.suppliers s
SET is_active = (b.prima->>'is_active')::boolean, updated_at = now()
FROM public._bkp_merge_anagrafiche_20260903 b
WHERE b.origine = 'suppliers' AND s.id::text = b.riga_id;

-- 3. Saldo di apertura sulla scheda di origine
UPDATE public.supplier_opening_balances ob
SET supplier_id = (b.prima->>'supplier_id')::uuid,
    note = b.prima->>'note',
    updated_at = now()
FROM public._bkp_merge_anagrafiche_20260903 b
WHERE b.origine = 'supplier_opening_balances' AND ob.id::text = b.riga_id;

COMMIT;
