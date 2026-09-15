-- 20260910_197 — I contanti si chiudono SUBITO, con la data della fattura.
--
-- La 194 chiudeva contanti e carte in via provvisoria alla SCADENZA. Per le carte è
-- giusto: i soldi escono quando la carta addebita, il 20 del mese successivo, e nel
-- frattempo la scadenza è comunque fuori dalla lista dei pagamenti perché marcata
-- addebito automatico. Per i contanti no: si pagano alla consegna, quindi la scadenza
-- calcolata dal piano del fornitore (per esempio 30 giorni fine mese) è una data che non
-- corrisponde a niente, e fino a quel giorno la riga resta fra le Aperte. Due effetti
-- concreti, segnalati da Patrizio: confonde chi prepara i bonifici e gonfia il totale da
-- saldare con soldi già usciti.
--
-- Da qui:
--   • CONTANTI  → chiusura provvisoria appena la scadenza esiste, payment_date = data
--     della FATTURA (il giorno in cui il contante è uscito davvero).
--   • CARTE     → invariato: chiusura alla scadenza, payment_date = data di addebito.
--
-- La soglia di attivazione vale sulla data fattura per i contanti e sulla scadenza per le
-- carte, così l'automatico non tocca a sorpresa lo storico degli altri tenant; il recupero
-- dello storico resta a p_include_backlog.
--
-- Additiva: sostituisce una sola funzione. Rollback in _ROLLBACK.sql

CREATE OR REPLACE FUNCTION public.fn_cash_card_provisional_close(
  p_company_id uuid DEFAULT NULL::uuid,
  p_include_backlog boolean DEFAULT false
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_activation CONSTANT date := DATE '2026-09-09';
  v_count integer := 0;
  v_metodo text;
  v_data date;
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.id, p.gross_amount, p.due_date, p.invoice_date, p.status,
           COALESCE(p.payment_method::text, s.payment_method::text, s.default_payment_method::text) AS metodo
    FROM public.payables p
    LEFT JOIN public.suppliers s ON s.id = p.supplier_id
    WHERE (p_company_id IS NULL OR p.company_id = p_company_id)
      AND COALESCE(p.payment_method::text, s.payment_method::text, s.default_payment_method::text)
          IN ('contanti', 'carta_credito', 'carta_debito')
      AND p.gross_amount > 0
      AND COALESCE(p.is_placeholder, false) = false
      AND COALESCE(p.is_provisional_paid, false) = false
      AND COALESCE(p.closed_manually, false) = false
      AND p.bank_transaction_id IS NULL
      AND p.status IN ('da_pagare', 'in_scadenza', 'scaduto')
      AND (
        CASE
          -- Contanti: pagati alla consegna, non c'è nessuna data da aspettare.
          WHEN COALESCE(p.payment_method::text, s.payment_method::text, s.default_payment_method::text) = 'contanti'
            THEN p_include_backlog OR COALESCE(p.invoice_date, p.due_date) >= v_activation
          -- Carte: si chiudono quando la carta addebita.
          ELSE p.due_date <= CURRENT_DATE
               AND (p_include_backlog OR p.due_date >= v_activation)
        END
      )
  LOOP
    IF r.metodo = 'contanti' THEN
      v_metodo := 'in contanti';
      v_data := COALESCE(r.invoice_date, r.due_date);
    ELSIF r.metodo = 'carta_credito' THEN
      v_metodo := 'con carta di credito';
      v_data := r.due_date;
    ELSE
      v_metodo := 'con carta di debito';
      v_data := r.due_date;
    END IF;

    UPDATE public.payables
    SET amount_paid = gross_amount,
        payment_date = v_data,
        is_provisional_paid = true,
        provisional_paid_at = now()
    WHERE id = r.id;

    INSERT INTO public.payable_actions
      (payable_id, action_type, old_status, new_status, amount, note, performed_at)
    VALUES
      (r.id, 'chiusura_provvisoria_cassa_carte', r.status, 'pagato'::payable_status, r.gross_amount,
       'Chiusura provvisoria (pagamento ' || v_metodo || ') con data '
         || to_char(v_data, 'DD/MM/YYYY')
         || CASE WHEN r.metodo = 'contanti'
                 THEN ' (data della fattura: in contanti si paga alla consegna)'
                 ELSE ' (data di addebito della carta)' END
         || ' — in attesa del movimento, da A-Cube o da estratto conto caricato', now());

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_cash_card_provisional_close(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_cash_card_provisional_close(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_cash_card_provisional_close(uuid, boolean) TO authenticated, service_role;
