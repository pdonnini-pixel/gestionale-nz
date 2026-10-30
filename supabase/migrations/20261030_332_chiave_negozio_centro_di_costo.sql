-- =====================================================================
-- 332 — Chiave negozio ↔ centro di costo allineata (tutti e 3 i tenant)
-- =====================================================================
-- PROBLEMA
--   La chiave che lega un negozio alla catena contabile deve essere UNA sola,
--   uguale in quattro posti: outlets.cost_center_key, cost_centers.code,
--   budget_entries.cost_center, chart_of_accounts.outlet_link.
--   La convenzione è lo slug del nome del negozio (src/lib/costCenterKey.ts:
--   «ROMA SORATTE» → «roma_soratte»).
--   I tenant nati dal wizard (Made, Zago) non la rispettano:
--     * onboard_tenant crea il centro di costo con il CODICE del negozio in
--       minuscolo («zago-fi»);
--     * la 062 ha scritto outlets.cost_center_key = lower(name)
--       («zago firenze», con lo spazio).
--   Le due chiavi non combaciano: il negozio resta fuori da Budget,
--   Confronto outlet, Personale, Incassi (obiettivo) e Cashflow (canone).
--   Su Made il centro di costo del negozio non esiste proprio.
--
-- COSA FA (formula, nessun valore di un tenant scritto qui)
--   PART A — helper public.slug_cost_center(text): stessa regola del frontend.
--   PART B — backup dei valori attuali in cost_center_key_fix_bkp_20261030.
--   PART C — per ogni negozio la cui chiave NON coincide con un centro di
--            costo esistente:
--              1. cerca il suo centro di costo (stesso nome o stesso codice
--                 negozio); se c'è e il suo codice non è usato da nessun dato,
--                 lo rinomina allo slug del nome;
--              2. se non c'è, lo crea (codice = slug del nome, ruolo outlet);
--              3. scrive outlets.cost_center_key = codice del centro di costo.
--            Un codice già usato da budget, bilanci, ricorrenze, fatture,
--            fornitori o conti NON viene toccato: quel negozio si salta e lo
--            dice il NOTICE. Negozi già allineati (tutto NZ) non si toccano.
--   PART D — onboard_tenant: i tenant nuovi nascono già allineati
--            (cost_center_key e codice del centro di costo = slug del nome,
--            sede con ruolo 'hq').
--
-- NON distruttiva: solo UPDATE/INSERT su righe di anagrafica, con backup.
-- Rollback: 20261030_332_chiave_negozio_centro_di_costo_ROLLBACK.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- PART A — slug del nome, identico a slugCostCenter() del frontend
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.slug_cost_center(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT btrim(
           regexp_replace(
             translate(lower(coalesce(p_name, '')),
                       'àáâãäåèéêëìíîïòóôõöùúûüçñ',
                       'aaaaaaeeeeiiiiooooouuuucn'),
             '[^a-z0-9]+', '_', 'g'),
           '_')
$$;

-- ---------------------------------------------------------------------
-- PART B — backup (additivo)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cost_center_key_fix_bkp_20261030 (
  backed_up_at  timestamptz NOT NULL DEFAULT now(),
  source_table  text        NOT NULL,
  row_id        uuid        NOT NULL,
  company_id    uuid,
  old_value     text,
  new_value     text
);
ALTER TABLE public.cost_center_key_fix_bkp_20261030 ENABLE ROW LEVEL SECURITY;
-- nessuna policy: leggibile solo da service_role / SQL editor

-- ---------------------------------------------------------------------
-- PART C — allineamento
-- ---------------------------------------------------------------------
DO $$
DECLARE
  o          record;
  v_slug     text;
  v_cc_id    uuid;
  v_cc_code  text;
  v_final    text;
  v_sort     int;
BEGIN
  FOR o IN
    SELECT ou.id, ou.company_id, ou.name, ou.code, ou.cost_center_key
      FROM public.outlets ou
     WHERE NOT EXISTS (
             SELECT 1 FROM public.cost_centers c
              WHERE c.company_id = ou.company_id
                AND c.code = ou.cost_center_key)
     ORDER BY ou.name
  LOOP
    v_slug := public.slug_cost_center(o.name);
    IF v_slug = '' THEN
      RAISE NOTICE '332: negozio % senza nome utile, saltato', o.id;
      CONTINUE;
    END IF;

    -- la vecchia chiave del negozio non deve essere già usata da dati
    IF o.cost_center_key IS NOT NULL AND (
         EXISTS (SELECT 1 FROM public.budget_entries     WHERE company_id = o.company_id AND cost_center = o.cost_center_key)
      OR EXISTS (SELECT 1 FROM public.budget_confronto   WHERE company_id = o.company_id AND cost_center = o.cost_center_key)
      OR EXISTS (SELECT 1 FROM public.chart_of_accounts  WHERE company_id = o.company_id AND outlet_link = o.cost_center_key)
    ) THEN
      RAISE NOTICE '332: negozio % ha la chiave «%» già usata da dati, saltato', o.name, o.cost_center_key;
      CONTINUE;
    END IF;

    -- 1. centro di costo esistente del negozio
    SELECT c.id, c.code INTO v_cc_id, v_cc_code
      FROM public.cost_centers c
     WHERE c.company_id = o.company_id
       AND (lower(btrim(c.label)) = lower(btrim(o.name))
            OR c.code = lower(btrim(o.code))
            OR c.code = v_slug)
     ORDER BY (c.code = v_slug) DESC, (lower(btrim(c.label)) = lower(btrim(o.name))) DESC
     LIMIT 1;

    IF v_cc_id IS NOT NULL THEN
      v_final := v_cc_code;
      IF v_cc_code <> v_slug
         AND NOT EXISTS (SELECT 1 FROM public.cost_centers WHERE company_id = o.company_id AND code = v_slug)
         AND NOT EXISTS (SELECT 1 FROM public.budget_entries     WHERE company_id = o.company_id AND cost_center = v_cc_code)
         AND NOT EXISTS (SELECT 1 FROM public.budget_confronto   WHERE company_id = o.company_id AND cost_center = v_cc_code)
         AND NOT EXISTS (SELECT 1 FROM public.balance_sheet_data WHERE company_id = o.company_id AND cost_center = v_cc_code)
         AND NOT EXISTS (SELECT 1 FROM public.recurring_costs    WHERE company_id = o.company_id AND cost_center = v_cc_code)
         AND NOT EXISTS (SELECT 1 FROM public.invoices           WHERE company_id = o.company_id AND cost_center = v_cc_code)
         AND NOT EXISTS (SELECT 1 FROM public.suppliers          WHERE company_id = o.company_id AND cost_center = v_cc_code)
         AND NOT EXISTS (SELECT 1 FROM public.chart_of_accounts  WHERE company_id = o.company_id AND outlet_link = v_cc_code)
      THEN
        INSERT INTO public.cost_center_key_fix_bkp_20261030 (source_table, row_id, company_id, old_value, new_value)
        VALUES ('cost_centers.code', v_cc_id, o.company_id, v_cc_code, v_slug);
        UPDATE public.cost_centers SET code = v_slug WHERE id = v_cc_id;
        v_final := v_slug;
      END IF;
    ELSE
      -- 2. centro di costo mancante: si crea
      IF EXISTS (SELECT 1 FROM public.cost_centers WHERE company_id = o.company_id AND code = v_slug) THEN
        RAISE NOTICE '332: codice «%» già preso da un altro centro di costo, negozio % saltato', v_slug, o.name;
        CONTINUE;
      END IF;
      SELECT coalesce(max(sort_order), 0) + 1 INTO v_sort FROM public.cost_centers WHERE company_id = o.company_id;
      INSERT INTO public.cost_centers (company_id, code, label, role, sort_order, is_active)
      VALUES (o.company_id, v_slug, o.name, 'outlet', v_sort, true)
      RETURNING id INTO v_cc_id;
      INSERT INTO public.cost_center_key_fix_bkp_20261030 (source_table, row_id, company_id, old_value, new_value)
      VALUES ('cost_centers.created', v_cc_id, o.company_id, NULL, v_slug);
      v_final := v_slug;
    END IF;

    -- 3. chiave del negozio = codice del centro di costo
    INSERT INTO public.cost_center_key_fix_bkp_20261030 (source_table, row_id, company_id, old_value, new_value)
    VALUES ('outlets.cost_center_key', o.id, o.company_id, o.cost_center_key, v_final);
    UPDATE public.outlets SET cost_center_key = v_final WHERE id = o.id;

    RAISE NOTICE '332: negozio % → chiave «%» (era «%»)', o.name, v_final, o.cost_center_key;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------
-- PART D — onboard_tenant: tenant nuovi già allineati.
-- Identica alla versione in produzione (012, uguale sui 3 tenant) salvo:
--   * outlets: cost_center_key = slug del nome
--   * cost_centers: codice = slug del nome, sede con role 'hq'
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.onboard_tenant(p_company jsonb, p_outlets jsonb, p_chart_template text DEFAULT 'nz'::text, p_suppliers jsonb DEFAULT '[]'::jsonb, p_point_of_sale_label text DEFAULT 'Punto vendita'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
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

  -- 7. INSERT outlets — la chiave contabile è lo slug del nome (332)
  v_idx := 0;
  FOR v_outlet IN SELECT * FROM jsonb_array_elements(p_outlets)
  LOOP
    v_idx := v_idx + 1;
    IF coalesce(trim(v_outlet->>'name'), '') = '' OR coalesce(trim(v_outlet->>'code'), '') = '' THEN
      RAISE EXCEPTION 'onboard_tenant: outlet #% mancante di name o code', v_idx
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.outlets (
      company_id, name, code, cost_center_key, address, city, province, cap, phone, email, is_active
    )
    VALUES (
      v_company_id,
      trim(v_outlet->>'name'),
      upper(trim(v_outlet->>'code')),
      public.slug_cost_center(trim(v_outlet->>'name')),
      NULLIF(trim(coalesce(v_outlet->>'address', '')), ''),
      NULLIF(trim(coalesce(v_outlet->>'city', '')), ''),
      NULLIF(upper(trim(coalesce(v_outlet->>'province', ''))), ''),
      NULLIF(trim(coalesce(v_outlet->>'cap', '')), ''),
      NULLIF(trim(coalesce(v_outlet->>'phone', '')), ''),
      NULLIF(trim(coalesce(v_outlet->>'email', '')), ''),
      true
    );
  END LOOP;

  -- 8. cost_centers — sede + uno per outlet, codice = cost_center_key (332)
  INSERT INTO public.cost_centers (company_id, code, label, role, sort_order)
  VALUES (v_company_id, 'sede', 'Sede / Magazzino', 'hq', 1);

  WITH numbered AS (
    SELECT
      v_company_id                                   AS company_id,
      public.slug_cost_center(trim(o->>'name'))      AS code,
      trim(o->>'name')                               AS label,
      (ord + 1)::int                                 AS sort_order
    FROM jsonb_array_elements(p_outlets) WITH ORDINALITY AS arr(o, ord)
  )
  INSERT INTO public.cost_centers (company_id, code, label, role, sort_order)
  SELECT company_id, code, label, 'outlet', sort_order FROM numbered;

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
$function$;

COMMIT;

-- ---------------------------------------------------------------------
-- VERIFICA (da lanciare su ogni tenant): ogni negozio deve avere il suo
-- centro di costo, con lo stesso codice della chiave.
-- ---------------------------------------------------------------------
-- SELECT o.name, o.cost_center_key, c.code AS cc_code, c.role
--   FROM public.outlets o
--   LEFT JOIN public.cost_centers c
--          ON c.company_id = o.company_id AND c.code = o.cost_center_key
--  ORDER BY o.name;
-- Atteso: nessuna riga con cc_code NULL.
-- SELECT * FROM public.cost_center_key_fix_bkp_20261030 ORDER BY backed_up_at;
