-- =====================================================================
-- ROLLBACK Migrazione 152 — riapre le tabelle di backup
-- =====================================================================
-- ⚠️ Da usare SOLO se qualcosa legge quei backup con la chiave anon e si
--    rompe. Ri-eseguirlo riporta l'advisor 0013 in stato ERROR e riespone
--    i dati (IBAN, P.IVA, importi) a chiunque abbia l'URL del progetto.
--    Preferire, come alternativa, una policy SELECT mirata sulla singola
--    tabella invece di disattivare RLS su tutto.
--
-- La lista e' esplicita e non uno sweep: disattivare RLS a tappeto
-- toccherebbe anche le tabelle vive, che RLS ce l'hanno da sempre.
-- =====================================================================

DO $$
DECLARE
  t   TEXT;
  cnt INTEGER := 0;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    '_bkp_reconlog_stale_20260803',
    'payables_bkp_manualclose_carta_20260806',
    'payables_bkp_mp08_autodebit_20260806',
    'payables_bkp_supplier_card_20260807',
    'payables_installment_placeholder_backup_20260806',
    'riba_method_fix_backup_20260807',
    'riba_method_fix2_backup_20260807',
    'spm_reconcile_backup_20260806_banktx',
    'spm_reconcile_backup_20260806_logs',
    'spm_reconcile_backup_20260806_payables'
  ]
  LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
      cnt := cnt + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'ROLLBACK 152 — RLS disattivato su % tabelle', cnt;
END $$;
