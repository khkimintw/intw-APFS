-- Fresh-project snapshot for intw-APFS. The connected project's migrations were applied separately.
create extension if not exists pgcrypto;
create type public.app_role as enum ('host','admin','user');
create type public.consultation_kind as enum ('diagnosis','consulting');
create schema if not exists private;

create table public.companies (
 id uuid primary key default gen_random_uuid(),
 source_sheet text not null default '1. 경영체 리스트 풀&특이사항(진행중)', source_row_number integer,
 program_year integer, presentation_date text, theme text, reapplicant text, intake_date text,
 business_name text not null, representative_name text, representative_phone text, representative_email text,
 business_registration_number text, founded_year text, address text, business_summary text, revenue_2024 text,
 diagnosis_consultant text, assigned_consultant_id uuid, status text not null default '배정 대기',
 ir_direct boolean not null default false, cooperation_level text, report_status text, notes text,
 source_payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(source_sheet,source_row_number)
);
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade, email text, display_name text not null default '',
 role public.app_role not null default 'user', user_kind text not null default 'client' check(user_kind in ('consultant','client')),
 company_id uuid references public.companies(id) on delete set null,
 approved boolean not null default false, active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.companies add constraint companies_assigned_consultant_id_fkey foreign key(assigned_consultant_id) references public.profiles(id) on delete set null;
create unique index profiles_single_host_idx on public.profiles(role) where role='host';
create index profiles_company_id_idx on public.profiles(company_id);
create index companies_assignment_idx on public.companies(assigned_consultant_id);

create table public.consultation_sessions (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 kind public.consultation_kind not null, round_number smallint not null check(round_number between 1 and 4),
 scheduled_on date, remote boolean not null default false, report_status text not null default '미제출', report_note text,
 updated_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(company_id,kind,round_number)
);
create index consultation_company_idx on public.consultation_sessions(company_id);
create index sessions_updated_by_idx on public.consultation_sessions(updated_by);
create table public.audit_events (
 id bigint generated always as identity primary key, actor_id uuid references public.profiles(id) on delete set null,
 entity_type text not null, entity_id text not null, action text not null, summary text not null default '', created_at timestamptz not null default now()
);
create index audit_actor_id_idx on public.audit_events(actor_id);

create function private.current_app_role() returns public.app_role language sql stable security definer set search_path=public
as $body$ select role from public.profiles where id=auth.uid() and active=true and approved=true $body$;
create function private.is_company_assigned(target_company uuid) returns boolean language sql stable security definer set search_path=public
as $body$ select private.current_app_role()='user' and exists(select 1 from public.profiles p join public.companies c on c.assigned_consultant_id=p.id where p.id=auth.uid() and p.active and p.approved and p.user_kind='consultant' and c.id=target_company) $body$;
create function private.bootstrap_profile() returns trigger language plpgsql security definer set search_path=public
as $body$ begin
 insert into public.profiles(id,email,display_name,role,user_kind,approved,active)
 values(new.id,new.email,coalesce(new.raw_user_meta_data->>'name',split_part(new.email,'@',1)),case when lower(new.email)='khkim.intw@gmail.com' then 'host'::public.app_role else 'user'::public.app_role end,'client',lower(new.email)='khkim.intw@gmail.com',true)
 on conflict(id) do nothing; return new; end $body$;
create function private.record_updated_at() returns trigger language plpgsql set search_path=public
as $body$ begin new.updated_at=now(); return new; end $body$;
revoke all on function private.bootstrap_profile() from public,anon,authenticated;
revoke all on function private.record_updated_at() from public,anon,authenticated;
revoke all on function private.current_app_role() from public,anon;
revoke all on function private.is_company_assigned(uuid) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.current_app_role() to authenticated;
grant execute on function private.is_company_assigned(uuid) to authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure private.bootstrap_profile();
create trigger companies_updated_at before update on public.companies for each row execute procedure private.record_updated_at();
create trigger profiles_updated_at before update on public.profiles for each row execute procedure private.record_updated_at();
create trigger sessions_updated_at before update on public.consultation_sessions for each row execute procedure private.record_updated_at();

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.consultation_sessions enable row level security;
alter table public.audit_events enable row level security;
create policy profiles_read_self_host_admin on public.profiles for select to authenticated using(id=(select auth.uid()) or private.current_app_role() in('host','admin'));
create policy profiles_host_update on public.profiles for update to authenticated using(private.current_app_role()='host') with check(private.current_app_role()='host' and (id<>(select auth.uid()) or (role='host' and active=true and approved=true)));
create policy profiles_admin_update on public.profiles for update to authenticated using(private.current_app_role()='admin' and role<>'host') with check(private.current_app_role()='admin' and role<>'host');
create policy companies_read_scope on public.companies for select to authenticated using(private.current_app_role() in('host','admin') or (private.current_app_role()='user' and assigned_consultant_id=(select auth.uid())) or (private.current_app_role()='user' and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=companies.id)));
create policy companies_host_admin_insert on public.companies for insert to authenticated with check(private.current_app_role() in('host','admin'));
create policy companies_host_admin_update on public.companies for update to authenticated using(private.current_app_role() in('host','admin')) with check(private.current_app_role() in('host','admin'));
create policy companies_host_admin_delete on public.companies for delete to authenticated using(private.current_app_role() in('host','admin'));
create policy sessions_read_scope on public.consultation_sessions for select to authenticated using(private.current_app_role() in('host','admin') or private.is_company_assigned(company_id) or (private.current_app_role()='user' and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=consultation_sessions.company_id)));
create policy sessions_scoped_insert on public.consultation_sessions for insert to authenticated with check(private.current_app_role() in('host','admin') or private.is_company_assigned(company_id));
create policy sessions_scoped_update on public.consultation_sessions for update to authenticated using(private.current_app_role() in('host','admin') or private.is_company_assigned(company_id)) with check(private.current_app_role() in('host','admin') or private.is_company_assigned(company_id));
create policy sessions_host_admin_delete on public.consultation_sessions for delete to authenticated using(private.current_app_role() in('host','admin'));
create policy audit_host_admin_read on public.audit_events for select to authenticated using(private.current_app_role() in('host','admin'));
create policy audit_self_insert on public.audit_events for insert to authenticated with check(actor_id=(select auth.uid()));
