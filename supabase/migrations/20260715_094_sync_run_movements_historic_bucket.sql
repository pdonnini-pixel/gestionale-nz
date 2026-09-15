-- 094 — bucket "Storico" per i movimenti bancari non attribuibili a una run
--
-- CONTESTO: la 093 aggancia i movimenti acube_ob alla run 'banche' più vicina
-- nel tempo (±15'). Ma la maggior parte dei movimenti è stata scaricata PRIMA
-- che partisse il log delle run (in NZ: ~8000 movimenti 21/05→16/06, prima run
-- banche il 16/06) → nessuna run vicina → restano senza sync_run_id e non si
-- vedono nel dettaglio.
--
-- FIX: raccogliamo i movimenti ancora non attribuiti in run SINTETICHE "storico",
-- UNA PER MESE (per azienda), con il riepilogo per banca. Onesto: la run esatta
-- è ignota, ma il mese e il riepilogo per banca danno la traccia di cosa è stato
-- scaricato. La finestra temporale (period_from/to) mostra il range del mese.
--
-- SICUREZZA: additivo/reversibile. Scrive SOLO su:
--   • bank_transactions.sync_run_id (colonna nullable creata dalla 093)
--   • sync_runs / sync_run_details (osservabilità, non dato "vivo")
-- Nessun DELETE/DROP. IDEMPOTENTE: dopo la prima esecuzione non restano
-- movimenti non attribuiti, quindi riapplicarla non crea nulla.
-- Il saldo per banca è approssimato col saldo corrente del conto (lo storico
-- dei saldi non esiste): indicazione, non dato contabile.
--
-- ⚠️ PARITÀ TENANT: applicare A MANO su NZ + Made + Zago. Richiede 092 + 093.

DO $$
DECLARE
  r RECORD;
  v_run uuid;
BEGIN
  FOR r IN
    SELECT company_id,
           date_trunc('month', transaction_date)::date AS mese,
           count(*)            AS cnt,
           min(transaction_date) AS d_min,
           max(transaction_date) AS d_max,
           max(created_at)       AS c_max
    FROM public.bank_transactions
    WHERE source = 'acube_ob' AND sync_run_id IS NULL
    GROUP BY company_id, date_trunc('month', transaction_date)
  LOOP
    -- run sintetica per (azienda, mese); run_at = ultimo istante di import reale
    INSERT INTO public.sync_runs
      (company_id, feed, origine, period_from, period_to, status, items_downloaded, run_at)
    VALUES (r.company_id, 'banche', 'manuale', r.d_min, r.d_max, 'ok', r.cnt::int,
            COALESCE(r.c_max, (r.mese + interval '1 month' - interval '1 day')))
    RETURNING id INTO v_run;

    -- aggancia i movimenti di quel mese alla run sintetica
    UPDATE public.bank_transactions
    SET sync_run_id = v_run
    WHERE source = 'acube_ob'
      AND sync_run_id IS NULL
      AND company_id = r.company_id
      AND date_trunc('month', transaction_date)::date = r.mese;

    -- riepilogo per banca del bucket
    INSERT INTO public.sync_run_details
      (sync_run_id, company_id, feed, detail_type, label, reference, items_count, amount, extra)
    SELECT v_run, r.company_id, 'banche', 'banca',
           COALESCE(NULLIF(ba.bank_name,''), 'Banca'),
           ba.iban,
           count(*)::int,
           max(ba.current_balance),
           jsonb_build_object('accounts', count(DISTINCT bt.bank_account_id)::int)
    FROM public.bank_transactions bt
    JOIN public.bank_accounts ba ON ba.id = bt.bank_account_id
    WHERE bt.sync_run_id = v_run
    GROUP BY ba.bank_name, ba.iban;
  END LOOP;
END $$;
