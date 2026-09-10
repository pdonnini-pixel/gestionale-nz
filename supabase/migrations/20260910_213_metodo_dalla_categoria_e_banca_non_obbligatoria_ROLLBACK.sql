-- ROLLBACK 20260910_213 — la banca torna a essere obbligatoria per Ri.Ba./RID/SDD/carte,
-- e la colonna del metodo per categoria viene rimossa.
-- Le segnalazioni «banca mancante» chiuse dalla 213 non vengono riaperte: si riaprono da
-- sole al primo refresh, per i fornitori che ancora non hanno la banca.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_supplier_config_anomaly(p_supplier_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  s public.suppliers%ROWTYPE; v_method text; v_bank_required boolean; v_is_riba boolean;
BEGIN
  SELECT * INTO s FROM public.suppliers WHERE id = p_supplier_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_method := COALESCE(s.default_payment_method::text, s.payment_method, '');
  IF v_method = '' THEN RETURN 'metodo_mancante'; END IF;
  v_is_riba := v_method LIKE 'riba%';
  v_bank_required := v_is_riba OR v_method IN ('rid','sdd_core','sdd_b2b','carta_credito','carta_debito');
  IF v_bank_required AND s.payment_bank_account_id IS NULL THEN RETURN 'banca_mancante'; END IF;
  IF v_is_riba AND (s.payment_base IS NULL OR s.prima_scadenza_gg IS NULL OR s.numero_rate IS NULL) THEN
    RETURN 'piano_incompleto'; END IF;
  RETURN NULL;
END; $function$;

ALTER TABLE public.cost_categories DROP COLUMN IF EXISTS default_payment_method;

COMMIT;
