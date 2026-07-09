-- 20260709_087_supplier_payment_plan_and_anomalies.sql
--
-- FEATURE: piano di pagamento strutturato per fornitore + segnalazioni ("anomalie")
-- di configurazione, con banca di pagamento assegnata (per storno nei cashflow).
--
-- Contesto / regole concordate con Patrizio:
--  * Si applica SOLO alle fatture con DATA EMISSIONE >= 31/07/2026 e SOLO se il
--    fornitore ha il piano impostato. Il PREGRESSO in payables NON si tocca
--    (nessun ricalcolo retroattivo).
--  * L'anomalia e' a livello FORNITORE (la fattura ne fa capo): sistemato il
--    fornitore, si risolve per tutte le sue fatture. Il badge rosso su
--    "Fatturazione" conta i fornitori con anomalia APERTA a livello azienda e
--    sparisce solo quando stato='risolta' (stato CONDIVISO, non per-utente).
--  * Banca obbligatoria a seconda del metodo (serve per lo storno nel cashflow):
--      riba_*, rid, sdd_core, sdd_b2b, carta_credito, carta_debito -> OBBLIGATORIA
--      bonifico_*, contanti, compensazione, mav, rav, bollettino_postale, f24 -> facoltativa
--
-- Questa migration e' ADDITIVA e NON DISTRUTTIVA:
--   - ADD COLUMN IF NOT EXISTS su suppliers
--   - CREATE TABLE IF NOT EXISTS per le anomalie
--   - CREATE OR REPLACE di 2 funzioni helper PURE (nessuna scrittura dati)
-- Non tocca dati esistenti, non modifica trigger/flussi di import (il wiring
-- all'import SDI e il frontend arrivano in step separati, gia' concordati).
--
-- PARITA' TENANT (Regola #0): applicare su NZ + Made + Zago.
-- Idempotente: riapplicabile senza effetti collaterali.

BEGIN;

-- =====================================================================
-- 1) SUPPLIERS: 4 campi additivi per il piano di pagamento
-- =====================================================================
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS payment_base text
    CHECK (payment_base IS NULL OR payment_base IN ('data_fattura','fine_mese')),
  ADD COLUMN IF NOT EXISTS prima_scadenza_gg integer
    CHECK (prima_scadenza_gg IS NULL OR prima_scadenza_gg >= 0),
  ADD COLUMN IF NOT EXISTS numero_rate integer
    CHECK (numero_rate IS NULL OR numero_rate >= 1),
  ADD COLUMN IF NOT EXISTS payment_bank_account_id uuid
    REFERENCES public.bank_accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.suppliers.payment_base IS
  'Base di calcolo scadenze: data_fattura (a giorni) | fine_mese (a mesi solari, ultimo giorno).';
COMMENT ON COLUMN public.suppliers.prima_scadenza_gg IS
  'Giorni della prima scadenza (30/60/90...). Le rate successive sono sempre +30gg (DF) o +1 mese (FM).';
COMMENT ON COLUMN public.suppliers.numero_rate IS
  'Numero di rate in cui splittare l''importo della fattura (in parti uguali; l''ultima assorbe l''arrotondamento).';
COMMENT ON COLUMN public.suppliers.payment_bank_account_id IS
  'Banca su cui esce il pagamento (bank_accounts). Obbligatoria per riba_*/rid/sdd_*/carta_*; serve per lo storno nelle simulazioni cashflow.';

