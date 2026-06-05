-- Ripresa saldo (saldo apertura) per fornitore/anno.
-- opening_balance in SEGNO CONTABILE: negativo = debito verso fornitore, positivo = credito nostro.
-- Applicata via MCP su NZ/Made/Zago il 2026-06-05; file di repo per provisioning/parità.
create table if not exists public.supplier_opening_balances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  fiscal_year integer not null,
  opening_balance numeric not null default 0,
  as_of_date date,
  note text,
  source text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (company_id, supplier_id, fiscal_year)
);
create index if not exists idx_sob_supplier on public.supplier_opening_balances(company_id, supplier_id, fiscal_year);
alter table public.supplier_opening_balances enable row level security;
drop policy if exists sob_all_authenticated on public.supplier_opening_balances;
create policy sob_all_authenticated on public.supplier_opening_balances for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.supplier_opening_balances to authenticated;
