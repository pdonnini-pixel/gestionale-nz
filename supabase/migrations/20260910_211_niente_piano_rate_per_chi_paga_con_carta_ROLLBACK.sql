-- ROLLBACK 20260910_211 — rimette il criterio della 178, dove «fornitore non riconosciuto»
-- scattava per ogni fornitore auto-creato senza piano, anche se pagato con carta.
-- Le segnalazioni chiuse dalla 211 non vengono riaperte qui: il ramo (C) e' one-shot e non
-- reinserisce una segnalazione gia' esistente. Per riaprirle davvero servirebbe cancellarle
-- da payment_import_anomalies, cosa che questo file NON fa di proposito.

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
