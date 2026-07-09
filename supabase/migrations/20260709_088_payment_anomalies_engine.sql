-- 20260709_088_payment_anomalies_engine.sql
--
-- MOTORE delle segnalazioni "anomalie configurazione pagamento fornitore".
-- Completa la 087 con due RPC usate dal frontend (Fatturazione):
--   * rpc_refresh_payment_anomalies(): scansiona i fornitori che hanno fatture
--     con emissione >= 31/07/2026 e, per ognuno, apre/risolve l'anomalia di
--     configurazione (metodo/banca/piano) usando fn_supplier_config_anomaly.
--     Idempotente. Auto-risolve quelle ormai a posto. Ritorna il n. di anomalie
--     aperte (per il badge). Scope: azienda del chiamante (get_my_company_id()).
--   * rpc_resolve_payment_anomaly(uuid): marca "risolta" una segnalazione.
--
-- SICURO: scrive SOLO su payment_import_anomalies. Non tocca payables/fatture,
-- non modifica flussi di import. La generazione automatica delle rate in
-- payables all'import resta uno step successivo (vedi PAYMENT_PLAN_NOTES.md),
-- da integrare col bridge A-Cube e testare prima su ambiente reale.
--
-- PARITA' TENANT (Regola #0): applicare su NZ + Made + Zago.
-- Idempotente e non distruttivo.

BEGIN;

-- Testi "descrizione" + "come risolvere" per tipo anomalia (unico punto di verità)
CREATE OR REPLACE FUNCTION public.fn_payment_anomaly_texts(p_type text)
RETURNS TABLE(descrizione text, come_risolvere text)
LANGUAGE sql IMMUTABLE AS $$
  SELECT
    CASE p_type
      WHEN 'metodo_mancante'          THEN 'Il fornitore non ha la modalità di pagamento impostata.'
      WHEN 'banca_mancante'           THEN 'La modalità di pagamento richiede una banca (RI.BA / carta / RID) ma non è assegnata.'
      WHEN 'piano_incompleto'         THEN 'Piano rate incompleto: mancano base (data fattura / fine mese), giorni prima scadenza o numero rate.'
      WHEN 'importo_non_quadra'       THEN 'La somma delle rate non corrisponde all''importo della fattura.'
      WHEN 'fornitore_non_riconosciuto' THEN 'La fattura arriva da un fornitore non presente in anagrafica.'
      ELSE 'Anomalia di configurazione pagamento.'
    END,
    CASE p_type
      WHEN 'metodo_mancante'          THEN 'Vai in Fornitori → apri il fornitore → imposta la Modalità di pagamento.'
      WHEN 'banca_mancante'           THEN 'Vai in Fornitori → apri il fornitore → assegna la Banca di pagamento (serve per il cashflow).'
      WHEN 'piano_incompleto'         THEN 'Vai in Fornitori → apri il fornitore → completa base, 1ª scadenza (gg) e numero rate.'
      WHEN 'importo_non_quadra'       THEN 'Verifica l''importo della fattura e correggi le scadenze a mano.'
      WHEN 'fornitore_non_riconosciuto' THEN 'Crea o associa il fornitore in anagrafica, poi rigenera le scadenze.'
      ELSE 'Verifica la configurazione del fornitore.'
    END;
$$;

-- Scansione/refresh anomalie di configurazione per l'azienda del chiamante
CREATE OR REPLACE FUNCTION public.rpc_refresh_payment_anomalies()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := get_my_company_id();
  v_open    integer;
  r         record;
  v_type    text;
  v_desc    text;
  v_fix     text;
BEGIN
  IF v_company IS NULL THEN
    RETURN 0;
  END IF;

  -- Fornitori dell'azienda che hanno almeno una fattura emessa dal 31/07/2026
  -- (match best-effort per P.IVA o ragione sociale normalizzata).
  FOR r IN
    SELECT DISTINCT s.id AS supplier_id, COALESCE(s.ragione_sociale, s.name) AS nome
    FROM public.suppliers s
    WHERE s.company_id = v_company
      AND COALESCE(s.is_deleted, false) = false
      AND EXISTS (
        SELECT 1 FROM public.electronic_invoices ei
        WHERE ei.company_id = v_company
          AND ei.invoice_date >= DATE '2026-07-31'
          AND (
            (s.partita_iva IS NOT NULL AND ei.supplier_vat = s.partita_iva)
            OR regexp_replace(upper(ei.supplier_name), '[^A-Z0-9]', '', 'g')
             = regexp_replace(upper(COALESCE(s.ragione_sociale, s.name, '')), '[^A-Z0-9]', '', 'g')
          )
      )
  LOOP
    v_type := public.fn_supplier_config_anomaly(r.supplier_id);

    IF v_type IS NOT NULL THEN
      SELECT descrizione, come_risolvere INTO v_desc, v_fix
        FROM public.fn_payment_anomaly_texts(v_type);

      INSERT INTO public.payment_import_anomalies
        (company_id, supplier_id, supplier_name, anomaly_type, descrizione, come_risolvere)
      VALUES (v_company, r.supplier_id, r.nome, v_type, v_desc, v_fix)
      ON CONFLICT (company_id, supplier_id, anomaly_type) WHERE stato = 'aperta'
      DO NOTHING;
    ELSE
      -- Configurazione ora a posto: risolvi eventuali anomalie di config aperte.
      UPDATE public.payment_import_anomalies
        SET stato = 'risolta'
      WHERE company_id = v_company
        AND supplier_id = r.supplier_id
        AND stato = 'aperta'
        AND anomaly_type IN ('metodo_mancante', 'banca_mancante', 'piano_incompleto');
    END IF;
  END LOOP;

  SELECT count(*) INTO v_open
    FROM public.payment_import_anomalies
    WHERE company_id = v_company AND stato = 'aperta';
  RETURN v_open;
END;
$$;

COMMENT ON FUNCTION public.rpc_refresh_payment_anomalies() IS
  'Scansiona i fornitori con fatture emesse dal 31/07/2026 e apre/risolve le anomalie di configurazione pagamento. Ritorna il n. di anomalie aperte (badge). Scope azienda.';

-- Risoluzione manuale di una segnalazione
CREATE OR REPLACE FUNCTION public.rpc_resolve_payment_anomaly(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := get_my_company_id();
BEGIN
  IF v_company IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.payment_import_anomalies
    SET stato = 'risolta', resolved_by = auth.uid()
  WHERE id = p_id AND company_id = v_company AND stato = 'aperta';
  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.rpc_resolve_payment_anomaly(uuid) IS
  'Marca risolta una segnalazione (scope azienda). Ritorna true se aggiornata.';

-- Permessi esecuzione (RLS sulle tabelle resta attiva; le RPC sono SECURITY DEFINER
-- ma filtrano sempre per get_my_company_id()).
GRANT EXECUTE ON FUNCTION public.rpc_refresh_payment_anomalies() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_resolve_payment_anomaly(uuid) TO authenticated;

COMMIT;
