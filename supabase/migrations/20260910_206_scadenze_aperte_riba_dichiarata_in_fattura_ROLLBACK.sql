-- ROLLBACK 20260910_206 — rimette il metodo delle scadenze com'era.
-- Solo le righe che il giro aveva cambiato, e solo se sono ancora aperte.

BEGIN;

UPDATE public.payables p SET
  payment_method       = b.payment_method,
  payment_method_code  = b.payment_method_code,
  payment_method_label = b.payment_method_label,
  updated_at = now()
FROM public.payables_backup_riba_20260910 b
WHERE b.id = p.id
  AND coalesce(p.status::text, '') NOT IN ('pagato', 'annullato', 'nota_credito');

DELETE FROM public.payable_actions
 WHERE action_type = 'allineamento_metodo_fattura'
   AND payable_id IN (SELECT id FROM public.payables_backup_riba_20260910);

COMMIT;
