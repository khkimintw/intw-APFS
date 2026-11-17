import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// A fresh in-memory PostgreSQL engine. Never connects to Supabase or copies source rows.
const db = new PGlite();
const actor = Object.fromEntries(['host','admin','consultantA','consultantB','client','pending','inactive','target'].map((role,i)=>[role,`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
const companies = ['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002'];
const sessions = ['30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002'];
const legacyCompany='20000000-0000-4000-8000-000000000003';
const legacySession='30000000-0000-4000-8000-000000000003';
async function asActor(name, callback) {
  await db.exec('begin; set local role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor[name]]);
  try { return await callback(); } finally { await db.exec('rollback;'); }
}
const safeCompany='id,business_name,assigned_consultant_id';

before(async()=>{
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $q$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $q$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;
  `);
  let snapshot = await readFile(new URL('../supabase/schema.sql', import.meta.url),'utf8');
  // gen_random_uuid is built in; this embedded engine does not load pgcrypto.
  snapshot=snapshot.replace('create extension if not exists pgcrypto;','');
  await db.exec(snapshot);
  // Sentinel created under the old round policy before the hardening transaction.
  await db.query("insert into companies(id,business_name) values($1,'합성 기존4회 기업')",[legacyCompany]);
  await db.query("insert into consultation_sessions(id,company_id,kind,round_number) values($1,$2,'consulting',4)",[legacySession,legacyCompany]);
  await db.exec(await readFile(new URL('../supabase/drafts/20261117_api_rls_hardening.sql',import.meta.url),'utf8'));
  for(const [name,id] of Object.entries(actor)){
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,'{}'::jsonb)",[id,`${name.toLowerCase()}@synthetic.invalid`]);
  }
  await db.query("update public.profiles set role='host',approved=true where id=$1",[actor.host]);
  await db.query("update public.profiles set role='admin',approved=true where id=$1",[actor.admin]);
  for(const name of ['consultantA','consultantB']) await db.query("update public.profiles set user_kind='consultant',approved=true where id=$1",[actor[name]]);
  await db.query("update public.profiles set approved=true where id in ($1,$2)",[actor.client,actor.inactive]);
  await db.query('update public.profiles set active=false where id=$1',[actor.inactive]);
  for(let i=0;i<companies.length;i++)await db.query("insert into public.companies(id,business_name,assigned_consultant_id,notes,source_payload) values($1,$2,$3,'synthetic-admin-only','{}'::jsonb)",[companies[i],`합성 검증 기업 ${i+1}`,actor[i?'consultantB':'consultantA']]);
  await db.query('update public.profiles set company_id=$1 where id=$2',[companies[0],actor.client]);
  for(let i=0;i<sessions.length;i++)await db.query("insert into public.consultation_sessions(id,company_id,kind,round_number) values($1,$2,'consulting',1)",[sessions[i],companies[i]]);
});
after(async()=>{await db.close();});

