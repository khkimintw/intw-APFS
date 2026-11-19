-- P1: auditable imports, safe undo, fuller company context, and trusted internal Google admins.
begin;

alter table public.company_admin_private
  add column if not exists representative_name text,
  add column if not exists representative_phone text,
  add column if not exists representative_birth_year text,
  add column if not exists representative_gender text,
  add column if not exists contact_name text,
  add column if not exists contact_phone text,
  add column if not exists contact_email text,
  add column if not exists address text,
  add column if not exists address_verification text not null default '미확인',
  add column if not exists intween_notes text;

update public.company_admin_private p
set representative_name = coalesce(p.representative_name, c.representative_name, nullif(btrim(c.source_payload->>'대표 이름'),'')),
    representative_phone = coalesce(p.representative_phone, c.representative_phone, nullif(btrim(c.source_payload->>'대표 핸드폰'),'')),
    representative_birth_year = coalesce(p.representative_birth_year, nullif(btrim(c.source_payload->>'생년'),'')),
    representative_gender = coalesce(p.representative_gender, nullif(btrim(c.source_payload->>'성별'),'')),
    contact_name = coalesce(p.contact_name, nullif(btrim(c.source_payload->>'담당자 이름'),'')),
    contact_phone = coalesce(p.contact_phone, nullif(btrim(c.source_payload->>'담당자 핸드폰'),'')),
    contact_email = coalesce(p.contact_email, nullif(btrim(c.source_payload->>'담당자 e메일'),'')),
    address = coalesce(p.address, c.address, nullif(btrim(c.source_payload->>'주소'),'')),
    intween_notes = coalesce(p.intween_notes, nullif(btrim(c.source_payload->>'인트윈 확인사항'),''))
from public.companies c where c.id = p.company_id;

insert into public.company_admin_private(company_id, notes, representative_email, representative_name, representative_phone, representative_birth_year, representative_gender, contact_name, contact_phone, contact_email, address, intween_notes)
select c.id, nullif(btrim(c.source_payload->>'특이사항'),''), nullif(btrim(c.source_payload->>'대표 e메일'),''),
       nullif(btrim(c.source_payload->>'대표 이름'),''), nullif(btrim(c.source_payload->>'대표 핸드폰'),''),
       nullif(btrim(c.source_payload->>'생년'),''), nullif(btrim(c.source_payload->>'성별'),''),
       nullif(btrim(c.source_payload->>'담당자 이름'),''), nullif(btrim(c.source_payload->>'담당자 핸드폰'),''),
       nullif(btrim(c.source_payload->>'담당자 e메일'),''), nullif(btrim(c.source_payload->>'주소'),''),
       nullif(btrim(c.source_payload->>'인트윈 확인사항'),'')
from public.companies c
where not exists (select 1 from public.company_admin_private p where p.company_id=c.id)
  and (c.source_payload ?| array['특이사항','대표 e메일','대표 이름','대표 핸드폰','생년','성별','담당자 이름','담당자 핸드폰','담당자 e메일','주소','인트윈 확인사항']);

alter table public.companies add column if not exists ir_confirmed boolean not null default false;
alter table public.companies add column if not exists ir_confirmed_at timestamptz;
alter table public.consultation_sessions add column if not exists scheduled_time time;
alter table public.consultation_sessions add column if not exists appointment_confirmed boolean not null default false;
alter table public.consultation_sessions add column if not exists departure_base text;
alter table public.consultation_sessions add column if not exists confirmed_by uuid references public.profiles(id) on delete set null;
alter table public.consultation_sessions add column if not exists confirmed_at timestamptz;
grant select (ir_confirmed, ir_confirmed_at) on public.companies to authenticated;
grant update (ir_confirmed, ir_confirmed_at) on public.companies to authenticated;
grant select (scheduled_time, appointment_confirmed, departure_base, confirmed_by, confirmed_at) on public.consultation_sessions to authenticated;
grant update (scheduled_time, appointment_confirmed, departure_base, confirmed_by, confirmed_at) on public.consultation_sessions to authenticated;

