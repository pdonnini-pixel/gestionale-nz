-- Migrazione 109 — RPC atomica per la chiusura manuale delle fatture (fix lost update).
-- (audit A44)
--
-- PROBLEMA: `ScadenzarioSmart.closePayableManually` calcolava
--   amount_paid = amount_paid_LOCALE + importo
-- dove amount_paid_LOCALE veniva dallo stato React caricato all'apertura pagina.
-- Con più operatrici in parallelo (o la riconciliazione bancaria automatica) quel
-- valore è STALE: il salvataggio scrive un valore assoluto che CANCELLA il pagamento
-- registrato nel frattempo da un'altra (classico lost update: 300 pagati → 200).
--
-- SOLUZIONE: spostare il calcolo lato DB in modo ATOMICO. La funzione blocca la riga
-- (SELECT ... FOR UPDATE), legge i valori FRESCHI dal database, calcola il nuovo
-- amount_paid come incremento (paid_DB + importo) e aggiorna in un'unica transazione.
-- Due chiamate concorrenti si serializzano sul lock → nessun pagamento perso.
--
-- La funzione REPLICA fedelmente la logica del frontend (gestione note di credito,
-- clamp dell'importo al residuo, stato pagato/parziale, riga di audit in
-- payable_actions), ma sui valori reali del DB. Restituisce i valori autorevoli così
-- il frontend aggiorna lo stato locale senza ricalcolare a partire da un dato stale.
--
-- SICUREZZA: SECURITY INVOKER → rispetta le RLS di payables/payable_actions (l'utente
-- può toccare solo le righe della propria azienda; un p_id di un'altra azienda non
-- viene trovato sotto RLS → eccezione).
--
-- CARATTERE: additivo (CREATE OR REPLACE FUNCTION). Nessun dato modificato dall'apply.
-- ⚠️ REGOLA #0 — PARITÀ TENANT: applicare su NZ + Made + Zago.

CREATE OR REPLACE FUNCTION public.close_payable_manually(
  p_id uuid,
  p_close_date date,
  p_reason text DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_operator text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  status text,
  amount_paid numeric,
  amount_remaining numeric,
  payment_date date,
  closed_manually boolean,
  manual_close_reason text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_gross numeric;
  v_paid numeric;
  v_status text;
  v_remaining numeric;
  v_amount numeric;
  v_new_paid numeric;
  v_new_remaining numeric;
  v_new_status text;
  v_date_label text;
  v_note text;
BEGIN
  -- Lock della riga + lettura valori FRESCHI dal DB (anti lost-update).
  SELECT p.gross_amount, COALESCE(p.amount_paid, 0), p.status::text
    INTO v_gross, v_paid, v_status
  FROM public.payables p
  WHERE p.id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payable % non trovato o non accessibile', p_id;
  END IF;

  v_date_label := to_char(p_close_date, 'DD/MM/YYYY');

  -- ───── NOTA DI CREDITO (status nota_credito o gross < 0) ─────
  -- "Chiudere" una NC = compensarla: marca closed_manually + data, SENZA
  -- riclassificarla come pagata. Riga di audit in AVERE.
  IF v_status = 'nota_credito' OR v_gross < 0 THEN
    UPDATE public.payables SET
      payment_date = p_close_date,
      closed_manually = true,
      manual_close_reason = p_reason,
      payment_bank_account_id = NULL
    WHERE public.payables.id = p_id;

    INSERT INTO public.payable_actions
      (payable_id, action_type, amount, bank_account_id, note, operator_name, performed_at)
    VALUES
      (p_id, 'chiusura_manuale', abs(v_gross), NULL,
       'Chiusura nota di credito a mano il ' || v_date_label
         || COALESCE(' — ' || p_reason, '') || ' (registrata in AVERE)',
       p_operator, now());

    RETURN QUERY
      SELECT p.id, p.status::text, p.amount_paid, p.amount_remaining,
             p.payment_date, p.closed_manually, p.manual_close_reason
      FROM public.payables p WHERE p.id = p_id;
    RETURN;
  END IF;

  -- ───── Fattura normale ─────
  v_remaining := GREATEST(0, v_gross - v_paid);
  v_amount := COALESCE(p_amount, v_remaining);           -- default: chiudi tutto il residuo
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Importo di chiusura non valido';
  END IF;
  IF v_amount > v_remaining + 0.005 THEN                 -- clamp al residuo
    v_amount := v_remaining;
  END IF;

  v_new_paid := v_paid + v_amount;                       -- INCREMENTO su valore fresco
  v_new_remaining := GREATEST(0, v_remaining - v_amount);
  v_new_status := CASE WHEN v_new_remaining <= 0.005 THEN 'pagato' ELSE 'parziale' END;

  UPDATE public.payables SET
    status = v_new_status::payable_status,
    payment_date = p_close_date,
    amount_paid = v_new_paid,
    amount_remaining = v_new_remaining,
    closed_manually = true,
    manual_close_reason = p_reason,
    payment_bank_account_id = NULL
  WHERE public.payables.id = p_id;

  v_note := 'Chiusa a mano il ' || v_date_label
    || CASE WHEN v_new_remaining <= 0.005 THEN '' ELSE ' — PARZIALE' END
    || COALESCE(' — ' || p_reason, '')
    || ' (' || COALESCE(v_status, '—') || ' → ' || v_new_status || ')';

  INSERT INTO public.payable_actions
    (payable_id, action_type, amount, bank_account_id, note, operator_name, performed_at)
  VALUES
    (p_id, 'chiusura_manuale', v_amount, NULL, v_note, p_operator, now());

  RETURN QUERY
    SELECT p.id, p.status::text, p.amount_paid, p.amount_remaining,
           p.payment_date, p.closed_manually, p.manual_close_reason
    FROM public.payables p WHERE p.id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_payable_manually(uuid, date, text, numeric, text) TO authenticated;

-- Rollback: DROP FUNCTION IF EXISTS public.close_payable_manually(uuid, date, text, numeric, text);
