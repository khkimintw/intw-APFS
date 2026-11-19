-- Let approved consultants submit a pending company record for their own work list.
-- The user cannot choose another assignee, change review state, or write admin notes.
create or replace function private.guard_consultant_company_submission()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  if private.current_app_role() = 'user'::public.app_role then
    if not exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'user'::public.app_role
        and p.user_kind = 'consultant'
        and p.approved = true
        and p.active = true
    ) then
      raise exception 'Consultant access required' using errcode = '42501';
    end if;

    new.assigned_consultant_id := (select auth.uid());
    new.status := '등록 검토';
    new.ir_direct := false;
    new.ir_confirmed := false;
    new.ir_confirmed_at := null;
    new.ir_scheduled_at := null;
    new.cooperation_level := null;
    new.report_status := '미제출';
    new.reapplicant := null;
    new.representative_name := null;
    new.representative_phone := null;
    new.representative_email := null;
    new.address := null;
    new.diagnosis_consultant := null;
    new.revenue_2024 := null;
    new.notes := null;
    new.source_sheet := '사용자 등록';
    new.source_row_number := null;
    new.source_payload := '{}'::jsonb;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_consultant_company_submission() from public, anon, authenticated;
drop trigger if exists companies_guard_consultant_submission on public.companies;
create trigger companies_guard_consultant_submission
before insert on public.companies
for each row execute function private.guard_consultant_company_submission();

create policy companies_consultant_submit_pending
on public.companies
for insert to authenticated
with check (
  (select private.current_app_role()) = 'user'::public.app_role
  and assigned_consultant_id = (select auth.uid())
  and status = '등록 검토'
  and ir_direct = false
  and ir_confirmed = false
  and ir_confirmed_at is null
  and ir_scheduled_at is null
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.user_kind = 'consultant'
      and p.approved = true
      and p.active = true
  )
);

create or replace function private.guard_consultant_private_submission()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  if private.current_app_role() = 'user'::public.app_role then
    new.notes := null;
    new.representative_email := null;
    new.representative_name := null;
    new.representative_phone := null;
    new.representative_birth_year := null;
    new.representative_gender := null;
    new.contact_name := null;
    new.contact_phone := null;
    new.contact_email := null;
    new.intween_notes := null;
    new.source_payload := '{}'::jsonb;
    new.address_verification := case when nullif(btrim(new.address), '') is null then '미확인' else '확인 필요' end;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_consultant_private_submission() from public, anon, authenticated;
drop trigger if exists company_admin_private_guard_consultant_submission on public.company_admin_private;
create trigger company_admin_private_guard_consultant_submission
before insert on public.company_admin_private
for each row execute function private.guard_consultant_private_submission();

create policy company_admin_private_consultant_submission_insert
on public.company_admin_private
for insert to authenticated
with check (
  (select private.current_app_role()) = 'user'::public.app_role
  and exists (
    select 1 from public.companies c
    where c.id = company_id
      and c.assigned_consultant_id = (select auth.uid())
      and c.status = '등록 검토'
  )
);

grant insert on public.companies to authenticated;
grant insert on public.company_admin_private to authenticated;
grant insert (company_id, actor_id, batch_id) on public.company_import_events to authenticated;

create policy company_import_events_actor_insert
on public.company_import_events
for insert to authenticated
with check (
  actor_id = (select auth.uid())
  and (
    (select private.current_app_role()) in ('host'::public.app_role, 'admin'::public.app_role)
    or exists (
      select 1 from public.companies c
      where c.id = company_id
        and c.assigned_consultant_id = (select auth.uid())
        and c.status = '등록 검토'
        and (select private.current_app_role()) = 'user'::public.app_role
    )
  )
);
