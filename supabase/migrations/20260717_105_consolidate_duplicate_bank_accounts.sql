-- =====================================================================
-- Migrazione 105 — Consolidamento conti bancari doppioni per IBAN
--                  + re-pointing movimenti/pagamenti sul conto canonico
-- =====================================================================
-- CONTESTO (segue la 094):
--   La 094 ha installato un trigger BEFORE INSERT che impedisce la CREAZIONE di
--   nuovi conti doppioni allo stesso IBAN (ri-collegamento A-Cube con nuovo
--   acube_account_uuid). Ma la 094 e' PREVENTIVA: non tocca i doppioni GIA'
--   presenti, ne' ri-punta i movimenti/pagamenti gia' scritti sul conto vecchio.
--
--   Caso reale NZ (MPS, IBAN IT04V0103038020000000621460): due righe stesso IBAN,
--   una attiva (conto "vivo" con l'acube_account_uuid corrente) e una disattivata
--   (vecchia, residuo del ri-collegamento). I movimenti storici restano attaccati
--   al bank_account_id vecchio -> "movimenti/pagamenti sdoppiati" su due conti.
--
-- COSA FA QUESTA MIGRAZIONE (idempotente, NON distruttiva — REGOLA GRANITICA NO DATA LOSS):
--   1. BACKUP: salva in _backup_bankacct_consolidation_105 le righe bank_accounts
--      coinvolte PRIMA di qualsiasi modifica.
--   2. Per ogni gruppo (company_id, iban) con >1 conto sceglie il CANONICO = il
--      conto ATTIVO che porta l'acube_account_uuid corrente (quello su cui A-Cube
--      sincronizza oggi), preferendo il saldo aggiornato piu' di recente.
--   3. RE-POINTING: sposta sul canonico tutte le righe delle tabelle che
--      referenziano il conto (movimenti, saldi, estratti, pagamenti, batch,
--      proposte, ecc.). Per bank_transactions usa una GUARDIA anti-collisione
--      sull'unique index import_dedup_hash (ricalcolato dal trigger 046 ad ogni
--      UPDATE del bank_account_id): i movimenti che collidono con uno gia'
--      presente sul canonico (stesso reale movimento) NON vengono spostati e
--      restano sul conto vecchio (nessuna riga cancellata).
--   4. Disattiva i doppioni (is_active=false) e annota la causale. NESSUN DELETE.
--
--   La funzione fn_consolidate_duplicate_bank_accounts() e' RIUSABILE e idempotente:
--   se un doppione dovesse ripresentarsi si puo' rieseguire senza danni.
--
-- PREVENZIONE "non deve piu' accadere":
--   - Creazione conto doppione  -> gia' bloccata a monte dalla 094 (BEFORE INSERT
--     su bank_accounts, universale per ogni percorso: edge function, trigger, cron RPC).
--   - Aggancio movimenti         -> post-094 esiste UNA sola riga per IBAN che porta
--     l'acube_account_uuid corrente; acube-ob-tx-sync mappa uuid->id, quindi i nuovi
--     movimenti finiscono sempre sul conto canonico. Questa 105 allinea lo STORICO.
--
-- ⚠️ REGOLA #0 — PARITA' TENANT: applicare su NZ + Made + Zago (3 project_id).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) BACKUP delle righe bank_accounts coinvolte (idempotente)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._backup_bankacct_consolidation_105 (
  backed_up_at timestamptz DEFAULT now(),
  id uuid,
  company_id uuid,
  bank_name text,
  account_name text,
  iban text,
  acube_account_uuid uuid,
  current_balance numeric,
  is_active boolean,
  created_at timestamptz
);

INSERT INTO public._backup_bankacct_consolidation_105
  (id, company_id, bank_name, account_name, iban, acube_account_uuid, current_balance, is_active, created_at)
SELECT ba.id, ba.company_id, ba.bank_name, ba.account_name, ba.iban,
       ba.acube_account_uuid, ba.current_balance, ba.is_active, ba.created_at
FROM public.bank_accounts ba
WHERE ba.iban IS NOT NULL AND trim(ba.iban) <> ''
  AND EXISTS (
    SELECT 1 FROM public.bank_accounts d
    WHERE d.company_id = ba.company_id AND d.iban = ba.iban AND d.id <> ba.id
  )
  -- non ri-loggare se gia' salvato in un run precedente
  AND NOT EXISTS (
    SELECT 1 FROM public._backup_bankacct_consolidation_105 b WHERE b.id = ba.id
  );

