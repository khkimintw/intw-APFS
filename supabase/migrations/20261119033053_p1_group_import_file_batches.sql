begin;
drop function if exists public.import_company_batch(jsonb,text);
create function public.import_company_batch(
  p_rows jsonb,
  p_filename text default '',
  p_batch_id uuid default null,
  p_received_count integer default null,
  p_duplicate_count integer default null,
  p_invalid_count integer default null
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,auth
as $$
declare
  v_batch uuid := coalesce(p_batch_id,gen_random_uuid()); v_row jsonb; v_name text; v_number text;
  v_inserted integer := 0; v_duplicates integer := 0; v_invalid integer := 0;
begin
  if private.current_app_role() not in ('host'::public.app_role,'admin'::public.app_role) then
    raise exception using errcode='42501', message='admin_required';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 100 then
    raise exception using errcode='22023', message='batch_size_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtext('apfs-company-import'),hashtext(v_batch::text));
  insert into public.company_import_batches(id,actor_id,source_filename,received_count,duplicate_count,invalid_count)
  values(v_batch,auth.uid(),left(coalesce(p_filename,''),240),coalesce(p_received_count,jsonb_array_length(p_rows)),coalesce(p_duplicate_count,0),coalesce(p_invalid_count,0))
  on conflict(id) do update set
    received_count=greatest(public.company_import_batches.received_count,coalesce(excluded.received_count,0)),
    duplicate_count=greatest(public.company_import_batches.duplicate_count,coalesce(excluded.duplicate_count,0)),
    invalid_count=greatest(public.company_import_batches.invalid_count,coalesce(excluded.invalid_count,0));
  perform set_config('app.company_import_batch_id',v_batch::text,true);
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
  update public.company_import_batches set
    inserted_count=inserted_count+v_inserted,
    duplicate_count=greatest(duplicate_count,coalesce(p_duplicate_count,0))+v_duplicates,
    invalid_count=greatest(invalid_count,coalesce(p_invalid_count,0))+v_invalid
    where id=v_batch;
  return jsonb_build_object('batch_id',v_batch,'received',jsonb_array_length(p_rows),'inserted',v_inserted,'skipped_duplicate',v_duplicates,'invalid',v_invalid);
end;
$$;
revoke all on function public.import_company_batch(jsonb,text,uuid,integer,integer,integer) from public,anon;
grant execute on function public.import_company_batch(jsonb,text,uuid,integer,integer,integer) to authenticated;
commit;
