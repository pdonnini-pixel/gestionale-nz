-- ─────────────────────────────────────────────────────────────────────────────
-- 20260909_201 — cash_must_pay: le uscite che «non si possono non pagare»
--
-- La Simulazione fabbisogno smette di dedurre da sola cosa va pagato: chi tiene
-- l'amministrazione (Sabrina) spunta riga per riga le uscite obbligatorie entro
-- una data (fatture fornitori, scadenze fiscali, stipendi, voci fuori sistema).
-- La selezione vive qui: è condivisa fra gli utenti dell'azienda e resta nel
-- tempo, così la simulazione parte da una decisione, non da una regola.
--
-- Migration ADDITIVA: crea una tabella nuova, non tocca dati esistenti.
-- Da applicare su NZ, Made e Zago (parità tenant).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.cash_must_pay (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Data obiettivo del piano: «obbligatorio entro il 30/09». Selezioni diverse
  -- per date diverse convivono, così il piano del mese scorso resta consultabile.
  horizon_date date NOT NULL,

  -- Che tipo di uscita è. payable/fiscal puntano a una riga vera; payroll e
  -- manual sono voci costruite dalla pagina (stipendi) o scritte a mano.
  item_kind text NOT NULL CHECK (item_kind IN ('payable', 'fiscal', 'payroll', 'manual')),

  payable_id uuid REFERENCES public.payables(id) ON DELETE CASCADE,
  fiscal_deadline_id uuid REFERENCES public.fiscal_deadlines(id) ON DELETE CASCADE,

  -- Chiave stabile per le voci senza riga in tabella (es. 'payroll-2026-09-10').
  item_ref text,

  -- Etichetta e importo servono SOLO a payroll/manual: per payable e fiscal
  -- l'importo si legge sempre dalla fonte, così non si sfasa quando cambia.
  label text,
  amount numeric,

  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Coerenza fra tipo e riferimento: una voce agganciata deve avere il suo id,
  -- una voce libera deve avere chiave e importo.
  CONSTRAINT cash_must_pay_ref_coerente CHECK (
    (item_kind = 'payable' AND payable_id IS NOT NULL)
    OR (item_kind = 'fiscal' AND fiscal_deadline_id IS NOT NULL)
    OR (item_kind IN ('payroll', 'manual') AND item_ref IS NOT NULL AND amount IS NOT NULL)
  )
);

-- Una sola spunta per voce e per data obiettivo: la chiave normalizza i tre
-- modi di identificare una voce in un'unica espressione.
CREATE UNIQUE INDEX IF NOT EXISTS cash_must_pay_unico
  ON public.cash_must_pay (
    company_id,
    horizon_date,
    (COALESCE(payable_id::text, fiscal_deadline_id::text, item_ref))
  );

CREATE INDEX IF NOT EXISTS cash_must_pay_company_horizon
  ON public.cash_must_pay (company_id, horizon_date);

COMMENT ON TABLE public.cash_must_pay IS
  'Uscite marcate come obbligatorie entro una data, dalla pagina Simulazione fabbisogno. Selezione condivisa fra gli utenti dell''azienda.';

-- updated_at automatico
CREATE OR REPLACE FUNCTION public.fn_cash_must_pay_touch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cash_must_pay_touch ON public.cash_must_pay;
CREATE TRIGGER trg_cash_must_pay_touch
  BEFORE UPDATE ON public.cash_must_pay
  FOR EACH ROW EXECUTE FUNCTION public.fn_cash_must_pay_touch();

-- ── RLS: stesso schema di vat_settlements ───────────────────────────────────
-- lettura a tutta l'azienda, scrittura a super_advisor / cfo / contabile
-- (Sabrina è contabile), operatore_cassa escluso da tutto.
ALTER TABLE public.cash_must_pay ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cash_must_pay_select ON public.cash_must_pay;
CREATE POLICY cash_must_pay_select ON public.cash_must_pay
  FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS cash_must_pay_write ON public.cash_must_pay;
CREATE POLICY cash_must_pay_write ON public.cash_must_pay
  FOR ALL
  USING (
    company_id = get_my_company_id()
    AND (get_my_role())::text = ANY (ARRAY['super_advisor', 'contabile', 'cfo'])
  )
  WITH CHECK (
    company_id = get_my_company_id()
    AND (get_my_role())::text = ANY (ARRAY['super_advisor', 'contabile', 'cfo'])
  );

DROP POLICY IF EXISTS cash_operator_block ON public.cash_must_pay;
CREATE POLICY cash_operator_block ON public.cash_must_pay
  FOR ALL
  USING (COALESCE((get_my_role())::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE((get_my_role())::text, '') <> 'operatore_cassa');

COMMIT;

-- ── Verifica ────────────────────────────────────────────────────────────────
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'cash_must_pay';        -- t
-- SELECT count(*) FROM pg_policies WHERE tablename = 'cash_must_pay';         -- 3
-- SELECT count(*) FROM pg_indexes WHERE tablename = 'cash_must_pay';          -- 3 (pk + 2)