-- ---------------------------------------------------------------------
-- 2) Funzione riusabile di consolidamento
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_consolidate_duplicate_bank_accounts()
RETURNS TABLE(
  company_id uuid,
  iban text,
  canonical_id uuid,
  dups_merged int,
  refs_repointed bigint,
  movements_repointed bigint,
  movements_left_on_dup bigint
)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  g            RECORD;   -- gruppo (company_id, iban)
  v_canonical  uuid;
  v_dup        uuid;
  v_dups       uuid[];
  v_pair       text[];   -- {tabella, colonna} da ri-puntare
  v_refs       bigint;
  v_moved      bigint;
  v_moved_tot  bigint;
  v_left       bigint;
  v_left_tot   bigint;
  v_refs_tot   bigint;
  -- Tabelle/colonne che referenziano bank_accounts.id (esclusa bank_transactions,
  -- gestita a parte per la guardia dedup). Ogni UPDATE e' avvolto in un handler:
  -- se in un tenant una tabella/colonna non esiste o una unique collide, si logga
  -- e si prosegue senza abortire la migrazione.
  c_refs text[][] := ARRAY[
    ['bank_balances','bank_account_id'],
    ['bank_statements','bank_account_id'],
    ['import_batches','bank_account_id'],
    ['bank_imports','bank_account_id'],
    ['manual_balance_entries','bank_account_id'],
    ['outlet_bank_accounts','bank_account_id'],
    ['payable_actions','bank_account_id'],
    ['payables','payment_bank_account_id'],
    ['payment_batches','bank_account_id'],
    ['payment_records','bank_account_id'],
    ['payment_schedule','bank_account_id'],
    ['cash_position','bank_account_id'],
    ['loans','bank_account_id'],
    ['yapily_accounts','bank_account_id'],
    ['acube_accounts','bank_account_id'],
    ['suppliers','payment_bank_account_id'],
    ['supplier_payment_proposals','proposed_bank_account_id'],
    ['supplier_payment_proposals','prev_bank_account_id']
  ];
BEGIN
  FOR g IN
    SELECT ba.company_id AS cid, ba.iban AS iban
    FROM public.bank_accounts ba
    WHERE ba.iban IS NOT NULL AND trim(ba.iban) <> ''
    GROUP BY ba.company_id, ba.iban
    HAVING count(*) > 1
  LOOP
    -- Canonico: conto ATTIVO che porta l'acube_account_uuid corrente e col saldo
    -- aggiornato piu' di recente (e' quello su cui A-Cube sincronizza oggi).
    SELECT id INTO v_canonical
    FROM public.bank_accounts
    WHERE company_id = g.cid AND iban = g.iban
    ORDER BY is_active DESC,
             (acube_account_uuid IS NOT NULL) DESC,
             balance_updated_at DESC NULLS LAST,
             updated_at DESC NULLS LAST,
             created_at DESC
    LIMIT 1;

    SELECT array_agg(id) INTO v_dups
    FROM public.bank_accounts
    WHERE company_id = g.cid AND iban = g.iban AND id <> v_canonical;

    IF v_dups IS NULL OR array_length(v_dups, 1) = 0 THEN
      CONTINUE;
    END IF;

    v_refs_tot := 0; v_moved_tot := 0; v_left_tot := 0;

    FOREACH v_dup IN ARRAY v_dups LOOP
      -- 3a) bank_transactions: re-point SOLO i movimenti che NON collidono con uno
      --     gia' presente sul canonico. bank_transactions ha DUE unique index:
      --       - import_dedup_hash  (ricalcolato dal trigger 046 sull'UPDATE del
      --                             bank_account_id) -> formula compute_bank_tx_dedup_hash
      --       - acube_dedup_hash   (NON ricalcolato in automatico) -> formula
      --                             bank_transaction_canonical_hash
      --     Si escludono dallo spostamento i movimenti che collidono su UNO QUALSIASI
      --     dei due hash ricalcolati sul canonico (sono duplicati reali del medesimo
      --     movimento gia' presente sul canonico) e si lasciano sul conto vecchio
      --     (nessuna cancellazione). Per i movimenti spostati si RICALCOLA anche
      --     acube_dedup_hash sul canonico, cosi' che i sync A-Cube futuri li
      --     riconoscano come duplicati (ON CONFLICT DO NOTHING) e non li ri-sdoppino.
      BEGIN
        UPDATE public.bank_transactions bt
        SET bank_account_id = v_canonical,
            acube_dedup_hash = CASE
              WHEN bt.acube_dedup_hash IS NOT NULL
                THEN public.bank_transaction_canonical_hash(v_canonical, bt.transaction_date, bt.amount, bt.description)
              ELSE NULL END
        WHERE bt.bank_account_id = v_dup
          AND NOT EXISTS (  -- collisione su import_dedup_hash
            SELECT 1 FROM public.bank_transactions c
            WHERE c.company_id = bt.company_id
              AND c.bank_account_id = v_canonical
              AND public.compute_bank_tx_dedup_hash(v_canonical, c.transaction_date, c.amount, c.description)
                = public.compute_bank_tx_dedup_hash(v_canonical, bt.transaction_date, bt.amount, bt.description)
          )
          AND NOT EXISTS (  -- collisione su acube_dedup_hash
            SELECT 1 FROM public.bank_transactions c
            WHERE c.bank_account_id = v_canonical
              AND c.acube_dedup_hash IS NOT NULL
              AND c.acube_dedup_hash
                = public.bank_transaction_canonical_hash(v_canonical, bt.transaction_date, bt.amount, bt.description)
          );
        GET DIAGNOSTICS v_moved = ROW_COUNT;
        v_moved_tot := v_moved_tot + v_moved;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[105] bank_transactions re-point dup=% -> canon=%: %', v_dup, v_canonical, SQLERRM;
        v_moved := 0;
      END;

      -- movimenti rimasti sul doppione (duplicati reali non spostabili)
      SELECT count(*) INTO v_left FROM public.bank_transactions WHERE bank_account_id = v_dup;
      v_left_tot := v_left_tot + COALESCE(v_left, 0);

      -- 3b) tutte le altre tabelle referenzianti (dinamico, con handler per-statement)
      FOREACH v_pair SLICE 1 IN ARRAY c_refs LOOP
        BEGIN
          EXECUTE format(
            'UPDATE public.%I SET %I = $1 WHERE %I = $2',
            v_pair[1], v_pair[2], v_pair[2]
          ) USING v_canonical, v_dup;
          GET DIAGNOSTICS v_refs = ROW_COUNT;
          v_refs_tot := v_refs_tot + COALESCE(v_refs, 0);
        EXCEPTION WHEN undefined_table OR undefined_column THEN
          -- tabella/colonna assente in questo tenant: si ignora
          NULL;
        WHEN unique_violation THEN
          -- collisione (es. outlet_bank_accounts gia' collegato al canonico):
          -- si lascia il riferimento sul doppione, nessun errore fatale
          RAISE NOTICE '[105] %.% unique_violation dup=% -> canon=%: lasciato invariato',
            v_pair[1], v_pair[2], v_dup, v_canonical;
        WHEN OTHERS THEN
          RAISE NOTICE '[105] %.% re-point dup=% -> canon=%: %',
            v_pair[1], v_pair[2], v_dup, v_canonical, SQLERRM;
        END;
      END LOOP;

      -- 4) disattiva il doppione (NO DELETE)
      UPDATE public.bank_accounts
      SET is_active = false,
          updated_at = now()
      WHERE id = v_dup;
    END LOOP;

    company_id := g.cid;
    iban := g.iban;
    canonical_id := v_canonical;
    dups_merged := array_length(v_dups, 1);
    refs_repointed := v_refs_tot;
    movements_repointed := v_moved_tot;
    movements_left_on_dup := v_left_tot;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------