test('database preserves seeded companies and sessions',async()=>{
  assert.equal((await db.query('select count(*)::int n from companies')).rows[0].n,3);
  assert.equal((await db.query('select count(*)::int n from consultation_sessions')).rows[0].n,3);
});
test('pending and inactive profiles can read self but no company rows',async()=>{
  for(const name of ['pending','inactive'])await asActor(name,async()=>{
    assert.equal((await db.query('select id from profiles')).rows.length,1);
    assert.equal((await db.query(`select ${safeCompany} from companies`)).rows.length,0);
    assert.equal((await db.query('select id from consultation_sessions')).rows.length,0);
    await assert.rejects(db.query("insert into companies(business_name) values('합성 차단')"),/row-level security/i);
  });
});
test('consultant only reads assigned company and session',async()=>{
  await asActor('consultantA',async()=>{
    assert.deepEqual((await db.query('select id from companies')).rows.map(x=>x.id),[companies[0]]);
    assert.deepEqual((await db.query('select id from consultation_sessions')).rows.map(x=>x.id),[sessions[0]]);
  });
});
test('client only reads own company, cannot edit consultation',async()=>{
  await asActor('client',async()=>{
    assert.deepEqual((await db.query('select id from companies')).rows.map(x=>x.id),[companies[0]]);
    const changed=await db.query("update consultation_sessions set report_status='제출 완료' where id=$1 returning id",[sessions[0]]);
    assert.equal(changed.rows.length,0);
  });
});
test('company raw contact, notes and source payload are blocked even on direct query',async()=>{
  for(const name of ['host','admin','consultantA','client'])await asActor(name,async()=>{
    await assert.rejects(db.query('select representative_phone,source_payload,notes from companies'),/permission denied/i);
  });
});
test('profiles raw email is not an app-readable column',async()=>{
  await asActor('admin',async()=>{await assert.rejects(db.query('select email from profiles'),/permission denied/i);});
});
test('admin can create update and delete a new empty company',async()=>{
  await asActor('admin',async()=>{
    const created=(await db.query("insert into companies(business_name) values('합성 CRUD') returning id")).rows[0];
    assert.ok(created.id);
    assert.equal((await db.query("update companies set status='진단 대기' where id=$1 returning status",[created.id])).rows[0].status,'진단 대기');
    assert.equal((await db.query('delete from companies where id=$1 returning id',[created.id])).rows.length,1);
  });
});
test('deleting a company with sessions is blocked rather than cascading',async()=>{
  await asActor('admin',async()=>{await assert.rejects(db.query('delete from companies where id=$1',[companies[0]]),/Company with sessions/);});
});
test('consultant cannot create or modify companies',async()=>{
  await asActor('consultantA',async()=>{
    assert.equal((await db.query("update companies set status='완료' where id=$1 returning id",[companies[0]])).rows.length,0);
    await assert.rejects(db.query("insert into companies(business_name) values('합성 차단')"),/row-level security/i);
  });
});
test('only host can grant host; host can designate another approved host',async()=>{
  await asActor('admin',async()=>{await assert.rejects(db.query("update profiles set role='host' where id=$1 returning id",[actor.target]),/Only host|row-level security/i);});
  await asActor('host',async()=>{
    assert.equal((await db.query("update profiles set role='host',approved=true where id=$1 returning role",[actor.target])).rows[0].role,'host');
    assert.equal((await db.query("select id from profiles where role='host'")).rows.length,2);
  });
});
test('admin cannot modify host and host cannot revoke own active access',async()=>{
  await asActor('admin',async()=>{assert.equal((await db.query('update profiles set active=false where id=$1 returning id',[actor.host])).rows.length,0);});
  await asActor('host',async()=>{await assert.rejects(db.query('update profiles set active=false where id=$1',[actor.host]),/Host cannot revoke own access/);});
});
test('admin can approve an ordinary pending account',async()=>{
  await asActor('admin',async()=>{assert.equal((await db.query('update profiles set approved=true where id=$1 returning approved',[actor.pending])).rows[0].approved,true);});
});
test('consultant cannot change own profile privileges through direct query',async()=>{
  await asActor('consultantA',async()=>{assert.equal((await db.query("update profiles set role='admin' where id=$1 returning id",[actor.consultantA])).rows.length,0);});
});
test('consultant can insert and edit assigned session; trigger records real actor',async()=>{
  await asActor('consultantA',async()=>{
    const created=(await db.query("insert into consultation_sessions(company_id,kind,round_number,updated_by) values($1,'consulting',2,$2) returning id,updated_by",[companies[0],actor.host])).rows[0];
    assert.equal(created.updated_by,actor.consultantA);
    assert.equal((await db.query("update consultation_sessions set report_status='검토 중' where id=$1 returning report_status",[created.id])).rows[0].report_status,'검토 중');
  });
});
test('consultant cannot insert session for another company',async()=>{
  await asActor('consultantA',async()=>{await assert.rejects(db.query("insert into consultation_sessions(company_id,kind,round_number) values($1,'consulting',2)",[companies[1]]),/row-level security/i);});
});
test('duplicate sessions are rejected, no upsert overwrite',async()=>{
  await asActor('admin',async()=>{await assert.rejects(db.query("insert into consultation_sessions(company_id,kind,round_number) values($1,'consulting',1)",[companies[0]]),/duplicate key/i);});
});
test('new round four and diagnosis round two are rejected',async()=>{
  for(const [kind,round] of [['consulting',4],['diagnosis',2]])await asActor('admin',async()=>{await assert.rejects(db.query('insert into consultation_sessions(company_id,kind,round_number) values($1,$2,$3)',[companies[0],kind,round]),/Diagnosis round/);});
});
test('client cannot forge an audit event or read admin audit stream',async()=>{
  await asActor('client',async()=>{
    assert.equal((await db.query('select id from audit_events')).rows.length,0);
    await assert.rejects(db.query("insert into audit_events(actor_id,entity_type,entity_id,action) values($1,'companies',$2,'forged')",[actor.client,companies[0]]),/permission denied/i);
  });
});
test('trigger audit contains metadata without copying report text',async()=>{
  await asActor('admin',async()=>{
    await db.query("update consultation_sessions set report_note='synthetic-private-report' where id=$1",[sessions[0]]);
    const events=(await db.query('select actor_id,entity_type,entity_id,action from audit_events where entity_id=$1',[sessions[0]])).rows;
    assert.ok(events.some(e=>e.actor_id===actor.admin&&e.action==='update'));
    await assert.rejects(db.query('select summary from audit_events'),/permission denied/i);
  });
});

test('legacy round four survives migration and can update report/date',async()=>{
  await asActor('admin',async()=>{
    const updated=(await db.query("update consultation_sessions set scheduled_on='2026-11-20',report_status='검토 중' where id=$1 returning round_number,report_status",[legacySession])).rows[0];
    assert.equal(updated.round_number,4);
    assert.equal(updated.report_status,'검토 중');
  });
});
test('direct assignment to an unapproved account is rejected',async()=>{
  await asActor('admin',async()=>{await assert.rejects(db.query('update companies set assigned_consultant_id=$1 where id=$2',[actor.pending,companies[0]]),/approved active consultant/);});
});
test('new account starts pending user without client-controlled privileges',async()=>{
  const profile=(await db.query('select role,user_kind,approved,active from profiles where id=$1',[actor.target])).rows[0];
  assert.deepEqual(profile,{role:'user',user_kind:'client',approved:false,active:true});
});
