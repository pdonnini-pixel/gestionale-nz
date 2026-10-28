ALTER POLICY employee_availability_write ON public.employee_availability
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_scrivere()))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_scrivere()));
-- Le colonne fasce, valido_dal, valido_al restano (rimuoverle perderebbe gli accordi inseriti).
