-- Rollback 296: toglie solo le categorie messe dal sistema (segno
-- 'categoria_dal_riparto'), ripristina il giro notturno senza il passo.
UPDATE public.suppliers
   SET default_cost_category_id = NULL,
       profile_from_invoice_fields = array_remove(profile_from_invoice_fields, 'categoria_dal_riparto')
 WHERE profile_from_invoice_fields @> ARRAY['categoria_dal_riparto']
   AND default_cost_category_id IN (SELECT id FROM public.cost_categories WHERE code IN ('ACQ_MERCE', 'ALTRI_STRUTTURA'));

CREATE OR REPLACE FUNCTION public.fn_riparto_automatico_tutte()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c uuid;
  out jsonb := '[]'::jsonb;
BEGIN
  FOR c IN SELECT DISTINCT company_id FROM public.suppliers WHERE company_id IS NOT NULL LOOP
    PERFORM public.fn_segna_fatture_non_costo(c);
    out := out || jsonb_build_array(public.fn_riparto_automatico(c));
  END LOOP;
  RETURN out;
END;
$function$;

DROP FUNCTION IF EXISTS public.fn_categoria_dal_riparto(uuid);
-- La categoria ALTRI_STRUTTURA resta (nessun fornitore la usa più): si può disattivare con is_active = false.
