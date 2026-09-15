-- 161 — employee_costs diventa il TOTALE del mese, ricalcolato dai cedolini.
-- Regola: se esiste un cedolino 'manuale' vince lui (correzione esplicita di chi
-- lavora), altrimenti il mese è la somma dei cedolini caricati. Se non resta
-- nessun cedolino la riga NON viene cancellata: si azzera il netto e la storia
-- resta (regola no data loss).
CREATE OR REPLACE FUNCTION public.sync_employee_costs_from_slips()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  k_company uuid; k_emp uuid; k_year int; k_month int; n_slips int;
  v_netto numeric; v_retr numeric; v_contr numeric; v_inail numeric;
  v_tfr numeric; v_altri numeric; v_outlet text; v_outlet_src text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    k_company := OLD.company_id; k_emp := OLD.employee_id; k_year := OLD.year; k_month := OLD.month;
  ELSE
    k_company := NEW.company_id; k_emp := NEW.employee_id; k_year := NEW.year; k_month := NEW.month;
  END IF;
  SELECT count(*) INTO n_slips FROM employee_cost_slips s
   WHERE s.company_id=k_company AND s.employee_id=k_emp AND s.year=k_year AND s.month=k_month;
  IF n_slips = 0 THEN
    UPDATE employee_costs c SET netto = NULL
     WHERE c.company_id=k_company AND c.employee_id=k_emp AND c.year=k_year AND c.month=k_month;
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM employee_cost_slips s WHERE s.company_id=k_company AND s.employee_id=k_emp
               AND s.year=k_year AND s.month=k_month AND s.tipo='manuale') THEN
    SELECT s.netto, COALESCE(s.retribuzione,0), COALESCE(s.contributi,0), COALESCE(s.inail,0),
           COALESCE(s.tfr,0), COALESCE(s.altri_costi,0), s.outlet_code, s.outlet_source
      INTO v_netto, v_retr, v_contr, v_inail, v_tfr, v_altri, v_outlet, v_outlet_src
      FROM employee_cost_slips s WHERE s.company_id=k_company AND s.employee_id=k_emp
       AND s.year=k_year AND s.month=k_month AND s.tipo='manuale';
  ELSE
    SELECT CASE WHEN count(*) FILTER (WHERE s.netto IS NOT NULL) > 0
                THEN sum(COALESCE(s.netto,0)) ELSE NULL END,
           sum(COALESCE(s.retribuzione,0)), sum(COALESCE(s.contributi,0)),
           sum(COALESCE(s.inail,0)), sum(COALESCE(s.tfr,0)), sum(COALESCE(s.altri_costi,0)),
           (array_agg(s.outlet_code ORDER BY COALESCE(s.netto,0) DESC) FILTER (WHERE s.outlet_code IS NOT NULL))[1],
           (array_agg(s.outlet_source ORDER BY COALESCE(s.netto,0) DESC) FILTER (WHERE s.outlet_code IS NOT NULL))[1]
      INTO v_netto, v_retr, v_contr, v_inail, v_tfr, v_altri, v_outlet, v_outlet_src
      FROM employee_cost_slips s WHERE s.company_id=k_company AND s.employee_id=k_emp
       AND s.year=k_year AND s.month=k_month;
  END IF;
  INSERT INTO employee_costs (company_id, employee_id, year, month, netto, retribuzione,
                              contributi, inail, tfr, altri_costi, outlet_code, outlet_source)
  VALUES (k_company, k_emp, k_year, k_month, v_netto, v_retr, v_contr, v_inail, v_tfr, v_altri, v_outlet, v_outlet_src)
  ON CONFLICT (employee_id, year, month) DO UPDATE SET
    netto=EXCLUDED.netto, retribuzione=EXCLUDED.retribuzione, contributi=EXCLUDED.contributi,
    inail=EXCLUDED.inail, tfr=EXCLUDED.tfr, altri_costi=EXCLUDED.altri_costi,
    outlet_code=COALESCE(EXCLUDED.outlet_code, employee_costs.outlet_code),
    outlet_source=COALESCE(EXCLUDED.outlet_source, employee_costs.outlet_source);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.sync_employee_costs_from_slips() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS trg_sync_employee_costs_from_slips ON public.employee_cost_slips;
CREATE TRIGGER trg_sync_employee_costs_from_slips
AFTER INSERT OR UPDATE OR DELETE ON public.employee_cost_slips
FOR EACH ROW EXECUTE FUNCTION public.sync_employee_costs_from_slips();
