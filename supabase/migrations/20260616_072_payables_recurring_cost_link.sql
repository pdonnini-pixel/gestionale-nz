-- Link scadenza -> ricorrenza d'origine, per la cancellazione a cascata
-- (eliminando la scadenza ricorrente si elimina anche la recurring_costs, così
-- stime on-the-fly e cashflow non mostrano più ricorrenze fantasma).
-- ON DELETE SET NULL: rimuovere la ricorrenza non cancella lo storico payable.
-- Applicata live su NZ + Made + Zago.
alter table public.payables add column if not exists recurring_cost_id uuid references public.recurring_costs(id) on delete set null;
create index if not exists idx_payables_recurring_cost on public.payables(recurring_cost_id) where recurring_cost_id is not null;
