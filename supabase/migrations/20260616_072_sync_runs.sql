-- 072 — sync_runs: storico osservabilità delle sincronizzazioni dati
--
-- Una riga per RUN, per FEED. Misura l'ultima run RIUSCITA (non l'ultima
-- fattura): un giorno senza documenti nuovi è status='ok' con items=0, NON
-- un errore.
--
-- Feed coperti:
--   banche            → Open Banking A-Cube (acube_ob_sync_all_production)
--   fatture_passive   → SDI inbound A-Cube REST (acube_sdi_sync_inbound_production)
--   corrispettivi     → corrispettivi telematici (canale non ancora attivo)
--   cassetto_fiscale  → Cassetto Fiscale AdE via A-Cube (acube-cf-sync-invoices)
--
-- RLS: lettura company-scoped (get_my_company_id). Nessuna policy di scrittura
-- per gli utenti: gli unici writer sono funzioni SECURITY DEFINER (owner postgres
-- → bypassano RLS) e le edge function via service_role (bypassa RLS). Così la
-- tabella non è scrivibile da `authenticated`/`anon`.

-- ─── ENUM ────────────────────────────────────────────────────────────────
do $$ begin
  create type public.sync_feed as enum ('banche','fatture_passive','corrispettivi','cassetto_fiscale');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.sync_origin as enum ('auto_cron','manuale');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.sync_status as enum ('ok','parziale','errore','vuoto');
exception when duplicate_object then null; end $$;

-- ─── TABELLA ─────────────────────────────────────────────────────────────
create table if not exists public.sync_runs (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  feed             public.sync_feed   not null,
  origine          public.sync_origin not null default 'auto_cron',
  period_from      date,
  period_to        date,
  status           public.sync_status not null,
  items_downloaded integer not null default 0,
  error_message    text,
  duration_ms      integer,
  run_at           timestamptz not null default now()
);

comment on table public.sync_runs is
  'Storico run di sincronizzazione per feed. Una riga per run. items_downloaded=0 con status=ok è valido (giorno senza documenti nuovi).';

create index if not exists idx_sync_runs_company_feed_runat
  on public.sync_runs (company_id, feed, run_at desc);
create index if not exists idx_sync_runs_runat on public.sync_runs (run_at desc);

-- ─── RLS ─────────────────────────────────────────────────────────────────
alter table public.sync_runs enable row level security;

do $$ begin
  create policy sync_runs_select_by_company on public.sync_runs
    for select using (company_id = public.get_my_company_id());
exception when duplicate_object then null; end $$;

-- ─── SEED storico (idempotente) ──────────────────────────────────────────
-- Fatture passive: storico AdE mTLS (sdi_sync_log). Canale deprecato (mTLS
-- morto) ma utile a non lasciare il report vuoto al day-1. Verrà superato
-- dalla prima run REST riuscita (run_at più recente).
insert into public.sync_runs
  (company_id, feed, origine, period_from, period_to, status, items_downloaded, error_message, duration_ms, run_at)
select
  l.company_id,
  'fatture_passive'::public.sync_feed,
  case when l.trigger = 'scheduled' then 'auto_cron' else 'manuale' end::public.sync_origin,
  l.date_from,
  l.date_to,
  case l.status
    when 'success' then 'ok'
    when 'partial' then 'parziale'
    when 'error'   then 'errore'
    else 'parziale'
  end::public.sync_status,
  coalesce(l.fatture_count, 0),
  case when l.errors is not null then left(l.errors::text, 4000) else null end,
  l.duration_ms,
  l.created_at
from public.sdi_sync_log l
where l.company_id is not null
  and not exists (
    select 1 from public.sync_runs sr
    where sr.feed = 'fatture_passive' and sr.run_at = l.created_at
  );

-- Cassetto Fiscale: storico pulls (vuoto finché il canale non è sbloccato).
insert into public.sync_runs
  (company_id, feed, origine, period_from, period_to, status, items_downloaded, error_message, duration_ms, run_at)
select
  p.company_id,
  'cassetto_fiscale'::public.sync_feed,
  case when p.triggered_by_cron then 'auto_cron' else 'manuale' end::public.sync_origin,
  p.date_from,
  p.date_to,
  case
    when p.status = 'completed' and coalesce(p.invoices_inserted,0) = 0 then 'vuoto'
    when p.status = 'completed' then 'ok'
    when p.status = 'failed'    then 'errore'
    when p.status in ('partial','running') then 'parziale'
    else 'parziale'
  end::public.sync_status,
  coalesce(p.invoices_inserted, 0),
  case when p.error_message is not null then left(p.error_message, 4000) else null end,
  p.duration_ms,
  coalesce(p.completed_at, p.started_at, now())
from public.acube_cassetto_fiscale_pulls p
where p.company_id is not null
  and not exists (
    select 1 from public.sync_runs sr
    where sr.feed = 'cassetto_fiscale' and sr.run_at = coalesce(p.completed_at, p.started_at)
  );
