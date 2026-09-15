-- 20260715_099_NZ_ONLY_supplier_payment_block1bis.sql
--
-- ⚠️⚠️ SOLO NEW ZAGO (NZ) — NON applicare a Made / Zago ⚠️⚠️
--
-- BLOCCO 1-bis: i 5 fornitori del blocco 1 che non si erano agganciati per nome.
-- Qui l'aggancio è per ID ESATTO (dal pre-check), quindi zero ambiguità.
--   * BRT S.p.A.            (= CORRIERE BARTOLINI)        -> Ri.Ba. 30 fine mese, MPS
--   * PATRIZIA NIGRO        (= NOIR DI PATRIZIA NIGRO)    -> Ri.Ba. 30 fine mese, MPS
--   * Colette srl           (= COLETTE)                   -> Bonifico fine mese 30
--   * Colette Group srl     (= COLETTE)                   -> Bonifico fine mese 30
--   * ZUCCHETTI SPA ...     (= ZUCCHETTI PEOPLE SMART)    -> Bonifico fine mese 30
-- (STUDIO POLI: non presente in anagrafica -> lasciato fuori, come concordato.)
--
-- Backup nella STESSA tabella del blocco 1 (append). Nessuna cancellazione.
-- Eseguire UNA SOLA VOLTA. MPS = e351d628-a150-4769-b965-9514deab48a3

BEGIN;

CREATE TABLE IF NOT EXISTS public.suppliers_payment_backup_block1_20260715 (
  id uuid, ragione_sociale text, name text,
  payment_method text, default_payment_method text,
  payment_base text, prima_scadenza_gg int, numero_rate int,
  payment_bank_account_id uuid, backed_up_at timestamptz
);
ALTER TABLE public.suppliers_payment_backup_block1_20260715 ENABLE ROW LEVEL SECURITY;

WITH b(id, metodo, base, prima, rate, banca) AS (
  VALUES
    ('a1a9be15-3d80-4652-86a9-c54cc8207869'::uuid,'riba_30','fine_mese',30,1,'e351d628-a150-4769-b965-9514deab48a3'::uuid),  -- BRT (Corriere Bartolini)
    ('3f493fe7-1c2f-48cf-935d-a7559be10f5f','riba_30','fine_mese',30,1,'e351d628-a150-4769-b965-9514deab48a3'),               -- PATRIZIA NIGRO (Noir)
    ('cafb905f-5bbd-4501-aa4a-98e0c200a2b7','bonifico_ordinario','fine_mese',30,1,NULL),                                       -- Colette srl
    ('309c1a9a-7e93-4c9c-b736-fc48fa12cb34','bonifico_ordinario','fine_mese',30,1,NULL),                                       -- Colette Group srl
    ('e814e350-4e1a-4939-abe0-fd8c6798ea48','bonifico_ordinario','fine_mese',30,1,NULL)                                        -- ZUCCHETTI SPA
),
bkp AS (
  INSERT INTO public.suppliers_payment_backup_block1_20260715
  SELECT s.id, s.ragione_sociale, s.name, s.payment_method, s.default_payment_method::text,
         s.payment_base, s.prima_scadenza_gg, s.numero_rate, s.payment_bank_account_id, now()
  FROM public.suppliers s
  JOIN b ON s.id = b.id
  RETURNING 1
)
UPDATE public.suppliers s SET
  payment_method          = b.metodo,
  default_payment_method  = b.metodo::payment_method,
  payment_base            = b.base,
  prima_scadenza_gg       = b.prima,
  numero_rate             = b.rate,
  payment_bank_account_id = COALESCE(b.banca, s.payment_bank_account_id),
  updated_at              = now()
FROM b
WHERE s.id = b.id;

COMMIT;

-- VERIFICA:
-- SELECT ragione_sociale, payment_method, payment_base, prima_scadenza_gg, numero_rate, payment_bank_account_id
--   FROM public.suppliers
--  WHERE id IN ('a1a9be15-3d80-4652-86a9-c54cc8207869','3f493fe7-1c2f-48cf-935d-a7559be10f5f',
--               'cafb905f-5bbd-4501-aa4a-98e0c200a2b7','309c1a9a-7e93-4c9c-b736-fc48fa12cb34',
--               'e814e350-4e1a-4939-abe0-fd8c6798ea48')
--  ORDER BY ragione_sociale;
