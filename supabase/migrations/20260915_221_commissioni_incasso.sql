-- =====================================================================
-- 221 — Commissioni di incasso elettronico: contratti acquirer e costi
-- ---------------------------------------------------------------------
-- Dall'analisi di 8 estratti Amex e 32 estratti Nexi del 2026
-- (COMMISSIONI_INCASSO_NOTES.md): il costo dell'incasso elettronico arriva
-- in due forme, e la forma dipende dal CONTRATTO del singolo punto vendita.
--
--   * al lordo  -> l'accredito e' il transato pieno e la commissione viene
--                  addebitata a parte con un SDD mensile (Amex ovunque,
--                  Nexi solo Valdichiana, terminali BCC/Numia).
--   * al netto  -> l'accredito e' gia' decurtato: in banca del costo non
--                  resta traccia (Nexi sugli altri sei punti vendita).
--
-- Finora quel costo non esisteva da nessuna parte: nessuna attribuzione a
-- outlet, nessuna riga in conto economico, e gli addebiti in banca sparsi
-- fra 'utenze', 'fees' e nessuna categoria.
--
-- Due tabelle:
--   acquirer_contracts  anagrafica dei contratti (codice punto vendita,
--                       Payment Contract, mandato SDD, regime), con validita'
--                       nel tempo: i codici nascono e muoiono quando un
--                       negozio apre o cambia contratto.
--   acquirer_fees       il costo per contratto e mese, con la provenienza
--                       del dato (documento, banca, stima) e il riferimento
--                       al documento archiviato e al movimento bancario.
--
-- Additiva e idempotente: nessun DROP, nessuna riga toccata.
-- Tenant: NZ, Made, Zago (struttura). I dati sono nel seed NZ_ONLY 222.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Anagrafica dei contratti acquirer
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.acquirer_contracts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  outlet_id         uuid REFERENCES public.outlets(id) ON DELETE SET NULL,
  acquirer          text NOT NULL CHECK (acquirer IN ('amex', 'nexi', 'numia', 'altro')),
  -- Codice del punto vendita presso l'acquirer: codice AX per Amex
  -- (7373035260), codice LN per Nexi (LN0004777495).
  merchant_code     text NOT NULL,
  -- Nexi: Payment Contract (PC0001000583). Amex: non esiste, resta NULL.
  payment_contract  text,
  -- Mandato SDD con cui l'acquirer addebita: e' la chiave che lega il
  -- movimento bancario al punto vendita, perche' contiene il codice.
  sdd_mandate       text,
  settlement_mode   text NOT NULL DEFAULT 'netto' CHECK (settlement_mode IN ('lordo', 'netto')),
  -- Codice terminale (ultime 5 cifre) quando il contratto ne governa uno solo.
  terminal_code     text,
  label             text,
  valid_from        date,
  valid_to          date,
  is_active         boolean NOT NULL DEFAULT true,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS acquirer_contracts_code_key
  ON public.acquirer_contracts (company_id, acquirer, merchant_code);
CREATE INDEX IF NOT EXISTS acquirer_contracts_outlet_idx
  ON public.acquirer_contracts (company_id, outlet_id);

COMMENT ON TABLE public.acquirer_contracts IS
  'Contratti di acquiring per punto vendita: codice, mandato SDD e regime di accredito (lordo/netto).';
COMMENT ON COLUMN public.acquirer_contracts.settlement_mode IS
  'lordo = accredito pieno e commissione addebitata a parte; netto = commissione trattenuta alla fonte.';

