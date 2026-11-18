insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'agri-report-templates',
  'agri-report-templates',
  false,
  10485760,
  array['application/x-hwp', 'application/haansofthwp', 'application/octet-stream']
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists apfs_report_templates_read on storage.objects;
create policy apfs_report_templates_read
on storage.objects for select to authenticated
using (
  bucket_id = 'agri-report-templates'
  and (select private.current_app_role()) is not null
);

drop policy if exists apfs_report_templates_insert on storage.objects;
create policy apfs_report_templates_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'agri-report-templates'
  and (select private.current_app_role()) in ('host'::public.app_role, 'admin'::public.app_role)
);

drop policy if exists apfs_report_templates_update on storage.objects;
create policy apfs_report_templates_update
on storage.objects for update to authenticated
using (
  bucket_id = 'agri-report-templates'
  and (select private.current_app_role()) in ('host'::public.app_role, 'admin'::public.app_role)
)
with check (
  bucket_id = 'agri-report-templates'
  and (select private.current_app_role()) in ('host'::public.app_role, 'admin'::public.app_role)
);

drop policy if exists apfs_report_templates_delete on storage.objects;
create policy apfs_report_templates_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'agri-report-templates'
  and (select private.current_app_role()) in ('host'::public.app_role, 'admin'::public.app_role)
);