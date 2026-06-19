-- 084 — imposte_annuali
-- Imposte sul reddito annuali per company/anno (input Lilian, vista aggregata Budget & Controllo).
-- Un solo valore POSITIVO per (company, anno); il segno meno e la ripartizione
-- (10% Sede fissa + 90% outlet aperti pro-quota ricavi) sono solo lato frontend.
-- RLS coerente con budget_confronto (stesso input di Lilian).

create table if not exists public.imposte_annuali (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  year        int  not null,
  amount      numeric not null default 0,   -- valore positivo inserito; segno e ripartizione solo a display
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (company_id, year)
);

alter table public.imposte_annuali enable row level security;

-- SELECT: la propria company.
drop policy if exists imposte_annuali_select on public.imposte_annuali;
create policy imposte_annuali_select on public.imposte_annuali
  for select
  using (company_id = get_my_company_id());

-- WRITE: super_advisor / contabile della propria company (come budget_confronto_write).
drop policy if exists imposte_annuali_write on public.imposte_annuali;
create policy imposte_annuali_write on public.imposte_annuali
  for all
  using (
    (company_id = get_my_company_id())
    and (get_my_role() = any (array['super_advisor'::user_role, 'contabile'::user_role]))
  )
  with check (
    (company_id = get_my_company_id())
    and (get_my_role() = any (array['super_advisor'::user_role, 'contabile'::user_role]))
  );

-- WRITE: ruolo budget_approver via JWT (come budget_confronto_budget_approver_write).
drop policy if exists imposte_annuali_budget_approver_write on public.imposte_annuali;
create policy imposte_annuali_budget_approver_write on public.imposte_annuali
  for all
  using (
    has_jwt_role('budget_approver'::text)
    and ((jwt_company_id() is null) or (company_id = jwt_company_id()))
  )
  with check (
    has_jwt_role('budget_approver'::text)
    and ((jwt_company_id() is null) or (company_id = jwt_company_id()))
  );

grant select, insert, update, delete on public.imposte_annuali to authenticated;
