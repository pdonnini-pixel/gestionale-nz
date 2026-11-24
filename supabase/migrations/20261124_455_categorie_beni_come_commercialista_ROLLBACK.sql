-- ROLLBACK 455 — prima annullare 456 (NZ) e 457 (Zago), che spostano fatture e fornitori sulle BENI_*.
DO $$
DECLARE v_def text := pg_get_functiondef('public.fn_riparto_automatico(uuid, boolean)'::regprocedure);
BEGIN
  IF position('/* 455 */' IN v_def) > 0 THEN
    EXECUTE replace(v_def, 'CASE WHEN cat.code LIKE ''BENI\_%'' THEN ''ALLESTIMENTI'' ELSE cat.code END AS cat_code, /* 455 */', 'cat.code AS cat_code,');
  END IF;
END $$;
DO $$
DECLARE v_def text := pg_get_viewdef('public.v_costi_outlet_da_fatture'::regclass);
BEGIN
  EXECUTE 'CREATE OR REPLACE VIEW public.v_costi_outlet_da_fatture WITH (security_invoker = on) AS '
          || replace(v_def, 'WHEN ((c.code = ''ALLESTIMENTI''::text) OR (c.code ~~ ''BENI\_%''::text)) THEN', 'WHEN (c.code = ''ALLESTIMENTI''::text) THEN');
END $$;
ALTER VIEW public.v_costi_outlet_da_fatture SET (security_invoker = on);
-- le categorie si disattivano, non si cancellano (le fatture potrebbero ancora puntarle)
UPDATE public.cost_categories SET is_active = false WHERE code LIKE 'BENI\_%';
