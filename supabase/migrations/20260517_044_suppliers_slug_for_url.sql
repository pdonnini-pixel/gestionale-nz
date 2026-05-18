-- Migrazione 044: suppliers.slug per URL leggibili
-- Aggiunge colonna slug univoca per company_id, popolata da name/ragione_sociale.
-- Gestisce duplicati appendendo -2, -3, ecc.
-- URL prima: /fornitori/87245707-288f-4ede-952a-b8e30829c746/scheda-contabile
-- URL dopo: /fornitori/fornitore-sandbox-srl/scheda-contabile

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS slug TEXT;

CREATE OR REPLACE FUNCTION public._suppliers_slugify(input TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(
    regexp_replace(
      regexp_replace(
        trim(coalesce(input, '')),
        '[àáâãäå]', 'a', 'g'
      ),
      '[^a-zA-Z0-9]+', '-', 'g'
    )
  );
$$;

WITH base AS (
  SELECT id, company_id,
    public._suppliers_slugify(coalesce(name, ragione_sociale, 'fornitore-' || substring(id::text from 1 for 8))) AS base_slug
  FROM public.suppliers
  WHERE slug IS NULL OR slug = ''
),
numbered AS (
  SELECT id, company_id, base_slug,
    ROW_NUMBER() OVER (PARTITION BY company_id, base_slug ORDER BY id) AS rn
  FROM base
)
UPDATE public.suppliers s
SET slug = CASE WHEN n.rn = 1 THEN n.base_slug ELSE n.base_slug || '-' || n.rn END
FROM numbered n WHERE s.id = n.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_slug_per_company
  ON public.suppliers(company_id, slug) WHERE slug IS NOT NULL;

CREATE OR REPLACE FUNCTION public.suppliers_autoslug()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_base TEXT; v_slug TEXT; v_counter INT := 0;
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    v_base := public._suppliers_slugify(coalesce(NEW.name, NEW.ragione_sociale, 'fornitore-' || substring(NEW.id::text from 1 for 8)));
    v_slug := v_base;
    WHILE EXISTS (SELECT 1 FROM public.suppliers WHERE company_id = NEW.company_id AND slug = v_slug AND id <> NEW.id) LOOP
      v_counter := v_counter + 1;
      v_slug := v_base || '-' || (v_counter + 1);
    END LOOP;
    NEW.slug := v_slug;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_suppliers_autoslug ON public.suppliers;
CREATE TRIGGER trg_suppliers_autoslug
BEFORE INSERT OR UPDATE OF name, ragione_sociale ON public.suppliers
FOR EACH ROW EXECUTE FUNCTION public.suppliers_autoslug();

NOTIFY pgrst, 'reload schema';
