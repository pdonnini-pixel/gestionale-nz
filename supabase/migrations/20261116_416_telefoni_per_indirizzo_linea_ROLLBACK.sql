-- ROLLBACK 416 — telefoni di nuovo esclusi dal riparto automatico nelle aziende con le parti uguali.
--
-- 1. Disattiva (non cancella) le regole create dal passaggio 1c. Solo quelle del sistema.
UPDATE public.supplier_allocation_rules
   SET is_active = false, updated_at = now()
 WHERE created_by IS NULL
   AND is_active
   AND description LIKE 'Automatica: telefoni, negozio dell''indirizzo della linea%';

-- 2. Toglie il blocco 1c dalla funzione: dal commento «-- 1c. Telefoni» fino al
--    commento «-- 2. Outlet nominato in ogni fattura» escluso.
DO $rb$
DECLARE
  v_def text := pg_get_functiondef('public.fn_riparto_automatico(uuid,boolean)'::regprocedure);
  v_ini int := position(E'    -- 1c. Telefoni' IN v_def);
  v_fin int := position(E'    -- 2. Outlet nominato in ogni fattura' IN v_def);
BEGIN
  IF v_ini = 0 THEN RAISE NOTICE 'rollback 416: niente da togliere'; RETURN; END IF;
  IF v_fin <= v_ini THEN RAISE EXCEPTION 'rollback 416: definizione inattesa, nessuna modifica'; END IF;
  EXECUTE left(v_def, v_ini - 1) || substr(v_def, v_fin);
END
$rb$;
