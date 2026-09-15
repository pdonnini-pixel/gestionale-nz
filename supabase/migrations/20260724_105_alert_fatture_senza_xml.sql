-- =====================================================================
-- Migrazione 105 — ALERT AUTOMATICO "Fattura senza XML"
-- =====================================================================
--
-- OBIETTIVO
-- Avvisare da soli (senza query manuale) quando compare una fattura "vera"
-- ancora da pagare che NON ha la fattura elettronica/XML agganciata — cioè
-- quei casi in cui l'anteprima/PDF non si può generare perché manca l'XML.
-- L'alert finisce nella campanella 🔔 (tabella public.notifications, categoria
-- 'fattura_sdi', severità 'warning'), che il frontend NotificationBell già legge.
--
-- COSA FA
--   1) funzione public.notify_invoices_without_xml():
--        - INSERISCE una notifica per ogni payable APERTO (da_pagare/in_scadenza/
--          scaduto/parziale), con importo > 0, SENZA electronic_invoice_id e SENZA
--          una fattura elettronica con XML corrispondente (numero + P.IVA), non
--          ancora notificato. Esclude i "documenti manuali" per natura senza XML
--          (proforma, parcelle/numerazioni interne SF_/SPN_/SP_/ATT-, NC a mano,
--          INPS/contributi, polizze/PREVIGES, ONLUS). Aspetta 6h dalla creazione
--          per non falsare i casi in cui l'import A-Cube aggancia l'XML poco dopo.
--        - AUTO-CHIUDE (dismissed=true) gli alert non più validi (XML arrivato,
--          fattura pagata/annullata o sparita), così la campanella resta pulita.
--   2) schedulazione pg_cron: gira ogni giorno alle 06:00 UTC.
--
-- CARATTERE: additiva e non distruttiva (nuova funzione + job cron; nessuna
--   modifica a dati o tabelle esistenti). Idempotente: non duplica notifiche.
--
-- ⚠️ REGOLA #0 — PARITÀ TENANT: applicare A MANO e IDENTICA su NZ + Made + Zago.
--   NZ   = xfvfxsvqpnpvibgeqpqp
--   Made = wdgoebzvosspjqttitra
--   Zago = jxlwvzjreukscnswkbjx
--   (pg_cron è per-database: il job va creato su ciascun tenant.)
-- Rollback + verifiche in coda al file.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.notify_invoices_without_xml()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new integer := 0;
BEGIN
  -- 1) Crea gli alert per le fatture "vere" ancora aperte e senza XML
  WITH candidate AS (
    SELECT p.id, p.company_id, p.invoice_number, p.supplier_name, p.gross_amount
    FROM public.payables p
    WHERE p.electronic_invoice_id IS NULL
      AND p.gross_amount > 0
      AND p.status IN ('da_pagare','in_scadenza','scaduto','parziale')
      -- lascia tempo all'import A-Cube di agganciare l'XML poco dopo la creazione
      AND p.created_at < now() - interval '6 hours'
      -- escludi i documenti che un XML non ce l'hanno per natura
      AND COALESCE(p.invoice_number,'') <> ''
      AND p.invoice_number !~ '^(SF_|SPN_|SP_|ATT-|Proforma)'
      AND p.invoice_number NOT ILIKE 'NC %'
      AND COALESCE(p.supplier_name,'') NOT ILIKE '%INPS%'
      AND COALESCE(p.supplier_name,'') NOT ILIKE '%previges%'
      AND COALESCE(p.supplier_name,'') NOT ILIKE '%polizza%'
      AND COALESCE(p.supplier_name,'') NOT ILIKE '%onlus%'
      -- nessuna fattura elettronica con XML corrispondente (numero + P.IVA)
      AND NOT EXISTS (
        SELECT 1 FROM public.electronic_invoices ei
        WHERE ei.company_id = p.company_id
          AND ei.invoice_number = p.invoice_number
          AND ei.supplier_vat IS NOT DISTINCT FROM p.supplier_vat
          AND ei.xml_content IS NOT NULL
      )
      -- non già notificato (dedup su payable)
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.company_id = p.company_id
          AND n.category = 'fattura_sdi'
          AND n.reference_type = 'payable'
          AND n.reference_id = p.id
      )
  )
  INSERT INTO public.notifications
    (company_id, title, message, category, severity, action_url, action_label, reference_type, reference_id)
  SELECT
    c.company_id,
    'Fattura senza XML: ' || c.invoice_number,
    'La fattura ' || c.invoice_number || ' di ' || COALESCE(c.supplier_name, '(fornitore n.d.)')
      || ' — ' || replace(to_char(c.gross_amount, 'FM999999990.00'), '.', ',') || ' €'
      || ' — è a scadenzario ma non ha la fattura elettronica/XML collegata. '
      || 'Verifica se è un documento non elettronico oppure re-importa l''XML da A-Cube.',
    'fattura_sdi',
    'warning',
    '/scadenzario',
    'Vai allo scadenzario',
    'payable',
    c.id
  FROM candidate c;

  GET DIAGNOSTICS v_new = ROW_COUNT;

  -- 2) Auto-chiudi gli alert non più validi (XML arrivato / fattura pagata o sparita)
  UPDATE public.notifications n
  SET dismissed = true
  WHERE n.category = 'fattura_sdi'
    AND n.reference_type = 'payable'
    AND n.dismissed = false
    AND NOT EXISTS (
      SELECT 1 FROM public.payables p
      WHERE p.id = n.reference_id
        AND p.electronic_invoice_id IS NULL
        AND p.status IN ('da_pagare','in_scadenza','scaduto','parziale')
        AND NOT EXISTS (
          SELECT 1 FROM public.electronic_invoices ei
          WHERE ei.company_id = p.company_id
            AND ei.invoice_number = p.invoice_number
            AND ei.supplier_vat IS NOT DISTINCT FROM p.supplier_vat
            AND ei.xml_content IS NOT NULL
        )
    );

  RETURN v_new;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_invoices_without_xml() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_invoices_without_xml() TO authenticated, service_role;

