-- REVIEW DRAFT ONLY. Not applied. Existing 235 companies / 156 sessions are not rewritten.
-- Requires a transaction, metadata backup and verified Auth account before approval.
begin;

-- Stop trusting an unverified sign-up email as a host privilege claim.
-- Existing host profiles are preserved. First verified host is a separate console action.
create or replace function private.bootstrap_profile() returns trigger
language plpgsql security definer set search_path=public
as $body$ begin
 insert into public.profiles(id,email,display_name,role,user_kind,approved,active)
 values(new.id,new.email,coalesce(new.raw_user_meta_data->>'name',''),'user','client',false,true)
 on conflict(id) do nothing;
 return new;
end $body$;
revoke all on function private.bootstrap_profile() from public,anon,authenticated;

-- Permit a host to designate an additional host. Existing rows are not changed.
-- Guard below prevents API clients from assigning host without being an approved host.
drop index if exists public.profiles_single_host_idx;
create or replace function private.guard_profile_change() returns trigger
language plpgsql security definer set search_path=public
as $body$
declare actor_role public.app_role;
begin
 -- SQL-console maintenance is an explicit privileged action, outside application roles.
 if auth.uid() is null then
  if current_user in ('postgres','supabase_admin') then return new; end if;
  raise insufficient_privilege using message='Authenticated profile administrator required';
 end if;
 actor_role := private.current_app_role();
 if actor_role is null or actor_role not in ('host','admin') then
  raise insufficient_privilege using message='Profile administrator required';
 end if;
 if actor_role <> 'host' and (old.role='host' or new.role='host') then
  raise insufficient_privilege using message='Only host may change host privileges';
 end if;
 if old.id=auth.uid() and old.role='host' and (new.role<>'host' or not new.active or not new.approved) then
  raise check_violation using message='Host cannot revoke own access';
 end if;
 if new.id<>old.id then raise check_violation using message='Profile identity cannot change'; end if;
 return new;
end $body$;
revoke all on function private.guard_profile_change() from public,anon,authenticated;
create trigger profiles_guard_api_change before update on public.profiles
for each row execute function private.guard_profile_change();

-- Defend role boundaries even for direct Data API requests.
drop policy if exists profiles_host_update on public.profiles;
create policy profiles_host_update on public.profiles for update to authenticated
 using(private.current_app_role()='host')
 with check(private.current_app_role()='host' and (id<>auth.uid() or (role='host' and active and approved)));
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
 using(private.current_app_role()='admin' and role<>'host')
 with check(private.current_app_role()='admin' and role<>'host');
drop policy if exists companies_read_scope on public.companies;
create policy companies_read_scope on public.companies for select to authenticated
 using(private.current_app_role() in ('host','admin') or exists(
  select 1 from public.profiles p where p.id=auth.uid() and p.role='user' and p.active and p.approved
  and ((p.user_kind='consultant' and companies.assigned_consultant_id=p.id)
    or (p.user_kind='client' and p.company_id=companies.id))));
drop policy if exists sessions_read_scope on public.consultation_sessions;
create policy sessions_read_scope on public.consultation_sessions for select to authenticated
 using(private.current_app_role() in ('host','admin') or private.is_company_assigned(company_id)
 or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='user' and p.active and p.approved and p.user_kind='client' and p.company_id=consultation_sessions.company_id));

-- Keep the legacy columns/data, but remove their Data API column privileges for every app role.
-- RLS filters rows, not columns. A UI-only projection cannot protect notes or source_payload.
revoke all on public.companies from anon,authenticated;
grant select(id,business_name,theme,program_year,presentation_date,assigned_consultant_id,status,cooperation_level,report_status,intake_date,reapplicant,ir_direct,business_summary,created_at,updated_at) on public.companies to authenticated;
grant insert(business_name,theme,program_year,presentation_date,assigned_consultant_id,status,cooperation_level,report_status,intake_date,reapplicant,ir_direct,business_summary) on public.companies to authenticated;
grant update(business_name,theme,program_year,presentation_date,assigned_consultant_id,status,cooperation_level,report_status,intake_date,reapplicant,ir_direct,business_summary) on public.companies to authenticated;
grant delete on public.companies to authenticated;
revoke all on public.profiles from anon,authenticated;
grant select(id,display_name,role,user_kind,company_id,approved,active,created_at,updated_at) on public.profiles to authenticated;
grant update(display_name,role,user_kind,company_id,approved,active) on public.profiles to authenticated;
revoke all on public.consultation_sessions from anon,authenticated;
grant select(id,company_id,kind,round_number,scheduled_on,remote,report_status,report_note,updated_by,created_at,updated_at) on public.consultation_sessions to authenticated;
grant insert(company_id,kind,round_number,scheduled_on,remote,report_status,report_note,updated_by) on public.consultation_sessions to authenticated;
grant update(kind,round_number,scheduled_on,remote,report_status,report_note,updated_by) on public.consultation_sessions to authenticated;
grant delete on public.consultation_sessions to authenticated;
revoke all on public.audit_events from anon,authenticated;
grant select(id,actor_id,entity_type,entity_id,action,created_at) on public.audit_events to authenticated;

