-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK della NZ_ONLY 20260918_238 (contratto magazzino Reggello).
--
-- Torna indietro SOLO su ciò che la 238 ha creato, e solo finché nessuno ci ha
-- lavorato sopra:
--   • le righe della checklist allegati con un file già caricato NON vengono
--     toccate (is_uploaded = true resta dov'è, il file nello Storage anche);
--   • la scadenza fiscale già pagata o con una disposizione non viene toccata;
--   • le note e il centro di costo del fornitore e della scheda outlet NON
--     vengono ripuliti: sono testo, non fanno danno, e cancellarli
--     rischierebbe di portarsi via annotazioni scritte dopo.
--
-- Da eseguire solo su NZ (xfvfxsvqpnpvibgeqpqp).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE
  v_company  uuid;
  v_outlet   uuid;
  v_contract uuid;
BEGIN
  SELECT id INTO v_company FROM public.companies WHERE vat_number = '07362100484' LIMIT 1;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Azienda New Zago (P.IVA 07362100484) non trovata: rollback solo NZ';
  END IF;

  SELECT id INTO v_outlet   FROM public.outlets   WHERE company_id = v_company AND code = 'SED' LIMIT 1;
  SELECT id INTO v_contract FROM public.contracts WHERE company_id = v_company AND contract_number = 'TZM26T003665000ZH' LIMIT 1;

  -- Contratto: scadenze e storico canoni vanno via col contratto.
  IF v_contract IS NOT NULL THEN
    DELETE FROM public.contract_deadlines       WHERE contract_id = v_contract;
    DELETE FROM public.contract_amount_history  WHERE contract_id = v_contract;
    DELETE FROM public.contracts                WHERE id = v_contract;
  END IF;

  -- Costo ricorrente del canone (solo se nessuna scadenza ci si è agganciata).
  DELETE FROM public.recurring_costs r
   WHERE r.company_id = v_company
     AND r.cost_center = 'sede_magazzino'
     AND r.description LIKE 'Canone magazzino Reggello%'
     AND NOT EXISTS (SELECT 1 FROM public.payables p WHERE p.recurring_cost_id = r.id);

  -- Checklist: solo le righe ancora vuote, create da questa migration.
  IF v_outlet IS NOT NULL THEN
    DELETE FROM public.outlet_attachments
     WHERE outlet_id = v_outlet
       AND is_uploaded = false
       AND file_path IS NULL
       AND attachment_type IN ('contratto_locazione', 'registrazione', 'planimetria', 'ape', 'copia_conforme', 'polizza_rc');
  END IF;

  -- Scadenza fiscale: solo se ancora aperta e mai movimentata.
  DELETE FROM public.fiscal_deadlines
   WHERE company_id = v_company
     AND title LIKE 'Imposta di registro magazzino Reggello%'
     AND status = 'pending'
     AND paid_date IS NULL
     AND disposizione_date IS NULL
     AND bank_transaction_id IS NULL;

  -- Scheda outlet: si azzerano i soli campi numerici e di data scritti qui.
  -- Indirizzo, città, CAP e note restano: sono l'anagrafica dell'immobile.
  IF v_outlet IS NOT NULL THEN
    UPDATE public.outlets SET
      rent_annual              = NULL,
      deposit_amount           = NULL,
      contract_start           = NULL,
      contract_end             = NULL,
      contract_duration_months = NULL,
      contract_min_months      = NULL,
      rent_start_date          = NULL,
      landlord_supplier_id     = NULL,
      updated_at               = now()
    WHERE id = v_outlet;
  END IF;

  -- Fornitore: torna il piano di ripiego precedente (fine mese, 30 giorni,
  -- 1 rata) e il centro di costo «all».
  UPDATE public.suppliers SET
    cost_center           = 'all',
    payment_base          = 'fine_mese',
    prima_scadenza_gg     = 30,
    numero_rate           = 1,
    payment_terms         = 30,
    default_payment_terms = 30,
    updated_at            = now()
  WHERE company_id = v_company AND partita_iva = '03916460482';
END $$;

COMMIT;
