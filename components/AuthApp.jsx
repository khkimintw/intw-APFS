'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import Workspace from './Workspace';

export default function AuthApp() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [busy, setBusy] = useState(true);
  const [mode, setMode] = useState('login');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ email: '', password: '', name: '' });

  async function loadProfile(nextSession) {
    setSession(nextSession);
    if (!nextSession) { setProfile(null); setBusy(false); return; }
    setBusy(true);
    const { data, error } = await supabase.from('profiles').select('*').eq('id', nextSession.user.id).maybeSingle();
    setProfile(error ? null : data);
    setMessage(error ? '사용자 프로필을 불러오지 못했습니다. 데이터베이스 설정을 확인해 주세요.' : '');
    setBusy(false);
  }
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => { if (alive) loadProfile(data.session); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => { if (alive) loadProfile(next); });
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!session || !profile || profile.approved || !profile.active) return;
    const timer = setInterval(async () => {
      const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
      if (data?.approved || data?.active === false) setProfile(data);
    }, 5000);
    return () => clearInterval(timer);
  }, [session, profile?.approved, profile?.active]);

  async function googleSignIn() {
    setBusy(true); setMessage('');
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    if (error) { setMessage(`Google 로그인을 시작할 수 없습니다. Supabase Auth의 Google 공급자 설정을 확인하세요. ${error.message}`); setBusy(false); }
  }

  async function submit(e) {
    e.preventDefault(); setBusy(true); setMessage('');
    const result = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email: form.email, password: form.password })
      : await supabase.auth.signUp({ email: form.email, password: form.password, options: { data: { name: form.name } } });
    if (result.error) { setMessage(result.error.message); setBusy(false); return; }
    if (mode === 'signup' && !result.data.session) setMessage('가입 확인 이메일을 보냈습니다. 이메일 인증을 마치면 로그인할 수 있습니다.');
    else if (mode === 'signup') setMessage('계정이 생성되었습니다. 관리자 승인 뒤 업무 메뉴를 이용할 수 있습니다.');
    setBusy(false);
  }

  if (busy) return <div className="auth-screen"><div className="auth-card">연결 상태를 확인하고 있습니다…</div></div>;
  if (session && profile?.active && profile?.approved) return <Workspace supabase={supabase} session={session} profile={profile} onProfile={setProfile} onSignOut={() => supabase.auth.signOut()} />;
  if (session && !profile) return <div className="auth-screen"><div className="auth-card"><div className="brand-mark">i</div><h1>계정 권한 확인 중</h1><p>프로필이 생성되지 않았습니다. Supabase 마이그레이션이 적용되었는지 확인하세요.</p><button onClick={() => supabase.auth.signOut()}>로그아웃</button></div></div>;
  if (session && profile && !profile.approved) return <div className="auth-screen"><div className="auth-card"><div className="brand-mark">i</div><span className="eyebrow">ACCOUNT REVIEW</span><h1>가입 승인 대기 중입니다</h1><p>관리자가 계정을 승인하고 경영체 또는 컨설턴트 권한을 지정하면 업무 화면을 이용할 수 있습니다.</p><button onClick={() => supabase.auth.signOut()}>로그아웃</button></div></div>;
  if (session && profile && !profile.active) return <div className="auth-screen"><div className="auth-card"><div className="brand-mark">i</div><h1>사용 중지된 계정입니다</h1><p>관리자에게 계정 활성화를 요청해 주세요.</p><button onClick={() => supabase.auth.signOut()}>로그아웃</button></div></div>;
  return <main className="auth-screen"><section className="auth-card"><div className="brand-mark">i</div><span className="eyebrow">INTWEEN · AGRI PROGRAM</span><h1>농금원 업무 플랫폼</h1><p className="muted">사업 운영 현황과 컨설팅 기록을 한곳에서 관리합니다.</p>
    <div className="auth-tabs"><button className={mode==='login'?'active':''} onClick={()=>{setMode('login');setMessage('');}}>로그인</button><button className={mode==='signup'?'active':''} onClick={()=>{setMode('signup');setMessage('');}}>계정 만들기</button></div>
    <form onSubmit={submit} className="auth-form">{mode==='signup'&&<label>이름<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} autoComplete="name"/></label>}<label>이메일<input type="email" required value={form.email} onChange={e=>setForm({...form,email:e.target.value})} autoComplete="email"/></label><label>비밀번호<input type="password" required minLength={8} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} autoComplete={mode==='login'?'current-password':'new-password'}/></label><button className="primary full" disabled={busy}>{busy?'잠시만요…':mode==='login'?'로그인':'계정 만들기'}</button></form>
    <div className="auth-divider"><span>또는</span></div><button type="button" className="google-button" onClick={googleSignIn} disabled={busy}><strong>G</strong> Google로 계속하기</button>
    {message&&<p className="form-message" role="status">{message}</p>}<p className="fine-print">권한은 관리자·컨설턴트·경영체별로 구분됩니다. 경영체 계정은 배정된 회사 자료만 열 수 있습니다.</p></section></main>;
}
