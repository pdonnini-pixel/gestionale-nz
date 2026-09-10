-- 20260910_211 — «Fornitore non riconosciuto» solo a chi ha davvero una dilazione da decidere
--
-- PERCHE' (Patrizio, 10/09/2026, guardando il riquadro rosso in Fatturazione): «perche' ho
-- ancora questi che non sono stati sistemati, visto che hai tutte le informazioni nelle
-- fatture per risolverle da solo?».
--
-- Perche' quella segnalazione chiedeva la cosa sbagliata. Il ramo (C) apriva
-- «fornitore non riconosciuto» a ogni fornitore auto-creato senza `payment_base`, anche a
-- chi si paga con la CARTA: li' un piano rate non esiste, la spesa e' gia' fatta e il conto
-- viene addebitato il 20 del mese dopo. Nessuna fattura potra' mai rispondere a quella
-- domanda, quindi la riga rossa sarebbe rimasta li' per sempre.
--
-- Sui dati NZ le 7 segnalazioni aperte erano tutte cosi': 6 fornitori cha hanno TUTTE le
-- scadenze ad addebito automatico (BELLUCO, CRESCIMANNA, Hills, Only The Food, PIETRASANTA,
-- Poke House) e BIZAY, che non ha nemmeno una scadenza a sistema.
--
-- COSA CAMBIA: il piano serve solo a chi ha almeno una scadenza degli ultimi 12 mesi che si
-- paga davvero a mano (non addebito automatico, non carta, non contanti). Chi non ne ha, o
-- ha come metodo carta o contanti, non viene piu' segnalato; le segnalazioni gia' aperte per
-- quel motivo si chiudono al primo refresh, e la migration le chiude subito con l'UPDATE
-- finale per non lasciare il riquadro rosso sporco fino al prossimo giro.
--
-- «Banca di pagamento mancante» resta intatta di proposito: quella e' una domanda vera (su
-- quale conto addebita la carta) e la risposta non sta nelle fatture, la da' l'amministrazione.
-- Gli altri rami (config metodo/banca, importo non quadra) sono invariati.
-- Rollback in _ROLLBACK.sql

CREATE OR REPLACE FUNCTION public.rpc_refresh_payment_anomalies()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_company     uuid := get_my_company_id();
  v_open        integer;
  r             record;
  v_type        text;
  v_desc        text;
  v_fix         text;
  v_mismatch    boolean;
  v_serve_piano boolean;
BEGIN
  IF v_company IS NULL THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT DISTINCT
      s.id                                   AS supplier_id,
      COALESCE(s.ragione_sociale, s.name)    AS nome,
      s.source                               AS source,
      s.payment_base                         AS payment_base,
      COALESCE(s.default_payment_method::text, s.payment_method, '') AS metodo
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
      v_serve_piano := r.payment_base IS NULL
        AND r.metodo NOT IN ('contanti', 'carta_credito', 'carta_debito')
        AND EXISTS (
          SELECT 1 FROM public.payables p
          WHERE p.company_id = v_company
            AND p.supplier_id = r.supplier_id
            AND p.invoice_date >= current_date - 365
            AND COALESCE(p.is_auto_debit, false) = false
            AND COALESCE(p.payment_method::text, '') NOT IN ('contanti', 'carta_credito', 'carta_debito')
            AND COALESCE(p.status::text, '') <> 'annullato'
        );

      IF v_serve_piano THEN
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
  'Scansiona i fornitori con fatture dal 31/07/2026 e apre/risolve le anomalie pagamento: config (metodo/banca/piano), importo_non_quadra (confronto CON SEGNO e AL NETTO DELLA RITENUTA D''ACCONTO) e fornitore_non_riconosciuto, che dal fix 211 riguarda solo chi ha davvero una dilazione da decidere: chi si paga con carta o contanti, o non ha scadenze da disporre a mano, non viene segnalato. Ritorna il n. di anomalie aperte (badge). Scope azienda.';

-- Chiusura immediata delle segnalazioni che il nuovo criterio non pone piu'.
UPDATE public.payment_import_anomalies a
   SET stato = 'risolta'
  FROM public.suppliers s
 WHERE s.id = a.supplier_id
   AND a.stato = 'aperta'
   AND a.anomaly_type = 'fornitore_non_riconosciuto'
   AND ( COALESCE(s.default_payment_method::text, s.payment_method, '') IN ('contanti','carta_credito','carta_debito')
         OR NOT EXISTS (
           SELECT 1 FROM public.payables p
           WHERE p.company_id = s.company_id AND p.supplier_id = s.id
             AND p.invoice_date >= current_date - 365
             AND COALESCE(p.is_auto_debit,false) = false
             AND COALESCE(p.payment_method::text,'') NOT IN ('contanti','carta_credito','carta_debito')
             AND COALESCE(p.status::text,'') <> 'annullato'
         ) );

-- VERIFICA su NZ dopo l'applicazione: restano solo le 11 «banca_mancante», che aspettano
-- il conto della carta aziendale dall'amministrazione.
-- SELECT anomaly_type, count(*) FROM public.payment_import_anomalies WHERE stato='aperta' GROUP BY 1;
