begin;
grant insert, update on public.company_admin_private to authenticated;
drop policy if exists company_admin_private_admin_insert on public.company_admin_private;
create policy company_admin_private_admin_insert on public.company_admin_private for insert to authenticated
with check ((select private.current_app_role()) in ('host'::public.app_role,'admin'::public.app_role));
drop policy if exists company_admin_private_admin_update on public.company_admin_private;
create policy company_admin_private_admin_update on public.company_admin_private for update to authenticated
using ((select private.current_app_role()) in ('host'::public.app_role,'admin'::public.app_role))
with check ((select private.current_app_role()) in ('host'::public.app_role,'admin'::public.app_role));
commit;