-- =====================================================================
-- 2) HELPER PURO: calcolo scadenze rate di una fattura
--    Ritorna una riga per rata con (rata, due_date, importo).
--    - data_fattura: due = emissione + (prima_gg + 30*(i-1)) giorni
--    - fine_mese   : due = ultimo giorno del mese (emissione + N mesi),
--                    con N = prima_gg/30 + (i-1)
--    Split importo in parti uguali; l'ultima rata assorbe l'arrotondamento
--    cosi' che la somma torni esatta al centesimo (gestisce anche importi
--    negativi delle note di credito).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_supplier_installment_schedule(
  p_emissione  date,
  p_base       text,
  p_prima_gg   integer,
  p_n_rate     integer,
  p_gross      numeric
)
RETURNS TABLE(rata integer, due_date date, importo numeric)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_n      integer := GREATEST(COALESCE(p_n_rate, 1), 1);
  v_prima  integer := COALESCE(p_prima_gg, 30);
  v_quota  numeric := round(COALESCE(p_gross, 0) / v_n, 2);
  v_acc    numeric := 0;
  i        integer;
  v_months integer;
BEGIN
  FOR i IN 1..v_n LOOP
    IF p_base = 'fine_mese' THEN
      -- N mesi da aggiungere al mese di emissione per arrivare al mese di scadenza
      v_months := (v_prima / 30) + (i - 1);
      -- ultimo giorno di (mese_emissione + v_months)
      due_date := (date_trunc('month', p_emissione)
                   + make_interval(months => v_months + 1)
                   - interval '1 day')::date;
    ELSE
      -- data_fattura: a giorni
      due_date := p_emissione + ((v_prima + 30 * (i - 1)))::integer;
    END IF;

    rata := i;
    IF i < v_n THEN
      importo := v_quota;
      v_acc := v_acc + v_quota;
    ELSE
      importo := round(COALESCE(p_gross, 0) - v_acc, 2);  -- ultima rata: quadra il totale
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.fn_supplier_installment_schedule(date,text,integer,integer,numeric) IS
  'PURA: dato (emissione, base, prima_scadenza_gg, numero_rate, gross) ritorna le scadenze (rata, due_date, importo). DF a giorni, FM a mesi solari (ultimo giorno). Split in parti uguali, ultima rata quadra il totale.';

