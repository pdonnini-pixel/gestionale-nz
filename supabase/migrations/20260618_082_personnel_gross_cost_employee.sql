-- 082 — Costo lordo del personale per DIPENDENTE/MESE dal report
-- "Statistica costo orario" (Zucchetti Paghe Infinity).
--
-- Estende la FASE 2 (vedi 068 personnel_gross_cost, per OUTLET/MESE dal
-- "Prospetto riepilogativo"): qui il dettaglio è per singolo dipendente e mese,
-- così la scheda "Costo lordo" diventa drillabile outlet → dipendente.
--
-- Da applicare IDENTICA sui 3 tenant (NZ/Made/Zago). RLS allineata a
-- personnel_gross_cost: SELECT per company; scrittura super_advisor + contabile.
-- Nessun dato hardcoded: matricole/voci/outlet arrivano dal file e dalla mappa
-- employee_outlet_allocations esistente.
--
-- REGOLA CONTABILE: lordo = retribuzione + contribuzione + inail (= colonna
-- "Totale" del report). Il TFR è GIÀ dentro la retribuzione → salvato a parte
-- come informativo, MAI risommato.

-- ---------------------------------------------------------------------------
-- Log degli import (uno per file)
-- ---------------------------------------------------------------------------
create table if not exists personnel_gross_cost_employee_imports (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  file_name      text,
  period_label   text,                    -- es. 'Gen–Mag 2026' (informativo)
  rows_total     integer,                 -- righe dipendente/mese caricate
  employees_total integer,
  file_total     numeric(14,2),           -- somma dei lordi letti (controllo)
  imported_by    uuid,
  imported_at    timestamptz not null default now(),
  note           text
);

-- ---------------------------------------------------------------------------
-- Costo lordo per dipendente/mese — tutti i componenti, niente perdita di dato
-- ---------------------------------------------------------------------------
create table if not exists personnel_gross_cost_employee (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  employee_id   uuid references employees(id) on delete set null,  -- null = matricola non in anagrafica
  matricola     text not null,             -- chiave stabile dal report (7 cifre)
  employee_name text,                       -- "COGNOME NOME" dal report (tracciabilità/fallback)
  outlet_code   text,                       -- nome outlet (= employee_outlet_allocations.outlet_code); null = "Da assegnare"
  is_admin      boolean not null default false,  -- amministratore (voce fuori dagli outlet)
  year          integer not null,
  month         integer not null check (month between 1 and 12),
  retribuzione  numeric(14,2) not null default 0,
  contribuzione numeric(14,2) not null default 0,
  inail         numeric(14,2) not null default 0,
  tfr           numeric(14,2) not null default 0,   -- informativo: GIÀ incluso in retribuzione
  lordo         numeric(14,2) not null default 0,   -- = retribuzione + contribuzione + inail
  source_file   text,
  import_id     uuid references personnel_gross_cost_employee_imports(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, matricola, year, month)        -- upsert idempotente, NO DATA LOSS
);
create index if not exists idx_pgce_company_period on personnel_gross_cost_employee (company_id, year, month);
create index if not exists idx_pgce_outlet on personnel_gross_cost_employee (company_id, outlet_code);
create index if not exists idx_pgce_employee on personnel_gross_cost_employee (employee_id);

-- ---------------------------------------------------------------------------
-- RLS — identica a personnel_gross_cost
-- ---------------------------------------------------------------------------
alter table personnel_gross_cost_employee         enable row level security;
alter table personnel_gross_cost_employee_imports enable row level security;

drop policy if exists pgce_select on personnel_gross_cost_employee;
create policy pgce_select on personnel_gross_cost_employee for select
  using (company_id = get_my_company_id());
drop policy if exists pgce_write on personnel_gross_cost_employee;
create policy pgce_write on personnel_gross_cost_employee for all
  using (company_id = get_my_company_id() and get_my_role() = any (array['super_advisor','contabile']::user_role[]))
  with check (company_id = get_my_company_id() and get_my_role() = any (array['super_advisor','contabile']::user_role[]));

drop policy if exists pgcei_select on personnel_gross_cost_employee_imports;
create policy pgcei_select on personnel_gross_cost_employee_imports for select
  using (company_id = get_my_company_id());
drop policy if exists pgcei_write on personnel_gross_cost_employee_imports;
create policy pgcei_write on personnel_gross_cost_employee_imports for all
  using (company_id = get_my_company_id() and get_my_role() = any (array['super_advisor','contabile']::user_role[]))
  with check (company_id = get_my_company_id() and get_my_role() = any (array['super_advisor','contabile']::user_role[]));
