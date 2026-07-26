-- =====================================================================
-- Migrazione 119 — Utenze: match del fornitore a CONFINE DI PAROLA (fix over-match)
-- =====================================================================
-- CAUSA RADICE (caso reale): close_utility_movements (migr. 118) confermava il
-- fornitore-utenza con supplier_confirmed_in_text, che cerca la parola distintiva
-- del nome come SOTTOSTRINGA (position(w in testo)). Va bene quando c'è anche il
-- vincolo di importo/numero fattura, ma la chiusura utenze ha come unico filtro
-- "importo<0 + nome fornitore": così "HERA COMM S.p.A." matcha via "COMM" dentro
-- "COMMISSIONI" (e simili) e ha chiuso 720 movimenti su 1096. Over-match.
--
-- FIX: helper dedicato `supplier_confirmed_in_text_strict` che confronta la parola
-- distintiva come TOKEN ISOLATO (regex \y…\y, confine di parola Postgres), non come
-- sottostringa — come già si fa per i numeri fattura (R10). Aggiunge anche "comm",
-- "comp", "cons" alla stoplist (sigle commerciali generiche). close_utility_movements
-- usa questo helper. I matcher fattura (100/104/111) restano invariati: lì la
-- sottostringa è innocua perché c'è sempre il vincolo di importo/numero.
--
-- Additiva/idempotente. NON distruttiva (solo ridefinizione di funzioni).
-- ⚠️ REGOLA #0 — NZ + Made + Zago.
--
-- Dopo l'apply, sullo STESSO tenant:
--   1) annulla le chiusure sbagliate della 118 (ripristino):
--      UPDATE public.bank_transactions
--      SET is_reconciled = false, reconciled_at = NULL,
--          note = NULLIF(regexp_replace(note, '( \| )?chiuso automaticamente \(utenza — addebito permanente\)$', ''), '')
--      WHERE note LIKE '%chiuso automaticamente (utenza — addebito permanente)%';
--   2) ri-lancia il motore e verifica che ora chiuda solo le vere utenze:
--      SELECT public.run_daily_reconciliation();  -- guarda "chiusi_utenze" (dev'essere piccolo)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Helper STRETTO: conferma fornitore a confine di parola.
--    (P.IVA nella causale, oppure parola distintiva del nome come token isolato.)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.supplier_confirmed_in_text_strict(p_name text, p_vat text, p_text text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    (p_vat IS NOT NULL AND p_vat <> '' AND position(lower(p_vat) in lower(coalesce(p_text, ''))) > 0)
    OR EXISTS (
      SELECT 1 FROM regexp_split_to_table(lower(coalesce(p_name, '')), '[^a-z0-9]+') w
      WHERE length(w) >= 4
        AND w NOT IN (
          'srl','srls','spa','snc','sas','sapa','scarl','scrl','propco','group','gruppo',
          'holding','italia','italy','italiana','societa','coop','cooperativa',
          'unipersonale','socio','unico','associati','associato','servizi','service','services',
          'comm','comp','cons'
        )
        -- token isolato (\y = confine di parola): "hera" NON matcha "commissioni";
        -- "comm" (comunque in stoplist) non matcherebbe "commissioni" nemmeno da solo.
        AND lower(coalesce(p_text, '')) ~ ('\y' || w || '\y')
    );
$function$;

REVOKE EXECUTE ON FUNCTION public.supplier_confirmed_in_text_strict(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_confirmed_in_text_strict(text, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1) close_utility_movements: usa l'helper STRETTO.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_utility_movements()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n INT;
BEGIN
  WITH upd AS (
    UPDATE public.bank_transactions bt
    SET is_reconciled = true,
        reconciled_at = now(),
        category = COALESCE(bt.category, 'utenze'),
        note = COALESCE(bt.note || ' | ', '') || 'chiuso automaticamente (utenza — addebito permanente)'
    WHERE bt.amount < 0
      AND COALESCE(bt.is_reconciled, false) = false
      AND bt.status IN ('posted', 'booked')
      -- niente fattura agganciata né proposta pendente: la fattura ha sempre la precedenza
      AND NOT EXISTS (
        SELECT 1 FROM public.reconciliation_log rl
        WHERE rl.bank_transaction_id = bt.id AND rl.status IN ('applied', 'to_confirm'))
      -- beneficiario = fornitore-utenza, confermato a CONFINE DI PAROLA (per P.IVA o token isolato)
      AND EXISTS (
        SELECT 1 FROM public.suppliers s
        WHERE s.company_id = bt.company_id
          AND COALESCE(s.is_utility, false) = true
          AND public.supplier_confirmed_in_text_strict(
                s.name, COALESCE(s.vat_number, s.partita_iva),
                coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '')))
    RETURNING bt.id
  )
  SELECT count(*) INTO v_n FROM upd;
  RETURN jsonb_build_object('chiusi_utenze', v_n);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.close_utility_movements() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_utility_movements() TO authenticated, service_role;
