-- =====================================================================
-- 446 — I due commenti che si erano persi fra il file e il database. NZ + Zago.
-- =====================================================================
-- Subito dopo aver applicato la 443 ho confrontato al byte il corpo delle
-- funzioni nuove (`pg_proc.prosrc`) con il testo nel repo: tre uguali, due no.
-- `escludi_coppia` e `riammetti_coppia` sul database erano piu' corte di 191 e
-- 207 caratteri, e la differenza erano due blocchi di commento che il file ha e
-- che si sono persi quando ho ribattuto la migration nella chiamata di
-- applicazione. Il codice e' identico, quindi non cambia niente di come si
-- comportano: cambia che il file nel repo non raccontava piu' il vivo.
--
-- E' lo stesso inciampo del 09/11 con la 333, e la regola resta quella: il testo
-- di una funzione non si ribatte, si copia. Questa volta il controllo l'ha
-- trovato subito, e questo file rimette i due corpi esattamente come stanno nel
-- repo, copiati da li' senza passare da una tastiera.
--
-- Applicata su NZ e Zago il 23/11/2026 e verificata: i cinque corpi delle
-- funzioni nuove di oggi combaciano al byte fra repo e database vivo
-- (`md5(prosrc)`), e la parita' fra i due tenant regge (435 funzioni, impronta
-- e636b35ba6fef0aa8185f736973e12f6).
--
-- NO DATA LOSS: due CREATE OR REPLACE, nessuna riga toccata.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.escludi_coppia(p_bt_id uuid, p_payable_id uuid, p_motivo text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pay_company uuid;
  v_bt_company uuid;
BEGIN
  PERFORM public.ruoli_operativi_non_qui(); -- migration 380
  IF p_bt_id IS NULL OR p_payable_id IS NULL THEN
    RETURN;
  END IF;
  SELECT company_id INTO v_pay_company FROM public.payables WHERE id = p_payable_id;
  SELECT company_id INTO v_bt_company FROM public.bank_transactions WHERE id = p_bt_id;
  -- Il movimento e la fattura devono essere della stessa azienda, e di quella di
  -- chi sta scrivendo quando dietro c'è una persona (il giro notturno non ha
  -- azienda nel JWT e passa).
  IF v_pay_company IS NULL OR v_bt_company IS NULL OR v_pay_company <> v_bt_company THEN
    RETURN;
  END IF;
  IF auth.uid() IS NOT NULL
     AND (SELECT public.get_my_company_id()) IS NOT NULL
     AND (SELECT public.get_my_company_id()) <> v_pay_company THEN
    RAISE EXCEPTION 'Quella coppia non è di questa azienda' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.reconciliation_coppie_escluse AS e
         (company_id, bank_transaction_id, payable_id, motivo)
  VALUES (v_pay_company, p_bt_id, p_payable_id, p_motivo)
  ON CONFLICT (bank_transaction_id, payable_id) DO UPDATE
    SET motivo = COALESCE(EXCLUDED.motivo, e.motivo),
        escluso_il = now(),
        escluso_da = COALESCE(auth.uid(), e.escluso_da);
END;
$function$;

CREATE OR REPLACE FUNCTION public.riammetti_coppia(p_bt_id uuid, p_payable_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_riga RECORD;
BEGIN
  PERFORM public.ruoli_operativi_non_qui(); -- migration 380
  SELECT * INTO v_riga FROM public.reconciliation_coppie_escluse
   WHERE bank_transaction_id = p_bt_id AND payable_id = p_payable_id;
  IF v_riga IS NULL THEN
    RETURN;
  END IF;
  IF auth.uid() IS NOT NULL
     AND (SELECT public.get_my_company_id()) IS NOT NULL
     AND (SELECT public.get_my_company_id()) <> v_riga.company_id THEN
    RAISE EXCEPTION 'Quella coppia non è di questa azienda' USING ERRCODE = '42501';
  END IF;
  -- La riga si cancella, ma il motivo che c'era non si perde: finisce in coda
  -- alla nota dell'ultima riga di log di quella coppia, così fra sei mesi si
  -- legge che qualcuno l'aveva esclusa e perché.
  UPDATE public.reconciliation_log
     SET notes = COALESCE(notes, '') || ' | ' || to_char(now(), 'DD/MM/YYYY')
                 || ': coppia riammessa a mano. Era stata esclusa'
                 || CASE WHEN v_riga.motivo IS NULL THEN '' ELSE ': ' || v_riga.motivo END
   WHERE id = (
     SELECT l.id FROM public.reconciliation_log l
      WHERE l.bank_transaction_id = p_bt_id AND l.payable_id = p_payable_id
      ORDER BY l.performed_at DESC LIMIT 1
   );
  DELETE FROM public.reconciliation_coppie_escluse
   WHERE bank_transaction_id = p_bt_id AND payable_id = p_payable_id;
END;
$function$;

COMMIT;

-- =====================================================================
-- Verifica (su NZ e su Zago): i corpi vivi devono combaciare col repo
-- =====================================================================
--   SELECT proname, md5(prosrc) FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND proname IN ('escludi_coppia','riammetti_coppia');
--   -- attesi: escludi_coppia  b8a4478f94c4dc5dc2c4d5e8e23cb621
--   --         riammetti_coppia df5f7cd363c2b6e61518ea38c6867573
-- =====================================================================
