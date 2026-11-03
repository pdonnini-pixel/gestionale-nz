-- ROLLBACK 337 — riporta organico_imposta_referente alla versione della 319.
-- La tabella dello storico NON si elimina qui: contiene dati veri. Se va tolta,
-- prima un backup e la conferma di Patrizio (regola NO DATA LOSS).
BEGIN;

CREATE OR REPLACE FUNCTION public.organico_imposta_referente(p_outlet_id uuid, p_employee_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := (SELECT public.get_my_company_id());
BEGIN
  IF NOT public.organico_puo_scrivere() THEN
    RAISE EXCEPTION 'La referente la imposta chi tiene l''organico.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM outlets WHERE id = p_outlet_id AND company_id = v_company) THEN
    RAISE EXCEPTION 'Negozio non trovato.';
  END IF;
  IF p_employee_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM employees WHERE id = p_employee_id AND company_id = v_company) THEN
    RAISE EXCEPTION 'Persona non trovata.';
  END IF;
  UPDATE outlets SET referente_employee_id = p_employee_id, updated_at = now()
   WHERE id = p_outlet_id AND company_id = v_company;
END;
$$;

DROP FUNCTION IF EXISTS public.organico_imposta_referente_dal(uuid, uuid, date);

COMMIT;
