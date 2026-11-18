-- P1: protect imported contact/source data, expose admin-only notes, and record company creation actor/time.
create table if not exists public.company_admin_private (
  company_id uuid primary key references public.companies(id) on delete cascade,
  notes text,
  representative_email text,
  updated_at timestamptz not null default now()
);

insert into public.company_admin_private (company_id, notes, representative_email)
select
  c.id,
  coalesce(nullif(btrim(c.notes), ''), nullif(btrim(c.source_payload ->> '특이사항'), '')),
  nullif(btrim(c.representative_email), '')
from public.companies c
where nullif(btrim(c.notes), '') is not null
   or nullif(btrim(c.source_payload ->> '특이사항'), '') is not null
   or nullif(btrim(c.representative_email), '') is not null
on conflict (company_id) do update
set notes = coalesce(public.company_admin_private.notes, excluded.notes),
    representative_email = coalesce(public.company_admin_private.representative_email, excluded.representative_email),
    updated_at = now();

alter table public.company_admin_private enable row level security;
revoke all on public.company_admin_private from public, anon, authenticated;
grant select on public.company_admin_private to authenticated;
drop policy if exists company_admin_private_read on public.company_admin_private;
create policy company_admin_private_read on public.company_admin_private
for select to authenticated
using ((select private.current_app_role()) in ('host'::app_role, 'admin'::app_role));

create table if not exists public.company_import_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists company_import_events_created_at_idx
  on public.company_import_events (created_at desc);
create index if not exists company_import_events_company_id_idx
  on public.company_import_events (company_id, created_at desc);
alter table public.company_import_events enable row level security;
revoke all on public.company_import_events from public, anon, authenticated;
grant select on public.company_import_events to authenticated;
drop policy if exists company_import_events_admin_read on public.company_import_events;
create policy company_import_events_admin_read on public.company_import_events
for select to authenticated
using ((select private.current_app_role()) in ('host'::app_role, 'admin'::app_role));

create or replace function private.record_company_creation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  insert into public.company_import_events (company_id, actor_id)
  values (new.id, auth.uid());
  return new;
end;
$$;
revoke all on function private.record_company_creation() from public, anon, authenticated;
drop trigger if exists companies_record_creation on public.companies;
create trigger companies_record_creation
after insert on public.companies
for each row execute function private.record_company_creation();

-- RLS scopes rows; explicit column grants also prevent direct Data API reads of imported PII/raw source.
revoke select on public.companies from authenticated;
grant select (
  id, business_name, theme, program_year, presentation_date, assigned_consultant_id,
  status, cooperation_level, report_status, intake_date, reapplicant, ir_direct,
  business_summary, business_registration_number, founded_year, created_at, updated_at
) on public.companies to authenticated;
