begin;
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
      and (
        p.role in ('host'::public.app_role, 'admin'::public.app_role)
        or (p.role = 'user'::public.app_role and p.user_kind = 'consultant' and c.assigned_consultant_id = p.id)
      )
  )
);
commit;