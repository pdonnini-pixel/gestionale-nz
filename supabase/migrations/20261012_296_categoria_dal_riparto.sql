-- Migrazione 296 — categoria dei fornitori dal riparto (12/10/2026)
--
-- Deciso da Patrizio il 12/10/2026. Nel riquadro «Costi per outlet» di
-- Confronto Outlet 116 fornitori di NZ (233.359 € nel 2026) finivano in
-- «Senza categoria»: il riparto notturno li aveva già divisi sui negozi come
-- merce o come costo di struttura, ma la categoria era vuota e né le righe
-- delle fatture né le scadenze la dicevano.
-- Regola (CLAUDE.md, «niente liste da compilare a mano»): il sistema riempie
-- solo il campo vuoto, con ciò che ha già deciso il riparto, e lo marca.
--   regola automatica «merce ripartita come il preventivo…» → ACQ_MERCE
--   regola automatica «costo di struttura…»                  → ALTRI_STRUTTURA
-- ALTRI_STRUTTURA (macro generali_amministrative) è un valore di ripiego:
-- chi sceglie a mano la categoria vera la sostituisce. Il segno è
-- 'categoria_dal_riparto' in suppliers.profile_from_invoice_fields.
-- Le categorie scelte a mano e le regole manuali non si toccano. Non cambia il
-- metodo di pagamento: le due categorie non hanno un metodo tipico.
-- Ogni notte, dopo il riparto, si ripete per i fornitori nuovi.
-- Vale su ogni tenant (dove manca il piano dei conti non fa niente).

-- 1. Categoria di ripiego per i costi di struttura, dove esiste un piano dei costi
INSERT INTO public.cost_categories (company_id, code, name, macro_group, is_fixed, is_system, sort_order, notes)
SELECT DISTINCT c.company_id, 'ALTRI_STRUTTURA', 'Altri costi di struttura', 'generali_amministrative'::public.cost_macro_group, true, false, 900,
       'Assegnata dal sistema ai fornitori che il riparto tratta come costo di struttura (migrazione 296). Si sostituisce scegliendo la categoria vera.'
FROM public.cost_categories c
ON CONFLICT (company_id, code) DO NOTHING;

-- 2. Funzione: categoria dal riparto, solo dove è vuota
CREATE OR REPLACE FUNCTION public.fn_categoria_dal_riparto(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_merce uuid;
  v_strutt uuid;
  n_merce int := 0;
  n_strutt int := 0;
BEGIN
  SELECT id INTO v_merce  FROM public.cost_categories WHERE company_id = p_company_id AND code = 'ACQ_MERCE';
  SELECT id INTO v_strutt FROM public.cost_categories WHERE company_id = p_company_id AND code = 'ALTRI_STRUTTURA';

  IF v_merce IS NOT NULL THEN
    UPDATE public.suppliers s
       SET default_cost_category_id = v_merce,
           profile_from_invoice_fields = array_append(array_remove(coalesce(s.profile_from_invoice_fields, ARRAY[]::text[]), 'categoria_dal_riparto'), 'categoria_dal_riparto')
     WHERE s.company_id = p_company_id
       AND s.default_cost_category_id IS NULL
       AND EXISTS (SELECT 1 FROM public.supplier_allocation_rules r
                    WHERE r.supplier_id = s.id AND r.is_active AND r.created_by IS NULL
                      AND r.description ILIKE 'Automatica: merce ripartita come il preventivo%');
    GET DIAGNOSTICS n_merce = ROW_COUNT;
  END IF;

  IF v_strutt IS NOT NULL THEN
    UPDATE public.suppliers s
       SET default_cost_category_id = v_strutt,
           profile_from_invoice_fields = array_append(array_remove(coalesce(s.profile_from_invoice_fields, ARRAY[]::text[]), 'categoria_dal_riparto'), 'categoria_dal_riparto')
     WHERE s.company_id = p_company_id
       AND s.default_cost_category_id IS NULL
       AND EXISTS (SELECT 1 FROM public.supplier_allocation_rules r
                    WHERE r.supplier_id = s.id AND r.is_active AND r.created_by IS NULL
                      AND r.description ILIKE 'Automatica: costo di struttura%');
    GET DIAGNOSTICS n_strutt = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('company_id', p_company_id, 'merce', n_merce, 'struttura', n_strutt);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_categoria_dal_riparto(uuid) FROM PUBLIC, anon, authenticated;

-- 3. Nel giro notturno, dopo il riparto
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
    out := out || jsonb_build_array(public.fn_riparto_automatico(c));
    out := out || jsonb_build_array(public.fn_categoria_dal_riparto(c));
  END LOOP;
  RETURN out;
END;
$function$;

-- 4. Subito, per i fornitori di oggi
SELECT public.fn_categoria_dal_riparto(company_id) FROM (SELECT DISTINCT company_id FROM public.suppliers WHERE company_id IS NOT NULL) x;
