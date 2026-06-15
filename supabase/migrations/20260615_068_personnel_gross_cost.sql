-- 068 — Costi lordi del personale per OUTLET/MESE dal "Prospetto riepilogativo
-- elaborazione paghe" (Zucchetti Paghe Infinity). FASE 2 pagina Personale.
--
-- Tre tabelle + una vista. Da applicare IDENTICA sui 3 tenant (NZ/Made/Zago).
-- RLS allineata a employee_costs: SELECT per company; scrittura super_advisor + contabile.
-- Nessun dato hardcoded: outlet/PAT/tassi arrivano dal file o li inserisce Lilian.

-- ---------------------------------------------------------------------------
-- Log degli import (uno per file/mese)
-- ---------------------------------------------------------------------------
create table if not exists personnel_gross_cost_imports (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  year          integer,
  month         integer,
  file_name     text,
  outlets_total integer,
  file_total    numeric(14,2),           -- somma dei "Totale retribuzioni" letti
  imported_by   uuid,
  imported_at   timestamptz not null default now(),
  note          text
);

-- ---------------------------------------------------------------------------
-- Costo lordo per outlet/mese — tutti i componenti, niente perdita di dato
-- ---------------------------------------------------------------------------
create table if not exists personnel_gross_cost (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references companies(id) on delete cascade,
  outlet_id                uuid references outlets(id) on delete set null, -- null = "Non attribuito"
  outlet_label             text,                 -- nome filiale grezzo (tooltip/export, tracciabilità)
  filiale_code             text not null,        -- codice filiale a 10 cifre (chiave stabile)
  year                     integer not null,
  month                    integer not null check (month between 1 and 12),
  numero_dipendenti        integer,
  retribuzioni_lorde       numeric(14,2),        -- "1 Retribuzioni Lorde" (dettaglio)
  totale_retribuzioni      numeric(14,2),        -- base del costo
  compensi_amm             numeric(14,2) not null default 0,  -- "2 Compensi Collaboratori/Ammin." → amministratori
  contr_inps               numeric(14,2) not null default 0,  -- I.N.P.S. ordinaria Contr.Azienda
  contr_ebinter            numeric(14,2) not null default 0,
  contr_est                numeric(14,2) not null default 0,
  contr_gestione_separata  numeric(14,2) not null default 0,  -- I.N.P.S. Gestione separata → amministratori
  tfr_fondo                numeric(14,2) not null default 0,  -- T.F.R. trasf. <fondo> Contr.Azienda
  inail_pat                jsonb not null default '[]'::jsonb,-- [{code,label,imponibile}]
  source_file              text,
  import_id                uuid references personnel_gross_cost_imports(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (company_id, filiale_code, year, month)
);
create index if not exists idx_pgc_company_period on personnel_gross_cost (company_id, year, month);
create index if not exists idx_pgc_outlet on personnel_gross_cost (outlet_id);

-- ---------------------------------------------------------------------------
-- Tassi INAIL per PAT — li compila Lilian (nessun default hardcoded).
-- Finché rate_percent è NULL la PAT contribuisce 0 all'INAIL e la UI lo segnala.
-- ---------------------------------------------------------------------------
create table if not exists inail_rates (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  pat_label    text not null,                    -- nome PAT come nel prospetto (identità stabile)
  outlet_id    uuid references outlets(id) on delete set null, -- outlet di competenza (dove compare la PAT)
  rate_percent numeric(7,4),                      -- es. 1.2345 (%). NULL = da inserire
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, pat_label)
);

-- ---------------------------------------------------------------------------
-- Vista: costo lordo calcolato (INAIL = Σ imponibile_PAT × tasso_PAT / 100),
-- amministratori in voce separata. security_invoker → applica la RLS per-tenant.
-- ---------------------------------------------------------------------------
create or replace view v_personnel_gross_cost
with (security_invoker = true) as
select
  g.*,
  (g.contr_inps + g.contr_ebinter + g.contr_est)              as contr_azienda,
  coalesce(i.inail_calcolato, 0)                              as inail_calcolato,
  coalesce(i.inail_incompleto, false)                         as inail_incompleto,
  ( coalesce(g.totale_retribuzioni,0) - g.compensi_amm
    + g.contr_inps + g.contr_ebinter + g.contr_est
    + coalesce(i.inail_calcolato,0) + g.tfr_fondo )           as costo_lordo_outlet,
  (g.compensi_amm + g.contr_gestione_separata)                as amministratori_totale
from personnel_gross_cost g
left join lateral (
  select
    sum( (p->>'imponibile')::numeric * coalesce(r.rate_percent,0) / 100.0 ) as inail_calcolato,
    bool_or( (p->>'imponibile')::numeric > 0 and r.rate_percent is null )    as inail_incompleto
  from jsonb_array_elements(g.inail_pat) as p
  left join inail_rates r
    on r.company_id = g.company_id and r.pat_label = (p->>'label')
) i on true;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table personnel_gross_cost          enable row level security;
alter table personnel_gross_cost_imports  enable row level security;
alter table inail_rates                   enable row level security;

drop policy if exists pgc_select on personnel_gross_cost;
create policy pgc_select on personnel_gross_cost for select
  using (company_id = get_my_company_id());
drop policy if exists pgc_write on personnel_gross_cost;
create policy pgc_write on personnel_gross_cost for all
  using (company_id = get_my_company_id() and get_my_role() = any (array['super_advisor','contabile']::user_role[]))
  with check (company_id = get_my_company_id() and get_my_role() = any (array['super_advisor','contabile']::user_role[]));

drop policy if exists pgci_select on personnel_gross_cost_imports;
create policy pgci_select on personnel_gross_cost_imports for select
  using (company_id = get_my_company_id());
drop policy if exists pgci_write on personnel_gross_cost_imports;
create policy pgci_write on personnel_gross_cost_imports for all
  using (company_id = get_my_company_id() and get_my_role() = any (array['super_advisor','contabile']::user_role[]))
  with check (company_id = get_my_company_id() and get_my_role() = any (array['super_advisor','contabile']::user_role[]));

drop policy if exists inail_rates_select on inail_rates;
create policy inail_rates_select on inail_rates for select
  using (company_id = get_my_company_id());
drop policy if exists inail_rates_write on inail_rates;
create policy inail_rates_write on inail_rates for all
  using (company_id = get_my_company_id() and get_my_role() = any (array['super_advisor','contabile']::user_role[]))
  with check (company_id = get_my_company_id() and get_my_role() = any (array['super_advisor','contabile']::user_role[]));
