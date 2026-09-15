-- 20260715_097_payment_anomalies_data_checks.sql
--
-- Completa il motore anomalie pagamento (migration 087/088) con i due tipi di
-- segnalazione finora DEFINITI ma MAI generati da nessuno:
--   * importo_non_quadra       -> la somma delle rate di una fattura non torna col lordo
--   * fornitore_non_riconosciuto -> fornitore entrato da solo dall'import, ancora da rivedere
--
-- Contesto / regole (coerenti con PAYMENT_PLAN_NOTES.md e le migration 087-089):
--   * Ambito invariato: SOLO fatture con emissione >= 31/07/2026 (il pregresso non
--     si tocca). Scope azienda del chiamante (get_my_company_id()).
--   * NON si tocca il bridge A-Cube (sync_acube_sdi_passive_to_payable): tutta la
--     rilevazione avviene nella RPC di scansione gia' esistente
--     rpc_refresh_payment_anomalies(), che il frontend chiama al mount del pannello
--     Fatturazione. Additivo, idempotente, non distruttivo.
--
-- Semantica concordata:
--   * importo_non_quadra: a livello fornitore, RIAPRIBILE e AUTO-RISOLVIBILE.
--     Apre se almeno una fattura >= 31/07 del fornitore ha somma rate != lordo
--     (tolleranza) o lordo assente; si risolve da sola quando torna a quadrare.
--   * fornitore_non_riconosciuto: siccome il bridge CREA da solo il fornitore
--     mancante (con default 'bonifico_ordinario', che NON fa scattare alcuna
--     anomalia di config), un fornitore auto-creato resterebbe invisibile.
--     Qui lo segnaliamo UNA VOLTA (one-shot): fornitore source='acube_sdi' con
--     fatture >= 31/07 e senza piano esplicito (payment_base IS NULL) => "va rivisto".
--     E' one-shot: una volta segnato risolto (o completato il piano) NON ri-scatta.
--
-- PARITA' TENANT (Regola #0): applicare a mano su NZ + Made + Zago.

BEGIN;

-- ---------------------------------------------------------------------
-- 1) Aggiorno i testi: il tipo 'fornitore_non_riconosciuto' cambia significato
--    (non piu' "fattura senza fornitore" ma "fornitore auto-creato da rivedere").
--    Gli altri testi restano identici alla 088.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_payment_anomaly_texts(p_type text)
RETURNS TABLE(descrizione text, come_risolvere text)
LANGUAGE sql IMMUTABLE AS $$
  SELECT
    CASE p_type
      WHEN 'metodo_mancante'          THEN 'Il fornitore non ha la modalità di pagamento impostata.'
      WHEN 'banca_mancante'           THEN 'La modalità di pagamento richiede una banca (RI.BA / carta / RID) ma non è assegnata.'
      WHEN 'piano_incompleto'         THEN 'Piano rate incompleto: mancano base (data fattura / fine mese), giorni prima scadenza o numero rate.'
      WHEN 'importo_non_quadra'       THEN 'La somma delle rate non corrisponde all''importo della fattura.'
      WHEN 'fornitore_non_riconosciuto' THEN 'Fornitore creato automaticamente dall''import: va rivisto e completato (metodo, banca, piano rate).'
      ELSE 'Anomalia di configurazione pagamento.'
    END,
    CASE p_type
      WHEN 'metodo_mancante'          THEN 'Vai in Fornitori → apri il fornitore → imposta la Modalità di pagamento.'
      WHEN 'banca_mancante'           THEN 'Vai in Fornitori → apri il fornitore → assegna la Banca di pagamento (serve per il cashflow).'
      WHEN 'piano_incompleto'         THEN 'Vai in Fornitori → apri il fornitore → completa base, 1ª scadenza (gg) e numero rate.'
      WHEN 'importo_non_quadra'       THEN 'Verifica l''importo della fattura e correggi le scadenze a mano.'
      WHEN 'fornitore_non_riconosciuto' THEN 'Vai in Fornitori → apri il fornitore → verifica i dati e imposta il piano di pagamento, poi segna risolto.'
      ELSE 'Verifica la configurazione del fornitore.'
    END;
$$;

-- ---------------------------------------------------------------------
-- 2) Estendo la scansione: oltre alle 3 anomalie di config (invariate),
--    rileva importo_non_quadra (riapribile) e fornitore_non_riconosciuto (one-shot).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_refresh_payment_anomalies()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company  uuid := get_my_company_id();
  v_open     integer;
  r          record;
  v_type     text;
  v_desc     text;
  v_fix      text;
  v_mismatch boolean;