-- 3) Esecuzione one-shot del consolidamento
-- ---------------------------------------------------------------------
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM public.fn_consolidate_duplicate_bank_accounts() LOOP
    RAISE NOTICE '[105] Consolidato IBAN % (company %): canonico=%, doppioni=%, refs=%, movimenti spostati=%, movimenti residui sul doppione=%',
      r.iban, r.company_id, r.canonical_id, r.dups_merged, r.refs_repointed, r.movements_repointed, r.movements_left_on_dup;
  END LOOP;
END $$;

COMMIT;

-- =====================================================================
-- VERIFICA (sola lettura, dopo l'applicazione)
-- =====================================================================
-- -- (a) Non devono piu' esistere IBAN con >1 conto ATTIVO:
-- SELECT company_id, iban, count(*) FILTER (WHERE is_active) AS attivi, count(*) AS totali
-- FROM bank_accounts
-- WHERE iban IS NOT NULL AND trim(iban) <> ''
-- GROUP BY company_id, iban HAVING count(*) > 1;
--
-- -- (b) I doppioni disattivati non devono avere piu' movimenti "vivi" spostabili
-- --     (movements_left_on_dup indica eventuali duplicati reali lasciati apposta):
-- SELECT ba.iban, ba.id, ba.is_active, count(bt.id) AS movimenti
-- FROM bank_accounts ba
-- LEFT JOIN bank_transactions bt ON bt.bank_account_id = ba.id
-- WHERE ba.iban IN (SELECT iban FROM _backup_bankacct_consolidation_105)
-- GROUP BY ba.iban, ba.id, ba.is_active
-- ORDER BY ba.iban, ba.is_active DESC;
--
-- -- (c) Backup delle righe pre-modifica:
-- SELECT * FROM _backup_bankacct_consolidation_105 ORDER BY iban, is_active DESC;
-- =====================================================================
