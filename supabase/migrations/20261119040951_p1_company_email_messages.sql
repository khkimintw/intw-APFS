create table if not exists public.company_email_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  recipient text not null,
  subject text not null,
  body text not null,
  send_number integer not null check (send_number > 0),
  is_resend boolean not null default false,
  in_reply_to uuid references public.company_email_messages(id) on delete set null,
  provider_email_id text,
  provider_message_id text,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists company_email_messages_company_created_idx
  on public.company_email_messages(company_id, created_at desc);

alter table public.company_email_messages enable row level security;
revoke all on public.company_email_messages from public, anon, authenticated;
grant select, insert, update on public.company_email_messages to authenticated;

create policy company_email_messages_admin_read
  on public.company_email_messages for select to authenticated
  using ((select private.current_app_role()) in ('host'::public.app_role, 'admin'::public.app_role));

create policy company_email_messages_admin_insert
  on public.company_email_messages for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and (select private.current_app_role()) in ('host'::public.app_role, 'admin'::public.app_role)
  );

create policy company_email_messages_admin_update
  on public.company_email_messages for update to authenticated
  using (
    actor_id = (select auth.uid())
    and (select private.current_app_role()) in ('host'::public.app_role, 'admin'::public.app_role)
  )
  with check (
    actor_id = (select auth.uid())
    and (select private.current_app_role()) in ('host'::public.app_role, 'admin'::public.app_role)
  );
