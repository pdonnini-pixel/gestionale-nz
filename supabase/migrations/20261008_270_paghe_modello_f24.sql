-- 270 · Paghe: il modello F24 dello studio diventa la scadenza pianificata
--
-- Richiesta di Patrizio (08/10/2026): nello zip paghe di settembre lo studio ha
-- messo anche il modello F24 («2026-10 in scadenza il 16-10-2026 (prog.1) tipo
-- Ordinario», 10 moduli, 32.601,97 €, addebito sul conto MPS …621460).
-- «F24 deve creare il pagamento tra quelli pianificati e definire gia' chi paga
-- e quando viene pagato».
--
--  1. payroll_f24_documents: un modello per (azienda, scadenza, prog). Lo legge il
--     frontend (src/lib/modelloF24.ts) e lo salva save_payroll_f24_document.
--  2. save_payroll_f24_document crea (o completa) la riga delle Scadenze fiscali
--     «F24 ritenute e contributi dipendenti, <mese>»: importo esatto, scadenza,
--     codici, e la disposizione gia' compilata (conto dell'IBAN del modello,
--     importo, nota «addebito automatico»). Cosi' compare nello Scadenzario come
--     pagamento gia' disposto e la Tesoreria lo toglie dal saldo previsionale di
--     quel conto. Chiede conferma solo se sostituirebbe un importo diverso gia'
--     presente (regola fissa del caricamento, CLAUDE.md).
--  3. fn_payroll_sync: l'F24 atteso e' quello del modello quando c'e'; altrimenti
--     la stima del Prospetto contando solo le voci del suo mese (prima le quote
--     INPS con periodo del mese dopo aprivano un controllo a se'). Con il modello,
--     la delega ritrovata in banca al centesimo chiude la scadenza fiscale.
--  4. Nel frontend (stessa PR): le voci 5xxx del Prospetto (TAXBENEFIT, AZIMUT)
--     non sono F24.
--
-- Additiva: tabella nuova, due colonne nuove su payroll_f24_checks, funzioni
-- sostituite. Nessun dato esistente toccato.
-- Rollback: 20261008_270_paghe_modello_f24_ROLLBACK.sql.

-- ── 1. modelli F24 dello studio ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_f24_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  scadenza date NOT NULL,
  prog integer NOT NULL,
  periodo date NOT NULL,
  totale numeric(14,2) NOT NULL,
  modo_invio text,
  banca text,
  iban text,
  bank_account_id uuid,  -- come fiscal_deadlines.disposizione_bank_account_id: riferimento semplice
  sezioni jsonb,
  codici text,
  moduli jsonb,
  quadra boolean NOT NULL DEFAULT true,
  file_name text,
  import_document_id uuid,
  -- Riferimento semplice: una scadenza annullata o tolta dalla pagina non deve
  -- essere bloccata da questo legame; se manca, il salvataggio ne crea una nuova.
  fiscal_deadline_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_f24_documents_uq UNIQUE (company_id, scadenza, prog)
);
COMMENT ON TABLE public.payroll_f24_documents IS
  'Modelli F24 del personale preparati dallo studio paghe (uno per scadenza e progressivo). Scritta solo da save_payroll_f24_document (migration 270).';
ALTER TABLE public.payroll_f24_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_f24_documents_select ON public.payroll_f24_documents FOR SELECT USING (company_id = public.get_my_company_id());
REVOKE INSERT, UPDATE ON public.payroll_f24_documents FROM anon, authenticated;
GRANT SELECT ON public.payroll_f24_documents TO authenticated;

ALTER TABLE public.payroll_f24_checks ADD COLUMN IF NOT EXISTS fonte text NOT NULL DEFAULT 'prospetto';
ALTER TABLE public.payroll_f24_checks ADD COLUMN IF NOT EXISTS fiscal_deadline_id uuid;

-- Nessuna policy di scrittura: con la RLS attiva da client si legge soltanto.

