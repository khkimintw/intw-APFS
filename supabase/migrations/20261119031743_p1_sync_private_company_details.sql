begin;
create or replace function private.sync_company_private_details()
returns trigger language plpgsql security definer set search_path=pg_catalog,public
as $$
declare v jsonb;
begin
  v := coalesce(new.source_payload,'{}'::jsonb);
  insert into public.company_admin_private (
    company_id,notes,representative_email,representative_name,representative_phone,
    representative_birth_year,representative_gender,contact_name,contact_phone,contact_email,address,intween_notes
  ) values (
    new.id,
    coalesce(nullif(btrim(new.notes),''),nullif(btrim(v->>'특이사항'),'')),
    coalesce(nullif(btrim(new.representative_email),''),nullif(btrim(v->>'대표 e메일'),''),nullif(btrim(v->>'대표이메일'),'')),
    coalesce(nullif(btrim(new.representative_name),''),nullif(btrim(v->>'대표 이름'),''),nullif(btrim(v->>'대표자 이름'),''),nullif(btrim(v->>'대표자명'),'')),
    coalesce(nullif(btrim(new.representative_phone),''),nullif(btrim(v->>'대표 핸드폰'),''),nullif(btrim(v->>'대표자 연락처'),'')),
    coalesce(nullif(btrim(v->>'생년'),''),nullif(btrim(v->>'대표 생년'),'')),
    coalesce(nullif(btrim(v->>'성별'),''),nullif(btrim(v->>'대표 성별'),'')),
    coalesce(nullif(btrim(v->>'담당자 이름'),''),nullif(btrim(v->>'담당자명'),'')),
    coalesce(nullif(btrim(v->>'담당자 핸드폰'),''),nullif(btrim(v->>'담당자 연락처'),'')),
    coalesce(nullif(btrim(v->>'담당자 e메일'),''),nullif(btrim(v->>'담당자 이메일'),'')),
    coalesce(nullif(btrim(new.address),''),nullif(btrim(v->>'주소'),'')),
    coalesce(nullif(btrim(v->>'인트윈 확인사항'),''),nullif(btrim(v->>'인트윈 확인 사항'),''))
  ) on conflict (company_id) do update set
    notes=coalesce(excluded.notes,public.company_admin_private.notes),
    representative_email=coalesce(excluded.representative_email,public.company_admin_private.representative_email),
    representative_name=coalesce(excluded.representative_name,public.company_admin_private.representative_name),
    representative_phone=coalesce(excluded.representative_phone,public.company_admin_private.representative_phone),
    representative_birth_year=coalesce(excluded.representative_birth_year,public.company_admin_private.representative_birth_year),
    representative_gender=coalesce(excluded.representative_gender,public.company_admin_private.representative_gender),
    contact_name=coalesce(excluded.contact_name,public.company_admin_private.contact_name),
    contact_phone=coalesce(excluded.contact_phone,public.company_admin_private.contact_phone),
    contact_email=coalesce(excluded.contact_email,public.company_admin_private.contact_email),
    address=coalesce(excluded.address,public.company_admin_private.address),
    intween_notes=coalesce(excluded.intween_notes,public.company_admin_private.intween_notes),
    updated_at=now();
  return new;
end;
$$;
revoke all on function private.sync_company_private_details() from public,anon,authenticated;
drop trigger if exists companies_sync_private_details on public.companies;
create trigger companies_sync_private_details after insert or update on public.companies
for each row execute function private.sync_company_private_details();
commit;
