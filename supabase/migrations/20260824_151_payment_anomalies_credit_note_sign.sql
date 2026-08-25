-- 20260824_151_payment_anomalies_credit_note_sign.sql
--
-- FIX falso positivo "importo_non_quadra" sulle NOTE DI CREDITO.
--
-- Problema rilevato in produzione (NZ, pannello segnalazioni di Fatturazione):
--   5 delle 8 anomalie aperte erano tutte e sole note di credito (TD04).
--   Esempio: fattura GGZ SRL 15694/01 -> electronic_invoices.gross_amount = 112,24
--   (positivo, come arriva da SDI) mentre il payable generato dal bridge
--   sync_acube_sdi_passive_to_payable vale -112,24 (status 'nota_credito'),
--   perche' una NC riduce il debito. Il controllo della 097 confrontava
--   sum(payables) con ei.gross_amount SENZA tenere conto del segno:
--       abs(-112,24 - 112,24) = 224,48 > tolleranza -> anomalia.
--   Conseguenza: OGNI nota di credito dal 31/07/2026 in poi genera un'anomalia
--   che non si risolve mai da sola (il segno non tornera' mai), e il fornitore
--   resta segnalato in rosso pur essendo tutto corretto.
--
-- Soluzione: confrontare la somma delle rate con l'importo ATTESO CON SEGNO,
--   che per i documenti di credito (TD04 nota di credito, TD08 nota di debito
--   trattata come credito dal bridge) e' -abs(gross_amount), coerente con
--   quanto scrive il bridge stesso.
--
-- Additiva e non distruttiva: nessun dato toccato, solo CREATE OR REPLACE della
-- funzione di scansione. Le 5 anomalie false si chiudono da sole (ramo ELSE
-- gia' esistente, stato -> 'risolta') alla prima apertura della pagina
-- Fatturazione, senza cancellare nulla.
--
-- PARITA' TENANT (Regola #0): NZ -> Made -> Zago.

BEGIN;

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
    -- (A) ANOMALIE DI CONFIG (INVARIATO): metodo/banca/piano
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
    --     (payables non annullati) non quadrano con l'importo ATTESO, o lordo
    --     assente. Riapribile e auto-risolvibile.
    --     FIX 151: l'importo atteso e' CON SEGNO -> per le note di credito
    --     (TD04/TD08) il bridge scrive un payable negativo (-abs(totale)),
    --     quindi il confronto va fatto contro -abs(gross_amount). Prima la NC
    --     risultava sempre "non quadra" per il doppio dell'importo.
    SELECT EXISTS (
      SELECT 1
      FROM public.electronic_invoices ei
      JOIN public.payables p ON p.electronic_invoice_id = ei.id
      WHERE p.company_id = v_company
        AND p.supplier_id = r.supplier_id
        AND COALESCE(p.status::text, '') <> 'annullato'
        AND ei.invoice_date >= DATE '2026-07-31'
      GROUP BY ei.id, ei.gross_amount, ei.tipo_documento
      HAVING ei.gross_amount IS NULL
          OR ei.gross_amount = 0
          OR abs(
               sum(p.gross_amount)
               - CASE WHEN upper(COALESCE(ei.tipo_documento, '')) IN ('TD04', 'TD08')
                        THEN -abs(ei.gross_amount)
                      ELSE ei.gross_amount
                 END
             ) > greatest(0.05, abs(ei.gross_amount) * 0.001)
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

    -- (C) fornitore_non_riconosciuto (INVARIATO): fornitore auto-creato
    --     dall'import (source='acube_sdi') senza piano esplicito. ONE-SHOT.
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
  'Scansiona i fornitori con fatture dal 31/07/2026 e apre/risolve le anomalie pagamento: config (metodo/banca/piano), importo_non_quadra (riapribile, confronto CON SEGNO: le note di credito TD04/TD08 attendono un payable negativo) e fornitore_non_riconosciuto (auto-creato da rivedere, one-shot). Ritorna il n. di anomalie aperte (badge). Scope azienda.';

GRANT EXECUTE ON FUNCTION public.rpc_refresh_payment_anomalies() TO authenticated;

COMMIT;

-- =====================================================================
-- VERIFICHE (sola lettura, dopo l'applicazione)
-- =====================================================================
-- 1) Fatture che NON quadrano davvero (deve NON contenere piu' le TD04):
--    SELECT ei.invoice_number, ei.tipo_documento, ei.gross_amount,
--           sum(p.gross_amount) AS somma_rate
--      FROM public.electronic_invoices ei
--      JOIN public.payables p ON p.electronic_invoice_id = ei.id
--     WHERE ei.invoice_date >= DATE '2026-07-31'
--       AND COALESCE(p.status::text,'') <> 'annullato'
--     GROUP BY ei.id, ei.invoice_number, ei.tipo_documento, ei.gross_amount
--    HAVING ei.gross_amount IS NULL OR ei.gross_amount = 0
--        OR abs(sum(p.gross_amount) - CASE WHEN upper(coalesce(ei.tipo_documento,'')) IN ('TD04','TD08')
--                                          THEN -abs(ei.gross_amount) ELSE ei.gross_amount END)
--           > greatest(0.05, abs(ei.gross_amount)*0.001);
-- 2) Stato anomalie dopo la prima apertura della pagina Fatturazione:
--    SELECT anomaly_type, stato, count(*) FROM public.payment_import_anomalies GROUP BY 1,2 ORDER BY 1,2;
