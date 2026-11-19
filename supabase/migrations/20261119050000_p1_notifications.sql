-- In-app notifications. Users can read and mark-read only their own rows.
-- A private trigger creates them only after a confirmed sent email log row.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('email_sent','email_received')),
  title text not null check (char_length(title) <= 120),
  body text not null default '' check (char_length(body) <= 240),
  company_id uuid references public.companies(id) on delete set null,
  email_message_id uuid references public.company_email_messages(id) on delete cascade,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index if not exists notifications_user_created_idx on public.notifications(user_id, created_at desc);
create index if not exists notifications_user_unread_idx on public.notifications(user_id) where read_at is null;

alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy notifications_own_read
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

create policy notifications_own_mark_read
  on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Private trigger: not callable through Supabase's exposed RPC surface. Notifications
-- are created only when a message row transitions to confirmed sent status.
create or replace function private.notify_company_email_sent_on_status()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, private
as $fn$
declare
  company_name text;
  recipient_id uuid;
begin
  if old.status = new.status or new.status <> 'sent' then
    return new;
  end if;
  if auth.uid() is null or new.actor_id is distinct from auth.uid()
     or (select private.current_app_role()) not in ('host'::public.app_role, 'admin'::public.app_role) then
    return new;
  end if;
  select business_name into company_name from public.companies where id = new.company_id;
  insert into public.notifications(user_id, kind, title, body, company_id, email_message_id, dedupe_key)
  values (new.actor_id, 'email_sent', '메일 발송 접수',
          left(coalesce(company_name, '경영체') || ' · ' || new.send_number || '회차 메일 발송이 접수되었습니다.', 240),
          new.company_id, new.id, 'company-email:' || new.id || ':sender')
  on conflict (user_id, dedupe_key) do nothing;
  select p.id into recipient_id from public.profiles p
   where p.active and p.approved and p.email is not null
     and lower(btrim(p.email)) = lower(btrim(new.recipient))
   order by p.created_at limit 1;
  if recipient_id is not null and recipient_id <> new.actor_id then
    insert into public.notifications(user_id, kind, title, body, company_id, email_message_id, dedupe_key)
    values (recipient_id, 'email_received', '새 메일이 발송되었습니다',
            '농금원 업무 플랫폼에서 메일을 보냈습니다. 메일함을 확인해 주세요.',
            null, new.id, 'company-email:' || new.id || ':recipient')
    on conflict (user_id, dedupe_key) do nothing;
  end if;
  return new;
end
$fn$;
revoke all on function private.notify_company_email_sent_on_status() from public, anon, authenticated;
drop trigger if exists company_email_sent_notifications on public.company_email_messages;
create trigger company_email_sent_notifications
after update of status on public.company_email_messages
for each row execute function private.notify_company_email_sent_on_status();