-- ── 2. salvataggio del modello e scadenza pianificata ───────────────────────
CREATE OR REPLACE FUNCTION public.save_payroll_f24_document(p_doc jsonb, p_conferma boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_role text := public.get_my_role()::text;
  v_scad date := NULLIF(p_doc->>'scadenza', '')::date;
  v_prog int := NULLIF(p_doc->>'prog', '')::int;
  v_tot numeric := round(NULLIF(p_doc->>'totale', '')::numeric, 2);
  v_periodo date;
  v_iban text := upper(regexp_replace(COALESCE(p_doc->>'iban', ''), '\s', '', 'g'));
  v_cf text := upper(regexp_replace(COALESCE(p_doc->>'codice_fiscale', ''), '[^0-9A-Za-z]', '', 'g'));
  v_cf_az text;
  v_piva_az text;
  v_acc record;
  v_doc record;
  v_fd record;
  v_fd_id uuid;
  v_doc_id uuid;
  v_gia boolean := false;
  v_titolo text;
  v_desc text;
  v_nota text;
  v_disp_nota text;
  v_conto text;
  v_mesi text[] := ARRAY['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'Nessuna azienda associata all''utente'; END IF;
  IF COALESCE(v_role, '') NOT IN ('super_advisor', 'cfo', 'contabile') THEN
    RAISE EXCEPTION 'Ruolo % non abilitato', v_role;
  END IF;
  IF v_scad IS NULL OR v_prog IS NULL OR v_tot IS NULL OR v_tot <= 0 THEN
    RAISE EXCEPTION 'Modello F24 incompleto: servono scadenza, progressivo e totale';
  END IF;
  v_periodo := (date_trunc('month', v_scad) - interval '1 month')::date;

  -- Il modello deve essere di questa azienda (tre tenant, tre aziende).
  SELECT upper(regexp_replace(COALESCE(fiscal_code, ''), '[^0-9A-Za-z]', '', 'g')),
         regexp_replace(COALESCE(vat_number, ''), '\D', '', 'g')
    INTO v_cf_az, v_piva_az FROM public.companies WHERE id = v_company;
  IF v_cf <> '' AND (v_cf_az <> '' OR v_piva_az <> '')
     AND v_cf <> v_cf_az AND right(v_cf, 11) <> right(v_piva_az, 11) THEN
    RETURN jsonb_build_object('stato', 'altra_azienda',
      'messaggio', format('Il modello F24 è intestato al codice fiscale %s, che non è quello di questa azienda: non l''ho salvato.', v_cf));
  END IF;

  -- Chi paga: il conto dell'IBAN scritto in fondo al modulo (prima i conti attivi).
  SELECT a.id, a.bank_name, COALESCE(NULLIF(a.iban, ''), a.account_name) AS iban INTO v_acc
  FROM public.bank_accounts a
  WHERE a.company_id = v_company AND v_iban <> ''
    AND (upper(regexp_replace(COALESCE(a.iban, ''), '\s', '', 'g')) = v_iban
         OR upper(regexp_replace(COALESCE(a.account_name, ''), '\s', '', 'g')) = v_iban)
  ORDER BY COALESCE(a.is_active, true) DESC, a.created_at
  LIMIT 1;
  v_conto := CASE WHEN v_acc.id IS NOT NULL THEN format('%s …%s', v_acc.bank_name, right(v_iban, 6))
                  WHEN v_iban <> '' THEN format('IBAN %s (non è fra i conti del gestionale)', v_iban)
                  ELSE 'conto non indicato nel modello' END;

  -- Lo stesso modello gia' caricato?
  SELECT * INTO v_doc FROM public.payroll_f24_documents
  WHERE company_id = v_company AND scadenza = v_scad AND prog = v_prog;
  IF FOUND THEN
    IF v_doc.totale = v_tot THEN
      v_gia := true;
    ELSIF NOT p_conferma THEN
      RETURN jsonb_build_object('stato', 'da_confermare',
        'messaggio', format('Il modello F24 in scadenza il %s (prog. %s) era già caricato con %s; questo dice %s. Lo sostituisco?',
                            to_char(v_scad, 'DD/MM/YYYY'), v_prog, public.fn_eur_it(v_doc.totale), public.fn_eur_it(v_tot)));
    END IF;
    v_fd_id := v_doc.fiscal_deadline_id;
  END IF;

  -- La scadenza fiscale: quella gia' legata al modello, oppure (solo prog. 1)
  -- una F24 del personale con la stessa scadenza inserita a mano.
  IF v_fd_id IS NOT NULL THEN
    SELECT * INTO v_fd FROM public.fiscal_deadlines WHERE id = v_fd_id AND company_id = v_company;
  ELSIF v_prog = 1 THEN
    SELECT * INTO v_fd FROM public.fiscal_deadlines
    WHERE company_id = v_company AND deadline_type = 'f24' AND due_date = v_scad
      AND status <> 'cancelled' AND title ~* '(dipendent|personale|paghe|ritenute e contributi)'
    ORDER BY created_at LIMIT 1;
  END IF;

  IF v_fd.id IS NOT NULL AND v_fd.status <> 'paid' AND COALESCE(v_fd.amount, 0) > 0
     AND round(v_fd.amount, 2) <> v_tot AND NOT p_conferma AND NOT v_gia THEN
    RETURN jsonb_build_object('stato', 'da_confermare',
      'messaggio', format('Nelle Scadenze fiscali c''è già «%s» di %s per il %s; il modello dello studio dice %s. La aggiorno con l''importo del modello?',
                          v_fd.title, public.fn_eur_it(v_fd.amount), to_char(v_scad, 'DD/MM/YYYY'), public.fn_eur_it(v_tot)));
  END IF;

  INSERT INTO public.payroll_f24_documents (company_id, scadenza, prog, periodo, totale, modo_invio, banca, iban,
    bank_account_id, sezioni, codici, moduli, quadra, file_name, import_document_id, created_by)
  VALUES (v_company, v_scad, v_prog, v_periodo, v_tot, NULLIF(p_doc->>'modo_invio', ''), NULLIF(p_doc->>'banca', ''),
    NULLIF(v_iban, ''), v_acc.id, p_doc->'sezioni', NULLIF(p_doc->>'codici', ''), p_doc->'moduli',
    COALESCE((p_doc->>'quadra')::boolean, true), NULLIF(p_doc->>'file_name', ''),
    NULLIF(p_doc->>'import_document_id', '')::uuid, auth.uid())
  ON CONFLICT (company_id, scadenza, prog) DO UPDATE SET
    periodo = EXCLUDED.periodo, totale = EXCLUDED.totale, modo_invio = EXCLUDED.modo_invio, banca = EXCLUDED.banca,
    iban = EXCLUDED.iban, bank_account_id = EXCLUDED.bank_account_id, sezioni = EXCLUDED.sezioni,
    codici = EXCLUDED.codici, moduli = EXCLUDED.moduli, quadra = EXCLUDED.quadra,
    file_name = COALESCE(EXCLUDED.file_name, payroll_f24_documents.file_name),
    import_document_id = COALESCE(EXCLUDED.import_document_id, payroll_f24_documents.import_document_id),
    updated_at = now()
  RETURNING id INTO v_doc_id;

  v_titolo := format('F24 ritenute e contributi dipendenti, %s %s%s',
                     v_mesi[extract(month FROM v_periodo)::int], extract(year FROM v_periodo)::int,
                     CASE WHEN v_prog > 1 THEN format(' (prog. %s)', v_prog) ELSE '' END);
  v_desc := format('Modello F24 ordinario prog. %s (%s %s), %s, delega irrevocabile a %s; letto dal PDF «%s».',
                   v_prog, jsonb_array_length(COALESCE(p_doc->'moduli', '[]'::jsonb)),
                   CASE WHEN jsonb_array_length(COALESCE(p_doc->'moduli', '[]'::jsonb)) = 1 THEN 'modulo' ELSE 'moduli' END,
                   COALESCE('invio ' || NULLIF(p_doc->>'modo_invio', ''), 'invio dello studio'),
                   COALESCE(NULLIF(p_doc->>'banca', ''), 'banca non indicata'),
                   COALESCE(NULLIF(p_doc->>'file_name', ''), 'modello F24'));
  v_nota := format('Dal modello F24 dello studio (%s): %s. Totale delega %s.',
                   to_char(now() AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY'),
                   COALESCE(NULLIF(p_doc->>'sezioni_testo', ''), 'sezioni non lette'), public.fn_eur_it(v_tot));
  v_disp_nota := format('Delega F24 trasmessa dallo studio: la banca la addebita da sola il %s sul conto %s. Non va disposta a mano.',
                        to_char(v_scad, 'DD/MM/YYYY'), v_conto);

  IF v_fd.id IS NULL THEN
    INSERT INTO public.fiscal_deadlines (company_id, deadline_type, title, description, amount, amount_paid, due_date,
      reminder_date, status, f24_code, tax_period, payment_method, notes, created_by,
      disposizione_date, disposizione_bank_account_id, disposizione_amount, disposizione_note)
    VALUES (v_company, 'f24', v_titolo, v_desc, v_tot, 0, v_scad,
      v_scad - 7, 'pending', NULLIF(p_doc->>'codici', ''), to_char(v_periodo, 'MM/YYYY'), 'f24', v_nota, auth.uid(),
      now(), v_acc.id, v_tot, v_disp_nota)
    RETURNING id INTO v_fd_id;
  ELSE
    v_fd_id := v_fd.id;
    -- Pagata: resta com'e', si lega soltanto. Altrimenti importo e codici dal
    -- modello; la disposizione si completa solo dove e' vuota.
    IF v_fd.status <> 'paid' AND NOT v_gia THEN
      UPDATE public.fiscal_deadlines f SET
        amount = v_tot,
        f24_code = COALESCE(NULLIF(p_doc->>'codici', ''), f.f24_code),
        tax_period = COALESCE(f.tax_period, to_char(v_periodo, 'MM/YYYY')),
        payment_method = COALESCE(f.payment_method, 'f24'),
        description = COALESCE(NULLIF(f.description, ''), v_desc),
        notes = concat_ws(' | ', NULLIF(f.notes, ''), v_nota),
        disposizione_date = COALESCE(f.disposizione_date, now()),
        disposizione_bank_account_id = COALESCE(f.disposizione_bank_account_id, v_acc.id),
        disposizione_amount = CASE WHEN f.disposizione_amount IS NULL OR p_conferma THEN v_tot ELSE f.disposizione_amount END,
        disposizione_note = COALESCE(NULLIF(f.disposizione_note, ''), v_disp_nota),
        updated_at = now()
      WHERE f.id = v_fd.id;
    END IF;
  END IF;

  UPDATE public.payroll_f24_documents SET fiscal_deadline_id = v_fd_id WHERE id = v_doc_id;

  RETURN jsonb_build_object(
    'stato', CASE WHEN v_gia THEN 'gia_presente' ELSE 'salvato' END,
    'fiscal_deadline_id', v_fd_id, 'totale', v_tot, 'scadenza', v_scad, 'conto', v_conto,
    'conto_trovato', v_acc.id IS NOT NULL,
    'messaggio', format('F24 di %s %s: %s, addebito automatico il %s sul conto %s. È fra i pagamenti pianificati (Scadenze fiscali e Scadenzario).',
                        v_mesi[extract(month FROM v_periodo)::int], extract(year FROM v_periodo)::int,
                        public.fn_eur_it(v_tot), to_char(v_scad, 'DD/MM/YYYY'), v_conto),
    'sync', public.fn_payroll_sync(v_company));
END;
$function$;
REVOKE ALL ON FUNCTION public.save_payroll_f24_document(jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_payroll_f24_document(jsonb, boolean) TO authenticated;

-- ── 3. motore paghe: F24 atteso dal modello, o dal Prospetto del mese ───────
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
  v_bt_data date;
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

  -- 2) F24 del personale. La cifra vera e' il modello F24 dello studio
  --    (payroll_f24_documents, migration 270); finche' non arriva vale la stima
  --    del Prospetto, contando solo le voci del suo mese.
  FOR p IN
    WITH prosp AS (
      SELECT i.periodo, round(sum(i.importo), 2) AS atteso
      FROM public.payroll_f24_items i
      WHERE i.company_id = p_company AND i.canale = 'f24'
        -- (270) solo le voci con il periodo del mese del Prospetto: le quote INPS
        -- con periodo del mese dopo (18,69 ad agosto, 27,13 a settembre 2026)
        -- vanno nell'F24 successivo e non devono aprire un controllo a se'.
        AND i.periodo = make_date(i.year, i.month, 1)
        -- solo l'ultimo caricamento di ogni mese del Prospetto
        AND i.batch_id = (SELECT j.batch_id FROM public.payroll_f24_items j
                          WHERE j.company_id = i.company_id AND j.year = i.year AND j.month = i.month
                          ORDER BY j.created_at DESC, j.batch_id LIMIT 1)
      GROUP BY 1
    ), modello AS (
      SELECT d.periodo, round(sum(d.totale), 2) AS atteso, min(d.scadenza) AS scadenza,
             (array_agg(d.fiscal_deadline_id ORDER BY d.prog))[1] AS fiscal_deadline_id,
             count(*) AS deleghe
      FROM public.payroll_f24_documents d
      WHERE d.company_id = p_company
      GROUP BY 1
    )
    SELECT COALESCE(m.periodo, pr.periodo) AS periodo,
           COALESCE(m.atteso, pr.atteso) AS atteso,
           m.scadenza AS scadenza_modello,
           m.fiscal_deadline_id,
           COALESCE(m.deleghe, 0) AS deleghe,
           CASE WHEN m.periodo IS NOT NULL THEN 'modello' ELSE 'prospetto' END AS fonte
    FROM prosp pr FULL JOIN modello m ON m.periodo = pr.periodo
  LOOP
    v_f24 := v_f24 + 1;
    v_scad := COALESCE(p.scadenza_modello, public.fn_f24_scadenza(p.periodo));
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

    INSERT INTO public.payroll_f24_checks (company_id, periodo, scadenza, atteso, pagato, bank_transaction_ids, esito, fonte, fiscal_deadline_id, updated_at)
    VALUES (p_company, p.periodo, v_scad, p.atteso, v_pagato, COALESCE(v_bt, '{}'), v_esito, p.fonte, p.fiscal_deadline_id, now())
    ON CONFLICT (company_id, periodo) DO UPDATE SET
      scadenza = EXCLUDED.scadenza, atteso = EXCLUDED.atteso, pagato = EXCLUDED.pagato,
      bank_transaction_ids = EXCLUDED.bank_transaction_ids, esito = EXCLUDED.esito,
      fonte = EXCLUDED.fonte, fiscal_deadline_id = EXCLUDED.fiscal_deadline_id, updated_at = now();

    -- (270) Con il modello dello studio la cifra e' esatta: se in banca c'e' una
    -- delega per ogni modello e fanno la cifra al centesimo, la scadenza fiscale
    -- creata dal modello si chiude agganciata al movimento.
    IF p.fonte = 'modello' AND v_esito = 'pagato' AND p.fiscal_deadline_id IS NOT NULL
       AND v_sub IS NOT NULL AND cardinality(v_bt) = 1 THEN
      SELECT b.transaction_date INTO v_bt_data FROM public.bank_transactions b WHERE b.id = v_bt[1];
      UPDATE public.fiscal_deadlines f SET
        status = 'paid',
        paid_date = COALESCE(f.paid_date, v_bt_data),
        amount_paid = CASE WHEN COALESCE(f.amount_paid, 0) = 0 THEN f.amount ELSE f.amount_paid END,
        bank_transaction_id = COALESCE(f.bank_transaction_id, v_bt[1]),
        notes = concat_ws(' | ', NULLIF(f.notes, ''), 'chiusa auto: delega F24 del modello dello studio ritrovata in banca al centesimo'),
        updated_at = now()
      WHERE f.id = p.fiscal_deadline_id AND f.company_id = p_company AND f.status <> 'paid';
      UPDATE public.bank_transactions b SET is_reconciled = true
      WHERE b.id = v_bt[1] AND b.company_id = p_company AND COALESCE(b.is_reconciled, false) = false;
    END IF;

    IF v_esito = 'da_chiarire' AND v_scad >= current_date - 90 THEN
      IF public.fn_bank_doc_ask(p_company, NULL, 'f24_paghe', 'f24-paghe:' || p.periodo, NULL,
           CASE WHEN p.fonte = 'modello' THEN
             format('Il modello F24 dello studio di %s %s (%s, in scadenza il %s) in banca non torna: fra il %s e il %s le deleghe F24 fanno %s. È stato pagato da un altro conto o in un''altra data?',
                    v_mesi[extract(month FROM p.periodo)::int], extract(year FROM p.periodo)::int, public.fn_eur_it(p.atteso),
                    to_char(v_scad, 'DD/MM/YYYY'), to_char(v_scad - 3, 'DD/MM/YYYY'), to_char(v_scad + 7, 'DD/MM/YYYY'),
                    public.fn_eur_it(COALESCE(v_pagato, 0)))
           WHEN v_bt IS NULL THEN
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
