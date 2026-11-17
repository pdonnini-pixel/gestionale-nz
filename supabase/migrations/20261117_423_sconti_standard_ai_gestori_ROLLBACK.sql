-- Rollback 423: sconti standard di nuovo solo per il Super Advisor (come nella 422).

CREATE OR REPLACE FUNCTION public.divise_impostazioni_salva(p_divise numeric, p_acquisti numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := public.divise_solo_super_advisor();
  v_prima record;
BEGIN
  IF p_divise IS NULL OR p_acquisti IS NULL OR p_divise < 0 OR p_divise > 100 OR p_acquisti < 0 OR p_acquisti > 100 THEN
    RAISE EXCEPTION 'Lo sconto va da 0 a 100.' USING ERRCODE = '22023';
  END IF;
  SELECT i.sconto_divise_pct, i.sconto_acquisti_pct INTO v_prima FROM public.divise_impostazioni i WHERE i.company_id = v_company;
  INSERT INTO public.divise_impostazioni (company_id, sconto_divise_pct, sconto_acquisti_pct, updated_at, updated_by)
  VALUES (v_company, round(p_divise, 2), round(p_acquisti, 2), now(), (SELECT auth.uid()))
  ON CONFLICT (company_id) DO UPDATE SET sconto_divise_pct = EXCLUDED.sconto_divise_pct,
     sconto_acquisti_pct = EXCLUDED.sconto_acquisti_pct, updated_at = now(), updated_by = (SELECT auth.uid());
  PERFORM public.divise_scrivi_registro(v_company, NULL, NULL, 'sconti_standard',
    jsonb_build_object('divise_prima', v_prima.sconto_divise_pct, 'acquisti_prima', v_prima.sconto_acquisti_pct,
                       'divise', round(p_divise, 2), 'acquisti', round(p_acquisti, 2)));
END $$;
REVOKE ALL ON FUNCTION public.divise_impostazioni_salva(numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.divise_impostazioni_salva(numeric, numeric) TO authenticated, service_role;