COMMIT;

-- ---------------------------------------------------------------------
-- SCHEDULAZIONE pg_cron — eseguire FUORI dalla transazione (una volta per tenant)
-- Gira ogni giorno alle 06:00 UTC. Ri-eseguibile: prima rimuove un eventuale job omonimo.
-- ---------------------------------------------------------------------
SELECT cron.unschedule('alert-fatture-senza-xml')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'alert-fatture-senza-xml');

SELECT cron.schedule('alert-fatture-senza-xml', '0 6 * * *', $$SELECT public.notify_invoices_without_xml();$$);

-- Primo giro subito, per popolare eventuali casi già presenti:
SELECT public.notify_invoices_without_xml();

-- =====================================================================
-- ROLLBACK (eseguire a mano se serve tornare indietro)
-- =====================================================================
-- SELECT cron.unschedule('alert-fatture-senza-xml');
-- DROP FUNCTION IF EXISTS public.notify_invoices_without_xml();
-- -- (facoltativo) chiudere gli alert già creati:
-- UPDATE public.notifications SET dismissed = true
--   WHERE category='fattura_sdi' AND reference_type='payable';

-- =====================================================================
-- VERIFICHE (sola lettura, dopo l'applicazione)
-- =====================================================================
-- 1) Job schedulato:
--    SELECT jobname, schedule, active FROM cron.job WHERE jobname='alert-fatture-senza-xml';
-- 2) Alert generati (dovrebbero corrispondere alle fatture "vere" aperte senza XML):
--    SELECT title, message, severity, created_at
--    FROM public.notifications
--    WHERE category='fattura_sdi' AND dismissed=false ORDER BY created_at DESC;
-- 3) Esecuzione manuale on-demand (ritorna quante nuove notifiche ha creato):
--    SELECT public.notify_invoices_without_xml();
-- =====================================================================
