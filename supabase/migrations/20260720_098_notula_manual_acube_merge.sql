-- ════════════════════════════════════════════════════════════════════
-- 098 — Aggancio NOTULA MANUALE ↔ FATTURA A-Cube (SDI)
-- Applicare a mano su NZ + Made + Zago (additiva, idempotente, non distruttiva).
--
-- PROBLEMA (verificato su NZ, 2026-07-20):
--   Le "notule/proforma" (parcelle di studi: commercialista, consulenti) non hanno
--   ancora un numero fattura SDI quando arrivano. L'operatrice le inserisce a MANO
--   nello scadenzario per poterle pianificare/pagare. Quando poi lo stesso documento
--   viene emesso come fattura elettronica e arriva da A-Cube, porta un numero SDI
--   diverso (es. notula "SP_84" 2.750,00 → fattura "322/E" 2.750,00): la dedup
--   attuale (080) aggancia solo per electronic_invoice_id o per invoice_number
--   uguale, quindi NON riconosce la notula manuale → nasce un DOPPIONE (una riga
--   "pagata" a mano + una fattura A-Cube "scaduta" per lo stesso importo).
--
-- DECISIONE (Patrizio, opzione A):
--   Quando arriva la fattura A-Cube, se esiste già una notula manuale dello stesso
--   fornitore (per P.IVA) riconoscibile in modo NON ambiguo, la fattura vera
--   ASSORBE la notula: si tiene la riga manuale (con il suo stato pagato/
--   riconciliazione) e le si innestano numero e data VERI della fattura SDI +
--   electronic_invoice_id/acube_uuid. Se il match è AMBIGUO (più candidate, o
--   fornitori con importi ricorrenti identici tipo Tanesini) NON si fonde in
--   automatico: la coppia viene solo SEGNALATA per conferma manuale.
--
-- Match (in ordine di forza), sempre a parità di FORNITORE (P.IVA, o id, o nome):
--   1) NUMERO NORMALIZZATO uguale (togliendo zeri/prefissi: "5198" ≡ "005198");
--   2) altrimenti IMPORTO uguale (± 0,01) e DATA entro una finestra
--      [emissione_SDI − 200gg, emissione_SDI + 45gg] (la notula è di competenza
--      precedente all'emissione della fattura).
--   L'auto-merge scatta SOLO se il candidato è UNO SOLO ed è una notula a rata unica.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) Helper: normalizza un numero documento per il confronto
--    lower + rimuove tutto tranne [a-z0-9] + toglie zeri iniziali del blocco.
--    Es: "005198" -> "5198"; "5198" -> "5198"; "SP_84" -> "sp84"; "322/E" -> "322e".
CREATE OR REPLACE FUNCTION public.fn_normalize_invoice_number(p_num text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT regexp_replace(
           regexp_replace(lower(coalesce(p_num,'')), '[^a-z0-9]', '', 'g'),
           '^0+', ''
         );
$function$;

-- 2) Dedup chokepoint (BEFORE INSERT su payables): aggiunto il ramo notula-manuale.
--    Costruisce sopra 080 preservando ESATTAMENTE il comportamento esistente; il
--    nuovo ramo agisce solo quando l'INSERT è una fattura A-Cube (electronic_invoice_id
--    valorizzato) a rata unica e NON ha trovato match per electronic_invoice_id.
CREATE OR REPLACE FUNCTION public.fn_prevent_duplicate_payable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  existing_id uuid; existing_status text;
  v_notula_merge boolean := false;
  v_cands uuid[];
  v_norm text;
