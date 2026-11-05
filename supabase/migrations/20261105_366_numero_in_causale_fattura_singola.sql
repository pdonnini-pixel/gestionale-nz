-- =============================================================================
-- Migrazione 366 — Fattura singola: se la causale cita un numero, vale solo quella
-- =============================================================================
--
-- PERCHÉ (Patrizio, 05/11/2026)
--   Stessa regola della 364 per i gruppi, applicata ai motori che chiudono UNA fattura:
--   un numero scritto in causale dice quale fattura si paga. Se il fornitore ha
--   un'altra fattura con lo stesso importo, il motore non deve chiudere quella.
--
-- CASO REALE TROVATO MISURANDO (NZ)
--   Bonifico LA FAVORITA del 04/06/2026, 359,21 €, causale «SF-870»: il giro notturno
--   (rerun_bijective_reconciliation, nome + importo) l'ha agganciato alla fattura 331
--   del 31/01/2026 (stesso importo), non alla 870 del 31/03/2026.
--   Misura sulle 417 chiusure automatiche di NZ: 98 con un numero in causale, 1 sola
--   su una fattura non citata (questa). Le altre 4 «non citate» al primo conteggio
--   erano numeri di due cifre (11-12, NC30, 20/FE): per questo il confronto sulla
--   fattura citata parte da 2 cifre.
--
-- LA REGOLA
--   public.causale_cita_fattura(testo): vero se la causale (prima di «ID.BON») ha una
--   parola che introduce un documento (FATTURA, FATT, FT, anche con N./N°/NUMERO; SF-,
--   SSF-, NC-, CF- col trattino) seguita da un codice leggibile di almeno 3 caratteri
--   con una cifra. Stessa espressione di citesInvoiceNumbers in src/lib/reconcileMatch.ts.
--   Quando è vera, i motori della fattura singola considerano solo le fatture il cui
--   numero compare in causale (public.invoice_cited_in_text con almeno 2 cifre):
--     * try_match_bank_transaction        (a punteggio, all'arrivo del movimento)
--     * rerun_bijective_reconciliation     (giro notturno, nome + importo)
--     * try_match_amount_bank_transaction  (flussi CBI con il solo importo)
--   Numeri troppo corti («FT 1», «FATTURE 12 E 13») non attivano la regola: resta il
--   comportamento di prima.
--
-- COME (senza riscrivere le funzioni)
--   Altre sessioni lavorano su queste funzioni (la 364 rpc_solo_con_profilo ci ha
--   messo la guardia del profilo). Per non sovrascrivere niente, la migration
--   inserisce le righe nuove nel testo attuale di ogni funzione, davanti a un punto
--   preciso che deve comparire una volta sola; se il punto non c'è o è doppio, si
--   ferma senza cambiare nulla. Rilanciabile (salta le funzioni già marcate «366»).
--
-- DATI: nessuno. Rollback in _ROLLBACK.sql (toglie le righe inserite).
-- PARITA' TENANT: NZ + Zago (niente Made dal 03/11/2026).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.causale_cita_fattura(p_descr text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT split_part(regexp_replace(upper(coalesce(p_descr, '')), 'ID\.?\s?BON', '§', 'g'), '§', 1)
         ~ '(^|[^A-Z])((FATTUR[AE]|FATT|FT)\.?\s*(N\.?|N°|NR\.?|NUM\.?|NUMERO)?\s*[-.:#°]?\s*[A-Z]{0,3}[0-9][A-Z0-9/-]{2,}|(S?SF|NC|CF)-\s*[A-Z]{0,3}[0-9][A-Z0-9/-]{2,})';
$function$;

REVOKE ALL ON FUNCTION public.causale_cita_fattura(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.causale_cita_fattura(text) TO authenticated, service_role;

DO $$
DECLARE
  r record;
  v_def text;
  v_n int;
  v_done int := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.try_match_bank_transaction(uuid)'::regprocedure,
       E'    -- 356: un movimento anteriore alla fattura la paga solo se la causale nomina il\n',
       E'    -- 366: se la causale cita un numero di fattura leggibile, vale solo la fattura citata.\n'
       || E'    IF public.causale_cita_fattura(v_bt.description)\n'
       || E'       AND NOT public.invoice_cited_in_text(coalesce(v_pay.invoice_number, ''''), v_descr, 2) THEN\n'
       || E'      CONTINUE;\n'
       || E'    END IF;\n\n'),
      ('public.rerun_bijective_reconciliation()'::regprocedure,
       E'      AND public.supplier_confirmed_in_text(\n            v_pay.supplier_name, v_pay.supplier_vat,\n',
       E'      -- 366: causale con numero di fattura leggibile: solo la fattura citata.\n'
       || E'      AND (NOT public.causale_cita_fattura(bt.description)\n'
       || E'           OR public.invoice_cited_in_text(coalesce(v_pay.invoice_number, ''''), coalesce(bt.description, ''''), 2))\n'),
      ('public.try_match_amount_bank_transaction(uuid)'::regprocedure,
       E'      AND (p.invoice_date IS NULL OR v_bt.transaction_date >= p.invoice_date)\n',
       E'      -- 366: causale con numero di fattura leggibile: solo la fattura citata.\n'
       || E'      AND (NOT public.causale_cita_fattura(v_descr)\n'
       || E'           OR public.invoice_cited_in_text(coalesce(p.invoice_number, ''''), v_descr, 2))\n')
    ) AS t(fn, anchor, ins)
  LOOP
    v_def := pg_get_functiondef(r.fn);
    CONTINUE WHEN position('-- 366:' IN v_def) > 0;
    v_n := (length(v_def) - length(replace(v_def, r.anchor, ''))) / length(r.anchor);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '366: in % il punto di inserimento compare % volte (atteso 1), niente cambiato', r.fn, v_n;
    END IF;
    EXECUTE replace(v_def, r.anchor, r.ins || r.anchor);
    v_done := v_done + 1;
  END LOOP;
  RAISE NOTICE '366: regola inserita in % funzioni', v_done;
END $$;

COMMIT;
