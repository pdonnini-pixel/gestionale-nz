-- Migrazione 298 — il segno «categoria dal riparto» sparisce quando la categoria cambia (12/10/2026)
--
-- La 296 marca con 'categoria_dal_riparto' i fornitori a cui il sistema ha dato
-- la categoria. Se poi una persona sceglie un'altra categoria, il segno non è più
-- vero: questo trigger lo toglie. Il sistema riempie solo categorie vuote (OLD
-- NULL), quindi non lo tocca. Vale su ogni tenant.
-- Rollback: DROP TRIGGER trg_categoria_dal_riparto_segno ON public.suppliers;
--           DROP FUNCTION public.fn_categoria_dal_riparto_segno();

CREATE OR REPLACE FUNCTION public.fn_categoria_dal_riparto_segno()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.default_cost_category_id IS NOT NULL
     AND NEW.default_cost_category_id IS DISTINCT FROM OLD.default_cost_category_id
     AND coalesce(NEW.profile_from_invoice_fields, ARRAY[]::text[]) @> ARRAY['categoria_dal_riparto'] THEN
    NEW.profile_from_invoice_fields := array_remove(NEW.profile_from_invoice_fields, 'categoria_dal_riparto');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_categoria_dal_riparto_segno ON public.suppliers;
CREATE TRIGGER trg_categoria_dal_riparto_segno
  BEFORE UPDATE OF default_cost_category_id ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.fn_categoria_dal_riparto_segno();
