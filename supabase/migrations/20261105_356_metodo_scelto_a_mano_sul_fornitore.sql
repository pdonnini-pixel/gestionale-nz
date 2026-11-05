-- 20261105_356 — Il metodo di pagamento scelto a mano sul fornitore vale per le sue fatture aperte
--
-- Il caso (05/11/2026, NZ). L UNDICESIMO DI GIUSTI LUIGI & GENNY S.A.S. (Reggello) ha in
-- anagrafica «bonifico», ma le fatture 306 del 06/10 (31,00) e 339 del 03/11 (27,00) restavano
-- «Carta di credito, addebito automatico» al 20 del mese dopo. Patrizio: «cambiata modalità di
-- pagamento a bonifico, e se cambio deve cambiare le fatture».
--
-- La causa. In fn_payable_auto_debit la CATEGORIA vince sull'anagrafica: «Viaggi e trasferte»
-- ha auto_debit_card = true e le fatture non dichiarano il codice MP, quindi la scadenza nasce
-- a carta qualunque cosa dica il fornitore. Va bene per il bonifico scritto d'ufficio dal vecchio
-- bridge (B&B Hotels, Corte delle Fucine & C. si pagano davvero con la carta), non va bene per
-- un metodo che una persona ha scelto. E cambiare il metodo del fornitore non toccava le
-- scadenze già nate.
--
-- Il fix.
--  1. suppliers.payment_method_user_at: quando una persona (sessione con auth.uid()) cambia il
--     metodo di un fornitore, si segna l'ora. I percorsi di sistema (bridge, profilo dalla
--     fattura, cron) non lo segnano: girano senza utente o marcano 'metodo_pagamento' in
--     profile_from_invoice_fields.
--  2. fn_payable_auto_debit: se il fornitore ha un metodo scelto a mano, comanda quello, sopra
--     alla categoria, all'anagrafica d'ufficio e al codice MP della fattura (regola: un valore
--     inserito a mano non si sovrascrive mai, nemmeno con un dato del documento).
--     Carta scelta a mano → addebito automatico al 20 del mese dopo come prima.
--     Altro metodo → la scadenza nuova nasce con quel metodo; in UPDATE la riga non viene più
--     riportata a carta dalla categoria.
--  3. Trigger AFTER UPDATE su suppliers: quando il metodo scelto a mano cambia, si riallineano
--     le scadenze APERTE e mai toccate da un pagamento (niente importo pagato, niente movimento
--     agganciato, niente chiusura manuale). Uscendo dalla carta la data torna quella della
--     fattura o del piano del fornitore; entrando nella carta va al 20 del mese dopo. Importi e
--     stato invariati. Una riga in payable_actions per ogni scadenza cambiata.
--  4. Dati: il fornitore del caso viene segnato con l'ora del salvataggio di Patrizio
--     (15:56 ora di Roma del 05/11/2026) e le sue 2 scadenze aperte passano a bonifico.
--     Backup in payables_backup_metodo_fornitore_20261105.
--
-- Tenant: NZ + Zago (regola #0 aggiornata al 03/11/2026). Il frontend non cambia: la marcatura
-- avviene nel database, quindi su Made (colonna assente) tutto resta come prima.
-- Rollback in _ROLLBACK.sql

-- ── 1. colonna ───────────────────────────────────────────────────────────────
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS payment_method_user_at timestamptz;
COMMENT ON COLUMN public.suppliers.payment_method_user_at IS
  'Quando una persona ha scelto il metodo di pagamento. Se valorizzato, il metodo del fornitore comanda sulle scadenze (sopra categoria e codice MP). Migration 356.';

-- ── 2. marcatura della scelta umana ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_supplier_mark_method_choice()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (NEW.payment_method IS DISTINCT FROM OLD.payment_method
      OR NEW.default_payment_method IS DISTINCT FROM OLD.default_payment_method)
     AND (SELECT auth.uid()) IS NOT NULL
     -- il profilo dalla fattura, se gira in una sessione utente, marca il campo come suo
     AND NOT ('metodo_pagamento' = ANY (coalesce(NEW.profile_from_invoice_fields, ARRAY[]::text[]))
              AND NOT ('metodo_pagamento' = ANY (coalesce(OLD.profile_from_invoice_fields, ARRAY[]::text[]))))
  THEN
    NEW.payment_method_user_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_supplier_mark_method_choice ON public.suppliers;
CREATE TRIGGER trg_supplier_mark_method_choice
  BEFORE UPDATE OF payment_method, default_payment_method ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.fn_supplier_mark_method_choice();

-- ── 3. il trigger delle scadenze rispetta la scelta umana ────────────────────
CREATE OR REPLACE FUNCTION public.fn_payable_auto_debit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_xml_mp    text := NULL;
  v_mp        text;
  v_scontrino boolean := false;
  v_is_mp08   boolean;
  v_is_mp01   boolean;
  v_gia_sdd   boolean;
  v_altro     boolean;
  v_should    boolean;
  v_cat       boolean;
  v_sup       boolean;
  v_user_at   timestamptz;
  v_user_pm   text;
  v_user_card boolean := false;
BEGIN
  -- Metodo scelto a mano sul fornitore (356): comanda su tutto il resto.
  IF NEW.supplier_id IS NOT NULL THEN
    SELECT s.payment_method_user_at, coalesce(s.default_payment_method::text, nullif(s.payment_method, ''))
      INTO v_user_at, v_user_pm
      FROM public.suppliers s WHERE s.id = NEW.supplier_id;
    IF v_user_at IS NOT NULL AND v_user_pm IS NOT NULL
       AND v_user_pm = ANY (enum_range(NULL::payment_method)::text[]) THEN
      IF v_user_pm IN ('carta_credito', 'carta_debito') THEN
        v_user_card := true;
      ELSE
        -- Metodo non carta: la scadenza nuova nasce con quel metodo; in UPDATE non si tocca
        -- niente (il riallineamento delle aperte lo fa fn_supplier_method_to_open_payables).
        IF TG_OP = 'INSERT'
           AND COALESCE(NEW.amount_paid, 0) = 0
           AND COALESCE(NEW.status::text, 'da_pagare') NOT IN ('annullato','nota_credito','pagato','parziale','sospeso','bloccato')
        THEN
          NEW.payment_method := v_user_pm::payment_method;
          NEW.is_auto_debit  := v_user_pm IN ('rid','sdd_core','sdd_b2b');
        END IF;
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  -- Nota: in Postgres il conteggio di ripetizione di un regex POSIX arriva a 255,
  -- {0,400} fa fallire l'espressione a runtime. Qui si resta sotto la soglia.
  IF NEW.electronic_invoice_id IS NOT NULL AND COALESCE(NEW.installment_total, 1) <= 1 THEN
    SELECT
      COALESCE(substring(e.xml_content from '"modalita_pagamento":\s*"(MP[0-9]{2})"'),
               substring(e.xml_content from '<ModalitaPagamento>(MP[0-9]{2})<')),
      COALESCE(e.xml_content ~* '("causale":\s*\[[^\]]{0,250}(scontrino|ricevuta fiscale)|<Causale>[^<]{0,250}(scontrino|ricevuta fiscale))', false)
    INTO v_xml_mp, v_scontrino
    FROM public.electronic_invoices e
    WHERE e.id = NEW.electronic_invoice_id;
  END IF;

  v_mp := COALESCE(NEW.payment_method_code, v_xml_mp);

  v_is_mp08 := COALESCE(NEW.payment_method_code = 'MP08', false) OR COALESCE(v_xml_mp = 'MP08', false);
  v_is_mp01 := COALESCE(NEW.payment_method_code = 'MP01', false) OR COALESCE(v_xml_mp = 'MP01', false)
               OR COALESCE(v_scontrino, false);

  -- Addebito diretto: esce dal conto da solo, per mandato, alla SUA data.
  -- Lista dei codici SDI verificata: MP09 RID, MP10 RID utenze, MP11 RID veloce,
  -- MP16 domiciliazione bancaria, MP17 domiciliazione postale, MP19 SEPA Direct Debit,
  -- MP20 SDD CORE, MP21 SDD B2B. La RiBa è MP12 e resta fuori: ha il suo meccanismo.
  v_gia_sdd := COALESCE(v_mp IN ('MP09','MP10','MP11','MP16','MP17','MP19','MP20','MP21'), false)
               OR COALESCE(NEW.payment_method::text IN ('rid','sdd_core','sdd_b2b'), false)
               OR COALESCE(NEW.payment_method::text LIKE 'riba\_%', false);

  -- Qualunque altro canale scritto in fattura (bonifico, assegno, Ri.Ba., MAV, bollettino):
  -- lo ha deciso il fornitore, non lo scavalca né la categoria né l'anagrafica.
  v_altro := v_mp IS NOT NULL AND v_mp NOT IN ('MP08', 'MP01')
             AND NOT v_is_mp08 AND NOT v_is_mp01;

  -- Carta scelta a mano sul fornitore (356): vale sopra al codice della fattura.
  IF v_user_card THEN
    v_is_mp01 := false;
    v_gia_sdd := false;
    v_altro   := false;
  END IF;

  IF v_is_mp01 AND NOT v_is_mp08
     AND COALESCE(NEW.is_forecast, false) = false
     AND COALESCE(NEW.gross_amount, 0) > 0
     AND COALESCE(NEW.payment_method::text, '') <> 'contanti'
     AND COALESCE(NEW.status::text, 'da_pagare') NOT IN ('annullato','nota_credito','pagato','parziale','sospeso','bloccato')
  THEN
    NEW.payment_method := 'contanti'::payment_method;
    IF v_xml_mp = 'MP01' AND NEW.payment_method_code IS NULL THEN
      NEW.payment_method_code := 'MP01';
    END IF;
    RETURN NEW;
  END IF;

  -- Un addebito diretto si marca come automatico: esce dalla lista dei bonifici da
  -- disporre e dal totale da pagare. La scadenza resta la sua. La RiBa ha il suo
  -- meccanismo (migr. 146), quindi qui si marcano solo rid e SDD.
  IF v_gia_sdd AND NOT v_is_mp08
     AND COALESCE(NEW.payment_method::text, '') NOT LIKE 'riba\_%'
     AND COALESCE(NEW.is_forecast, false) = false
     AND COALESCE(NEW.gross_amount, 0) > 0
     AND COALESCE(NEW.amount_paid, 0) = 0
     AND COALESCE(NEW.status::text, 'da_pagare') NOT IN ('annullato','nota_credito','pagato','parziale','sospeso','bloccato')
  THEN
    -- La fattura è la fonte, la colonna è una copia (R18).
    IF NEW.payment_method_code IS NULL AND v_xml_mp IS NOT NULL THEN
      NEW.payment_method_code := v_xml_mp;
    END IF;
    IF COALESCE(NEW.payment_method::text, '') IN ('', 'bonifico_ordinario', 'bonifico_sepa', 'altro') THEN
      NEW.payment_method := CASE v_mp
                              WHEN 'MP20' THEN 'sdd_core'::payment_method
                              WHEN 'MP21' THEN 'sdd_b2b'::payment_method
                              ELSE 'rid'::payment_method
                            END;
    END IF;
    NEW.is_auto_debit := true;
    RETURN NEW;
  END IF;

  v_should := v_is_mp08 OR v_user_card;

  -- La categoria e l'anagrafica fornitore decidono solo dove il canale non è già dichiarato.
  IF NOT v_should AND NOT v_gia_sdd AND NOT v_altro AND NEW.cost_category_id IS NOT NULL THEN
    SELECT COALESCE(c.auto_debit_card, false) INTO v_cat
    FROM public.cost_categories c WHERE c.id = NEW.cost_category_id;
    v_should := COALESCE(v_cat, false);
  END IF;

  IF NOT v_should AND NOT v_gia_sdd AND NOT v_altro AND NEW.supplier_id IS NOT NULL THEN
    SELECT (s.default_payment_method IN ('carta_credito','carta_debito')
            OR s.payment_method IN ('carta_credito','carta_debito'))
      INTO v_sup
    FROM public.suppliers s WHERE s.id = NEW.supplier_id;
    v_should := COALESCE(v_sup, false);
  END IF;

  IF v_should
     AND COALESCE(NEW.is_forecast, false) = false
     AND COALESCE(NEW.gross_amount, 0) > 0
     AND COALESCE(NEW.amount_paid, 0) = 0
     AND COALESCE(NEW.status::text, 'da_pagare') NOT IN ('annullato','nota_credito','pagato','parziale','sospeso','bloccato')
     AND NOT COALESCE(NEW.is_auto_debit, false)
  THEN
    NEW.is_auto_debit := true;
    IF v_is_mp08 THEN NEW.payment_method_code := 'MP08'; END IF;
    NEW.payment_method := CASE WHEN v_user_card THEN v_user_pm::payment_method
                               ELSE 'carta_credito'::payment_method END;
    NEW.due_date := (date_trunc('month', NEW.invoice_date) + interval '1 month' + interval '19 days')::date;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 4. riallineamento delle scadenze aperte quando cambia la scelta ──────────
CREATE OR REPLACE FUNCTION public.fn_supplier_method_to_open_payables()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pm   text := coalesce(NEW.default_payment_method::text, nullif(NEW.payment_method, ''));
  v_card boolean;
  r      record;
  v_due  date;
BEGIN
  IF NEW.payment_method_user_at IS NULL OR v_pm IS NULL
     OR NOT (v_pm = ANY (enum_range(NULL::payment_method)::text[])) THEN
    RETURN NEW;
  END IF;
  v_card := v_pm IN ('carta_credito', 'carta_debito');

  FOR r IN
    SELECT p.id, p.payment_method::text AS old_pm, p.is_auto_debit, p.due_date, p.invoice_date,
           p.gross_amount, coalesce(p.installment_total, 1) AS inst_tot, ei.xml_content
      FROM public.payables p
      LEFT JOIN public.electronic_invoices ei ON ei.id = p.electronic_invoice_id
     WHERE p.supplier_id = NEW.id
       AND p.company_id = NEW.company_id
       AND coalesce(p.status::text, 'da_pagare') IN ('da_pagare', 'in_scadenza', 'scaduto', 'rimandato')
       AND coalesce(p.amount_paid, 0) = 0
       AND p.cash_movement_id IS NULL
       AND p.bank_transaction_id IS NULL
       AND coalesce(p.closed_manually, false) = false
       AND coalesce(p.is_provisional_paid, false) = false
       AND coalesce(p.is_placeholder, false) = false
       AND coalesce(p.is_forecast, false) = false
       AND p.payment_method::text IS DISTINCT FROM v_pm
  LOOP
    v_due := r.due_date;
    IF r.inst_tot <= 1 AND r.invoice_date IS NOT NULL THEN
      IF v_card THEN
        v_due := (date_trunc('month', r.invoice_date) + interval '1 month' + interval '19 days')::date;
      ELSIF r.old_pm IN ('carta_credito', 'carta_debito') THEN
        -- uscendo dalla carta: la data della fattura, se c'è, altrimenti il piano del fornitore
        v_due := coalesce(
          (SELECT min(x.due_date) FROM public.fn_parse_invoice_payments_json(
             CASE WHEN left(btrim(r.xml_content), 1) = '{' THEN r.xml_content::jsonb ELSE NULL END) x),
          (SELECT x.due_date FROM public.fn_supplier_installment_schedule(
             r.invoice_date, NEW.payment_base, NEW.prima_scadenza_gg, 1, r.gross_amount) x LIMIT 1),
          r.due_date);
      END IF;
    END IF;

    INSERT INTO public.payable_actions (payable_id, action_type, payment_method, old_due_date, new_due_date, note, performed_at, operator_name)
    VALUES (r.id, 'metodo_dal_fornitore', v_pm::payment_method, r.due_date, v_due,
            'Metodo cambiato sul fornitore: era ' || coalesce(r.old_pm, '—') || ' al ' || coalesce(r.due_date::text, '—'),
            now(), 'sistema');

    UPDATE public.payables SET
      payment_method = v_pm::payment_method,
      is_auto_debit  = v_card OR v_pm IN ('rid', 'sdd_core', 'sdd_b2b'),
      due_date       = v_due,
      updated_at     = now()
    WHERE id = r.id;
  END LOOP;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_supplier_method_to_open_payables() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_supplier_method_to_open_payables ON public.suppliers;
CREATE TRIGGER trg_supplier_method_to_open_payables
  AFTER UPDATE OF payment_method, default_payment_method, payment_method_user_at ON public.suppliers
  FOR EACH ROW
  WHEN (NEW.payment_method_user_at IS NOT NULL
        AND (NEW.payment_method_user_at IS DISTINCT FROM OLD.payment_method_user_at
             OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
             OR NEW.default_payment_method IS DISTINCT FROM OLD.default_payment_method))
  EXECUTE FUNCTION public.fn_supplier_method_to_open_payables();

-- ── 5. dati: il caso del 05/11/2026 (solo dove il fornitore esiste) ──────────
CREATE TABLE IF NOT EXISTS public.payables_backup_metodo_fornitore_20261105 AS
  SELECT p.* FROM public.payables p
    JOIN public.suppliers s ON s.id = p.supplier_id
   WHERE s.partita_iva = '05997780480'
     AND coalesce(p.status::text, '') NOT IN ('pagato', 'annullato', 'nota_credito');
ALTER TABLE public.payables_backup_metodo_fornitore_20261105 ENABLE ROW LEVEL SECURITY;

UPDATE public.suppliers
   SET payment_method_user_at = '2026-11-05 14:56:33+00'
 WHERE partita_iva = '05997780480'
   AND payment_method_user_at IS NULL
   AND coalesce(default_payment_method::text, payment_method) = 'bonifico_ordinario';

-- VERIFICA: le scadenze aperte del fornitore devono essere a bonifico, senza addebito automatico
-- SELECT p.invoice_number, p.payment_method, p.is_auto_debit, p.due_date, p.status
--   FROM public.payables p JOIN public.suppliers s ON s.id = p.supplier_id
--  WHERE s.partita_iva = '05997780480' ORDER BY p.invoice_date;