create table if not exists public.company_import_batches (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  source_filename text not null default '',
  received_count integer not null default 0 check(received_count >= 0),
  inserted_count integer not null default 0 check(inserted_count >= 0),
  duplicate_count integer not null default 0 check(duplicate_count >= 0),
  invalid_count integer not null default 0 check(invalid_count >= 0),
  created_at timestamptz not null default now(),
  undone_at timestamptz
);
alter table public.company_import_events add column if not exists batch_id uuid references public.company_import_batches(id) on delete set null;
create index if not exists company_import_events_batch_idx on public.company_import_events(batch_id,created_at desc);
create index if not exists company_import_batches_created_idx on public.company_import_batches(created_at desc);
alter table public.company_import_batches enable row level security;
revoke all on public.company_import_batches from public, anon, authenticated;
grant select on public.company_import_batches to authenticated;
drop policy if exists company_import_batches_admin_read on public.company_import_batches;
create policy company_import_batches_admin_read on public.company_import_batches for select to authenticated
using ((select private.current_app_role()) in ('host'::public.app_role,'admin'::public.app_role));

create or replace function private.record_company_creation()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
declare v_batch text;
begin
  v_batch := nullif(current_setting('app.company_import_batch_id', true), '');
  insert into public.company_import_events (company_id, actor_id, batch_id)
  values (new.id, auth.uid(), case when v_batch is null then null else v_batch::uuid end);
  return new;
end;
$$;
revoke all on function private.record_company_creation() from public, anon, authenticated;

create or replace function public.import_company_batch(p_rows jsonb, p_filename text default '')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private, auth
as $$
declare
  v_batch uuid := gen_random_uuid(); v_row jsonb; v_name text; v_number text;
  v_inserted integer := 0; v_duplicates integer := 0; v_invalid integer := 0;
begin
  if private.current_app_role() not in ('host'::public.app_role,'admin'::public.app_role) then
    raise exception using errcode='42501', message='admin_required';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 100 then
    raise exception using errcode='22023', message='batch_size_invalid';
  end if;
  insert into public.company_import_batches(id,actor_id,source_filename,received_count)
  values(v_batch,auth.uid(),left(coalesce(p_filename,''),240),jsonb_array_length(p_rows));
  perform set_config('app.company_import_batch_id',v_batch::text,true);
  perform pg_advisory_xact_lock(hashtext('apfs-company-import'));
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_name := nullif(btrim(v_row->>'business_name'),'');
    v_number := regexp_replace(coalesce(v_row->>'business_registration_number',''),'[^0-9]','','g');
    if v_name is null then v_invalid := v_invalid + 1; continue; end if;
    if exists (
      select 1 from public.companies c
      where regexp_replace(lower(coalesce(c.business_name,'')),'[[:space:]\-_.·/:()\[\]]','','g') = regexp_replace(lower(v_name),'[[:space:]\-_.·/:()\[\]]','','g')
         or (length(v_number)=10 and regexp_replace(coalesce(c.business_registration_number,''),'[^0-9]','','g')=v_number)
    ) then v_duplicates := v_duplicates + 1; continue; end if;
    insert into public.companies (
      business_name,business_registration_number,founded_year,theme,program_year,presentation_date,intake_date,status,ir_direct,
      representative_name,representative_phone,representative_email,address,business_summary,revenue_2024,source_payload,reapplicant
    ) values (
      left(v_name,300),nullif(left(coalesce(v_row->>'business_registration_number',''),40),''),nullif(left(coalesce(v_row->>'founded_year',''),10),''),
      nullif(left(coalesce(v_row->>'theme',''),100),''),nullif((nullif(v_row->>'program_year',''))::integer,null),
      nullif(left(coalesce(v_row->>'presentation_date',''),100),''),nullif(left(coalesce(v_row->>'intake_date',''),100),''),
      coalesce(nullif(left(v_row->>'status',100),''),'배정 대기'),coalesce((v_row->>'ir_direct')::boolean,false),
      nullif(left(coalesce(v_row->>'representative_name',''),200),''),nullif(left(coalesce(v_row->>'representative_phone',''),80),''),
      nullif(left(coalesce(v_row->>'representative_email',''),240),''),nullif(left(coalesce(v_row->>'address',''),500),''),
      nullif(left(coalesce(v_row->>'business_summary',''),4000),''),nullif(left(coalesce(v_row->>'revenue_2024',''),100),''),
      coalesce(v_row->'source_payload','{}'::jsonb),nullif(left(coalesce(v_row->>'reapplicant',''),100),'')
    );
    v_inserted := v_inserted + 1;
  end loop;
  update public.company_import_batches set inserted_count=v_inserted,duplicate_count=v_duplicates,invalid_count=v_invalid where id=v_batch;
  return jsonb_build_object('batch_id',v_batch,'received',jsonb_array_length(p_rows),'inserted',v_inserted,'skipped_duplicate',v_duplicates,'invalid',v_invalid);
