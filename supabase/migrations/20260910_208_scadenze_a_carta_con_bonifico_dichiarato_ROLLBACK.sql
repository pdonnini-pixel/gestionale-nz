-- ROLLBACK 20260910_208 — rimette metodo, scadenza e flag carta com'erano.
-- Solo le righe che il giro aveva cambiato, e solo se sono ancora aperte.
-- Da eseguire PRIMA del rollback della 207 (finche' la 207 e' in vigore il trigger non
-- rimette la carta, che e' esattamente cio' che serve durante il ripristino).

BEGIN;

UPDATE public.payables p SET
  payment_method       = b.payment_method,
  payment_method_code  = b.payment_method_code,
  payment_method_label = b.payment_method_label,
  is_auto_debit        = b.is_auto_debit,
  due_date             = b.due_date,
  updated_at = now()
FROM public.payables_backup_carta_20260910 b
WHERE b.id = p.id
  AND coalesce(p.status::text, '') NOT IN ('pagato', 'annullato', 'nota_credito');

DELETE FROM public.payable_actions
 WHERE action_type = 'allineamento_metodo_fattura'
   AND payable_id IN (SELECT id FROM public.payables_backup_carta_20260910);

COMMIT;
