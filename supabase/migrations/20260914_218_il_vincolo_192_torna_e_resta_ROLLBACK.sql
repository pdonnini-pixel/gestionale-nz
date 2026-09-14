-- ROLLBACK 20260914_218
--
-- Toglie la condizione rimessa dalla 218, con la stessa tecnica: patch sulla
-- definizione viva, senza riscrivere il resto della funzione.
--
-- Da usare solo se il vincolo si rivelasse troppo stretto (per esempio se una
-- chiusura manuale legittima portasse una payment_date volutamente lontana dal
-- movimento). In quel caso, meglio allargare la finestra dei 30 giorni che
-- togliere la condizione del tutto.

BEGIN;

DO $rb$
DECLARE
  v_src text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'try_match_bank_transaction';

  v_new := regexp_replace(
    v_src,
    '\n\s*-- Migration 192, rimessa dalla 218.*?<= 30\)',
    '',
    'n'
  );

  IF v_new = v_src THEN
    RAISE NOTICE 'ROLLBACK 218: vincolo non presente, niente da togliere';
    RETURN;
  END IF;

  EXECUTE v_new;
END
$rb$;

COMMIT;
