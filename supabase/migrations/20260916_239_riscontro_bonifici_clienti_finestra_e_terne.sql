-- =====================================================================
-- 239 — Riscontro bonifici clienti: finestra piu' larga e terne
-- ---------------------------------------------------------------------
-- La 238 cercava il bonifico fra 10 giorni prima e 3 dopo la chiusura, da
-- solo o in coppia. Tre righe «Bonifico» di Barberino restavano «mancante»
-- e Patrizio ha chiesto di guardare oltre la data: tutte e tre hanno il
-- loro bonifico in banca.
--   * 24/02/2026, 322,00 = 124,60 + 124,00 + 73,40: TRE bonifici lo stesso
--     giorno (la 238 provava solo le coppie);
--   * 08/07/2026, 158,00: bonifico del 23/06 (15 giorni prima);
--   * 31/08/2026, 25,90: bonifico del 07/07 (55 giorni prima, registrato
--     nella chiusura di fine mese).
-- Il negozio registra il bonifico quando lo vede, anche molto dopo: la
-- finestra diventa 60 giorni prima e 15 dopo, e si provano anche le terne.
-- Il bonifico piu' vicino alla chiusura vince sempre; stesso importo esatto.
-- Additiva e idempotente. Tenant: NZ, Made, Zago.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.match_customer_transfers_with_closings(
  p_company_id uuid DEFAULT NULL,
  p_from       date DEFAULT current_date - 90,
  p_tolerance  numeric DEFAULT 0.01
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r     record;
  v_ids uuid[];
  v_n   integer := 0;
BEGIN
  FOR r IN
    SELECT l.id AS line_id, l.closing_id, round(l.amount, 2) AS amount, c.company_id, c.closing_date
      FROM public.outlet_daily_closing_lines l
      JOIN public.outlet_payment_channels ch ON ch.id = l.channel_id
      JOIN public.outlet_daily_closings c ON c.id = l.closing_id
     WHERE ch.kind = 'bonifico'
       AND l.amount > 0
       AND c.status IN ('confermata', 'verificata')
       AND c.closing_date >= p_from
       AND (p_company_id IS NULL OR c.company_id = p_company_id)
       AND NOT EXISTS (SELECT 1 FROM public.closing_bank_matches m WHERE m.line_id = l.id)
     ORDER BY c.closing_date, l.id
  LOOP
    v_ids := NULL;

    -- Candidati: bonifici in entrata da privati, non ancora abbinati a una
    -- chiusura ne' a una fattura, fra 60 giorni prima e 15 dopo la chiusura.
    -- E1. uno solo con lo stesso importo, il piu' vicino alla chiusura.
    WITH cand AS (
      SELECT bt.id, bt.amount, abs(bt.transaction_date - r.closing_date) AS dist
        FROM public.bank_transactions bt
       WHERE bt.company_id = r.company_id
         AND bt.amount > 0 AND bt.amount <= r.amount + p_tolerance
         AND bt.transaction_date BETWEEN r.closing_date - 60 AND r.closing_date + 15
         AND COALESCE(bt.status, 'booked') IN ('posted', 'booked')
         AND public.cash_bank_is_customer_transfer(bt.description)
         AND NOT EXISTS (SELECT 1 FROM public.closing_bank_matches m WHERE m.bank_transaction_id = bt.id)
         AND NOT EXISTS (SELECT 1 FROM public.reconciliation_log rl WHERE rl.bank_transaction_id = bt.id AND rl.status = 'applied')
    )
    SELECT ARRAY[x.id] INTO v_ids
      FROM cand x
     WHERE abs(x.amount - r.amount) <= p_tolerance
     ORDER BY x.dist, x.id
     LIMIT 1;

    -- E2. due che sommano (due clienti lo stesso giorno o vicini).
    IF v_ids IS NULL THEN
      WITH cand AS (
        SELECT bt.id, bt.amount, abs(bt.transaction_date - r.closing_date) AS dist
          FROM public.bank_transactions bt
         WHERE bt.company_id = r.company_id
           AND bt.amount > 0 AND bt.amount < r.amount
           AND bt.transaction_date BETWEEN r.closing_date - 60 AND r.closing_date + 15
           AND COALESCE(bt.status, 'booked') IN ('posted', 'booked')
           AND public.cash_bank_is_customer_transfer(bt.description)
           AND NOT EXISTS (SELECT 1 FROM public.closing_bank_matches m WHERE m.bank_transaction_id = bt.id)
           AND NOT EXISTS (SELECT 1 FROM public.reconciliation_log rl WHERE rl.bank_transaction_id = bt.id AND rl.status = 'applied')
      )
      SELECT ARRAY[x.id, y.id] INTO v_ids
        FROM cand x JOIN cand y ON y.id > x.id
       WHERE abs(x.amount + y.amount - r.amount) <= p_tolerance
       ORDER BY x.dist + y.dist, x.id, y.id
       LIMIT 1;
    END IF;

    -- E3. tre che sommano (Barberino 24/02/2026: 124,60 + 124,00 + 73,40).
    IF v_ids IS NULL THEN
      WITH cand AS (
        SELECT bt.id, bt.amount, abs(bt.transaction_date - r.closing_date) AS dist
          FROM public.bank_transactions bt
         WHERE bt.company_id = r.company_id
           AND bt.amount > 0 AND bt.amount < r.amount
           AND bt.transaction_date BETWEEN r.closing_date - 60 AND r.closing_date + 15
           AND COALESCE(bt.status, 'booked') IN ('posted', 'booked')
           AND public.cash_bank_is_customer_transfer(bt.description)
           AND NOT EXISTS (SELECT 1 FROM public.closing_bank_matches m WHERE m.bank_transaction_id = bt.id)
           AND NOT EXISTS (SELECT 1 FROM public.reconciliation_log rl WHERE rl.bank_transaction_id = bt.id AND rl.status = 'applied')
      )
      SELECT ARRAY[x.id, y.id, z.id] INTO v_ids
        FROM cand x JOIN cand y ON y.id > x.id JOIN cand z ON z.id > y.id
       WHERE abs(x.amount + y.amount + z.amount - r.amount) <= p_tolerance
       ORDER BY x.dist + y.dist + z.dist, x.id, y.id, z.id
       LIMIT 1;
    END IF;

    IF v_ids IS NULL THEN
      -- Niente in banca: dopo 10 giorni la riga e' «mancante», prima resta in attesa.
      UPDATE public.outlet_daily_closing_lines
         SET bank_status = 'mancante'
       WHERE id = r.line_id AND bank_status = 'in_attesa' AND r.closing_date <= current_date - 10;
      CONTINUE;
    END IF;

    INSERT INTO public.closing_bank_matches (company_id, closing_id, line_id, bank_transaction_id, amount, match_type, reference_date, note)
    SELECT r.company_id, r.closing_id, r.line_id, bt.id, bt.amount, 'bonifico', r.closing_date,
           CASE WHEN array_length(v_ids, 1) > 1 THEN 'bonifico di cliente: ' || array_length(v_ids, 1) || ' bonifici per la riga Bonifico della chiusura' END
      FROM public.bank_transactions bt WHERE bt.id = ANY (v_ids)
    ON CONFLICT (bank_transaction_id, closing_id) DO NOTHING;

    UPDATE public.bank_transactions
       SET is_reconciled = true, reconciled_at = COALESCE(reconciled_at, now()), category = COALESCE(category, 'incassi_clienti'),
           note = CASE WHEN COALESCE(note, '') LIKE '%chiusura cassa%' THEN note
                       ELSE COALESCE(note || ' | ', '') || 'bonifico cliente abbinato a chiusura cassa del ' || to_char(r.closing_date, 'DD/MM/YYYY') END
     WHERE id = ANY (v_ids);

    UPDATE public.outlet_daily_closing_lines
       SET bank_amount = (SELECT round(sum(bt.amount), 2) FROM public.bank_transactions bt WHERE bt.id = ANY (v_ids)),
           bank_status = 'accreditato', bank_matched_at = now()
     WHERE id = r.line_id;

    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- Verifica:
--   SELECT match_customer_transfers_with_closings(NULL, '2026-01-01', 0.01);
