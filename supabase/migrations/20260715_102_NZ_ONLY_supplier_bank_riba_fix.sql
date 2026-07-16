-- 20260715_102_NZ_ONLY_supplier_bank_riba_fix.sql
--
-- ⚠️⚠️ SOLO NEW ZAGO (NZ) — NON applicare a Made / Zago ⚠️⚠️
--
-- Chiude i 3 "manca banca" (tutti su MPS, come da conferma):
--   * Best Tool S.r.l.      (riba_60, fine mese 60) -> banca MPS
--   * GLS ENTERPRISE SRL    (riba_30, fine mese 30) -> banca MPS
--   * DWS GRUNDBESITZ GMBH  (rid)                   -> banca MPS + base Data fattura,
--                                                      1 rata (giorni da definire -> NULL)
--
-- Solo banca (e per DWS anche base/rate); prima_scadenza_gg NON toccato.
-- Backup con RLS. Eseguire UNA SOLA VOLTA. MPS = e351d628-a150-4769-b965-9514deab48a3

BEGIN;

CREATE TABLE IF NOT EXISTS public.suppliers_payment_backup_bank_20260715 (
  id uuid, ragione_sociale text,
  payment_base text, prima_scadenza_gg int, numero_rate int,
  payment_bank_account_id uuid, backed_up_at timestamptz
);
ALTER TABLE public.suppliers_payment_backup_bank_20260715 ENABLE ROW LEVEL SECURITY;

WITH b(nome, base, rate, banca) AS (
  VALUES
    ('Best Tool S.r.l.',     NULL,           NULL, 'e351d628-a150-4769-b965-9514deab48a3'::uuid),
    ('GLS ENTERPRISE SRL',   NULL,           NULL, 'e351d628-a150-4769-b965-9514deab48a3'),
    ('DWS GRUNDBESITZ GMBH', 'data_fattura', 1,    'e351d628-a150-4769-b965-9514deab48a3')
),
bkp AS (
  INSERT INTO public.suppliers_payment_backup_bank_20260715
  SELECT s.id, s.ragione_sociale, s.payment_base, s.prima_scadenza_gg, s.numero_rate,
         s.payment_bank_account_id, now()
  FROM public.suppliers s
  JOIN b ON COALESCE(s.ragione_sociale, s.name) = b.nome
        AND coalesce(s.is_deleted,false)=false
  RETURNING 1
)
UPDATE public.suppliers s SET
  payment_bank_account_id = b.banca,
  payment_base            = COALESCE(b.base, s.payment_base),
  numero_rate             = COALESCE(b.rate, s.numero_rate),
  updated_at              = now()
FROM b
WHERE COALESCE(s.ragione_sociale, s.name) = b.nome
  AND coalesce(s.is_deleted,false)=false;

COMMIT;

-- VERIFICA:
-- SELECT ragione_sociale, payment_method, payment_base, prima_scadenza_gg, numero_rate, payment_bank_account_id
--   FROM public.suppliers
--  WHERE ragione_sociale IN ('Best Tool S.r.l.','GLS ENTERPRISE SRL','DWS GRUNDBESITZ GMBH');
-- ROLLBACK:
-- UPDATE public.suppliers s SET payment_base=bk.payment_base, numero_rate=bk.numero_rate,
--   payment_bank_account_id=bk.payment_bank_account_id
--   FROM public.suppliers_payment_backup_bank_20260715 bk WHERE bk.id=s.id;