BEGIN
  -- Forecast/ricorrenti: nessuna dedup automatica (gestione manuale)
  IF NEW.is_forecast IS TRUE OR NEW.recurring_cost_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.electronic_invoice_id IS NOT NULL THEN
    -- Chiave primaria di import: fattura elettronica + rata (rata unica = 1)
    SELECT id, status::text INTO existing_id, existing_status
    FROM payables
    WHERE company_id = NEW.company_id
      AND electronic_invoice_id = NEW.electronic_invoice_id
      AND COALESCE(installment_number,1) = COALESCE(NEW.installment_number,1)
    ORDER BY (status='annullato')::int ASC,
             (COALESCE(amount_paid,0)>0 OR bank_transaction_id IS NOT NULL OR status IN ('pagato','parziale'))::int DESC,
             created_at ASC
    LIMIT 1;

    -- ── NUOVO: aggancio a NOTULA MANUALE (solo fattura a rata unica) ──────────
    -- Scatta solo se non c'è già un payable per questa fattura elettronica.
    IF existing_id IS NULL
       AND COALESCE(NEW.installment_number,1) = 1
       AND COALESCE(NEW.installment_total,1) = 1 THEN

      -- (a) match forte: numero normalizzato uguale
      v_norm := public.fn_normalize_invoice_number(NEW.invoice_number);
      IF v_norm <> '' THEN
        SELECT array_agg(id) INTO v_cands
        FROM payables
        WHERE company_id = NEW.company_id
          AND electronic_invoice_id IS NULL AND acube_uuid IS NULL
          AND status IS DISTINCT FROM 'annullato'
          AND COALESCE(installment_number,1) = 1
          AND public.fn_normalize_invoice_number(invoice_number) = v_norm
          AND (
            (NEW.supplier_vat IS NOT NULL AND NEW.supplier_vat <> '' AND supplier_vat = NEW.supplier_vat)
            OR (NEW.supplier_id IS NOT NULL AND supplier_id = NEW.supplier_id)
            OR (NEW.supplier_name IS NOT NULL AND supplier_name = NEW.supplier_name)
          );
        IF v_cands IS NOT NULL AND array_length(v_cands,1) = 1 THEN
          existing_id := v_cands[1]; v_notula_merge := true;
        END IF;
      END IF;

      -- (b) match per importo + finestra data (solo se (a) non ha deciso e UNA sola candidata)
      IF existing_id IS NULL AND NEW.gross_amount IS NOT NULL AND NEW.gross_amount <> 0 THEN
        SELECT array_agg(id) INTO v_cands
        FROM payables
        WHERE company_id = NEW.company_id
          AND electronic_invoice_id IS NULL AND acube_uuid IS NULL
          AND status IS DISTINCT FROM 'annullato'
          AND COALESCE(installment_number,1) = 1
          AND abs(coalesce(gross_amount,0) - NEW.gross_amount) < 0.01
          AND NEW.invoice_date IS NOT NULL AND invoice_date IS NOT NULL
          AND invoice_date BETWEEN (NEW.invoice_date - 200) AND (NEW.invoice_date + 45)
          AND (
            (NEW.supplier_vat IS NOT NULL AND NEW.supplier_vat <> '' AND supplier_vat = NEW.supplier_vat)
            OR (NEW.supplier_id IS NOT NULL AND supplier_id = NEW.supplier_id)
            OR (NEW.supplier_name IS NOT NULL AND supplier_name = NEW.supplier_name)
          );
        IF v_cands IS NOT NULL AND array_length(v_cands,1) = 1 THEN
          existing_id := v_cands[1]; v_notula_merge := true;
          SELECT status::text INTO existing_status FROM payables WHERE id = existing_id;
        END IF;
      END IF;
    END IF;

  ELSIF NEW.invoice_number IS NOT NULL AND NEW.invoice_number <> '' THEN
    -- Fallback senza fattura elettronica: numero + rata + fornitore (mai due_date)
    SELECT id, status::text INTO existing_id, existing_status
    FROM payables
    WHERE company_id = NEW.company_id
      AND electronic_invoice_id IS NULL
      AND invoice_number = NEW.invoice_number
      AND COALESCE(installment_number,1) = COALESCE(NEW.installment_number,1)
      AND (
        (supplier_id IS NOT NULL AND supplier_id = NEW.supplier_id)
        OR (supplier_vat IS NOT NULL AND supplier_vat <> '' AND supplier_vat = NEW.supplier_vat)
        OR (supplier_name IS NOT NULL AND supplier_name <> '' AND supplier_name = NEW.supplier_name)
      )
    ORDER BY (status='annullato')::int ASC,
             (COALESCE(amount_paid,0)>0 OR bank_transaction_id IS NOT NULL OR status IN ('pagato','parziale'))::int DESC,
             created_at ASC
    LIMIT 1;
  ELSE
    RETURN NEW;
  END IF;

  IF existing_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- ── Caso NOTULA: la fattura vera assorbe la notula manuale ──────────────────
  -- Si tiene la riga manuale (stato pagato/riconciliazione INTATTI) e le si
  -- innestano numero e data VERI della fattura SDI + i riferimenti elettronici.
  IF v_notula_merge THEN
    UPDATE payables SET
      invoice_number        = NEW.invoice_number,
      invoice_date          = NEW.invoice_date,
      electronic_invoice_id = NEW.electronic_invoice_id,
      acube_uuid            = COALESCE(acube_uuid, NEW.acube_uuid),
      net_amount            = COALESCE(NEW.net_amount, net_amount),
      vat_amount            = COALESCE(NEW.vat_amount, vat_amount),
      gross_amount          = COALESCE(NEW.gross_amount, gross_amount),
      -- se già pagata/parziale la scadenza non si tocca; altrimenti prende quella vera
      due_date              = CASE WHEN status IN ('pagato','parziale') THEN due_date
                                   ELSE COALESCE(NEW.due_date, due_date) END,
      original_due_date     = COALESCE(original_due_date, NEW.original_due_date, NEW.due_date),
      payment_method        = COALESCE(payment_method, NEW.payment_method),
      payment_method_code   = COALESCE(payment_method_code, NEW.payment_method_code),
      supplier_id           = COALESCE(supplier_id, NEW.supplier_id),
      supplier_name         = COALESCE(NEW.supplier_name, supplier_name),
      supplier_vat          = COALESCE(NEW.supplier_vat, supplier_vat),
      cost_category_id      = COALESCE(cost_category_id, NEW.cost_category_id),
      notes                 = COALESCE(NULLIF(notes,''), '') ||
                              CASE WHEN COALESCE(notes,'') <> '' THEN ' ' ELSE '' END ||
                              '[Notula agganciata alla fattura SDI ' || COALESCE(NEW.invoice_number,'') || ']',
      updated_at            = NOW()
    WHERE id = existing_id;
    RETURN NULL;  -- blocca l'INSERT della fattura A-Cube (la notula è diventata la fattura)
  END IF;

  -- Duplicato "classico": aggiorna SOLO dati di import/anagrafica sulla riga
  -- canonica non annullata; preserva status, amount_paid, payment_date,
  -- riconciliazione, note. (comportamento 080, invariato)
  IF existing_status IS DISTINCT FROM 'annullato' THEN
    UPDATE payables SET
      supplier_id          = COALESCE(NEW.supplier_id, supplier_id),
      supplier_name        = COALESCE(NEW.supplier_name, supplier_name),
      supplier_vat         = COALESCE(NEW.supplier_vat, supplier_vat),
      gross_amount         = COALESCE(NEW.gross_amount, gross_amount),
      net_amount           = COALESCE(NEW.net_amount, net_amount),
      vat_amount           = COALESCE(NEW.vat_amount, vat_amount),
      due_date             = COALESCE(NEW.due_date, due_date),
      original_due_date    = COALESCE(original_due_date, NEW.original_due_date, NEW.due_date),
      payment_method       = COALESCE(NEW.payment_method, payment_method),
      payment_method_code  = COALESCE(NEW.payment_method_code, payment_method_code),
      payment_method_label = COALESCE(NEW.payment_method_label, payment_method_label),
      iban                 = COALESCE(NEW.iban, iban),
      installment_total    = COALESCE(NEW.installment_total, installment_total),
      electronic_invoice_id= COALESCE(electronic_invoice_id, NEW.electronic_invoice_id),
      acube_uuid           = COALESCE(acube_uuid, NEW.acube_uuid),
      cost_category_id     = COALESCE(cost_category_id, NEW.cost_category_id),
      updated_at           = NOW()
    WHERE id = existing_id;
  END IF;
  RETURN NULL;  -- blocca l'INSERT del duplicato (idempotenza)
