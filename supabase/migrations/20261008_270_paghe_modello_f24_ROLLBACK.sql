-- ROLLBACK della 270 (modello F24 dello studio).
-- Rimette fn_payroll_sync com'era nella 268 e toglie funzione, tabella e colonne
-- nuove. Le scadenze fiscali gia' create dai modelli restano (sono dati veri):
-- si annullano a mano dalle Scadenze fiscali se servisse.

BEGIN;
DROP FUNCTION IF EXISTS public.save_payroll_f24_document(jsonb, boolean);
CREATE OR REPLACE FUNCTION public.fn_payroll_sync(p_company uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  f record;
  g record;
  p record;
  v_target numeric;
  v_comm numeric;
  v_nbon int;
  v_cbi text;
  v_match uuid[];
  v_y int;
  v_m int;
  v_k int;
  v_giro int;
  v_amts_bt numeric[];
  v_sub uuid[];
  v_ids uuid[];
  v_amts numeric[];
  v_links int := 0;
  v_flussi int := 0;
  v_domande int := 0;
  v_scad date;
  v_bt uuid[];
  v_pagato numeric;
  v_esito text;
  v_f24 int := 0;
  v_mesi text[] := ARRAY['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
BEGIN
  IF p_company IS NULL THEN RETURN jsonb_build_object('errore', 'azienda mancante'); END IF;

  -- 1) Disposizioni emolumenti degli ultimi 6 mesi non ancora agganciate.
  --    Giro 1: solo dentro la stessa filiale. Giro 2: fra tutte le buste rimaste
  --    del mese, che a quel punto sono poche.
  FOR v_giro IN 1 .. 2 LOOP
  FOR f IN
    SELECT b.id, b.transaction_date AS d, b.amount, COALESCE(b.description, '') AS descr
    FROM public.bank_transactions b
    WHERE b.company_id = p_company AND b.amount < 0 AND b.category = 'stipendi'
      AND b.transaction_date >= current_date - 185
      AND NOT EXISTS (SELECT 1 FROM public.payroll_payment_links l WHERE l.bank_transaction_id = b.id)
    ORDER BY b.transaction_date, b.amount
  LOOP
    IF v_giro = 1 THEN v_flussi := v_flussi + 1; END IF;
    v_target := public.fn_it_num((regexp_match(f.descr, 'IMPORTO BONIFICI:\s*([\d.]+,\d{2})', 'i'))[1]);
    v_comm := public.fn_it_num((regexp_match(f.descr, 'IMPORTO COMMISSIONI:\s*([\d.]+,\d{2})', 'i'))[1]);
    v_nbon := ((regexp_match(f.descr, 'NUM\.?\s*TOT\.?\s*PAGAMENTI:\s*(\d+)', 'i'))[1])::int;
    v_cbi := (regexp_match(f.descr, 'ID FLUSSO CBI:\s*(\d+)', 'i'))[1];
    IF v_target IS NULL THEN v_target := round(-f.amount, 2); END IF;
    v_match := NULL;

    -- Mese prima del pagamento, poi stesso mese.
    FOR v_k IN 0 .. 1 LOOP
      v_y := extract(year FROM (date_trunc('month', f.d) - make_interval(months => 1 - v_k)))::int;
      v_m := extract(month FROM (date_trunc('month', f.d) - make_interval(months => 1 - v_k)))::int;
      -- Prima filiale e tipo di cedolino insieme (la 14ª si paga a parte dalla
      -- mensilita'), poi la sola filiale.
      FOR g IN
        SELECT 1 AS pass, COALESCE(s.outlet_code, '?') AS o, s.tipo AS t,
               array_agg(s.id ORDER BY s.netto DESC, s.id) AS ids,
               array_agg(round(s.netto, 2) ORDER BY s.netto DESC, s.id) AS amts
        FROM public.employee_cost_slips s
        WHERE s.company_id = p_company AND s.year = v_y AND s.month = v_m AND COALESCE(s.netto, 0) > 0
          AND NOT EXISTS (SELECT 1 FROM public.payroll_payment_links l WHERE l.slip_id = s.id)
        GROUP BY 2, 3
        UNION ALL
        SELECT 2 AS pass, COALESCE(s.outlet_code, '?') AS o, NULL AS t,
               array_agg(s.id ORDER BY s.netto DESC, s.id) AS ids,
               array_agg(round(s.netto, 2) ORDER BY s.netto DESC, s.id) AS amts
        FROM public.employee_cost_slips s
        WHERE s.company_id = p_company AND s.year = v_y AND s.month = v_m AND COALESCE(s.netto, 0) > 0
          AND NOT EXISTS (SELECT 1 FROM public.payroll_payment_links l WHERE l.slip_id = s.id)
        GROUP BY 2
        HAVING count(DISTINCT s.tipo) > 1
        ORDER BY 1, 2, 3
      LOOP
        EXIT WHEN v_giro = 2;
        v_match := public.fn_payroll_subset(g.ids, g.amts, v_target);
        EXIT WHEN v_match IS NOT NULL;
      END LOOP;
      IF v_match IS NULL AND v_giro = 2 THEN
        SELECT array_agg(s.id ORDER BY s.netto DESC, s.id), array_agg(round(s.netto, 2) ORDER BY s.netto DESC, s.id)
          INTO v_ids, v_amts
        FROM public.employee_cost_slips s
        WHERE s.company_id = p_company AND s.year = v_y AND s.month = v_m AND COALESCE(s.netto, 0) > 0
          AND NOT EXISTS (SELECT 1 FROM public.payroll_payment_links l WHERE l.slip_id = s.id);
        v_match := public.fn_payroll_subset(v_ids, v_amts, v_target);
        IF v_match IS NULL THEN v_match := public.fn_payroll_subset_k(v_ids, v_amts, v_target, v_nbon); END IF;
      END IF;
      EXIT WHEN v_match IS NOT NULL;
    END LOOP;

    IF v_match IS NOT NULL THEN
      INSERT INTO public.payroll_payment_links (company_id, slip_id, bank_transaction_id, year, month, tipo, outlet_code, netto,
                                               id_flusso, importo_bonifici, commissioni, n_bonifici)
      SELECT p_company, s.id, f.id, s.year, s.month, s.tipo, s.outlet_code, round(s.netto, 2), v_cbi, v_target, v_comm, v_nbon
      FROM public.employee_cost_slips s WHERE s.id = ANY (v_match)
      ON CONFLICT (slip_id) DO NOTHING;
      v_links := v_links + array_length(v_match, 1);
    ELSIF v_giro = 2 AND f.d >= current_date - 60 AND f.d <= current_date - 3 THEN
      -- Si chiede solo se le buste del mese prima ci sono gia': senza, manca
      -- un caricamento, non un'informazione.
      v_y := extract(year FROM (date_trunc('month', f.d) - interval '1 month'))::int;
      v_m := extract(month FROM (date_trunc('month', f.d) - interval '1 month'))::int;
      IF EXISTS (SELECT 1 FROM public.employee_cost_slips s WHERE s.company_id = p_company AND s.year = v_y AND s.month = v_m) THEN
        IF public.fn_bank_doc_ask(p_company, NULL, 'stipendio_non_abbinato', 'stip-flusso:' || f.id, f.id,
             format('La disposizione per emolumenti del %s di %s%s non corrisponde a nessun gruppo di buste paga di %s %s o del mese dopo. A chi si riferisce?',
                    to_char(f.d, 'DD/MM/YYYY'), public.fn_eur_it(v_target),
                    CASE WHEN v_nbon IS NOT NULL THEN ' (' || v_nbon || CASE WHEN v_nbon = 1 THEN ' bonifico)' ELSE ' bonifici)' END ELSE '' END,
                    v_mesi[v_m], v_y),
             jsonb_build_object('importo_bonifici', v_target, 'id_flusso', v_cbi)) THEN
          v_domande := v_domande + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;
  END LOOP;

  -- 1b) Una filiale intera senza pagamento, quando le altre dello stesso mese
  --     sono state pagate e il 25 del mese dopo e' passato. Una sola busta
  --     scoperta non fa domanda: puo' essere pagata in contanti o a parte.
  FOR g IN
    SELECT s.year, s.month, COALESCE(s.outlet_code, '?') AS o, count(*) AS n, round(sum(s.netto), 2) AS tot
    FROM public.employee_cost_slips s
    LEFT JOIN public.payroll_payment_links l ON l.slip_id = s.id
    WHERE s.company_id = p_company AND COALESCE(s.netto, 0) > 0
      AND make_date(s.year, s.month, 1) >= date_trunc('month', current_date - 90)::date
    GROUP BY 1, 2, 3
    HAVING count(l.id) = 0
  LOOP
    IF current_date > (make_date(g.year, g.month, 1) + interval '1 month' + interval '24 days')::date
       AND EXISTS (SELECT 1 FROM public.payroll_payment_links l WHERE l.company_id = p_company AND l.year = g.year AND l.month = g.month) THEN
      IF public.fn_bank_doc_ask(p_company, NULL, 'buste_non_pagate', 'stip-buste:' || g.year || '-' || g.month || ':' || g.o, NULL,
           format('Le buste paga di %s %s di %s (%s %s, %s in tutto) non trovano una disposizione in banca, mentre le altre filiali risultano pagate. Sono state pagate in un altro modo o da un altro conto?',
                  v_mesi[g.month], g.year, g.o, g.n, CASE WHEN g.n = 1 THEN 'persona' ELSE 'persone' END, public.fn_eur_it(g.tot)),
           jsonb_build_object('year', g.year, 'month', g.month, 'outlet_code', g.o)) THEN
        v_domande := v_domande + 1;
      END IF;
    END IF;
  END LOOP;

  -- 2) F24 del personale: atteso dal Prospetto, cercato in banca intorno alla scadenza.
  FOR p IN
    SELECT i.periodo, round(sum(i.importo), 2) AS atteso
    FROM public.payroll_f24_items i
    WHERE i.company_id = p_company AND i.canale = 'f24'
      -- solo l'ultimo caricamento di ogni mese del Prospetto
      AND i.batch_id = (SELECT j.batch_id FROM public.payroll_f24_items j
                        WHERE j.company_id = i.company_id AND j.year = i.year AND j.month = i.month
                        ORDER BY j.created_at DESC, j.batch_id LIMIT 1)
    GROUP BY 1
  LOOP
    v_f24 := v_f24 + 1;
    v_scad := public.fn_f24_scadenza(p.periodo);
    -- Deleghe gia' usate per un altro periodo non contano due volte.
    SELECT array_agg(b.id ORDER BY b.transaction_date, b.id), round(sum(-b.amount), 2),
           array_agg(round(-b.amount, 2) ORDER BY b.transaction_date, b.id)
      INTO v_bt, v_pagato, v_amts_bt
    FROM public.bank_transactions b
    WHERE b.company_id = p_company AND b.amount < 0
      AND b.transaction_date BETWEEN v_scad - 3 AND v_scad + 7
      AND upper(COALESCE(b.description, '') || ' ' || COALESCE(b.statement_description, '')) ~ '(\yF24\y|DELEGA|DELEGHE)'
      AND NOT EXISTS (SELECT 1 FROM public.payroll_f24_checks k
                      WHERE k.company_id = p_company AND k.periodo <> p.periodo AND b.id = ANY (k.bank_transaction_ids));
    -- Se alcune deleghe fanno esattamente la cifra, sono quelle del personale.
    -- Altrimenti le deleghe portano anche altro (IVA, ritenute): si tengono tutte
    -- quelle della finestra e si guarda che coprano la quota paghe.
    v_sub := CASE WHEN v_bt IS NOT NULL THEN public.fn_payroll_subset(v_bt, v_amts_bt, p.atteso) END;
    IF v_sub IS NOT NULL THEN
      v_bt := v_sub; v_pagato := p.atteso;
    END IF;
    IF v_bt IS NULL THEN
      v_esito := CASE WHEN current_date > v_scad + 5 THEN 'da_chiarire' ELSE 'in_attesa' END;
    ELSIF v_pagato >= p.atteso - 1 THEN
      v_esito := CASE WHEN abs(v_pagato - p.atteso) <= 1 THEN 'pagato' ELSE 'pagato_con_altre_voci' END;
    ELSE
      v_esito := CASE WHEN current_date > v_scad + 5 THEN 'da_chiarire' ELSE 'in_attesa' END;
    END IF;

    INSERT INTO public.payroll_f24_checks (company_id, periodo, scadenza, atteso, pagato, bank_transaction_ids, esito, updated_at)
    VALUES (p_company, p.periodo, v_scad, p.atteso, v_pagato, COALESCE(v_bt, '{}'), v_esito, now())
    ON CONFLICT (company_id, periodo) DO UPDATE SET
      scadenza = EXCLUDED.scadenza, atteso = EXCLUDED.atteso, pagato = EXCLUDED.pagato,
      bank_transaction_ids = EXCLUDED.bank_transaction_ids, esito = EXCLUDED.esito, updated_at = now();

    IF v_esito = 'da_chiarire' AND v_scad >= current_date - 90 THEN
      IF public.fn_bank_doc_ask(p_company, NULL, 'f24_paghe', 'f24-paghe:' || p.periodo, NULL,
           CASE WHEN v_bt IS NULL THEN
             format('Il Prospetto paghe di %s %s chiede %s di F24 (contributi e ritenute del personale) entro il %s, ma in banca fra il %s e il %s non trovo deleghe F24. È stato pagato da un altro conto o in un''altra data?',
                    v_mesi[extract(month FROM p.periodo)::int], extract(year FROM p.periodo)::int, public.fn_eur_it(p.atteso),
                    to_char(v_scad, 'DD/MM/YYYY'), to_char(v_scad - 3, 'DD/MM/YYYY'), to_char(v_scad + 7, 'DD/MM/YYYY'))
           ELSE
             format('Il Prospetto paghe di %s %s chiede %s di F24 entro il %s, ma le deleghe pagate intorno a quella data fanno %s. Manca una parte o è stata compensata con un credito?',
                    v_mesi[extract(month FROM p.periodo)::int], extract(year FROM p.periodo)::int, public.fn_eur_it(p.atteso),
                    to_char(v_scad, 'DD/MM/YYYY'), public.fn_eur_it(v_pagato))
           END,
           jsonb_build_object('periodo', p.periodo, 'atteso', p.atteso, 'pagato', v_pagato)) THEN
        v_domande := v_domande + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('disposizioni_esaminate', v_flussi, 'buste_agganciate', v_links,
                            'periodi_f24', v_f24, 'domande_nuove', v_domande);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_payroll_sync(uuid) FROM PUBLIC, anon, authenticated;
ALTER TABLE public.payroll_f24_checks DROP COLUMN IF EXISTS fiscal_deadline_id;
ALTER TABLE public.payroll_f24_checks DROP COLUMN IF EXISTS fonte;
DROP TABLE IF EXISTS public.payroll_f24_documents;
COMMIT;
