begin;

insert into storage.buckets (id, name, public, file_size_limit)
values ('consultation-reports', 'consultation-reports', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = 20971520;

alter table public.consultation_sessions
  add column if not exists report_file_path text,
  add column if not exists report_file_name text,
  add column if not exists report_file_size bigint,
  add column if not exists report_file_uploaded_at timestamptz,
  add column if not exists report_file_uploaded_by uuid references public.profiles(id) on delete set null;

grant select (report_file_path, report_file_name, report_file_size, report_file_uploaded_at, report_file_uploaded_by)
  on public.consultation_sessions to authenticated;
grant update (report_file_path, report_file_name, report_file_size, report_file_uploaded_at, report_file_uploaded_by)
  on public.consultation_sessions to authenticated;

drop policy if exists apfs_report_files_select on storage.objects;
create policy apfs_report_files_select on storage.objects
for select to authenticated
using (
  bucket_id = 'consultation-reports'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and split_part(name, '/', 2) ~* '^[0-9a-f-]{36}$'
  and exists (
    select 1 from public.consultation_sessions s
    join public.companies c on c.id = s.company_id
    join public.profiles p on p.id = auth.uid()
    where s.id = split_part(name, '/', 2)::uuid
      and c.id = split_part(name, '/', 1)::uuid
      and (
        p.role in ('host'::public.app_role, 'admin'::public.app_role)
        or (p.role = 'user'::public.app_role and p.user_kind = 'consultant' and c.assigned_consultant_id = p.id)
        or (p.role = 'user'::public.app_role and p.user_kind = 'client' and p.company_id = c.id)
      )
  )
);

drop policy if exists apfs_report_files_insert on storage.objects;
create policy apfs_report_files_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'consultation-reports'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and split_part(name, '/', 2) ~* '^[0-9a-f-]{36}$'
  and exists (
    select 1 from public.consultation_sessions s
    join public.companies c on c.id = s.company_id
    join public.profiles p on p.id = auth.uid()
    where s.id = split_part(name, '/', 2)::uuid
      and c.id = split_part(name, '/', 1)::uuid
      and (
        p.role in ('host'::public.app_role, 'admin'::public.app_role)
        or (p.role = 'user'::public.app_role and p.user_kind = 'consultant' and c.assigned_consultant_id = p.id)
      )
  )
);

drop policy if exists apfs_report_files_delete on storage.objects;
create policy apfs_report_files_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'consultation-reports'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and split_part(name, '/', 2) ~* '^[0-9a-f-]{36}$'
  and exists (
    select 1 from public.consultation_sessions s
    join public.companies c on c.id = s.company_id
    join public.profiles p on p.id = auth.uid()
    where s.id = split_part(name, '/', 2)::uuid
      and c.id = split_part(name, '/', 1)::uuid
      and p.role in ('host'::public.app_role, 'admin'::public.app_role)
  )
);

commit;