END;
$function$;

-- 3) RPC: elenca le possibili coppie NOTULA MANUALE ↔ FATTURA A-Cube già presenti.
--    Serve per: (a) sistemare il pregresso, (b) segnalare i casi AMBIGUI che il
--    trigger non fonde in automatico. SECURITY INVOKER: rispetta la RLS di payables.
CREATE OR REPLACE FUNCTION public.rpc_detect_notula_duplicates(p_company uuid)
 RETURNS TABLE (
   manual_id uuid, manual_number text, manual_date date, manual_amount numeric, manual_status text,
   acube_id uuid, acube_number text, acube_date date, acube_amount numeric, acube_status text,
   supplier_name text, match_reason text, ambiguo boolean
 )
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH manual AS (
    SELECT id, invoice_number, invoice_date, gross_amount, status::text AS st,
           supplier_id, supplier_vat, supplier_name
    FROM payables
    WHERE company_id = p_company
      AND electronic_invoice_id IS NULL AND acube_uuid IS NULL
      AND status IS DISTINCT FROM 'annullato'
      AND COALESCE(installment_number,1) = 1
  ),
  acube AS (
    SELECT id, invoice_number, invoice_date, gross_amount, status::text AS st,
           supplier_id, supplier_vat, supplier_name
    FROM payables
    WHERE company_id = p_company
      AND electronic_invoice_id IS NOT NULL
      AND status IS DISTINCT FROM 'annullato'
      AND COALESCE(installment_number,1) = 1 AND COALESCE(installment_total,1) = 1
  ),
  pairs AS (
    SELECT m.id AS manual_id, m.invoice_number AS manual_number, m.invoice_date AS manual_date,
           m.gross_amount AS manual_amount, m.st AS manual_status,
           a.id AS acube_id, a.invoice_number AS acube_number, a.invoice_date AS acube_date,
           a.gross_amount AS acube_amount, a.st AS acube_status,
           COALESCE(m.supplier_name, a.supplier_name) AS supplier_name,
           CASE
             WHEN public.fn_normalize_invoice_number(m.invoice_number) <> ''
              AND public.fn_normalize_invoice_number(m.invoice_number)
                  = public.fn_normalize_invoice_number(a.invoice_number) THEN 'numero'
             ELSE 'importo_data'
           END AS match_reason
    FROM manual m
    JOIN acube a
      ON (  -- entrambi i CTE sono già filtrati sulla stessa company (p_company)
           (m.supplier_vat IS NOT NULL AND m.supplier_vat <> '' AND a.supplier_vat = m.supplier_vat)
           OR (m.supplier_id IS NOT NULL AND a.supplier_id = m.supplier_id)
           OR (m.supplier_name IS NOT NULL AND a.supplier_name = m.supplier_name)
         )
     AND (
           ( public.fn_normalize_invoice_number(m.invoice_number) <> ''
             AND public.fn_normalize_invoice_number(m.invoice_number)
                 = public.fn_normalize_invoice_number(a.invoice_number) )
           OR
           ( m.gross_amount IS NOT NULL AND m.gross_amount <> 0
             AND abs(coalesce(a.gross_amount,0) - m.gross_amount) < 0.01
             AND m.invoice_date IS NOT NULL AND a.invoice_date IS NOT NULL
             AND m.invoice_date BETWEEN (a.invoice_date - 200) AND (a.invoice_date + 45) )
         )
  )
  SELECT p.manual_id, p.manual_number, p.manual_date, p.manual_amount, p.manual_status,
         p.acube_id, p.acube_number, p.acube_date, p.acube_amount, p.acube_status,
         p.supplier_name, p.match_reason,
         -- ambiguo = la stessa notula manuale combacia con più fatture A-Cube
         (COUNT(*) OVER (PARTITION BY p.manual_id)) > 1 AS ambiguo
  FROM pairs p
  ORDER BY p.supplier_name, p.manual_amount;
