-- 20260715_101_NZ_ONLY_supplier_bonifico_finemese_default.sql
--
-- ⚠️⚠️ SOLO NEW ZAGO (NZ) — NON applicare a Made / Zago ⚠️⚠️
--
-- DEFAULT DI CASA: imposta il piano "fine mese / 30 gg / 1 rata" a TUTTI i
-- fornitori ATTIVI con metodo BONIFICO e SENZA tipologia (payment_base NULL).
-- Regola concordata: per New Zago lo standard è fine mese; il bonifico non
-- richiede banca. Sovrascrivibile dal form sui pochi che fanno eccezione.
--
-- NON tocca: metodo, banca, né i fornitori non-bonifico (rid/riba/sdd/carte/
-- contanti) — quelli restano invariati. Solo dove payment_base IS NULL.
--
-- Backup con RLS. Eseguire UNA SOLA VOLTA.

BEGIN;

CREATE TABLE IF NOT EXISTS public.suppliers_payment_backup_bulk_bonifico_20260715 (
  id uuid, ragione_sociale text, name text,
  payment_method text, default_payment_method text,
  payment_base text, prima_scadenza_gg int, numero_rate int,
  payment_bank_account_id uuid, backed_up_at timestamptz
);
ALTER TABLE public.suppliers_payment_backup_bulk_bonifico_20260715 ENABLE ROW LEVEL SECURITY;

WITH tgt AS (
  SELECT id
  FROM public.suppliers
  WHERE coalesce(is_deleted,false)=false
    AND is_active IS NOT FALSE
    AND payment_base IS NULL
    AND coalesce(default_payment_method::text, payment_method, '') LIKE 'bonifico%'
),
bkp AS (
  INSERT INTO public.suppliers_payment_backup_bulk_bonifico_20260715
  SELECT s.id, s.ragione_sociale, s.name, s.payment_method, s.default_payment_method::text,
         s.payment_base, s.prima_scadenza_gg, s.numero_rate, s.payment_bank_account_id, now()
  FROM public.suppliers s
  JOIN tgt ON tgt.id = s.id
  RETURNING 1
)
UPDATE public.suppliers s SET
  payment_base      = 'fine_mese',
  prima_scadenza_gg = 30,
  numero_rate       = 1,
  updated_at        = now()
FROM tgt
WHERE s.id = tgt.id;

COMMIT;

-- VERIFICA:
-- 1) quanti aggiornati:
--    SELECT count(*) FROM public.suppliers_payment_backup_bulk_bonifico_20260715;
-- 2) restano ancora bonifico attivi senza tipologia? (atteso 0):
--    SELECT count(*) FROM public.suppliers
--     WHERE coalesce(is_deleted,false)=false AND is_active IS NOT FALSE
--       AND payment_base IS NULL
--       AND coalesce(default_payment_method::text,payment_method,'') LIKE 'bonifico%';
-- 3) ROLLBACK:
--    UPDATE public.suppliers s SET payment_base=bk.payment_base,
--      prima_scadenza_gg=bk.prima_scadenza_gg, numero_rate=bk.numero_rate
--    FROM public.suppliers_payment_backup_bulk_bonifico_20260715 bk WHERE bk.id=s.id;
