-- ============================================================================
-- 352 — Fattura elettronica a più rate: si aggancia alla riga registrata dal PDF
-- ============================================================================
-- Nata il 05/11/2026 dal caso SISTEMI ANTITACCHEGGIO fattura 103 del 24/09/2026 (NZ).
-- Il 25/09 la fattura (4.495,70, 50% all'ordine e 50% a installazione) è stata
-- registrata a mano dal PDF di cortesia e l'acconto di 2.247,85 è stato pagato il
-- 28/09. Il 07/10 è arrivata la fattura elettronica 2026_FTA_103 con due rate da
-- 2.247,85: il bridge A-Cube ha creato due scadenze nuove e la riga a mano è rimasta
-- aperta. Lo Scadenzario segnava 6.743,55 da pagare invece di 2.247,85.
--
-- PERCHÉ NON SI AGGANCIAVA
-- `fn_prevent_duplicate_payable` cerca la riga senza fattura elettronica (notula,
-- PDF, proforma) solo quando la scadenza in arrivo è 1 di 1. Con una fattura a più
-- rate la ricerca non partiva; e anche partendo, confrontava l'importo della RATA
-- (2.247,85) con quello della riga a mano, che è il totale (4.495,70).
--
-- COSA CAMBIA
-- 1. Rata 1 di una fattura a più rate: si cerca una sola riga aperta senza fattura
--    elettronica dello stesso fornitore, con importo uguale al TOTALE della fattura
--    (o al totale meno la ritenuta) e stesso numero normalizzato oppure data nella
--    stessa finestra già usata per le notule (-200 / +45 giorni). Se c'è, quella riga
--    diventa la rata 1: prende numero, fattura elettronica, importo della rata e
--    piano; tiene pagamenti, movimento bancario, distinte, outlet e IBAN.
-- 2. Rata 2 e successive: se la rata 1 ha un pagato più alto del suo importo (acconto
--    oltre la prima rata), l'eccedenza passa alla rata in arrivo, fino al suo importo.
--
-- COSA NON FA
-- · non tocca righe già esistenti finché non arriva una fattura nuova;
-- · non aggancia se le righe candidate sono due o più (resta il comportamento di
--   prima, nessuna scelta a caso);
-- · il ramo delle fatture 1 di 1 resta identico.
--
-- MISURA del 05/11/2026 prima dell'applicazione: su NZ l'unico caso era la 103
-- (sistemato a mano lo stesso giorno, acconto spostato sulla rata 1); su Zago nessuno.
-- Tenant: NZ + Zago (Made escluso dal 03/11/2026).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_prevent_duplicate_payable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  existing_id uuid; existing_status text;
  v_notula_merge boolean := false; v_cands uuid[]; v_norm text;
  v_ei_gross numeric; v_ei_wh numeric;
  v_r1 uuid; v_excess numeric; v_give numeric; v_r1_paid_on date;
BEGIN
  IF NEW.is_forecast IS TRUE OR NEW.recurring_cost_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.electronic_invoice_id IS NOT NULL THEN
    SELECT id, status::text INTO existing_id, existing_status FROM payables
    WHERE company_id = NEW.company_id AND electronic_invoice_id = NEW.electronic_invoice_id
      AND COALESCE(installment_number,1) = COALESCE(NEW.installment_number,1)
    ORDER BY (status='annullato')::int ASC,
             (COALESCE(amount_paid,0)>0 OR bank_transaction_id IS NOT NULL OR status IN ('pagato','parziale'))::int DESC,
             created_at ASC LIMIT 1;
    IF existing_id IS NULL AND COALESCE(NEW.installment_number,1)=1 AND COALESCE(NEW.installment_total,1)=1 THEN
      v_norm := public.fn_normalize_invoice_number(NEW.invoice_number);
      IF v_norm <> '' THEN
        SELECT array_agg(id) INTO v_cands FROM payables
        WHERE company_id = NEW.company_id AND electronic_invoice_id IS NULL AND acube_uuid IS NULL
          AND status IS DISTINCT FROM 'annullato' AND COALESCE(installment_number,1)=1
          AND public.fn_normalize_invoice_number(invoice_number) = v_norm
          AND ((NEW.supplier_vat IS NOT NULL AND NEW.supplier_vat<>'' AND supplier_vat=NEW.supplier_vat)
               OR (NEW.supplier_id IS NOT NULL AND supplier_id=NEW.supplier_id)
               OR (NEW.supplier_name IS NOT NULL AND supplier_name=NEW.supplier_name));
        IF v_cands IS NOT NULL AND array_length(v_cands,1)=1 THEN existing_id:=v_cands[1]; v_notula_merge:=true; END IF;
      END IF;
      IF existing_id IS NULL AND NEW.gross_amount IS NOT NULL AND NEW.gross_amount<>0 THEN
        SELECT array_agg(id) INTO v_cands FROM payables
        WHERE company_id = NEW.company_id AND electronic_invoice_id IS NULL AND acube_uuid IS NULL
          AND status IS DISTINCT FROM 'annullato' AND COALESCE(installment_number,1)=1
          AND ( abs(coalesce(gross_amount,0) - NEW.gross_amount) < 0.01
                OR (COALESCE(NEW.withholding_amount,0) > 0
                    AND abs(coalesce(gross_amount,0) - (NEW.gross_amount + NEW.withholding_amount)) < 0.01) )
          AND NEW.invoice_date IS NOT NULL AND invoice_date IS NOT NULL
          AND invoice_date BETWEEN (NEW.invoice_date - 200) AND (NEW.invoice_date + 45)
          AND ((NEW.supplier_vat IS NOT NULL AND NEW.supplier_vat<>'' AND supplier_vat=NEW.supplier_vat)
               OR (NEW.supplier_id IS NOT NULL AND supplier_id=NEW.supplier_id)
               OR (NEW.supplier_name IS NOT NULL AND supplier_name=NEW.supplier_name));
        IF v_cands IS NOT NULL AND array_length(v_cands,1)=1 THEN
          existing_id:=v_cands[1]; v_notula_merge:=true;
          SELECT status::text INTO existing_status FROM payables WHERE id=existing_id;
        END IF;
      END IF;

    -- 352: fattura a più rate. La riga registrata dal PDF (importo = totale fattura)
    -- diventa la rata 1; l'acconto oltre la rata 1 passa alle rate successive.
    ELSIF existing_id IS NULL AND COALESCE(NEW.installment_total,1) > 1 THEN
      IF COALESCE(NEW.installment_number,1) = 1 THEN
        SELECT gross_amount, COALESCE(withholding_amount,0) INTO v_ei_gross, v_ei_wh
          FROM electronic_invoices WHERE id = NEW.electronic_invoice_id;
        IF COALESCE(v_ei_gross,0) > 0 THEN
          v_norm := public.fn_normalize_invoice_number(NEW.invoice_number);
          SELECT array_agg(id) INTO v_cands FROM payables
          WHERE company_id = NEW.company_id AND electronic_invoice_id IS NULL AND acube_uuid IS NULL
            AND status IS DISTINCT FROM 'annullato'
            AND COALESCE(installment_number,1)=1 AND COALESCE(installment_total,1)=1
            AND COALESCE(is_forecast,false)=false AND recurring_cost_id IS NULL
            AND ( abs(coalesce(gross_amount,0) - v_ei_gross) < 0.01
                  OR (v_ei_wh > 0 AND abs(coalesce(gross_amount,0) - (v_ei_gross - v_ei_wh)) < 0.01) )
            AND ( (COALESCE(v_norm,'') <> '' AND public.fn_normalize_invoice_number(invoice_number) = v_norm)
                  OR (NEW.invoice_date IS NOT NULL AND invoice_date IS NOT NULL
                      AND invoice_date BETWEEN (NEW.invoice_date - 200) AND (NEW.invoice_date + 45)) )
            AND ((NEW.supplier_vat IS NOT NULL AND NEW.supplier_vat<>'' AND supplier_vat=NEW.supplier_vat)
                 OR (NEW.supplier_id IS NOT NULL AND supplier_id=NEW.supplier_id)
                 OR (NEW.supplier_name IS NOT NULL AND supplier_name=NEW.supplier_name));
          IF v_cands IS NOT NULL AND array_length(v_cands,1)=1 THEN
            UPDATE payables SET
              invoice_number=NEW.invoice_number, invoice_date=NEW.invoice_date,
              electronic_invoice_id=NEW.electronic_invoice_id, acube_uuid=COALESCE(acube_uuid,NEW.acube_uuid),
              gross_amount=NEW.gross_amount, net_amount=NEW.net_amount, vat_amount=NEW.vat_amount,
              withholding_amount=COALESCE(NEW.withholding_amount,0),
              installment_number=1, installment_total=NEW.installment_total,
              due_date=CASE WHEN COALESCE(amount_paid,0)>0 OR status IN ('pagato','parziale') THEN due_date
                            ELSE COALESCE(NEW.due_date,due_date) END,
              original_due_date=COALESCE(NEW.original_due_date,NEW.due_date,original_due_date),
              payment_method=COALESCE(payment_method,NEW.payment_method),
              payment_method_code=COALESCE(payment_method_code,NEW.payment_method_code),
              payment_method_label=COALESCE(payment_method_label,NEW.payment_method_label),
              payment_bank_account_id=COALESCE(payment_bank_account_id,NEW.payment_bank_account_id),
              supplier_id=COALESCE(supplier_id,NEW.supplier_id), supplier_name=COALESCE(NEW.supplier_name,supplier_name),
              supplier_vat=COALESCE(NEW.supplier_vat,supplier_vat), cost_category_id=COALESCE(cost_category_id,NEW.cost_category_id),
              notes=COALESCE(NULLIF(notes,''),'')||CASE WHEN COALESCE(notes,'')<>'' THEN ' ' ELSE '' END
                    ||'[Registrata dal PDF, agganciata alla fattura SDI '||COALESCE(NEW.invoice_number,'')
                    ||' come rata 1 di '||NEW.installment_total||']',
              updated_at=NOW()
            WHERE id=v_cands[1];
            RETURN NULL;
          END IF;
        END IF;
      ELSE
        SELECT id, amount_paid - gross_amount, payment_date INTO v_r1, v_excess, v_r1_paid_on
          FROM payables
         WHERE company_id = NEW.company_id AND electronic_invoice_id = NEW.electronic_invoice_id
           AND COALESCE(installment_number,1) = 1 AND status IS DISTINCT FROM 'annullato'
           AND COALESCE(amount_paid,0) > COALESCE(gross_amount,0) + 0.005
         LIMIT 1;
        IF v_r1 IS NOT NULL AND COALESCE(NEW.gross_amount,0) > 0 THEN
          v_give := round(least(v_excess, NEW.gross_amount - COALESCE(NEW.amount_paid,0)), 2);
          IF v_give > 0 THEN
            UPDATE payables SET amount_paid = amount_paid - v_give WHERE id = v_r1;
            NEW.amount_paid := COALESCE(NEW.amount_paid,0) + v_give;
            NEW.amount_remaining := NEW.gross_amount - NEW.amount_paid;
            NEW.status := CASE WHEN NEW.amount_remaining <= 0 THEN 'pagato'::payable_status
                               ELSE 'parziale'::payable_status END;
            NEW.payment_date := COALESCE(NEW.payment_date, v_r1_paid_on);
            NEW.notes := COALESCE(NULLIF(NEW.notes,'') || ' ', '')
                         || '[Pagato ' || trim(to_char(v_give, 'FM999999990.00'))
                         || ' con l''acconto registrato sulla rata 1]';
          END IF;
        END IF;
      END IF;
    END IF;
  ELSIF NEW.invoice_number IS NOT NULL AND NEW.invoice_number <> '' THEN
    SELECT id, status::text INTO existing_id, existing_status FROM payables
    WHERE company_id = NEW.company_id AND electronic_invoice_id IS NULL
      AND invoice_number = NEW.invoice_number
      AND COALESCE(installment_number,1) = COALESCE(NEW.installment_number,1)
      AND ((supplier_id IS NOT NULL AND supplier_id=NEW.supplier_id)
           OR (supplier_vat IS NOT NULL AND supplier_vat<>'' AND supplier_vat=NEW.supplier_vat)
           OR (supplier_name IS NOT NULL AND supplier_name<>'' AND supplier_name=NEW.supplier_name))
    ORDER BY (status='annullato')::int ASC,
             (COALESCE(amount_paid,0)>0 OR bank_transaction_id IS NOT NULL OR status IN ('pagato','parziale'))::int DESC,
             created_at ASC LIMIT 1;
  ELSE RETURN NEW; END IF;
  IF existing_id IS NULL THEN RETURN NEW; END IF;
  IF v_notula_merge THEN
    UPDATE payables SET
      invoice_number=NEW.invoice_number, invoice_date=NEW.invoice_date,
      electronic_invoice_id=NEW.electronic_invoice_id, acube_uuid=COALESCE(acube_uuid,NEW.acube_uuid),
      net_amount=COALESCE(NEW.net_amount,net_amount), vat_amount=COALESCE(NEW.vat_amount,vat_amount),
      gross_amount=COALESCE(NEW.gross_amount,gross_amount),
      withholding_amount=COALESCE(NEW.withholding_amount,withholding_amount),
      due_date=CASE WHEN status IN ('pagato','parziale') THEN due_date ELSE COALESCE(NEW.due_date,due_date) END,
      original_due_date=COALESCE(original_due_date,NEW.original_due_date,NEW.due_date),
      payment_method=COALESCE(payment_method,NEW.payment_method),
      payment_method_code=COALESCE(payment_method_code,NEW.payment_method_code),
      supplier_id=COALESCE(supplier_id,NEW.supplier_id), supplier_name=COALESCE(NEW.supplier_name,supplier_name),
      supplier_vat=COALESCE(NEW.supplier_vat,supplier_vat), cost_category_id=COALESCE(cost_category_id,NEW.cost_category_id),
      notes=COALESCE(NULLIF(notes,''),'')||CASE WHEN COALESCE(notes,'')<>'' THEN ' ' ELSE '' END||'[Notula agganciata alla fattura SDI '||COALESCE(NEW.invoice_number,'')||']',
      updated_at=NOW()
    WHERE id=existing_id;
    RETURN NULL;
  END IF;
  IF existing_status IS DISTINCT FROM 'annullato' THEN
    UPDATE payables SET
      supplier_id=COALESCE(NEW.supplier_id,supplier_id), supplier_name=COALESCE(NEW.supplier_name,supplier_name),
      supplier_vat=COALESCE(NEW.supplier_vat,supplier_vat), gross_amount=COALESCE(NEW.gross_amount,gross_amount),
      withholding_amount=COALESCE(NEW.withholding_amount,withholding_amount),
      net_amount=COALESCE(NEW.net_amount,net_amount), vat_amount=COALESCE(NEW.vat_amount,vat_amount),
      due_date=COALESCE(NEW.due_date,due_date), original_due_date=COALESCE(original_due_date,NEW.original_due_date,NEW.due_date),
      payment_method=COALESCE(NEW.payment_method,payment_method), payment_method_code=COALESCE(NEW.payment_method_code,payment_method_code),
      payment_method_label=COALESCE(NEW.payment_method_label,payment_method_label), iban=COALESCE(NEW.iban,iban),
      installment_total=COALESCE(NEW.installment_total,installment_total),
      electronic_invoice_id=COALESCE(electronic_invoice_id,NEW.electronic_invoice_id), acube_uuid=COALESCE(acube_uuid,NEW.acube_uuid),
      cost_category_id=COALESCE(cost_category_id,NEW.cost_category_id), updated_at=NOW()
    WHERE id=existing_id;
  END IF;
  RETURN NULL;
END; $function$;