$function$;

-- 4) RPC: fonde una specifica coppia (notula manuale, fattura A-Cube).
--    Regola: sopravvive la riga che PORTA la riconciliazione/pagamento (così non si
--    spostano mai bank_transaction_id fra righe); l'altra viene ANNULLATA (mai DELETE).
--    Se entrambe risultano pagate/riconciliate → non tocca nulla e segnala.
CREATE OR REPLACE FUNCTION public.rpc_merge_manual_notula(
    p_company uuid, p_manual_id uuid, p_acube_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  m record; a record;
  m_paid boolean; a_paid boolean;
BEGIN
  SELECT * INTO m FROM payables WHERE id = p_manual_id AND company_id = p_company;
  SELECT * INTO a FROM payables WHERE id = p_acube_id  AND company_id = p_company;
  IF m.id IS NULL OR a.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'coppia non trovata per questa azienda');
  END IF;
  IF m.electronic_invoice_id IS NOT NULL OR a.electronic_invoice_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'la prima deve essere una notula manuale, la seconda una fattura A-Cube');
  END IF;

  m_paid := (COALESCE(m.amount_paid,0) > 0 OR m.bank_transaction_id IS NOT NULL OR m.status::text IN ('pagato','parziale'));
  a_paid := (COALESCE(a.amount_paid,0) > 0 OR a.bank_transaction_id IS NOT NULL OR a.status::text IN ('pagato','parziale'));

  IF m_paid AND a_paid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entrambe risultano pagate/riconciliate: verifica a mano');
  END IF;

  IF a_paid AND NOT m_paid THEN
    -- La fattura A-Cube è già pagata e ha già i riferimenti veri: la notula è il puro doppione.
    UPDATE payables SET
      notes = COALESCE(NULLIF(a.notes,''),'') ||
              CASE WHEN COALESCE(a.notes,'') <> '' THEN ' ' ELSE '' END ||
              '[Notula manuale ' || COALESCE(m.invoice_number,'') || ' assorbita]',
      updated_at = NOW()
    WHERE id = a.id;
    UPDATE payables SET status = 'annullato'::payable_status,
      notes = COALESCE(NULLIF(notes,''),'') ||
              CASE WHEN COALESCE(notes,'') <> '' THEN ' ' ELSE '' END ||
              '[Annullata: doppione della fattura SDI ' || COALESCE(a.invoice_number,'') || ']',
      updated_at = NOW()
    WHERE id = m.id;
    RETURN jsonb_build_object('ok', true, 'survivor', a.id, 'annullato', m.id, 'mode', 'acube_survives');
  END IF;

  -- Altrimenti: sopravvive la NOTULA (mantiene id e, se c'è, il suo pagamento);
  -- le si innestano numero/data VERI + riferimenti elettronici della fattura A-Cube.
  -- IMPORTANTE: prima si ANNULLA la riga A-Cube LIBERANDO le sue chiavi uniche
  -- (acube_uuid ha un vincolo UNIQUE pieno, electronic_invoice_id uno parziale):
  -- altrimenti per un istante due righe avrebbero lo stesso acube_uuid.
  UPDATE payables SET status = 'annullato'::payable_status,
    acube_uuid = NULL, electronic_invoice_id = NULL,
    notes = COALESCE(NULLIF(notes,''),'') ||
            CASE WHEN COALESCE(notes,'') <> '' THEN ' ' ELSE '' END ||
            '[Annullata: assorbita dalla notula manuale ora agganciata]',
    updated_at = NOW()
  WHERE id = a.id;
  UPDATE payables SET
    invoice_number        = a.invoice_number,
    invoice_date          = a.invoice_date,
    electronic_invoice_id = a.electronic_invoice_id,
    acube_uuid            = COALESCE(m.acube_uuid, a.acube_uuid),
    net_amount            = COALESCE(a.net_amount, m.net_amount),
    vat_amount            = COALESCE(a.vat_amount, m.vat_amount),
    gross_amount          = COALESCE(a.gross_amount, m.gross_amount),
    due_date              = CASE WHEN m.status::text IN ('pagato','parziale') THEN m.due_date
                                 ELSE COALESCE(a.due_date, m.due_date) END,
    original_due_date     = COALESCE(m.original_due_date, a.original_due_date, a.due_date),
    payment_method_code   = COALESCE(m.payment_method_code, a.payment_method_code),
    cost_category_id      = COALESCE(m.cost_category_id, a.cost_category_id),
    notes                 = COALESCE(NULLIF(m.notes,''),'') ||
                            CASE WHEN COALESCE(m.notes,'') <> '' THEN ' ' ELSE '' END ||
                            '[Notula agganciata alla fattura SDI ' || COALESCE(a.invoice_number,'') || ']',
    updated_at            = NOW()
  WHERE id = m.id;
  RETURN jsonb_build_object('ok', true, 'survivor', m.id, 'annullato', a.id, 'mode', 'notula_survives');
END;
$function$;

COMMIT;

-- ════════════════════════════════════════════════════════════════════
-- VERIFICA (dopo l'apply, per ogni tenant)
--   -- coppie sospette ancora aperte:
--   SELECT * FROM rpc_detect_notula_duplicates('<company_id>');
--   -- normalizzazione:
--   SELECT fn_normalize_invoice_number('005198'), fn_normalize_invoice_number('5198'); -- entrambe '5198'
-- ════════════════════════════════════════════════════════════════════