-- Assignment targets must be an approved, active consultant; raw REST cannot bypass this.
create or replace function private.guard_company_assignment() returns trigger
language plpgsql security definer set search_path=public
as $body$ begin
 if new.assigned_consultant_id is not null and (tg_op='INSERT' or new.assigned_consultant_id is distinct from old.assigned_consultant_id) then
  if not exists(select 1 from public.profiles p where p.id=new.assigned_consultant_id and p.role='user' and p.user_kind='consultant' and p.approved and p.active) then
   raise check_violation using message='Assigned account must be an approved active consultant';
  end if;
 end if;
 return new;
end $body$;
revoke all on function private.guard_company_assignment() from public,anon,authenticated;
create trigger companies_guard_assignment before insert or update on public.companies for each row execute function private.guard_company_assignment();

create or replace function private.guard_company_delete() returns trigger
language plpgsql security definer set search_path=public
as $body$ begin
 if exists(select 1 from public.consultation_sessions where company_id=old.id) then
  raise foreign_key_violation using message='Company with sessions cannot be deleted';
 end if;
 return old;
end $body$;
revoke all on function private.guard_company_delete() from public,anon,authenticated;
create trigger companies_guard_delete before delete on public.companies for each row execute function private.guard_company_delete();

-- Existing round-4 sessions are retained. New diagnosis=1 / consulting=1..3 only.
-- Editing an existing record's date/status does not invalidate its historical round.
create or replace function private.guard_session_write() returns trigger
language plpgsql security definer set search_path=public
as $body$ begin
 if tg_op='INSERT' or new.kind<>old.kind or new.round_number<>old.round_number then
  if (new.kind='diagnosis' and new.round_number<>1) or (new.kind='consulting' and new.round_number not between 1 and 3) then
   raise check_violation using message='Diagnosis round 1 / consulting rounds 1 through 3 only';
  end if;
 end if;
 if tg_op='UPDATE' and new.company_id<>old.company_id then
  raise check_violation using message='Session company cannot change';
 end if;
 if new.report_status not in ('미제출','작성 중','검토 중','제출 완료') then
  raise check_violation using message='Invalid report status';
 end if;
 if length(coalesce(new.report_note,''))>4000 then raise check_violation using message='Report note exceeds limit'; end if;
 if auth.uid() is not null then new.updated_by:=auth.uid(); end if;
 return new;
end $body$;
revoke all on function private.guard_session_write() from public,anon,authenticated;
create trigger sessions_guard_write before insert or update on public.consultation_sessions for each row execute function private.guard_session_write();

-- Authoritative audit events originate from DB triggers, never arbitrary client text.
-- No names, contacts, source payloads, report notes or full row JSON are copied.
drop policy if exists audit_self_insert on public.audit_events;
create or replace function private.record_api_audit() returns trigger
language plpgsql security definer set search_path=public
as $body$
declare target_id text;
begin
 target_id := case when tg_op='DELETE' then old.id::text else new.id::text end;
 insert into public.audit_events(actor_id,entity_type,entity_id,action,summary)
 values(auth.uid(),tg_table_name,target_id,lower(tg_op),'');
 if tg_op='DELETE' then return old; end if;
 return new;
end $body$;
revoke all on function private.record_api_audit() from public,anon,authenticated;
create trigger companies_audit after insert or update or delete on public.companies for each row execute function private.record_api_audit();
create trigger sessions_audit after insert or update or delete on public.consultation_sessions for each row execute function private.record_api_audit();
create trigger profiles_audit after update on public.profiles for each row execute function private.record_api_audit();

commit;