-- =====================================================================
-- 3) HELPER PURO: anomalia di configurazione del fornitore (o NULL se ok)
--    Codifica la matrice "banca obbligatoria per metodo" concordata.
--    Ritorna: 'metodo_mancante' | 'banca_mancante' | 'piano_incompleto' | NULL
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_supplier_config_anomaly(p_supplier_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  s               public.suppliers%ROWTYPE;
  v_method        text;
  v_bank_required boolean;
  v_is_riba       boolean;
BEGIN
  SELECT * INTO s FROM public.suppliers WHERE id = p_supplier_id;
  IF NOT FOUND THEN
    RETURN NULL; -- fornitore non trovato: gestito a monte come 'fornitore_non_riconosciuto'
  END IF;

  v_method := COALESCE(s.default_payment_method::text, s.payment_method, '');

  IF v_method = '' THEN
    RETURN 'metodo_mancante';
  END IF;

  v_is_riba       := v_method LIKE 'riba%';
  v_bank_required := v_is_riba
                     OR v_method IN ('rid','sdd_core','sdd_b2b','carta_credito','carta_debito');

  IF v_bank_required AND s.payment_bank_account_id IS NULL THEN
    RETURN 'banca_mancante';
  END IF;

  -- Le RI.BA sono tipicamente multi-rata: serve il piano completo.
  IF v_is_riba
     AND (s.payment_base IS NULL OR s.prima_scadenza_gg IS NULL OR s.numero_rate IS NULL) THEN
    RETURN 'piano_incompleto';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.fn_supplier_config_anomaly(uuid) IS
  'Ritorna il tipo di anomalia di configurazione del fornitore (metodo_mancante | banca_mancante | piano_incompleto) o NULL se ok. Codifica la matrice banca-obbligatoria-per-metodo.';

-- =====================================================================
-- 4) TABELLA SEGNALAZIONI (anomalie) — stato CONDIVISO a livello azienda
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.payment_import_anomalies (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL,
  supplier_id           uuid REFERENCES public.suppliers(id) ON DELETE CASCADE,
  supplier_name         text,
  anomaly_type          text NOT NULL
    CHECK (anomaly_type IN ('metodo_mancante','banca_mancante','piano_incompleto',
                            'importo_non_quadra','fornitore_non_riconosciuto')),
  descrizione           text,              -- cosa non torna
  come_risolvere        text,              -- istruzioni per l'operatrice
  affected_invoice_ids  uuid[] NOT NULL DEFAULT '{}',
  stato                 text NOT NULL DEFAULT 'aperta'
    CHECK (stato IN ('aperta','risolta')),
  resolved_by           uuid,
  resolved_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payment_import_anomalies IS
  'Segnalazioni (a livello fornitore) generate all''import fattura quando la configurazione pagamenti non torna. Stato condiviso azienda: sparisce solo quando risolta. Alimenta il badge rosso su Fatturazione.';

-- Una sola anomalia APERTA per (azienda, fornitore, tipo)
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_anomaly_open
  ON public.payment_import_anomalies (company_id, supplier_id, anomaly_type)
  WHERE stato = 'aperta';

-- Conteggio badge: anomalie aperte per azienda
CREATE INDEX IF NOT EXISTS idx_payment_anomaly_open_company
  ON public.payment_import_anomalies (company_id)
  WHERE stato = 'aperta';

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.fn_payment_anomaly_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.stato = 'risolta' AND OLD.stato IS DISTINCT FROM 'risolta' AND NEW.resolved_at IS NULL THEN
    NEW.resolved_at := now();
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_payment_anomaly_touch ON public.payment_import_anomalies;
CREATE TRIGGER trg_payment_anomaly_touch
  BEFORE UPDATE ON public.payment_import_anomalies
  FOR EACH ROW EXECUTE FUNCTION public.fn_payment_anomaly_touch();

-- RLS: isolamento azienda (lettura a tutti i ruoli della company; scrittura ai ruoli operativi)
ALTER TABLE public.payment_import_anomalies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_anomalies_select" ON public.payment_import_anomalies;
CREATE POLICY "payment_anomalies_select" ON public.payment_import_anomalies
  AS PERMISSIVE FOR SELECT
  USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS "payment_anomalies_write" ON public.payment_import_anomalies;
CREATE POLICY "payment_anomalies_write" ON public.payment_import_anomalies
  AS PERMISSIVE
  USING ((company_id = get_my_company_id())
         AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role])))
  WITH CHECK ((company_id = get_my_company_id())
         AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role])));

COMMIT;

-- =====================================================================
-- VERIFICHE (da lanciare a mano dopo l'applicazione, sola lettura)
-- =====================================================================
-- 1) Esempi di calcolo scadenze (devono combaciare con quelli concordati):
--    FM 30/60/90, emiss 30/06/2026, 1200  -> 31/07, 31/08, 30/09 (400 cad.)
--    SELECT * FROM fn_supplier_installment_schedule('2026-06-30','fine_mese',30,3,1200);
--    DF 30/60/90, emiss 30/06/2026, 1200  -> 30/07, 29/08, 28/09 (400 cad.)
--    SELECT * FROM fn_supplier_installment_schedule('2026-06-30','data_fattura',30,3,1200);
--    Caso limite FM: 31/01/2026 30gg -> 28/02/2026 ; 31/01/2028 (bisestile) -> 29/02/2028
--    SELECT * FROM fn_supplier_installment_schedule('2026-01-31','fine_mese',30,1,900);
-- 2) Colonne aggiunte:
--    SELECT column_name FROM information_schema.columns
--      WHERE table_name='suppliers'
--        AND column_name IN ('payment_base','prima_scadenza_gg','numero_rate','payment_bank_account_id');
-- 3) Badge (conteggio anomalie aperte per azienda):
--    SELECT company_id, count(*) FROM payment_import_anomalies WHERE stato='aperta' GROUP BY 1;
