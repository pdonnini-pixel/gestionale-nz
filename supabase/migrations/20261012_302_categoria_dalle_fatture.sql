-- Migrazione 302 — la categoria si legge dalle fatture (12/10/2026)
--
-- Chiesto da Patrizio il 12/10/2026: «la lettura delle fatture deve essere
-- regola per collegare». Prima fonte della catena (CLAUDE.md, «niente liste
-- da compilare a mano»): il documento.
-- 1. Vocabolario: parole generali delle righe delle fatture, aggiunte a
--    cost_categories.matching_keywords per codice categoria (su ogni azienda
--    che ha quella categoria). Lo usa fn_categorize_from_lines, già in uso sulle
--    scadenze nuove: migliora anche quelle.
-- 2. fn_categoria_dalle_fatture: per i fornitori con categoria vuota, o con il
--    ripiego «Altri costi di struttura» messo dal riparto, legge le righe delle
--    fatture degli ultimi 18 mesi; se almeno metà delle fatture porta alla
--    stessa categoria e nessun'altra la eguaglia, la scrive e lascia il segno
--    'categoria_dalle_fatture'. Le categorie scelte a mano non si toccano.
-- 3. Giro notturno: fatture → riparto → ripiego del riparto.
-- 4. Il trigger della 298 toglie un segno solo se c'era prima: una persona che
--    cambia categoria cancella il segno del sistema.
-- Vale su ogni tenant.

WITH nuove(code, kw) AS (VALUES
  ('VIAGGI', ARRAY['coperto','coperti','pernott','ristorazion','city tax','tassa di soggiorno','minibar','antipast','menu','poke','panin','bruschett','frittat','suppli','piatto','birra','beer','coca-cola','tramezz','focacc','primo piatto','secondo piatto','dessert','agnolotti']),
  ('PULIZIA', ARRAY['detergent','pavimenti','carta igienica','igienica','asciugatutto','scopa','scopino','candeggin','swiffer','catturapolver','rotolon','salviett','sacchi rifiuti','manutenzione semestrale','controllo semestrale','lavanderia']),
  ('CANCELL', ARRAY['azzeramenti','rotoli termici','rotolo termico','rotolo pos','rotoli pos','rism','fotocopie','post-it','cucitrice','nastro adesivo','nastro imballo','etichett','timbri','corrispett','evidenziat','cartell','portascontrini']),
  ('MANUT', ARRAY['manodopera','ripristino','sostituzione','ispezione impianti','quadro elettrico','magnetotermic','duplicazione chiavi','serratur','cerniere','portone','pronto intervento','diritto intervento']),
  ('ASS_SW', ARRAY['contratto assistenza','canone assistenza','reg. telematico','registratore telematico']),
  ('CAN_SW', ARRAY['archiviazione sostitutiva','canone annuale sensore']),
  ('TELEFON', ARRAY['ftth','voip','unlimited','fibra ottica','telefonia']),
  ('COMM_CARTE', ARRAY['canone pos','pci program']),
  ('CONS_TEC', ARRAY['prestazioni professionali','piano di sicurezza','direzione dei lavori','d.lgs 81','81/2008','81/08','formazione']),
  ('CONS_LEG', ARRAY['visura camerale','repertorio','onorario']),
  ('CONS_CONT', ARRAY['prospetto di bilancio','dichiarazione dei redditi']),
  ('MEZZI_E_CARBURANTE', ARRAY['noleggio veicol','furgone','autonoleggio']),
  ('ONERI_DIV', ARRAY['diritti connessi','musica d','tariffa corrispettiva','tefa']),
  ('SPEDIZ', ARRAY['spedizion','trasporto merci'])
)
UPDATE public.cost_categories c
   SET matching_keywords = (SELECT array_agg(DISTINCT k ORDER BY k) FROM unnest(coalesce(c.matching_keywords, ARRAY[]::text[]) || n.kw) k)
  FROM nuove n
 WHERE c.code = n.code;

CREATE OR REPLACE FUNCTION public.fn_categoria_dalle_fatture(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_strutt uuid;
  n int := 0;
BEGIN
  SELECT id INTO v_strutt FROM public.cost_categories WHERE company_id = p_company_id AND code = 'ALTRI_STRUTTURA';

  WITH cand AS (
    SELECT s.id
      FROM public.suppliers s
     WHERE s.company_id = p_company_id
       AND (s.default_cost_category_id IS NULL
            OR (s.default_cost_category_id = v_strutt
                AND coalesce(s.profile_from_invoice_fields, ARRAY[]::text[]) @> ARRAY['categoria_dal_riparto']))
  ),
  f AS (
    SELECT DISTINCT ON (e.id) c.id AS sid,
           public.fn_categorize_from_lines(p_company_id, e.xml_content) AS cat
      FROM cand c
      JOIN public.payables p ON p.supplier_id = c.id
      JOIN public.electronic_invoices e ON e.id = p.electronic_invoice_id
     WHERE e.company_id = p_company_id
       AND e.invoice_date >= (now() AT TIME ZONE 'Europe/Rome')::date - 540
       AND coalesce(e.xml_content, '') <> ''
  ),
  tot AS (SELECT sid, count(*) AS tot FROM f GROUP BY sid),
  per AS (
    SELECT sid, cat, count(*) AS n,
           row_number() OVER (PARTITION BY sid ORDER BY count(*) DESC) AS rn,
           lead(count(*)) OVER (PARTITION BY sid ORDER BY count(*) DESC) AS n2
      FROM f WHERE cat IS NOT NULL GROUP BY sid, cat
  ),
  win AS (
    SELECT per.sid, per.cat
      FROM per JOIN tot ON tot.sid = per.sid
     WHERE per.rn = 1 AND per.n * 2 >= tot.tot AND per.n > coalesce(per.n2, 0)
       AND per.cat IS DISTINCT FROM v_strutt
  )
  UPDATE public.suppliers s
     SET default_cost_category_id = w.cat,
         profile_from_invoice_fields = array_append(
           array_remove(array_remove(coalesce(s.profile_from_invoice_fields, ARRAY[]::text[]), 'categoria_dal_riparto'), 'categoria_dalle_fatture'),
           'categoria_dalle_fatture')
    FROM win w
   WHERE s.id = w.sid;
  GET DIAGNOSTICS n = ROW_COUNT;

  RETURN jsonb_build_object('company_id', p_company_id, 'categorie_dalle_fatture', n);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_categoria_dalle_fatture(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_riparto_automatico_tutte()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c uuid;
  out jsonb := '[]'::jsonb;
BEGIN
  FOR c IN SELECT DISTINCT company_id FROM public.suppliers WHERE company_id IS NOT NULL LOOP
    PERFORM public.fn_segna_fatture_non_costo(c);
    out := out || jsonb_build_array(public.fn_categoria_dalle_fatture(c));
    out := out || jsonb_build_array(public.fn_riparto_automatico(c));
    out := out || jsonb_build_array(public.fn_categoria_dal_riparto(c));
  END LOOP;
  RETURN out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_categoria_dal_riparto_segno()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  segno text;
BEGIN
  IF OLD.default_cost_category_id IS NOT NULL
     AND NEW.default_cost_category_id IS DISTINCT FROM OLD.default_cost_category_id THEN
    FOREACH segno IN ARRAY ARRAY['categoria_dal_riparto', 'categoria_dalle_fatture'] LOOP
      IF coalesce(OLD.profile_from_invoice_fields, ARRAY[]::text[]) @> ARRAY[segno] THEN
        NEW.profile_from_invoice_fields := array_remove(NEW.profile_from_invoice_fields, segno);
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;
