begin;
alter table public.company_admin_private add column if not exists source_payload jsonb not null default '{}'::jsonb;
update public.company_admin_private p set source_payload=c.source_payload from public.companies c where c.id=p.company_id;
alter table public.companies add column if not exists ir_scheduled_at timestamptz;
grant select (ir_scheduled_at) on public.companies to authenticated;
grant update (ir_scheduled_at) on public.companies to authenticated;
create or replace function private.sync_company_sheet_payload()
returns trigger language plpgsql security definer set search_path=pg_catalog,public
as $$
begin
  insert into public.company_admin_private(company_id,source_payload)
  values(new.id,coalesce(new.source_payload,'{}'::jsonb))
  on conflict(company_id) do update set source_payload=excluded.source_payload,updated_at=now();
  return new;
end;
$$;
revoke all on function private.sync_company_sheet_payload() from public,anon,authenticated;
drop trigger if exists companies_sync_sheet_payload on public.companies;
create trigger companies_sync_sheet_payload after insert or update of source_payload on public.companies
for each row execute function private.sync_company_sheet_payload();
commit;
