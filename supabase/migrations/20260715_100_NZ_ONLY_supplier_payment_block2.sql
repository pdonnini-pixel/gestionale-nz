-- 20260715_100_NZ_ONLY_supplier_payment_block2.sql
--
-- ⚠️⚠️ SOLO NEW ZAGO (NZ) — NON applicare a Made / Zago ⚠️⚠️
-- Dati specifici fornitori New Zago (file scadenze Sabrina), gruppo 2.
--
-- Aggancio per TOKEN univoco (verificato dal pre-check: ogni token -> 1 solo
-- fornitore), robusto a apostrofi/formattazione delle ragioni sociali.
--
-- Regole: fine mese salvo ADD (=rid, data fattura); banca solo Ri.Ba./ADD;
-- 'a vista' dei bonifici -> trattati come fine mese 30 (come deciso);
-- già pagate (contanti) -> a vista (data fattura 0gg), nessuna banca.
--
-- FUORI da questo blocco (come concordato): GNT (non in anagrafica),
-- AXET FACILITY (41gg), Palmanova/Valdichiana PROPCO, righe TARI/F24, stipendi.
-- A.&C. GROUP e MED SECURITY: senza giorni nel file -> prima_scadenza_gg NULL
-- (compariranno nell'estrazione finale "manca tempistica").
--
-- Eseguire UNA SOLA VOLTA. MPS = e351d628-a150-4769-b965-9514deab48a3
-- Backup: suppliers_payment_backup_block2_20260715 (con RLS).

BEGIN;

CREATE TABLE IF NOT EXISTS public.suppliers_payment_backup_block2_20260715 (
  id uuid, ragione_sociale text, name text,
  payment_method text, default_payment_method text,
  payment_base text, prima_scadenza_gg int, numero_rate int,
  payment_bank_account_id uuid, backed_up_at timestamptz
);
ALTER TABLE public.suppliers_payment_backup_block2_20260715 ENABLE ROW LEVEL SECURITY;

WITH b(token, metodo, base, prima, rate, banca) AS (
  VALUES
    -- ADD -> rid (data fattura, MPS)
    ('ACAM','rid','data_fattura',21,1,'e351d628-a150-4769-b965-9514deab48a3'::uuid),
    -- Ri.Ba. (fine mese, MPS)  [GNT non trovato -> fuori]
    -- Bonifico fine mese
    ('MINGARDO','bonifico_ordinario','fine_mese',30,1,NULL),
    ('ATENA','bonifico_ordinario','fine_mese',30,1,NULL),
    ('KENFOSTER','bonifico_ordinario','fine_mese',72,1,NULL),
    ('MILANI','bonifico_ordinario','fine_mese',60,1,NULL),
    ('SERTEC','bonifico_ordinario','fine_mese',30,1,NULL),
    ('GRUPPO SERVIZI ASS','bonifico_ordinario','fine_mese',30,1,NULL),
    ('LA FAVORITA','bonifico_ordinario','fine_mese',30,1,NULL),
    ('SPM','bonifico_ordinario','fine_mese',30,1,NULL),
    ('LUNI CLIMA','bonifico_ordinario','fine_mese',30,1,NULL),
    ('CLIMASERVICE','bonifico_ordinario','fine_mese',30,1,NULL),
    ('SCOPA MAGICA','bonifico_ordinario','fine_mese',30,1,NULL),
    -- Bonifico fine mese SENZA giorni nel file -> prima NULL (manca tempistica)
    ('A.&C. GROUP','bonifico_ordinario','fine_mese',NULL,1,NULL),
    ('MED SEC','bonifico_ordinario','fine_mese',NULL,1,NULL),
    -- Già pagate (contanti, a vista, nessuna banca)
    ('FELICE CASA','contanti','data_fattura',0,1,NULL),
    ('TEDI','contanti','data_fattura',0,1,NULL),
    ('A.B.N','contanti','data_fattura',0,1,NULL),
    ('SME SPA','contanti','data_fattura',0,1,NULL),
    ('DX SRL','contanti','data_fattura',0,1,NULL),
    ('UNIEURO','contanti','data_fattura',0,1,NULL),
    ('AM4','contanti','data_fattura',0,1,NULL),
    ('KIK TESSILI','contanti','data_fattura',0,1,NULL)
),
bkp AS (
  INSERT INTO public.suppliers_payment_backup_block2_20260715
  SELECT s.id, s.ragione_sociale, s.name, s.payment_method, s.default_payment_method::text,
         s.payment_base, s.prima_scadenza_gg, s.numero_rate, s.payment_bank_account_id, now()
  FROM public.suppliers s
  JOIN b ON position(
              regexp_replace(upper(b.token),'[^A-Z0-9]','','g')
              in regexp_replace(upper(coalesce(s.ragione_sociale,s.name)),'[^A-Z0-9]','','g')
            ) > 0
        AND coalesce(s.is_deleted,false)=false
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
WHERE position(
        regexp_replace(upper(b.token),'[^A-Z0-9]','','g')
        in regexp_replace(upper(coalesce(s.ragione_sociale,s.name)),'[^A-Z0-9]','','g')
      ) > 0
  AND coalesce(s.is_deleted,false)=false;

COMMIT;

-- VERIFICA:
-- 1) righe toccate (atteso 22):
--    SELECT count(*) FROM public.suppliers_payment_backup_block2_20260715;
-- 2) campione:
--    SELECT ragione_sociale, payment_method, payment_base, prima_scadenza_gg, numero_rate, payment_bank_account_id
--      FROM public.suppliers
--     WHERE upper(coalesce(ragione_sociale,name)) LIKE ANY (ARRAY['%ACAM%','%KENFOSTER%','%UNIEURO%','%MED SECURITY%'])
--     ORDER BY ragione_sociale;
-- 3) ROLLBACK:
--    UPDATE public.suppliers s SET payment_method=bk.payment_method,
--      default_payment_method=bk.default_payment_method::payment_method,
--      payment_base=bk.payment_base, prima_scadenza_gg=bk.prima_scadenza_gg,
--      numero_rate=bk.numero_rate, payment_bank_account_id=bk.payment_bank_account_id
--    FROM public.suppliers_payment_backup_block2_20260715 bk WHERE bk.id=s.id;
