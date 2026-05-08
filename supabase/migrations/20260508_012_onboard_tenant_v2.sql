-- ============================================================================
-- 20260508_012_onboard_tenant_v2.sql
--
-- Aggiorna la RPC `onboard_tenant` (introdotta in 009) con:
--   1. Nuovo parametro `p_point_of_sale_label TEXT DEFAULT 'Punto vendita'`
--      che viene scritto in companies.point_of_sale_label.
--   2. Fix permission check: usa `has_jwt_role()` invece di leggere
--      `user_profiles.role` direttamente. Lilian ha role JWT
--      'budget_approver' ma in user_profiles è registrata come 'contabile'
--      (l'enum user_role non aveva 'budget_approver' fino alla migrazione
--      010, e il provisioning storico usava i ruoli applicativi nel JWT
--      e l'enum DB più ristretto in user_profiles). Allineiamo la check
--      sui ruoli JWT.
--   3. Mantiene safety net: se `user_profiles` row del caller non esiste,
--      eccezione esplicita.
--
-- La firma cambia (4 → 5 parametri). Per evitare conflitti con la firma
-- vecchia, usiamo DROP FUNCTION + CREATE FUNCTION (PostgreSQL non ammette
-- CREATE OR REPLACE quando cambia la signature). DROP è sicuro: nessuna
-- view/policy/trigger dipende dalla funzione (è chiamata solo da supabase.rpc
-- lato frontend).
-- ============================================================================

DROP FUNCTION IF EXISTS public.onboard_tenant(jsonb, jsonb, text, jsonb);

CREATE OR REPLACE FUNCTION public.onboard_tenant(
  p_company              jsonb,
  p_outlets              jsonb,
  p_chart_template       text DEFAULT 'nz',
  p_suppliers            jsonb DEFAULT '[]'::jsonb,
  p_point_of_sale_label  text DEFAULT 'Punto vendita'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user_id    uuid := auth.uid();
  v_user_role  text;
  v_existing_cid uuid;
  v_company_id uuid;
  v_pos_label  text;
  v_outlet     jsonb;
  v_supplier   jsonb;
  v_idx        int;
BEGIN
  -- 1. Auth check
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'onboard_tenant: utente non autenticato'
      USING ERRCODE = '28000';
  END IF;

  -- 2. Permission check: ruolo JWT (super_advisor o budget_approver).
  --    Nota: NON leggiamo più user_profiles.role qui — quello rimane usato
  --    solo come safety net (esistenza del profilo). Il wizard onboarding
  --    è autorizzato dai ruoli JWT, allineato con tutte le RLS write.
  IF NOT (public.has_jwt_role('super_advisor') OR public.has_jwt_role('budget_approver')) THEN
    RAISE EXCEPTION 'onboard_tenant: ruolo JWT non autorizzato all''onboarding (richiesto super_advisor o budget_approver)'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Safety net: il profilo deve esistere e non avere già company_id
  SELECT role::text, company_id
    INTO v_user_role, v_existing_cid
    FROM public.user_profiles
    WHERE id = v_user_id;

  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'onboard_tenant: profilo utente non trovato (run create-user prima)'
      USING ERRCODE = '42501';
  END IF;

  IF v_existing_cid IS NOT NULL THEN
    RAISE EXCEPTION 'onboard_tenant: utente già associato a company % (re-onboarding non consentito)', v_existing_cid
      USING ERRCODE = '23505';
  END IF;

  -- 4. Tenant deve essere vergine (zero company in tabella)
  IF EXISTS (SELECT 1 FROM public.companies LIMIT 1) THEN
    RAISE EXCEPTION 'onboard_tenant: tenant non vergine, esiste già almeno una company'
      USING ERRCODE = '23505';
  END IF;

  -- 5. Validation input minimo
  IF p_company IS NULL OR coalesce(trim(p_company->>'name'), '') = '' THEN
    RAISE EXCEPTION 'onboard_tenant: company.name è obbligatorio'
      USING ERRCODE = '22023';
  END IF;
  IF p_outlets IS NULL OR jsonb_array_length(p_outlets) < 1 THEN
    RAISE EXCEPTION 'onboard_tenant: almeno un outlet è obbligatorio'
      USING ERRCODE = '22023';
  END IF;

  -- Normalizza la label (default se vuota o solo spazi)
  v_pos_label := NULLIF(trim(coalesce(p_point_of_sale_label, '')), '');
  IF v_pos_label IS NULL THEN
    v_pos_label := 'Punto vendita';
  END IF;

  -- 6. INSERT companies (con point_of_sale_label)
  INSERT INTO public.companies (
    name, vat_number, fiscal_code, legal_address, pec, sdi_code, settings, point_of_sale_label
  )
  VALUES (
    trim(p_company->>'name'),
    NULLIF(trim(coalesce(p_company->>'vat_number', '')), ''),
    NULLIF(trim(coalesce(p_company->>'fiscal_code', '')), ''),
    NULLIF(trim(coalesce(p_company->>'legal_address', '')), ''),
    NULLIF(trim(coalesce(p_company->>'pec', '')), ''),
    NULLIF(trim(coalesce(p_company->>'sdi_code', '')), ''),
    jsonb_build_object(
      'currency', 'EUR',
      'fiscal_year_start', '01',
      'onboarding_completed', true,
      'onboarding_date', now(),
      'onboarded_by', v_user_id
    ),
    v_pos_label
  )
  RETURNING id INTO v_company_id;

  -- 7. INSERT outlets
  v_idx := 0;
  FOR v_outlet IN SELECT * FROM jsonb_array_elements(p_outlets)
  LOOP
    v_idx := v_idx + 1;
    IF coalesce(trim(v_outlet->>'name'), '') = '' OR coalesce(trim(v_outlet->>'code'), '') = '' THEN
      RAISE EXCEPTION 'onboard_tenant: outlet #% mancante di name o code', v_idx
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.outlets (
      company_id, name, code, address, city, province, cap, phone, email, is_active
    )
    VALUES (
      v_company_id,
      trim(v_outlet->>'name'),
      upper(trim(v_outlet->>'code')),
      NULLIF(trim(coalesce(v_outlet->>'address', '')), ''),
      NULLIF(trim(coalesce(v_outlet->>'city', '')), ''),
      NULLIF(upper(trim(coalesce(v_outlet->>'province', ''))), ''),
      NULLIF(trim(coalesce(v_outlet->>'cap', '')), ''),
      NULLIF(trim(coalesce(v_outlet->>'phone', '')), ''),
      NULLIF(trim(coalesce(v_outlet->>'email', '')), ''),
      true
    );
  END LOOP;

  -- 8. cost_centers — sede + uno per outlet
  INSERT INTO public.cost_centers (company_id, code, label, sort_order)
  VALUES (v_company_id, 'sede', 'Sede / Magazzino', 1);

  WITH numbered AS (
    SELECT
      v_company_id            AS company_id,
      lower(trim(o->>'code')) AS code,
      trim(o->>'name')        AS label,
      (ord + 1)::int          AS sort_order
    FROM jsonb_array_elements(p_outlets) WITH ORDINALITY AS arr(o, ord)
  )
  INSERT INTO public.cost_centers (company_id, code, label, sort_order)
  SELECT company_id, code, label, sort_order FROM numbered;

  -- 9. cost_categories — template scelto
  IF p_chart_template = 'nz' THEN
    INSERT INTO public.cost_categories (company_id, code, name, macro_group, sort_order)
    VALUES
      (v_company_id, 'RICAVI',     'Ricavi vendite e prestazioni',           'costo_venduto',           -10),
      (v_company_id, 'COSTO_VEND', 'Costo del venduto (netto rimanenze)',    'costo_venduto',           -5),
      (v_company_id, 'ACQ_MERCE',  'Acquisto merce',                          'costo_venduto',           10),
      (v_company_id, 'LOC_OUTLET', 'Locazione outlet',                        'locazione',               20),
      (v_company_id, 'LOC_SEDE',   'Locazione sede e magazzino',              'locazione',               25),
      (v_company_id, 'COND_MKT',   'Spese condominiali e marketing',          'locazione',               30),
      (v_company_id, 'COMP_AMM',   'Compenso amministratore',                 'personale',               40),
      (v_company_id, 'PERS_DIP',   'Personale dipendente',                    'personale',               50),
      (v_company_id, 'TFR',        'TFR',                                     'personale',               55),
      (v_company_id, 'ENERG_GAS',  'Energia elettrica e gas',                 'generali_amministrative', 60),
      (v_company_id, 'TELEFON',    'Linee telefoniche e internet',            'generali_amministrative', 65),
      (v_company_id, 'PULIZIA',    'Pulizia e manutenzione',                  'generali_amministrative', 70),
      (v_company_id, 'PUBBLICITA', 'Pubblicità e marketing',                  'generali_amministrative', 80),
      (v_company_id, 'CONS_CONT',  'Consulenze contabili',                    'generali_amministrative', 90),
      (v_company_id, 'CONS_LAV',   'Consulenze del lavoro',                   'generali_amministrative', 95),
      (v_company_id, 'CANONE_SW',  'Canone software e licenze',               'generali_amministrative', 100),
      (v_company_id, 'COMM_CARTE', 'Commissioni carte e bancarie',            'generali_amministrative', 110),
      (v_company_id, 'CANCELL',    'Cancelleria e spese ufficio',             'generali_amministrative', 120),
      (v_company_id, 'VIAGGI',     'Viaggi e trasferte',                      'generali_amministrative', 130),
      (v_company_id, 'SPEDIZ',     'Spedizioni e logistica',                  'generali_amministrative', 140),
      (v_company_id, 'MANUT',      'Manutenzioni straordinarie',              'generali_amministrative', 150),
      (v_company_id, 'ASSICUR',    'Assicurazioni',                           'generali_amministrative', 160),
      (v_company_id, 'CONS_TEC',   'Consulenze tecniche',                     'generali_amministrative', 170),
      (v_company_id, 'CONS_LEG',   'Consulenze legali',                       'generali_amministrative', 175),
      (v_company_id, 'INT_PASS',   'Interessi passivi e oneri finanziari',    'finanziarie',             200),
      (v_company_id, 'ONERI_DIV',  'Oneri diversi di gestione',               'oneri_diversi',           300);
  ELSE
    INSERT INTO public.cost_categories (company_id, code, name, macro_group, sort_order)
    VALUES
      (v_company_id, 'RICAVI',     'Ricavi vendite e prestazioni',  'costo_venduto',          -10),
      (v_company_id, 'COSTO_VEND', 'Costo del venduto',             'costo_venduto',           10),
      (v_company_id, 'LOC',        'Locazione',                     'locazione',               20),
      (v_company_id, 'PERS',       'Personale',                     'personale',               30),
      (v_company_id, 'GAM',        'Spese generali e amministrative','generali_amministrative', 40);
  END IF;

  -- 10. chart_of_accounts — solo se template NZ
  IF p_chart_template = 'nz' THEN
    INSERT INTO public.chart_of_accounts (company_id, code, name, macro_group, sort_order)
    VALUES
      (v_company_id, 'MRC001', 'Acquisto merci',                          'Costo del venduto',         10),
      (v_company_id, 'MRC002', 'Trasporti e logistica',                   'Costo del venduto',         20),
      (v_company_id, 'LOC001', 'Affitti outlet',                          'Locazione',                 30),
      (v_company_id, 'LOC002', 'Affitto sede/magazzino',                  'Locazione',                 35),
      (v_company_id, 'PER001', 'Stipendi dipendenti',                     'Personale',                 40),
      (v_company_id, 'PER002', 'Oneri sociali',                           'Personale',                 45),
      (v_company_id, 'PER003', 'TFR',                                     'Personale',                 50),
      (v_company_id, 'PER004', 'Emolumenti amministratore',               'Personale',                 55),
      (v_company_id, 'UTS001', 'Energia elettrica',                       'Utenze & Servizi',          60),
      (v_company_id, 'UTS002', 'Telefonia e internet',                    'Utenze & Servizi',          65),
      (v_company_id, 'GAM001', 'Commercialista',                          'Generali & Amministrative', 70),
      (v_company_id, 'GAM002', 'Consulente lavoro',                       'Generali & Amministrative', 75),
      (v_company_id, 'GAM003', 'Assicurazioni',                           'Generali & Amministrative', 80),
      (v_company_id, 'GAM004', 'Software e licenze',                      'Generali & Amministrative', 85),
      (v_company_id, 'MKT001', 'Marketing e pubblicità',                  'Marketing',                 90),
      (v_company_id, 'MAN001', 'Manutenzioni ordinarie',                  'Manutenzione',              100),
      (v_company_id, 'FIN001', 'Interessi finanziamento',                 'Finanziarie',               110),
      (v_company_id, 'FIN002', 'Interessi prestito soci',                 'Finanziarie',               115),
      (v_company_id, 'FIN003', 'Commissioni bancarie',                    'Finanziarie',               120),
      (v_company_id, 'OND001', 'Oneri diversi di gestione',               'Oneri diversi',             200);
  END IF;

  -- 11. suppliers — opzionale
  FOR v_supplier IN SELECT * FROM jsonb_array_elements(p_suppliers)
  LOOP
    IF NULLIF(trim(coalesce(v_supplier->>'name', '')), '') IS NOT NULL THEN
      INSERT INTO public.suppliers (company_id, name, vat_number, ragione_sociale, partita_iva)
      VALUES (
        v_company_id,
        trim(v_supplier->>'name'),
        NULLIF(trim(coalesce(v_supplier->>'vat_number', '')), ''),
        trim(v_supplier->>'name'),
        NULLIF(trim(coalesce(v_supplier->>'vat_number', '')), '')
      );
    END IF;
  END LOOP;

  -- 12. company_settings — riga unica con anagrafica
  INSERT INTO public.company_settings (
    company_id, ragione_sociale, partita_iva, codice_fiscale,
    sede_legale, pec, codice_sdi
  )
  VALUES (
    v_company_id,
    trim(p_company->>'name'),
    NULLIF(trim(coalesce(p_company->>'vat_number', '')), ''),
    NULLIF(trim(coalesce(p_company->>'fiscal_code', '')), ''),
    NULLIF(trim(coalesce(p_company->>'legal_address', '')), ''),
    NULLIF(trim(coalesce(p_company->>'pec', '')), ''),
    NULLIF(trim(coalesce(p_company->>'sdi_code', '')), '')
  );

  -- 13. user_profiles.company_id ← v_company_id
  UPDATE public.user_profiles
     SET company_id = v_company_id,
         updated_at = now()
   WHERE id = v_user_id;

  RETURN v_company_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.onboard_tenant(jsonb, jsonb, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.onboard_tenant(jsonb, jsonb, text, jsonb, text) TO authenticated;

COMMENT ON FUNCTION public.onboard_tenant(jsonb, jsonb, text, jsonb, text) IS
  'Atomic onboarding for a virgin tenant. Caller (auth.uid()) must have JWT role super_advisor or budget_approver and not yet be associated with a company. Inserts companies/outlets/cost_centers/cost_categories/chart_of_accounts/suppliers/company_settings in a single transaction and links the caller via user_profiles.company_id. Stores the tenant point-of-sale label (e.g. Outlet/Negozio/Boutique) in companies.point_of_sale_label. Returns the new company_id.';

-- Force PostgREST schema cache reload so the new function signature is
-- immediately invokable from the REST API.
NOTIFY pgrst, 'reload schema';