-- ---------------------------------------------------------------------
-- 2. Commissioni per contratto e mese
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.acquirer_fees (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  contract_id          uuid NOT NULL REFERENCES public.acquirer_contracts(id) ON DELETE CASCADE,
  outlet_id            uuid REFERENCES public.outlets(id) ON DELETE SET NULL,
  period_year          integer NOT NULL CHECK (period_year BETWEEN 2020 AND 2100),
  period_month         integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  gross_amount         numeric(14,2),            -- transato del periodo
  fee_amount           numeric(14,2) NOT NULL,   -- commissioni (valore positivo)
  fixed_amount         numeric(14,2) NOT NULL DEFAULT 0,  -- canoni e acquiring fissi
  stamp_amount         numeric(14,2) NOT NULL DEFAULT 0,  -- imposta di bollo
  settlement_mode      text NOT NULL CHECK (settlement_mode IN ('lordo', 'netto')),
  -- documento = letto dall'estratto conto; banca = ricavato dall'addebito
  -- SDD; stima = calcolato con l'aliquota nota, da sostituire appena arriva
  -- il documento vero.
  source               text NOT NULL DEFAULT 'documento'
                       CHECK (source IN ('documento', 'banca', 'stima')),
  document_id          uuid REFERENCES public.import_documents(id) ON DELETE SET NULL,
  bank_transaction_id  uuid REFERENCES public.bank_transactions(id) ON DELETE SET NULL,
  note                 text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS acquirer_fees_period_key
  ON public.acquirer_fees (contract_id, period_year, period_month);
CREATE INDEX IF NOT EXISTS acquirer_fees_outlet_idx
  ON public.acquirer_fees (company_id, outlet_id, period_year, period_month);

COMMENT ON TABLE public.acquirer_fees IS
  'Costo dell''incasso elettronico per contratto e mese, con la provenienza del dato.';
COMMENT ON COLUMN public.acquirer_fees.source IS
  'documento = estratto conto; banca = ricavato dall''addebito SDD; stima = da sostituire col documento.';

-- ---------------------------------------------------------------------
-- 3. RLS (stesso pattern di outlet_payment_channels)
-- ---------------------------------------------------------------------
ALTER TABLE public.acquirer_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acquirer_fees      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS acquirer_contracts_select ON public.acquirer_contracts;
CREATE POLICY acquirer_contracts_select ON public.acquirer_contracts
  FOR SELECT USING (company_id = get_my_company_id() AND has_outlet_access(outlet_id));

DROP POLICY IF EXISTS acquirer_contracts_write ON public.acquirer_contracts;
CREATE POLICY acquirer_contracts_write ON public.acquirer_contracts
  FOR ALL USING (company_id = get_my_company_id()
                 AND (get_my_role())::text = ANY (ARRAY['super_advisor', 'contabile']))
  WITH CHECK (company_id = get_my_company_id()
              AND (get_my_role())::text = ANY (ARRAY['super_advisor', 'contabile']));

DROP POLICY IF EXISTS acquirer_fees_select ON public.acquirer_fees;
CREATE POLICY acquirer_fees_select ON public.acquirer_fees
  FOR SELECT USING (company_id = get_my_company_id() AND has_outlet_access(outlet_id));

DROP POLICY IF EXISTS acquirer_fees_write ON public.acquirer_fees;
CREATE POLICY acquirer_fees_write ON public.acquirer_fees
  FOR ALL USING (company_id = get_my_company_id()
                 AND (get_my_role())::text = ANY (ARRAY['super_advisor', 'contabile']))
  WITH CHECK (company_id = get_my_company_id()
              AND (get_my_role())::text = ANY (ARRAY['super_advisor', 'contabile']));

-- ---------------------------------------------------------------------
-- 4. Vista di lettura per outlet e mese
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_commissioni_incasso
WITH (security_invoker = on) AS
SELECT f.company_id,
       f.outlet_id,
       o.code                                   AS outlet_code,
       o.name                                   AS outlet_name,
       f.period_year,
       f.period_month,
       make_date(f.period_year, f.period_month, 1) AS periodo,
       c.acquirer,
       c.merchant_code,
       c.payment_contract,
       f.settlement_mode,
       f.source,
       f.gross_amount,
       f.fee_amount,
       f.fixed_amount,
       f.stamp_amount,
       f.fee_amount + f.fixed_amount + f.stamp_amount AS costo_totale,
       CASE WHEN COALESCE(f.gross_amount, 0) > 0
            THEN round(f.fee_amount / f.gross_amount * 100, 3) END AS aliquota_pct,
       f.document_id,
       f.bank_transaction_id
  FROM public.acquirer_fees f
  JOIN public.acquirer_contracts c ON c.id = f.contract_id
  LEFT JOIN public.outlets o ON o.id = f.outlet_id;

COMMENT ON VIEW public.v_commissioni_incasso IS
  'Costo dell''incasso elettronico per outlet, mese e acquirer, con aliquota effettiva.';

-- Verifica:
--   SELECT outlet_code, period_month, acquirer, fee_amount, source
--     FROM v_commissioni_incasso WHERE period_year = 2026 ORDER BY 1, 2;
