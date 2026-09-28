-- 20260928_219 — A parità di punteggio vince la scadenza più vicina, anche fra fatture diverse
--
-- COSA NON TORNAVA
-- Il motore scrive nel log «abbinamento per data — stesso fornitore/importo», ma
-- in tre casi su sessantasei ha scelto la scadenza PIU' LONTANA dal movimento.
-- Il peggiore: EPPI, movimento del 03/06/2026 da 3.050,00, quattro fatture
-- aperte dello stesso importo, e il motore prende quella scaduta il 06/02
-- (117 giorni) invece di quella a 27. Stessa cosa per LA FAVORITA 331
-- (96 giorni invece di 35) e Colette 292/2026 (21 invece di 0).
--
-- LA CAUSA
-- Il tie-break sulla distanza esiste già, ma è chiuso dentro una condizione che
-- lo restringe a un caso solo:
--
--   ELSIF v_score_total = v_best_score AND v_score_total > 0 THEN
--     IF v_pay.invoice_number IS NOT NULL
--        AND v_pay.invoice_number = v_best_invoice        <-- stesso numero fattura
--        AND <stesso fornitore> THEN
--          IF v_gap < v_best_gap THEN ... prende la più vicina
--
-- Cioè: a parità di punteggio il motore preferisce la scadenza più vicina SOLO
-- se le due righe sono rate della STESSA fattura. Se sono fatture DIVERSE dello
-- stesso fornitore con lo stesso importo — il caso EPPI — il tie-break non si
-- applica affatto e vince la prima riga incontrata nel ciclo, cioè un ordine
-- arbitrario deciso dal piano di esecuzione.
--
-- COSA CAMBIA
-- Il tie-break vale per qualunque coppia di candidati dello STESSO FORNITORE,
-- non più solo per le rate della stessa fattura. Il corpo interno non si tocca:
-- prima la distanza minore, poi, a pari distanza, il numero di rata più basso.
--
-- PERCHE' E' SICURO
-- Agisce SOLO a punteggio identico (`v_score_total = v_best_score`): non tocca
-- mai un abbinamento vinto su identità certa — beneficiario in causale, numero
-- di fattura citato, scadenza in distinta — perché quelli hanno punteggio più
-- alto e vincono nel ramo sopra. Cambia soltanto quale, fra due righe che il
-- motore giudica identiche, risulti saldata. Importo e fornitore restano gli
-- stessi in ogni caso.
--
-- Come la 218, NON riscrive la funzione: legge la definizione viva, verifica
-- che l'ancora sia unica, la sostituisce e riapplica. È la regola scritta nelle
-- note dopo tre riscritture che si sono mangiate i rami altrui.

BEGIN;

DO $mig$
DECLARE
  v_src     text;
  v_new     text;
  v_pattern text := 'IF v_pay\.invoice_number IS NOT NULL\s+AND v_pay\.invoice_number = v_best_invoice\s+AND COALESCE\(v_pay\.supplier_vat, v_pay\.supplier_id::text, v_pay\.supplier_name\) IS NOT DISTINCT FROM v_best_supplier_key THEN';
  v_nuovo   text;
  v_conta   integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'try_match_bank_transaction';

  IF v_src IS NULL THEN
    RAISE EXCEPTION '219: try_match_bank_transaction non trovata';
  END IF;

  -- idempotente
  IF position('-- 219: a parita'' vince la scadenza piu'' vicina' in v_src) > 0 THEN
    RAISE NOTICE '219: gia'' applicata, nessuna modifica';
    RETURN;
  END IF;

  SELECT count(*) INTO v_conta FROM regexp_matches(v_src, v_pattern, 'g');
  IF v_conta <> 1 THEN
    RAISE EXCEPTION '219: ancora trovata % volte invece di 1 — corpo cambiato, patch NON applicata', v_conta;
  END IF;

  v_nuovo :=
    '-- 219: a parita'' vince la scadenza piu'' vicina al movimento, anche quando' || E'\n'
    '      -- i candidati sono fatture DIVERSE dello stesso fornitore con lo stesso' || E'\n'
    '      -- importo (prima il tie-break valeva solo fra rate della stessa fattura).' || E'\n'
    '      IF COALESCE(v_pay.supplier_vat, v_pay.supplier_id::text, v_pay.supplier_name) IS NOT DISTINCT FROM v_best_supplier_key THEN';

  v_new := regexp_replace(v_src, v_pattern, v_nuovo);

  IF position('-- 219: a parita'' vince la scadenza piu'' vicina' in v_new) = 0 THEN
    RAISE EXCEPTION '219: la sostituzione non ha prodotto la modifica attesa';
  END IF;

  -- le guardie delle migration precedenti devono sopravvivere alla patch
  IF position('closed_manually IS NOT TRUE' in v_new) = 0
     OR position('fn_bank_own_movement' in v_new) = 0
     OR position('payable_credit_note_links' in v_new) = 0 THEN
    RAISE EXCEPTION '219: la patch avrebbe perso un ramo esistente — NON applicata';
  END IF;

  EXECUTE v_new;
  RAISE NOTICE '219: tie-break esteso alle fatture diverse dello stesso fornitore';
END
$mig$;

COMMIT;

-- VERIFICA
-- SELECT position('-- 219: a parita' in pg_get_functiondef(p.oid)) > 0 AS patch_presente,
--        position('closed_manually IS NOT TRUE' in pg_get_functiondef(p.oid)) > 0 AS vincolo_218,
--        position('v_pay.invoice_number = v_best_invoice' in pg_get_functiondef(p.oid)) = 0 AS vecchia_condizione_rimossa
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public' AND p.proname='try_match_bank_transaction';
