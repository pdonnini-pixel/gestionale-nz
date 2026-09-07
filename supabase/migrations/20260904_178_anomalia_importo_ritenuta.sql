-- =============================================================================
-- 178 — «Importo non quadra»: l'atteso e' al netto della ritenuta (NZ+Made+Zago)
-- =============================================================================
--
-- Conseguenza diretta della 176. Da quando le scadenze delle fatture con
-- ritenuta d'acconto nascono sull'importo da pagare (totale - ritenuta), il
-- controllo (B) di rpc_refresh_payment_anomalies le vedrebbe come «importo non
-- quadra»: confrontava la somma delle rate con il TOTALE DOCUMENTO.
-- Su una parcella con ritenuta al 20% sarebbe un falso positivo garantito.
--
-- COSA CAMBIA: l'importo atteso diventa
--   fattura normale -> ei.gross_amount - coalesce(ei.withholding_amount, 0)
--   nota di credito (TD04/TD08) -> -abs(ei.gross_amount), come prima
--     (il ramo NC del bridge resta sul totale documento, vedi 176)
-- La tolleranza resta greatest(0,05; abs(totale) * 0,1%).
-- Con ritenuta = 0 il confronto e' identico a prima: nessuna anomalia cambia
-- stato sulle fatture gia' a sistema.
--
-- Tutto il resto della funzione (rami A e C) e' invariato.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_refresh_payment_anomalies()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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

    -- (B) importo_non_quadra: confronto CON SEGNO (fix 151) e AL NETTO DELLA
    --     RITENUTA D'ACCONTO (fix 178). Le rate di una parcella con ritenuta
    --     sommano all'importo da pagare, non al totale documento.
    --     Note di credito (TD04/TD08): atteso -abs(gross_amount), invariato.
    SELECT EXISTS (
      SELECT 1
      FROM public.electronic_invoices ei
      JOIN public.payables p ON p.electronic_invoice_id = ei.id
      WHERE p.company_id = v_company
        AND p.supplier_id = r.supplier_id
        AND COALESCE(p.status::text, '') <> 'annullato'
        AND ei.invoice_date >= DATE '2026-07-31'
      GROUP BY ei.id, ei.gross_amount, ei.withholding_amount, ei.tipo_documento
      HAVING ei.gross_amount IS NULL
          OR ei.gross_amount = 0
          OR abs(
               sum(p.gross_amount)
               - CASE WHEN upper(COALESCE(ei.tipo_documento, '')) IN ('TD04', 'TD08')
                        THEN -abs(ei.gross_amount)
                      ELSE ei.gross_amount - COALESCE(ei.withholding_amount, 0)
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

    -- (C) fornitore_non_riconosciuto (INVARIATO): one-shot
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
$function$;

COMMENT ON FUNCTION public.rpc_refresh_payment_anomalies() IS
  'Scansiona i fornitori con fatture dal 31/07/2026 e apre/risolve le anomalie pagamento: config (metodo/banca/piano), importo_non_quadra (confronto CON SEGNO e AL NETTO DELLA RITENUTA D''ACCONTO; le note di credito TD04/TD08 attendono un payable negativo pari al totale documento) e fornitore_non_riconosciuto (auto-creato da rivedere, one-shot). Ritorna il n. di anomalie aperte (badge). Scope azienda.';

COMMIT;
