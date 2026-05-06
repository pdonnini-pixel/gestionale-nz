-- ============================================================================
-- 20260506_009_onboard_tenant_rpc.sql
--
-- Chiude i bug A/B/C/E/F del fix bootstrap onboarding multi-tenant
-- introducendo una RPC SECURITY DEFINER atomica che esegue tutto
-- l'onboarding di un tenant vergine in una sola transazione.
--
-- Effetti:
--   1. crea funzione `public.onboard_tenant(jsonb,jsonb,text,jsonb)` che
--      bypassa RLS via SECURITY DEFINER e applica regole di permission
--      esplicite (caller deve avere role super_advisor o budget_approver,
--      tenant deve essere vergine, caller non deve già avere company_id).
--   2. droppa la policy temp `companies_onboarding_insert WITH CHECK true`
--      (TROPPO PERMISSIVA) creata come fix BUG-B su Made/Zago: la RPC
--      bypassa la necessità di una policy INSERT diretta sulla tabella.
--   3. aggiunge la policy `profiles_self_select` su tutti i tenant per
--      permettere ad un utente seed di leggere il proprio profilo prima
--      che `user_profiles.company_id` sia popolato (BUG-A). È additiva e
--      non amplia il blast radius (filtra per `id = auth.uid()`).
--
-- Idempotenza: tutte le operazioni con DROP IF EXISTS / DO block /
-- CREATE OR REPLACE. Sicuro applicare due volte.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Cleanup policy fix-temp (DROP IF EXISTS è idempotente)
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS companies_onboarding_insert ON public.companies;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Policy bootstrap user_profiles (lettura del proprio profilo)
--    Postgres NON supporta CREATE POLICY IF NOT EXISTS prima di v17 stabile;
--    usiamo DO block + DROP/CREATE per idempotenza.
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS profiles_self_select ON public.user_profiles;
CREATE POLICY profiles_self_select ON public.user_profiles
  FOR SELECT
  USING (id = auth.uid());

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Ripristino della policy companies_select alla versione originale di NZ.
--    Su Made/Zago la policy era stata modificata come fix temp BUG-C (aggiunto
--    "OR has_jwt_role('super_advisor') OR has_jwt_role('budget_approver')").
--    Con la RPC `onboard_tenant` SECURITY DEFINER quel rilassamento non serve
--    più (l'INSERT-then-SELECT durante onboarding avviene dentro la RPC e
--    bypassa RLS). Riportiamo la policy strict così che NZ e tenant nuovi
--    siano allineati. Su NZ è no-op (la policy era già strict).
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS companies_select ON public.companies;
CREATE POLICY companies_select ON public.companies
  FOR SELECT
  USING (id = public.get_my_company_id());

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RPC onboard_tenant — atomica, SECURITY DEFINER
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.onboard_tenant(
  p_company       jsonb,
  p_outlets       jsonb,
  p_chart_template text DEFAULT 'nz',
  p_suppliers     jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
-- SET search_path locks the path so SECURITY DEFINER cannot be tricked into
-- resolving objects from a malicious schema set by the caller's session.
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user_id          uuid := auth.uid();
  v_user_role        text;
  v_existing_cid     uuid;
  v_company_id       uuid;
  v_outlet           jsonb;
  v_supplier         jsonb;
  v_idx              int;
BEGIN
  -- 1. Auth check
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'onboard_tenant: utente non autenticato'
      USING ERRCODE = '28000';
  END IF;

  -- 2. Permission check: utente deve esistere in user_profiles e avere
  --    ruolo super_advisor o budget_approver
  SELECT role::text, company_id
    INTO v_user_role, v_existing_cid
    FROM public.user_profiles
    WHERE id = v_user_id;

  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'onboard_tenant: profilo utente non trovato (run create-user prima)'
      USING ERRCODE = '42501';
  END IF;

  IF v_user_role NOT IN ('super_advisor', 'budget_approver') THEN
    RAISE EXCEPTION 'onboard_tenant: ruolo "%" non autorizzato all''onboarding', v_user_role
      USING ERRCODE = '42501';
  END IF;

  -- 3. Idempotency: utente non deve già essere associato a una company
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

  -- 6. INSERT companies
  INSERT INTO public.companies (
    name, vat_number, fiscal_code, legal_address, pec, sdi_code, settings
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
    )
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

  -- 9. cost_categories — template scelto.
  --    Solo macro_group dell'enum cost_macro_group (6 valori validi):
  --    costo_venduto, locazione, personale, generali_amministrative,
  --    finanziarie, oneri_diversi.
  IF p_chart_template = 'nz' THEN
    -- Template ricco coerente con le ~28 categorie operative di NZ.
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
    -- Template minimo: 5 categorie copertura base.
    INSERT INTO public.cost_categories (company_id, code, name, macro_group, sort_order)
    VALUES
      (v_company_id, 'RICAVI',     'Ricavi vendite e prestazioni',  'costo_venduto',          -10),
      (v_company_id, 'COSTO_VEND', 'Costo del venduto',             'costo_venduto',           10),
      (v_company_id, 'LOC',        'Locazione',                     'locazione',               20),
      (v_company_id, 'PERS',       'Personale',                     'personale',               30),
      (v_company_id, 'GAM',        'Spese generali e amministrative','generali_amministrative', 40);
  END IF;

  -- 10. chart_of_accounts — solo se template NZ.
  --     macro_group qui è text, non enum; usiamo le label NZ esistenti.
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

  -- 12. company_settings — riga unica con anagrafica company.
  --     La tabella su NZ ha NOT NULL su company_id e ragione_sociale.
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

  -- 13. user_profiles.company_id ← v_company_id (caller diventa membro
  --     della company appena creata). Updated_at refresh.
  UPDATE public.user_profiles
     SET company_id = v_company_id,
         updated_at = now()
   WHERE id = v_user_id;

  RETURN v_company_id;
END;
$fn$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Permessi: chi può chiamare la RPC
-- ────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.onboard_tenant(jsonb, jsonb, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.onboard_tenant(jsonb, jsonb, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.onboard_tenant(jsonb, jsonb, text, jsonb) IS
  'Atomic onboarding for a virgin tenant. Caller (auth.uid()) must have role super_advisor or budget_approver and not yet be associated with a company. Inserts companies/outlets/cost_centers/cost_categories/chart_of_accounts/suppliers/company_settings in a single transaction and links the caller via user_profiles.company_id. Returns the new company_id.';

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Force PostgREST to reload the schema cache so the new function is
--    immediately invokable from the REST API (no need to wait 60s).
-- ────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