BEGIN
  IF v_company IS NULL THEN
    RETURN 0;
  END IF;

  -- Fornitori dell'azienda con almeno una fattura emessa dal 31/07/2026
  -- (match best-effort per P.IVA o ragione sociale normalizzata).
  FOR r IN
    SELECT DISTINCT
      s.id                                   AS supplier_id,
      COALESCE(s.ragione_sociale, s.name)    AS nome,
      s.source                               AS source,
      s.payment_base                         AS payment_base
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
    -- (A) ANOMALIE DI CONFIG (INVARIATO rispetto alla 088): metodo/banca/piano
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
      UPDATE public.payment_import_anomalies
        SET stato = 'risolta'
      WHERE company_id = v_company
        AND supplier_id = r.supplier_id
        AND stato = 'aperta'
        AND anomaly_type IN ('metodo_mancante', 'banca_mancante', 'piano_incompleto');
    END IF;

    -- (B) importo_non_quadra: una fattura >= 31/07 del fornitore le cui rate
    --     (payables non annullati) non quadrano col lordo, o lordo assente.
    --     Riapribile e auto-risolvibile.
    SELECT EXISTS (
      SELECT 1
      FROM public.electronic_invoices ei
      JOIN public.payables p ON p.electronic_invoice_id = ei.id
      WHERE p.company_id = v_company
        AND p.supplier_id = r.supplier_id
        AND COALESCE(p.status::text, '') <> 'annullato'
        AND ei.invoice_date >= DATE '2026-07-31'
      GROUP BY ei.id, ei.gross_amount
      HAVING ei.gross_amount IS NULL
          OR ei.gross_amount = 0
          OR abs(sum(p.gross_amount) - ei.gross_amount) > greatest(0.05, abs(ei.gross_amount) * 0.001)
    ) INTO v_mismatch;

    IF v_mismatch THEN
      SELECT descrizione, come_risolvere INTO v_desc, v_fix
        FROM public.fn_payment_anomaly_texts('importo_non_quadra');
      INSERT INTO public.payment_import_anomalies
        (company_id, supplier_id, supplier_name, anomaly_type, descrizione, come_risolvere)
      VALUES (v_company, r.supplier_id, r.nome, 'importo_non_quadra', v_desc, v_fix)
      ON CONFLICT (company_id, supplier_id, anomaly_type) WHERE stato = 'aperta'
      DO NOTHING;
    ELSE
      UPDATE public.payment_import_anomalies
        SET stato = 'risolta'
      WHERE company_id = v_company
        AND supplier_id = r.supplier_id
        AND stato = 'aperta'
        AND anomaly_type = 'importo_non_quadra';
    END IF;

    -- (C) fornitore_non_riconosciuto: fornitore auto-creato dall'import
    --     (source='acube_sdi') senza piano esplicito -> va rivisto. ONE-SHOT:
    --     segnalato una sola volta, non ri-scatta dopo "risolto"/completamento.
    IF r.source = 'acube_sdi' THEN
      IF r.payment_base IS NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.payment_import_anomalies
          WHERE company_id = v_company
            AND supplier_id = r.supplier_id
            AND anomaly_type = 'fornitore_non_riconosciuto'
        ) THEN
          SELECT descrizione, come_risolvere INTO v_desc, v_fix
            FROM public.fn_payment_anomaly_texts('fornitore_non_riconosciuto');
          INSERT INTO public.payment_import_anomalies
            (company_id, supplier_id, supplier_name, anomaly_type, descrizione, come_risolvere)
          VALUES (v_company, r.supplier_id, r.nome, 'fornitore_non_riconosciuto', v_desc, v_fix);
        END IF;
      ELSE
        -- Piano ora impostato: il fornitore e' stato rivisto -> risolvi eventuale aperta.
        UPDATE public.payment_import_anomalies
          SET stato = 'risolta'
        WHERE company_id = v_company
          AND supplier_id = r.supplier_id
          AND stato = 'aperta'
          AND anomaly_type = 'fornitore_non_riconosciuto';
      END IF;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_open
    FROM public.payment_import_anomalies
    WHERE company_id = v_company AND stato = 'aperta';
  RETURN v_open;
END;
$$;

COMMENT ON FUNCTION public.rpc_refresh_payment_anomalies() IS
  'Scansiona i fornitori con fatture dal 31/07/2026 e apre/risolve le anomalie pagamento: config (metodo/banca/piano), importo_non_quadra (riapribile) e fornitore_non_riconosciuto (auto-creato da rivedere, one-shot). Ritorna il n. di anomalie aperte (badge). Scope azienda.';

GRANT EXECUTE ON FUNCTION public.rpc_refresh_payment_anomalies() TO authenticated;

COMMIT;

-- =====================================================================
-- VERIFICHE (sola lettura, da lanciare a mano dopo l'applicazione)
-- =====================================================================
-- 1) Ricalcola e conta le anomalie aperte dell'azienda del chiamante:
--    SELECT public.rpc_refresh_payment_anomalies();
-- 2) Dettaglio per tipo:
--    SELECT anomaly_type, stato, count(*)
--      FROM public.payment_import_anomalies
--     GROUP BY 1,2 ORDER BY 1,2;
-- 3) Fatture che NON quadrano (per capire dove agire), esempio:
--    SELECT ei.id, ei.invoice_number, ei.gross_amount,
--           sum(p.gross_amount) AS somma_rate
--      FROM public.electronic_invoices ei
--      JOIN public.payables p ON p.electronic_invoice_id = ei.id
--     WHERE ei.invoice_date >= DATE '2026-07-31'
--       AND COALESCE(p.status::text,'') <> 'annullato'
--     GROUP BY ei.id, ei.invoice_number, ei.gross_amount
--    HAVING ei.gross_amount IS NULL OR ei.gross_amount = 0
--        OR abs(sum(p.gross_amount) - ei.gross_amount) > greatest(0.05, abs(ei.gross_amount)*0.001);