end;
$$;
revoke all on function public.import_company_batch(jsonb,text) from public, anon;
grant execute on function public.import_company_batch(jsonb,text) to authenticated;

create or replace function public.undo_company_import_batch(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private, auth
as $$
declare v_batch public.company_import_batches%rowtype; v_total integer; v_safe integer; v_sessions integer;
begin
  if private.current_app_role() not in ('host'::public.app_role,'admin'::public.app_role) then
    raise exception using errcode='42501', message='admin_required';
  end if;
  select * into v_batch from public.company_import_batches where id=p_batch_id for update;
  if not found then raise exception using errcode='P0002', message='batch_not_found'; end if;
  if v_batch.undone_at is not null then raise exception using errcode='23514', message='batch_already_undone'; end if;
  select count(*) into v_total from public.company_import_events where batch_id=p_batch_id;
  select count(*) into v_safe from public.company_import_events e join public.companies c on c.id=e.company_id
    where e.batch_id=p_batch_id and c.updated_at=c.created_at;
  select count(*) into v_sessions from public.consultation_sessions s join public.company_import_events e on e.company_id=s.company_id where e.batch_id=p_batch_id;
  if v_total=0 or v_total<>v_safe or v_sessions>0 then
    raise exception using errcode='23514', message='batch_has_changed_or_linked_rows';
  end if;
  delete from public.companies c using public.company_import_events e where e.batch_id=p_batch_id and e.company_id=c.id;
  update public.company_import_batches set undone_at=now() where id=p_batch_id;
  return jsonb_build_object('batch_id',p_batch_id,'deleted',v_total,'undone_at',now());
end;
$$;
revoke all on function public.undo_company_import_batch(uuid) from public, anon;
grant execute on function public.undo_company_import_batch(uuid) to authenticated;

create or replace function private.bootstrap_profile()
returns trigger language plpgsql security definer set search_path=public, auth
as $$
declare v_internal_google boolean;
begin
  v_internal_google := lower(split_part(coalesce(new.email,''),'@',2))='intw.co.kr'
    and new.email_confirmed_at is not null
    and (coalesce(new.raw_app_meta_data->>'provider','')='google' or coalesce(new.raw_app_meta_data->'providers','[]'::jsonb) ? 'google');
  insert into public.profiles(id,email,display_name,role,user_kind,approved,active)
  values(new.id,new.email,coalesce(new.raw_user_meta_data->>'name',split_part(coalesce(new.email,''),'@',1)),
    case when lower(coalesce(new.email,''))='khkim.intw@gmail.com' then 'host'::public.app_role when v_internal_google then 'admin'::public.app_role else 'user'::public.app_role end,
    'client',lower(coalesce(new.email,''))='khkim.intw@gmail.com' or v_internal_google,true)
  on conflict(id) do nothing;
  return new;
end;
$$;
revoke all on function private.bootstrap_profile() from public,anon,authenticated;

update public.profiles p set role='admin',approved=true,active=true,updated_at=now()
from auth.users u
where u.id=p.id and lower(split_part(coalesce(u.email,''),'@',2))='intw.co.kr'
  and u.email_confirmed_at is not null
  and (coalesce(u.raw_app_meta_data->>'provider','')='google' or coalesce(u.raw_app_meta_data->'providers','[]'::jsonb) ? 'google')
  and p.role='user';

commit;
