-- ROLLBACK 332 — rimette chiavi e codici com'erano, leggendoli dal backup.
-- Da lanciare solo se la 332 ha dato problemi, su ogni tenant dove è stata applicata.
BEGIN;

-- chiave dei negozi
UPDATE public.outlets o
   SET cost_center_key = b.old_value
  FROM public.cost_center_key_fix_bkp_20261030 b
 WHERE b.source_table = 'outlets.cost_center_key' AND b.row_id = o.id;

-- codici dei centri di costo rinominati
UPDATE public.cost_centers c
   SET code = b.old_value
  FROM public.cost_center_key_fix_bkp_20261030 b
 WHERE b.source_table = 'cost_centers.code' AND b.row_id = c.id;

-- centri di costo creati dalla 332 (solo se nessun dato li usa ancora)
DELETE FROM public.cost_centers c
 USING public.cost_center_key_fix_bkp_20261030 b
 WHERE b.source_table = 'cost_centers.created' AND b.row_id = c.id
   AND NOT EXISTS (SELECT 1 FROM public.budget_entries   be WHERE be.company_id = c.company_id AND be.cost_center = c.code)
   AND NOT EXISTS (SELECT 1 FROM public.budget_confronto bc WHERE bc.company_id = c.company_id AND bc.cost_center = c.code);

COMMIT;

-- onboard_tenant: per tornare alla versione precedente si riesegue la
-- CREATE OR REPLACE FUNCTION public.onboard_tenant di 20260508_012_onboard_tenant_v2.sql.
-- public.slug_cost_center e la tabella di backup restano: sono innocue.
