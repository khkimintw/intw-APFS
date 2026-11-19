'use client';
import { useEffect, useRef, useState } from 'react';
import { SUPABASE_URL, SUPABASE_KEY } from '../lib/public-config';
import { supabase } from '../lib/supabase';
import { apiRequest } from '../modules/api';
import Workspace from './Workspace';

export default function AuthApp() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [capabilities, setCapabilities] = useState({ departureBase: false, audit: true });
  const [busy, setBusy] = useState(true);
  const [mode, setMode] = useState('login');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const requestSequence = useRef(0);
  const sessionRef = useRef(null);
  const googleAppEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === 'true';
  const [googleProvider, setGoogleProvider] = useState('checking');
  const googleEnabled = googleAppEnabled && googleProvider === 'enabled';
  useEffect(() => {
    if (!supabase) return;
    const controller = new AbortController();
    let alive = true;
    const timer = setTimeout(() => controller.abort(), 8000);
    fetch(SUPABASE_URL + '/auth/v1/settings', {
      headers: { apikey: SUPABASE_KEY }, signal: controller.signal, cache: 'no-store'
    }).then(async response => {
      if (!response.ok) throw new Error('settings unavailable');
      const settings = await response.json();
      if (alive) setGoogleProvider(settings.external?.google === true ? 'enabled' : 'disabled');
    }).catch(() => { if (alive) setGoogleProvider('unavailable'); }).finally(() => clearTimeout(timer));
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, []);

  async function loadProfile(nextSession) {
    const previousSession = sessionRef.current;
    const sameUser = !!previousSession?.user?.id && previousSession.user.id === nextSession?.user?.id;
    const sequence = ++requestSequence.current;
    sessionRef.current = nextSession;
    setSession(nextSession);
    if (!nextSession) { setProfile(null); setBusy(false); return; }
    if (!sameUser) setBusy(true);
    try {
      const response = await apiRequest(nextSession, '/me', { includeMeta: true });
      const data = response.data;
      if (sequence !== requestSequence.current) return;
      setProfile(data); setCapabilities({ audit: true, ...response.capabilities }); setMessage('');
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      if (!sameUser) setProfile(null);
      setMessage(error.message);
    } finally { if (sequence === requestSequence.current) setBusy(false); }
  }
  useEffect(() => {
    if (!supabase) { setBusy(false); return; }
    let alive = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) return;
      if (error) { setMessage('로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.'); setBusy(false); }
      else loadProfile(data.session);
    }).catch(() => { if (alive) { setMessage('인증 서버에 연결하지 못했습니다.'); setBusy(false); } });
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      // Initial state is loaded by getSession. Same-user auth events only rotate the token;
      // refreshing the profile screen here would unmount Workspace and reset preview state.
      setTimeout(() => {
        if (!alive || event === 'INITIAL_SESSION') return;
        const sameUser = !!next?.user?.id && sessionRef.current?.user?.id === next.user.id;
        if (sameUser) { sessionRef.current = next; setSession(next); return; }
        loadProfile(next);
      }, 0);
    });
    return () => { alive = false; ++requestSequence.current; listener.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!session || !profile || profile.approved || !profile.active) return;
    const controller = new AbortController();
    const timer = setInterval(async () => {
      try {
        const data = await apiRequest(session, '/me', { signal: controller.signal });
        if (!controller.signal.aborted) setProfile(data);
      } catch (error) { if (error.name !== 'AbortError' && !controller.signal.aborted) setMessage(error.message); }
    }, 10000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [session, profile?.approved, profile?.active]);

  async function googleSignIn() {
    if (!googleEnabled || !supabase) return;
    setBusy(true); setMessage('');
    try {
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
      if (error) { setMessage('Google 로그인을 시작하지 못했습니다. 관리자에게 공급자 설정 확인을 요청해 주세요.'); setBusy(false); }
    } catch { setMessage('Google 인증 서버에 연결하지 못했습니다.'); setBusy(false); }
  }
  async function submit(event) {
    event.preventDefault(); if (!supabase) return;
    setBusy(true); setMessage('');
    try {
      const result = mode === 'login'
        ? await supabase.auth.signInWithPassword({ email: form.email.trim(), password: form.password })
        : await supabase.auth.signUp({ email: form.email.trim(), password: form.password, options: { data: { name: form.name.trim() } } });
      if (result.error) { setMessage(mode === 'login' ? '로그인하지 못했습니다. 이메일·비밀번호 또는 계정 승인 상태를 확인해 주세요.' : '가입을 완료하지 못했습니다. 입력 형식과 이메일 수신함을 확인해 주세요.'); return; }
      setForm(value => ({ ...value, password: '' }));
      if (mode === 'signup' && !result.data.session) setMessage('가입 확인 이메일을 확인해 주세요. 이메일 인증 후 관리자 승인이 필요합니다.');
      else if (mode === 'signup') setMessage('계정이 생성되었습니다. 관리자 승인 뒤 업무 메뉴를 이용할 수 있습니다.');
      if (result.data.session) await loadProfile(result.data.session);
    } catch { setMessage('인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  }
  const signOut = async () => { if (supabase) await supabase.auth.signOut(); sessionRef.current = null; setSession(null); setProfile(null); setMessage(''); };
  if (!supabase) return <AuthCard title="연결 설정이 필요합니다"><p>이 배포의 Supabase URL과 publishable key가 아직 설정되지 않았습니다. 관리자가 프로젝트 전용 공개 연결값을 설정해야 로그인할 수 있습니다.</p></AuthCard>;
  if (busy) return <AuthCard title="연결 상태 확인 중"><p role="status">잠시 기다려 주세요.</p></AuthCard>;
  if (session && profile?.active && profile?.approved) return <Workspace session={session} profile={profile} onProfile={setProfile} onSignOut={signOut} capabilities={capabilities} />;
  if (session && !profile) return <AuthCard title="계정 권한 확인이 필요합니다"><p role="alert">{message || '프로필을 확인하지 못했습니다. 관리자에게 계정 설정 확인을 요청해 주세요.'}</p><button onClick={() => loadProfile(session)}>다시 확인</button><button onClick={signOut}>로그아웃</button></AuthCard>;
  if (session && profile && !profile.active) return <AuthCard title="사용 중지된 계정입니다"><p>관리자에게 계정 활성화를 요청해 주세요.</p><button onClick={signOut}>로그아웃</button></AuthCard>;
  if (session && profile && !profile.approved) return <AuthCard title="가입 승인 대기 중입니다"><p>관리자가 계정을 승인하고 업무 역할과 배정 범위를 지정하면 업무 화면을 이용할 수 있습니다.</p>{message && <p role="status">{message}</p>}<button onClick={() => loadProfile(session)}>승인 상태 새로고침</button><button onClick={signOut}>로그아웃</button></AuthCard>;
  return <main className="auth-screen"><section className="auth-card"><div className="brand-mark">i</div><span className="eyebrow">INTWEEN · AGRI PROGRAM</span><h1>농금원 업무 플랫폼</h1><p className="muted">사업 운영 현황과 컨설팅 기록을 한곳에서 관리합니다.</p>
    <div className="auth-tabs"><button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setMessage(''); }}>로그인</button><button className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setMessage(''); }}>계정 만들기</button></div>
    <form onSubmit={submit} className="auth-form">{mode === 'signup' && <label>업무 표시명 (실명 대신 별칭)<input required maxLength={60} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoComplete="off" /></label>}<label>로그인 이메일<input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} autoComplete="email" /></label><label>비밀번호<input type="password" required minLength={8} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label><button className="primary full" disabled={busy}>{mode === 'login' ? '로그인' : '가입 신청'}</button></form>
    <div className="auth-divider"><span>또는</span></div><button type="button" className="google-button" onClick={googleSignIn} disabled={!googleEnabled || busy}><strong>G</strong> {googleEnabled ? 'Google로 계속하기' : 'Google 로그인 · 준비 대기'}</button>
    <p className="fine-print" role="status">Google 앱 사용 설정: {googleAppEnabled ? '켜짐' : '꺼짐'}. Supabase Google 공급자: {({ checking: '확인 중', enabled: '활성', disabled: '비활성', unavailable: '확인 실패' })[googleProvider]}. 두 설정이 모두 활성일 때 로그인할 수 있습니다.{!googleEnabled && ' 이메일 로그인을 이용해 주세요.'}</p>
    {message && <p className="form-message" role="status">{message}</p>}<p className="fine-print">로그인 이메일은 인증에만 사용합니다. 업무 화면에는 개인 연락처·주소·개인이메일을 표시하지 않습니다. 신규 계정은 관리자 승인 전 자료에 접근할 수 없습니다.</p></section></main>;
}
function AuthCard({ title, children }) { return <main className="auth-screen"><section className="auth-card"><div className="brand-mark">i</div><h1>{title}</h1>{children}</section></main>; }
