'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../modules/api';
import { uploadReportFile, removeReportFile } from '../modules/reportFiles';
import { filterCompanies, intakeLabel, intakeOptions } from '../modules/companyFilters';
import ImportPanel from './ImportPanel';
import { AssignmentView, ReportsView, ReviewView, SettlementView } from './WorkViews';
import { buildCompanyXlsx, downloadBlob, resolveRange } from '../modules/exportXlsx';
import { canEditSessions, isAdmin, REPORT_STATUSES, sessionError, sessionLabel } from '../modules/workflow';

const blank = { business_name: '', business_registration_number: '', founded_year: '', theme: '', presentation_date: '', program_year: String(new Date().getFullYear()), business_summary: '', assigned_consultant_id: '', status: '배정 대기', cooperation_level: '', report_status: '미제출', ir_direct: false, ir_confirmed: false, ir_scheduled_at:'', representative_name:'', representative_phone:'', representative_email:'', representative_birth_year:'', representative_gender:'', contact_name:'', contact_phone:'', contact_email:'', address:'', address_verification:'미확인', notes:'', intween_notes:'' };
const roleLabels = { host: '소유자(host)', admin: '관리자', user: '사용자' };
const PAGE_SIZES = [10, 20, 30, 40, 50, 'all'];
const SORTS = { name: ['기업명', c => c.business_name], founded: ['설립연도', c => (c.founded_year ? Number(c.founded_year) : null)], status: ['진행 상태', c => c.status], intake: ['접수', c => c.intake_date] };
const statusOptions = ['배정 대기', '진단 대기', '컨설팅 진행', '보고서 검토', '완료', '포기'];
const auditActions = { INSERT: '생성', UPDATE: '수정', DELETE: '삭제', insert: '생성', update: '수정', delete: '삭제' };
function Pill({ children, tone = '' }) { return <span className={`pill ${tone}`}>{children}</span>; }

export default function Workspace({ session, profile: actualProfile, onSignOut, capabilities = {} }) {
  const [pseudoMode, setPseudoMode] = useState(null);
  const profile = pseudoMode ? { ...actualProfile, id: pseudoMode === 'admin' ? 'p-admin' : 'p-user', role: pseudoMode, user_kind: 'consultant', display_name: pseudoMode === 'admin' ? '가상 관리자' : '가상 컨설턴트' } : actualProfile;
  const serviceSession = useMemo(() => pseudoMode ? { ...session, pseudoMode } : session, [session, pseudoMode]);
  const admin = isAdmin(profile), host = actualProfile.role === 'host', editor = canEditSessions(profile);
  const [uiSeed] = useState(() => { try { return typeof window !== 'undefined' ? JSON.parse(sessionStorage.getItem(`apfs-ui-${profile.id}`) || '{}') : {}; } catch { return {}; } });
  const [section, setSection] = useState(uiSeed.section || 'overview');
  const [companies, setCompanies] = useState([]), [people, setPeople] = useState([]), [selectedId, setSelectedId] = useState(uiSeed.selectedId || '');
  const [sessions, setSessions] = useState([]), [audits, setAudits] = useState([]), [loadedCompany, setLoadedCompany] = useState('');
  const [search, setSearch] = useState(uiSeed.search || ''), [searchDraft, setSearchDraft] = useState(uiSeed.search || ''), [categoryFilter, setCategoryFilter] = useState(uiSeed.categoryFilter || '전체');
  const directOnly = categoryFilter === 'ir';
  useEffect(() => { try { sessionStorage.setItem(`apfs-ui-${profile.id}`, JSON.stringify({section,selectedId,search,categoryFilter,statusFilter,consultantFilter,intakeFilter,pageSize,page,sortKey,sortDir})); } catch {} }, [profile.id,section,search,categoryFilter,statusFilter,consultantFilter,intakeFilter,pageSize,page,sortKey,sortDir]);
  const [allSessions, setAllSessions] = useState([]), [sessionsBusy, setSessionsBusy] = useState(false), [sessionsError, setSessionsError] = useState('');
  const [statusFilter, setStatusFilter] = useState(uiSeed.statusFilter || '전체'), [consultantFilter, setConsultantFilter] = useState(uiSeed.consultantFilter || '전체'), [intakeFilter, setIntakeFilter] = useState(uiSeed.intakeFilter || '전체');
  const [busy, setBusy] = useState(true), [mutationBusy, setMutationBusy] = useState(false), [detailBusy, setDetailBusy] = useState(false);
  const [error, setError] = useState(''), [toast, setToast] = useState(''), [auditMessage, setAuditMessage] = useState('');
  const [editing, setEditing] = useState(null), [form, setForm] = useState(blank);
  const [emailMessages,setEmailMessages]=useState([]),[emailComposeOpen,setEmailComposeOpen]=useState(false),[emailSending,setEmailSending]=useState(false),[emailDraft,setEmailDraft]=useState({recipient:'',subject:'',body:'',replyToPrevious:true});
  const [sessionForm, setSessionForm] = useState({ kind: 'consulting', round_number: 1, scheduled_on: '', scheduled_time:'' });
  const [pageSize, setPageSize] = useState(uiSeed.pageSize === 'all' ? 'all' : [10,20,30,40,50].includes(Number(uiSeed.pageSize)) ? Number(uiSeed.pageSize) : 10), [page, setPage] = useState(uiSeed.page || 1), [sortKey, setSortKey] = useState(['name','founded','status','intake'].includes(uiSeed.sortKey) ? uiSeed.sortKey : 'name'), [sortDir, setSortDir] = useState(uiSeed.sortDir === 'desc' ? 'desc' : 'asc');
  const [rangeStart, setRangeStart] = useState(''), [rangeEnd, setRangeEnd] = useState('');
  const [irMonth,setIrMonth]=useState(()=>new Date().toISOString().slice(0,7));
  const [exportState, setExportState] = useState(null), [exportError, setExportError] = useState('');
  const detailSequence = useRef(0), mutationLock = useRef(false);
  const peopleById = useMemo(() => Object.fromEntries(people.map(person => [person.id, person])), [people]);
  const selected = companies.find(company => company.id === selectedId) || companies[0];
  const visible = useMemo(() => filterCompanies(companies, { search, status: statusFilter, consultant: consultantFilter, intake: intakeFilter, category: categoryFilter }), [companies, search, statusFilter, consultantFilter, intakeFilter, categoryFilter]);
  const sorted = useMemo(() => {
    const pick = SORTS[sortKey][1], direction = sortDir === 'asc' ? 1 : -1;
    return [...visible].sort((a, b) => {
      const x = pick(a), y = pick(b);
      if (x == null || x === '') return y == null || y === '' ? 0 : 1; // 빈 값은 항상 마지막
      if (y == null || y === '') return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko', { numeric: true })) * direction;
    });
  }, [visible, sortKey, sortDir]);
  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = pageSize === 'all' ? sorted : sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pageFrom = sorted.length ? (pageSize === 'all' ? 1 : (currentPage - 1) * pageSize + 1) : 0, pageTo = pageSize === 'all' ? sorted.length : Math.min(sorted.length, currentPage * pageSize);
  const filtersMounted = useRef(false);
  useEffect(() => { if (!filtersMounted.current) { filtersMounted.current = true; return; } setPage(1); }, [search, statusFilter, consultantFilter, intakeFilter, categoryFilter, sortKey, sortDir, pageSize]);
  const statuses = useMemo(() => ['전체', ...new Set(companies.map(company => company.status).filter(Boolean))], [companies]);
  const intakeName = useMemo(() => intakeLabel(companies), [companies]);
  const intakes = useMemo(() => ['전체', ...intakeOptions(companies)], [companies]);
  const consultants = useMemo(() => admin ? [...new Set(companies.map(company => company.assigned_consultant_id).filter(Boolean))].filter(id => peopleById[id]).map(id => ({ id, name: peopleById[id].display_name || '업무 담당자' })) : [], [companies, peopleById, admin]);
  const hasUnassigned = useMemo(() => admin && companies.some(company => !company.assigned_consultant_id), [companies, admin]);
  const filtersActive = !!(search || statusFilter !== '전체' || consultantFilter !== '전체' || intakeFilter !== '전체' || categoryFilter !== '전체');
  function resetFilters() { setSearch(''); setSearchDraft(''); setStatusFilter('전체'); setConsultantFilter('전체'); setIntakeFilter('전체'); setCategoryFilter('전체'); }
  const currentSessions = loadedCompany === selected?.id ? sessions : [];
  const missingReports = currentSessions.filter(item => item.report_status !== '제출 완료');
  const stats = useMemo(() => ({ total: companies.length, waiting: companies.filter(company => /대기|미배정|미기재/.test(company.status || '')).length, consulting: companies.filter(company => /진행/.test(company.status || '')).length, done: companies.filter(company => /완료|제출/.test(company.status || '')).length }), [companies]);

  const refresh = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const [nextCompanies, nextPeople] = await Promise.all([apiRequest(serviceSession, '/companies'), admin ? apiRequest(serviceSession, '/profiles') : Promise.resolve([])]);
      setCompanies(nextCompanies || []); setPeople(nextPeople || []);
      setSelectedId(id => nextCompanies?.some(company => company.id === id) ? id : nextCompanies?.[0]?.id || '');
    } catch (problem) { setError(problem.message); }
    finally { setBusy(false); }
  }, [serviceSession, admin]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);

  const refreshDetail = useCallback(async (companyId, signal) => {
    const sequence = ++detailSequence.current;
    setDetailBusy(true); setAudits([]); setAuditMessage('');
    try {
      const nextSessions = await apiRequest(serviceSession, `/companies/${companyId}/sessions`, { signal });
      if (sequence !== detailSequence.current || signal?.aborted) return;
      setSessions(nextSessions || []); setLoadedCompany(companyId);
      if (admin && capabilities.audit !== false) {
        try {
          const nextAudits = await apiRequest(serviceSession, `/audit?company_id=${encodeURIComponent(companyId)}`, { signal });
          if (sequence === detailSequence.current && !signal?.aborted) setAudits(nextAudits || []);
        } catch (problem) { if (problem.name !== 'AbortError' && sequence === detailSequence.current) setAuditMessage(problem.message); }
      }
    } catch (problem) { if (problem.name !== 'AbortError' && sequence === detailSequence.current) { setSessions([]); setLoadedCompany(''); setError(problem.message); } }
    finally { if (sequence === detailSequence.current) setDetailBusy(false); }
  }, [serviceSession, admin, capabilities.audit]);
  useEffect(() => {
    if (!selected?.id) { setSessions([]); setLoadedCompany(''); return; }
    const controller = new AbortController();
    refreshDetail(selected.id, controller.signal);
    return () => { controller.abort(); ++detailSequence.current; };
  }, [selected?.id, refreshDetail]);
  const refreshEmails=useCallback(async(companyId)=>{
    if(!admin||!companyId||serviceSession.pseudoMode){setEmailMessages([]);return;}
    try{const messages=await apiRequest(serviceSession,`/companies/${companyId}/emails`);setEmailMessages(messages||[]);}catch{setEmailMessages([]);}
  },[serviceSession,admin]);
  useEffect(()=>{if(selected?.id)refreshEmails(selected.id);else setEmailMessages([]);},[selected?.id,refreshEmails]);

  async function mutate(action, success) {
    if (mutationLock.current) return false;
    mutationLock.current = true; setMutationBusy(true); setError('');
    try { await action(); setToast(success); return true; }
    catch (problem) { setError(problem.message); return false; }
    finally { mutationLock.current = false; setMutationBusy(false); }
  }
  function pick(company) { setSelectedId(company.id); setSection('detail'); setError(''); }
  function lookupAddress(){
    if(typeof window==='undefined')return;
    const open=()=>new window.daum.Postcode({oncomplete:data=>{const address=data.roadAddress||data.jibunAddress||'';setForm(current=>({...current,address:address?`${address}${data.zonecode?` (${data.zonecode})`:''}`:current.address,address_verification:'확인 필요'}));}}).open();
    if(window.daum?.Postcode){open();return;}
    const existing=document.querySelector('script[data-daum-postcode]');
    if(existing){existing.addEventListener('load',open,{once:true});return;}
    const script=document.createElement('script');script.src='https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';script.async=true;script.dataset.daumPostcode='true';script.onload=open;script.onerror=()=>setError('주소 검색 서비스를 불러오지 못했습니다. 주소를 직접 입력해 주세요.');document.head.appendChild(script);
  }
  function copyKnownAddress(){
    const normalized=value=>String(value||'').replace(/[^0-9]/g,'');
    const businessNo=normalized(form.business_registration_number);
    const match=companies.find(company=>businessNo&&normalized(company.business_registration_number)===businessNo&&company.address)
      ||companies.find(company=>form.business_name.trim()&&company.business_name.trim()===form.business_name.trim()&&company.address);
    if(!match){setToast('기존 등록 자료에서 일치하는 주소를 찾지 못했습니다. 주소 검색을 이용해 주세요.');return;}
    setForm(current=>({...current,address:match.address,address_verification:'확인 필요'}));
    setToast('기존 등록 자료의 주소를 복사했습니다. 기업에 확인한 뒤 주소 확인 상태를 갱신하세요.');
  }
  function fillKnownAddressOnBlur(){
    if(form.address)return;
    const normalized=value=>String(value||'').replace(/[^0-9]/g,'');
    const businessNo=normalized(form.business_registration_number);
    const match=companies.find(company=>businessNo&&normalized(company.business_registration_number)===businessNo&&company.address)
      ||companies.find(company=>form.business_name.trim()&&company.business_name.trim()===form.business_name.trim()&&company.address);
    if(match)setForm(current=>({...current,address:match.address,address_verification:'확인 필요'}));
  }
  function openEmailComposer(){
    if(!selected||!admin)return;
    if(serviceSession.pseudoMode){setToast('Pseudo 미리보기에서는 실제 메일 발송을 차단했습니다.');return;}
    const latest=emailMessages.find(message=>message.status==='sent');
    setEmailDraft({recipient:selected.contact_email||selected.representative_email||'',subject:`[농금원] ${selected.business_name} 자료 요청`,body:`안녕하세요. ${selected.business_name} 담당자님.\n\n농금원 지원사업 관련하여 아래 내용을 확인 부탁드립니다.\n\n요청 사항: \n회신 기한: \n\n감사합니다.`,replyToPrevious:!!latest?.provider_message_id});
    setEmailComposeOpen(true);
  }
  async function sendCompanyEmail(event){
    event.preventDefault();if(!selected||!admin||emailSending)return;
    setEmailSending(true);setError('');
    try{const sent=await apiRequest(serviceSession,`/companies/${selected.id}/emails`,{method:'POST',body:emailDraft});await refreshEmails(selected.id);setEmailComposeOpen(false);setToast(`${sent.send_number}회차 메일을 발송했습니다.${sent.threaded?' 기존 메일 대화에 연결했습니다.':''}`);}
    catch(problem){setError(problem.message);}
    finally{setEmailSending(false);}
  }
  function startCreate() { if (!admin) return; setForm({ ...blank }); setEditing('new'); }
  function startEdit(company) { if (!admin) return; setForm(Object.fromEntries(Object.keys(blank).map(key => [key, key === 'ir_scheduled_at' ? toLocalDateTime(company[key]) : company[key] ?? blank[key]]))); setEditing(company.id); }
  async function exportXlsx() {
    if (exportState) return;
    setExportError('');
    const range = resolveRange(sorted.length, rangeStart, rangeEnd);
    if (range.error) { setExportError(range.error); return; }
    setExportState({ phase: '준비 중', done: 0, total: range.to - range.from + 1 });
    try {
      const blob = await buildCompanyXlsx(sorted, { ...range, intakeName, resolveConsultant: company => peopleById[company.assigned_consultant_id]?.display_name || (company.assigned_consultant_id ? '배정됨' : '미배정'), onProgress: setExportState });
      downloadBlob(blob, `경영체목록_${new Date().toISOString().slice(0, 10)}_${range.from}-${range.to}.xlsx`);
      setToast(`${(range.to - range.from + 1).toLocaleString()}행을 XLSX로 내보냈습니다.`);
    } catch { setExportError('XLSX 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
    finally { setExportState(null); }
  }
  async function toggleIrConfirmed(company) {
    if (!admin) return;
    const confirmed=!company.ir_confirmed;
    await mutate(async()=>{await apiRequest(serviceSession,`/companies/${company.id}`,{method:'PATCH',body:{ir_confirmed:confirmed,ir_confirmed_at:confirmed?new Date().toISOString():null}});await refresh();},confirmed?'IR 확정으로 기록했습니다.':'IR 확정을 해제했습니다.');
  }
  async function saveCompany(event) {
    event.preventDefault(); if (!admin) return;
    const payload = { ...form, business_name: form.business_name.trim(), program_year: form.program_year ? Number(form.program_year) : null, assigned_consultant_id: form.assigned_consultant_id || null, ir_scheduled_at: form.ir_scheduled_at ? new Date(form.ir_scheduled_at).toISOString() : null };
    if (!payload.business_name) { setError('경영체명을 입력하세요.'); return; }
    const ok = await mutate(async () => {
      const data = await apiRequest(serviceSession, editing === 'new' ? '/companies' : `/companies/${editing}`, { method: editing === 'new' ? 'POST' : 'PATCH', body: payload });
      setEditing(null); setSelectedId(data.id); await refresh();
    }, '경영체 업무정보를 저장했습니다.');
    if (ok) setSection('detail');
  }
  async function removeCompany(company) {
    if (!admin || !window.confirm('경영체 업무정보를 삭제할까요? 연결된 회차가 있으면 서버에서 삭제를 차단합니다.')) return;
    await mutate(async () => { await apiRequest(serviceSession, `/companies/${company.id}`, { method: 'DELETE' }); await refresh(); setSection('companies'); }, '경영체 업무정보를 삭제했습니다.');
  }
  async function addSession(event) {
    event.preventDefault(); if (!selected || !editor || loadedCompany !== selected.id) return;
    const problem = sessionError(sessionForm, currentSessions);
    if (problem) { setError(problem); return; }
    await mutate(async () => {
      await apiRequest(serviceSession, `/companies/${selected.id}/sessions`, { method: 'POST', body: { kind: sessionForm.kind, round_number: Number(sessionForm.round_number), scheduled_on: sessionForm.scheduled_on || null, scheduled_time: sessionForm.scheduled_time || null } });
      setSessionForm({ kind: 'consulting', round_number: 1, scheduled_on: '', scheduled_time:'' }); await refreshDetail(selected.id);
    }, '새 상담 회차를 등록했습니다. 기존 회차는 덮어쓰지 않았습니다.');
  }
  async function uploadSessionReport(item, file) {
    if (!editor || !file || !selected) return;
    if (file.size > 20 * 1024 * 1024) { setError('보고서 파일은 20MB 이하로 선택하세요.'); return; }
    await mutate(async () => {
      let metadata;
      if (serviceSession.pseudoMode) metadata={path:'pseudo/'+item.id+'/'+file.name,name:file.name,file_size:file.size};
      else metadata=await uploadReportFile(session,selected.id,item.id,file);
      try { await apiRequest(serviceSession, '/sessions/' + item.id + '/report', { method: 'POST', body: metadata }); }
      catch(error) { if (!serviceSession.pseudoMode) await removeReportFile(session, metadata.path); throw error; }
      await refreshDetail(selected.id);
    }, '회차 보고서를 업로드했습니다.');
  }
  async function downloadSessionReport(item) {
    if (serviceSession.pseudoMode) { setToast('Pseudo 미리보기는 파일 이름과 크기만 가상으로 기록하며, 파일 내용은 저장하지 않습니다.'); return; }
    try { const report = await apiRequest(serviceSession, '/sessions/' + item.id + '/report'); if (!report?.url) throw new Error('등록된 보고서가 없습니다.'); const link=document.createElement('a'); link.href=report.url; link.target='_blank'; link.rel='noreferrer'; document.body.appendChild(link); link.click(); link.remove(); }
    catch(problem) { setError(problem.message); }
  }
  async function updateSession(item, patch) {
    if (!editor || !selected || loadedCompany !== selected.id) return;
    return mutate(async () => {
      await apiRequest(serviceSession, `/sessions/${item.id}`, { method: 'PATCH', body: patch });
      await refreshDetail(selected.id);
    }, '방문 일정과 보고 상태를 저장했습니다.');
  }
  async function removeSession(item) {
    if (!admin || !window.confirm('이 상담 회차를 삭제할까요? 되돌리려면 관리자의 데이터 복원이 필요합니다.')) return;
    await mutate(async () => { await apiRequest(serviceSession, `/sessions/${item.id}`, { method: 'DELETE' }); await refreshDetail(selected.id); }, '상담 회차를 삭제했습니다.');
  }
  async function updatePerson(person, patch) {
    if (!admin || (person.role === 'host' && !host)) return;
    await mutate(async () => {
      await apiRequest(serviceSession, `/profiles/${person.id}`, { method: 'PATCH', body: patch });
      setPeople(await apiRequest(serviceSession, '/profiles') || []);
    }, '계정의 승인·권한 설정을 저장했습니다.');
  }
  const SESSION_SECTIONS = ['assign', 'reports', 'review', 'settlement'];
  const loadAllSessions = useCallback(async () => {
    setSessionsBusy(true); setSessionsError('');
    try { setAllSessions(await apiRequest(serviceSession, '/sessions') || []); }
    catch (problem) { setSessionsError(problem.message); }
    finally { setSessionsBusy(false); }
  }, [serviceSession]);
  useEffect(() => { if (SESSION_SECTIONS.includes(section)) loadAllSessions(); }, [section, loadAllSessions]);
  const TITLES = { overview: admin ? '대시보드' : '내 배정 업무', import: '엑셀 업로드', companies: '기업 목록', ir: 'IR 캘린더', assign: '배정·방문 순서', reports: '보고 현황', review: '검수 의견', settlement: '보고·정산', users: '계정 및 권한', detail: '기업 상세' };
  const title = TITLES[section] || '기업 목록';

  return <div className="app-shell"><a className="skip-link" href="#workspace-content">본문으로 이동</a><aside className="sidebar"><a className="logo" href="#overview" onClick={() => setSection('overview')}><span className="brand-mark small-mark">i</span><span><strong>intween</strong><small>AGRI PROGRAM</small></span></a><div className="side-caption">WORKSPACE</div><Navigation section={section} setSection={setSection} admin={admin} pseudoImport={pseudoMode === 'user'} />{actualProfile.role !== 'user' && <div className="pseudo-switch">{pseudoMode ? <><small>가상 모드 · 이 브라우저에만 저장</small><button type="button" onClick={() => { setPseudoMode(pseudoMode === 'admin' ? 'user' : 'admin'); setSection('overview'); }}>Pseudo {pseudoMode === 'admin' ? 'User' : 'Admin'} 보기</button><button type="button" className="pseudo-return" onClick={() => { setPseudoMode(null); setSection('overview'); }}>실제 계정으로 돌아가기</button></> : <><button type="button" onClick={() => { setPseudoMode('user'); setSection('overview'); }}>Pseudo User</button><button type="button" onClick={() => { setPseudoMode('admin'); setSection('overview'); }}>Pseudo Admin</button></>}</div>}<div className="sidebar-bottom"><span className="user-avatar">U</span><div className="user-meta"><b>업무 계정</b><small>{roleLabels[profile.role]}{profile.role === 'user' ? ` · ${profile.user_kind === 'consultant' ? '컨설턴트' : '경영체'}` : ''}</small></div><button className="icon-button" aria-label="로그아웃" onClick={onSignOut}>↗</button></div></aside>
    <main className="workspace-main" id="workspace-content"><header className="topbar"><div className="crumb">업무공간 <span>/</span> {title}</div><div className="top-actions"><button className="text-button" onClick={refresh} disabled={busy || mutationBusy}>새로고침</button><Pill>{roleLabels[profile.role]}</Pill><button className="text-button mobile-signout" onClick={onSignOut}>로그아웃</button></div></header><div className="mobile-nav"><Navigation section={section} setSection={setSection} admin={admin} pseudoImport={pseudoMode === 'user'}/></div><div className="page-content">{pseudoMode && <div className="alert info" role="status">Pseudo {pseudoMode === 'admin' ? 'Admin' : 'User'} 미리보기입니다. 이 브라우저의 가상 데이터만 바뀌며 Supabase 실데이터에는 저장되지 않습니다.</div>}<div className="page-heading"><div><span className="eyebrow">AGRI SUPPORT WORKSPACE</span><h1>{title}</h1><p>{admin ? '사업 진행과 회차별 제출 현황을 확인하세요.' : '서버에서 허용된 배정 기업과 회차만 표시합니다.'}</p></div>{admin && section === 'companies' && <button className="primary" disabled={mutationBusy} onClick={startCreate}>＋ 경영체 추가</button>}</div>
      {error && <div className="alert error" role="alert">{error}<button onClick={() => setError('')}>닫기</button></div>}{toast && <div className="toast" role="status">✓ {toast}</div>}
      {section === 'overview' && <><div className="welcome-card"><div><span className="eyebrow light">INTWEEN · AGRI SUPPORT</span><h2>{admin ? '사업 진행 상황을 확인하세요' : '내 배정 기업의 업무를 이어가세요'}</h2><p>개인 연락처·주소·개인이메일을 표시하지 않는 업무 화면입니다.</p><button className="light-button" onClick={() => setSection('companies')}>경영체 목록 보기 <span>→</span></button></div><div className="welcome-art" aria-hidden="true"><div className="art-circle circle-a"/><div className="art-circle circle-b"/><span>農</span></div></div>
        {admin && <><div className="stat-grid"><Stat label="전체 경영체" value={busy ? '—' : stats.total} note="조회 가능한 전체 업무자료"/><Stat label="확인 필요" value={busy ? '—' : stats.waiting} note="배정·진행 상태 확인"/><Stat label="진행 중" value={busy ? '—' : stats.consulting} note="경영체 상태 기준"/><Stat label="완료·제출" value={busy ? '—' : stats.done} note="경영체 상태 기준 / 회차 실적과 별개"/></div><div className="alert info">사업 목표: 진단 90건 · 맞춤형 컨설팅 330건 · IR 15건 · 월 30건 페이스. 아래 현황은 경영체 상태 집계이며 목표 달성 실적을 대신하지 않습니다.</div></>}
        <div className="dashboard-grid"><section className="surface"><div className="section-head"><div><h2>{admin ? '등록 경영체' : '내 배정 기업'}</h2><p>경영체를 선택하면 회차와 방문 일정을 확인합니다.</p></div><button className="text-button" onClick={() => setSection('companies')}>전체 보기 →</button></div><CompanyTable rows={companies.slice(0, 7)} peopleById={peopleById} onPick={pick} empty={!busy} intakeName={intakeName} admin={admin} startIndex={1}/></section><aside className="surface quick-panel"><h2>빠른 업무</h2><p>자주 사용하는 업무 메뉴입니다.</p><button className="quick-action" onClick={() => setSection('companies')}><span className="quick-icon">▦</span><span><b>경영체 목록</b><small>배정 기업과 진행 상태</small></span><span className="arrow">→</span></button><button className="quick-action" disabled={!selected} onClick={() => selected && pick(selected)}><span className="quick-icon green">◷</span><span><b>회차별 일정·보고</b><small>방문 가능일과 미제출 상태</small></span><span className="arrow">→</span></button>{admin && <button className="quick-action" onClick={() => setSection('users')}><span className="quick-icon purple">♙</span><span><b>사용자 승인·권한</b><small>승인·활성·업무 범위</small></span><span className="arrow">→</span></button>}<div className="source-note"><span>i</span><p>승인된 업무자료만 사용합니다. 지도·AI·사업자 조회·정산 공급자는 연결하지 않았습니다.</p></div></aside></div></>}
      {section === 'companies' && <div className="company-layout"><section className="surface list-card" aria-busy={busy}><div className="section-head"><div><h2>{admin ? '기업 목록' : '내 배정 기업'}</h2><p>전체 {companies.length.toLocaleString()}개 · 조회 결과 <b>{sorted.length.toLocaleString()}</b>개</p></div></div>
        <form className="filter-bar" role="search" aria-label="기업 조회" onSubmit={event => { event.preventDefault(); setSearch(searchDraft); }}>
          <input type="search" className="filter-search" value={searchDraft} onChange={event => setSearchDraft(event.target.value)} placeholder="기업명 / 사업자번호" aria-label="기업명 또는 사업자번호 검색"/>
          <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label="상태 필터">{statuses.map(value => <option key={value} value={value}>{value === '전체' ? '상태 전체' : value}</option>)}</select>
          <select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)} aria-label="구분 필터"><option value="전체">구분 전체</option><option value="consult">컨설팅</option><option value="ir">IR 직행</option><option value="exclude_abandoned">포기 제외</option><option value="abandoned">포기만 보기</option><option value="reapplicant">재도전만 보기</option></select>
          {admin && <select value={consultantFilter} onChange={event => setConsultantFilter(event.target.value)} aria-label="담당 필터"><option value="전체">담당 전체</option>{hasUnassigned && <option value="none">미배정</option>}{consultants.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select>}
          {intakes.length > 1 && <select value={intakeFilter} onChange={event => setIntakeFilter(event.target.value)} aria-label={`${intakeName} 필터`}>{intakes.map(value => <option key={value} value={value}>{value === '전체' ? `${intakeName} 전체` : value}</option>)}</select>}
          <button className="primary filter-submit">조회</button><button type="button" className="ghost-button" onClick={resetFilters} disabled={!filtersActive && !searchDraft}>초기화</button>
        </form>
        <div className="list-tools"><button type="button" className={`chip ${directOnly ? 'on' : ''}`} aria-pressed={directOnly} onClick={() => setCategoryFilter(directOnly ? '전체' : 'ir')}>IR 직행만 보기</button>
          <details className="export-tool"><summary>내보내기 (XLSX)</summary>
            <form className="export-box" onSubmit={event => { event.preventDefault(); exportXlsx(); }}><p>현재 검색·필터·정렬{directOnly ? '·IR 직행' : ''}이 적용된 {sorted.length.toLocaleString()}행이 대상입니다. 행 범위를 비워 두면 전체를 내보냅니다. 연락처·주소·개인이메일·주민번호·생년월일은 포함되지 않습니다.</p><div className="export-fields"><label>시작 행<input type="number" inputMode="numeric" min="1" max={sorted.length || undefined} value={rangeStart} onChange={event => setRangeStart(event.target.value)} placeholder="1" disabled={!!exportState}/></label><label>끝 행<input type="number" inputMode="numeric" min="1" max={sorted.length || undefined} value={rangeEnd} onChange={event => setRangeEnd(event.target.value)} placeholder={sorted.length ? String(sorted.length) : ''} disabled={!!exportState}/></label><button className="primary" disabled={busy || !sorted.length || !!exportState}>{exportState ? '생성 중…' : 'XLSX 내보내기'}</button></div>
              {exportState && <div className="progress-box" role="status"><progress max={exportState.total || 1} value={exportState.done} aria-label="XLSX 생성 진행률"/><span>{exportState.phase} · {exportState.done.toLocaleString()} / {exportState.total.toLocaleString()}행</span></div>}
              {exportError && <div className="alert error" role="alert">{exportError}</div>}</form></details>
          <div className="list-controls"><label>정렬<select value={sortKey} onChange={event => setSortKey(event.target.value)}>{Object.entries(SORTS).map(([key, [label]]) => <option key={key} value={key}>{key === 'intake' ? intakeName : label}</option>)}</select></label><label>순서<select value={sortDir} onChange={event => setSortDir(event.target.value)}><option value="asc">오름차순</option><option value="desc">내림차순</option></select></label><label>페이지당<select value={pageSize} onChange={event => setPageSize(event.target.value === 'all' ? 'all' : Number(event.target.value))}>{PAGE_SIZES.map(value => <option key={value} value={value}>{value === 'all' ? '전체' : `${value}개`}</option>)}</select></label></div></div>
        {busy && <div className="progress-box" role="status"><progress aria-label="경영체 목록 불러오는 중"/><span>경영체 목록을 불러오는 중입니다. 데이터가 많으면 시간이 걸릴 수 있습니다.</span></div>}
        <CompanyTable rows={pageRows} peopleById={peopleById} onPick={pick} empty={!busy} intakeName={intakeName} admin={admin} startIndex={pageFrom}/>
        <nav className="pager" aria-label="경영체 목록 페이지"><span aria-live="polite">{sorted.length ? `${pageFrom.toLocaleString()}–${pageTo.toLocaleString()} / ${sorted.length.toLocaleString()}행` : '표시할 행 없음'}</span>{pageSize !== 'all' && <div className="pager-buttons"><button disabled={currentPage <= 1} onClick={() => setPage(1)} aria-label="첫 페이지">«</button><button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>이전</button><span>{currentPage} / {totalPages}</span><button disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>다음</button><button disabled={currentPage >= totalPages} onClick={() => setPage(totalPages)} aria-label="마지막 페이지">»</button></div>}</nav>
</section></div>}
      {section === 'detail' && selected && <div className="detail-grid"><section className="surface"><div className="section-head"><div><button className="back-link" onClick={() => setSection('companies')}>← 경영체 목록</button><h2>{selected.business_name}</h2><p>{selected.theme || '테마 미입력'} · {selected.program_year || '연도 미입력'}년 사업 {selected.ir_direct && <Pill>IR 직행 태그</Pill>}</p></div>{admin && <div className="inline-actions"><button className="primary" onClick={openEmailComposer}>플랫폼 메일 · {emailMessages.filter(item=>item.status==='sent').length}회 발송</button><button disabled={mutationBusy} onClick={() => startEdit(selected)}>정보 수정</button><button className={selected.ir_confirmed ? 'ghost-button' : 'primary'} disabled={mutationBusy} onClick={() => toggleIrConfirmed(selected)}>{selected.ir_confirmed ? 'IR 확정 해제' : 'IR 확정'}</button><button className="danger-button" disabled={mutationBusy} onClick={() => removeCompany(selected)}>삭제</button></div>}</div><div className="detail-facts"><Fact label="담당 컨설턴트" value={peopleById[selected.assigned_consultant_id]?.display_name || (selected.assigned_consultant_id ? '배정됨' : '미배정')}/><Fact label="사업자번호" value={selected.business_registration_number}/><Fact label="설립연도" value={selected.founded_year}/><Fact label="구분" value={selected.ir_direct ? 'IR 직행' : '컨설팅'}/><Fact label="진행 상태" value={selected.status}/><Fact label="재도전" value={selected.reapplicant}/><Fact label="접수일자" value={selected.intake_date}/><Fact label="등록일시" value={selected.created_at ? new Date(selected.created_at).toLocaleString('ko-KR') : ''}/><Fact label="발표 일정" value={selected.presentation_date}/><Fact label="협조도" value={selected.cooperation_level}/><Fact label="회사 보고 상태" value={selected.report_status}/><Fact label="IR 예정" value={selected.ir_scheduled_at ? new Date(selected.ir_scheduled_at).toLocaleString('ko-KR') : ''}/><Fact label="IR" value={selected.ir_confirmed ? `확정 · ${selected.ir_confirmed_at ? new Date(selected.ir_confirmed_at).toLocaleString('ko-KR') : ''}` : selected.ir_direct ? '직행 · 일정 미확정' : '해당 없음'}/></div>{admin && <section className="detail-private"><h3>경영체·담당자 정보</h3><div className="detail-facts"><Fact label="대표자" value={selected.representative_name}/><Fact label="대표 연락처" value={selected.representative_phone}/><Fact label="대표 이메일" value={selected.representative_email}/><Fact label="대표자 생년" value={selected.representative_birth_year}/><Fact label="성별" value={selected.representative_gender}/><Fact label="담당자" value={selected.contact_name}/><Fact label="담당자 연락처" value={selected.contact_phone}/><Fact label="담당자 이메일" value={selected.contact_email}/><Fact label="주소 확인" value={selected.address_verification}/></div><div className="address-row"><b>주소</b><span>{selected.address || '미기재'}</span>{selected.address && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selected.address)}`} target="_blank" rel="noreferrer">Google 지도 ↗</a>}</div><section className="email-history"><div className="section-head"><div><h3>메일 발송 내역</h3><p>발송 완료 {emailMessages.filter(item=>item.status==='sent').length}회 · 실패/대기 {emailMessages.filter(item=>item.status!=='sent').length}건</p></div><button type="button" onClick={()=>refreshEmails(selected.id)}>새로고침</button></div>{emailMessages.length?emailMessages.map(item=><details className="email-history-item" key={item.id}><summary><span>{item.send_number}회차 {item.is_resend?'· 재발송':''}</span><b>{item.subject}</b><Pill tone={item.status==='sent'?'green':item.status==='failed'?'red':'amber'}>{item.status==='sent'?'발송 접수':item.status==='failed'?'실패':'발송 중'}</Pill><time>{new Date(item.sent_at||item.created_at).toLocaleString('ko-KR')}</time></summary><div><p>받는 사람: {item.recipient}</p><pre>{item.body}</pre>{item.error_message&&<p className="error-text">{item.error_message}</p>}</div></details>):<p className="fine-print">아직 발송 내역이 없습니다.</p>}</section></section>}{admin && selected.notes && <div className="summary-box company-note-full"><b>특이사항</b><p>{selected.notes}</p></div>}{admin && selected.intween_notes && <div className="summary-box company-note-full"><b>인트윈 확인사항</b><p>{selected.intween_notes}</p></div>}{admin && Object.keys(selected.source_payload||{}).length>0 && <details className="source-data"><summary>원본 시트 항목 모두 보기 ({Object.keys(selected.source_payload).length})</summary><dl>{Object.entries(selected.source_payload).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{String(value??'')||'—'}</dd></div>)}</dl></details>}{selected.business_summary && <div className="summary-box"><b>경영체 개요</b><p>{selected.business_summary}</p></div>}
        <div className="section-head compact"><div><h3>상담·방문 회차</h3><p>진단 1회 · 컨설팅 최대 3회. 기존 4회차 기록은 보존하며 조회·수정할 수 있습니다.</p></div><button className="text-button" disabled={detailBusy || mutationBusy} onClick={() => refreshDetail(selected.id)}>회차 새로고침</button></div>
        {editor && <form className="session-form" onSubmit={addSession}><label className="sr-only" htmlFor="new-session-kind">상담 유형</label><select id="new-session-kind" value={sessionForm.kind} onChange={event => setSessionForm({ ...sessionForm, kind: event.target.value, round_number: 1 })}><option value="diagnosis">기업 진단</option><option value="consulting">맞춤형 컨설팅</option></select><label className="sr-only" htmlFor="new-session-round">등록 회차</label><select id="new-session-round" value={sessionForm.round_number} onChange={event => setSessionForm({ ...sessionForm, round_number: Number(event.target.value) })}>{(sessionForm.kind === 'diagnosis' ? [1] : [1, 2, 3]).map(value => <option key={value} value={value}>{value}회</option>)}</select><label className="sr-only" htmlFor="new-session-date">방문 가능일</label><input id="new-session-date" type="date" value={sessionForm.scheduled_on} onChange={event => setSessionForm({ ...sessionForm, scheduled_on: event.target.value })}/><label className="sr-only" htmlFor="new-session-time">방문 시간</label><input id="new-session-time" type="time" value={sessionForm.scheduled_time} onChange={event => setSessionForm({ ...sessionForm, scheduled_time: event.target.value })}/><button className="primary" disabled={mutationBusy || detailBusy || loadedCompany !== selected.id}>새 회차 등록</button></form>}
        {detailBusy && <p role="status">회차와 변경 이력을 불러오는 중입니다.</p>}<div className="session-list">{currentSessions.map(item => <SessionCard key={item.id} item={item} editor={editor} admin={admin} address={selected.address||''} busy={mutationBusy || detailBusy} departureBase={!!capabilities.departureBase} onSave={patch => updateSession(item, patch)} onUpload={file => uploadSessionReport(item,file)} onDownload={() => downloadSessionReport(item)} onRemove={() => removeSession(item)}/>)}{!detailBusy && !currentSessions.length && <div className="empty-state">등록된 회차가 없습니다.</div>}</div>
        <div className="alert info">보고서 파일 업로드·Storage 연결은 아직 활성화하지 않았습니다. 아래 상태는 업무 보고 상태 기록이며 실제 파일 제출을 대신하지 않습니다. 메모에는 이름·연락처·주소·개인이메일을 입력하지 마세요.</div>
      </section><aside><section className="surface detail-aside"><h3>진행 정보</h3><div className="status-block"><span>진행 상태</span><Pill tone="status">{selected.status || '상태 미기재'}</Pill></div><div className="status-block"><span>발표 일정</span><b>{selected.presentation_date || '미정'}</b></div><div className="status-block"><span>접수일</span><b>{selected.intake_date || '미기재'}</b></div><div className="status-block"><span>보고 확인 필요</span><b>{currentSessions.length ? `${missingReports.length}회차` : '회차 없음'}</b></div>{missingReports.length > 0 && <ul className="missing-list">{missingReports.map(item => <li key={item.id}>{sessionLabel(item)} · {item.report_status || '미제출'}</li>)}</ul>}</section>
        {admin && <section className="surface"><h3>서버 감사 이력</h3><p className="fine-print">이벤트 종류·시각만 표시합니다. 회사·회차 원문과 개인 식별정보를 표시하지 않습니다.</p>{auditMessage && <p className="alert info">{auditMessage}</p>}{audits.length ? <ol className="audit-list">{audits.map(item => <li key={item.id}><b>{auditActions[item.action] || '업무 변경'}</b><span>{item.entity_type === 'consultation_sessions' ? '상담 회차' : item.entity_type === 'companies' ? '경영체 업무정보' : '업무 기록'}</span><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString('ko-KR')}</time></li>)}</ol> : !detailBusy && <p className="empty-state">조회된 감사 이벤트가 없습니다. DB 감사 트리거 적용 여부는 관리자가 확인해야 합니다.</p>}</section>}</aside></div>}
      {section === 'detail' && !selected && <section className="surface empty-state">조회 가능한 경영체가 없습니다.</section>}
      {section === 'import' && (admin || pseudoMode === 'user') && <ImportPanel session={serviceSession} companies={companies} onDone={refresh}/>}
      {section === 'ir' && admin && <IRCalendarView companies={companies} month={irMonth} onMonthChange={setIrMonth} onPick={pick}/>}
      {section === 'assign' && <AssignmentView sessions={allSessions} companies={companies} peopleById={peopleById} loading={sessionsBusy || busy} error={sessionsError} onPick={pick}/>}
      {section === 'reports' && <ReportsView sessions={allSessions} companies={companies} peopleById={peopleById} loading={sessionsBusy || busy} error={sessionsError} onPick={pick}/>}
      {section === 'review' && <ReviewView sessions={allSessions} companies={companies} peopleById={peopleById} loading={sessionsBusy || busy} error={sessionsError} onPick={pick}/>}
      {section === 'settlement' && <SettlementView sessions={allSessions} companies={companies} loading={sessionsBusy || busy} error={sessionsError} onPick={pick}/>}
      {section === 'users' && admin && <section className="surface"><div className="section-head"><div><h2>계정 승인·권한</h2><p>승인과 활성 상태를 확인한 뒤 역할·유형·업무 범위를 지정하세요. 로그인 이메일과 개인 식별정보는 표시하지 않습니다.</p></div></div><div className="alert info">소유자(host) 권한은 host만 지정할 수 있습니다. 관리자 자신과 소유자 계정의 권한 보호는 서버에서도 검사합니다.</div><div className="table-wrap"><table><caption className="sr-only">업무 계정별 승인·역할·배정 범위</caption><thead><tr><th scope="col">업무 계정</th><th scope="col">역할·유형</th><th scope="col">소속 경영체</th><th scope="col">승인·활성</th></tr></thead><tbody>{people.map((person, index) => { const protectedAccount = (!host && person.role === 'host') || (person.id === profile.id); return <tr key={person.id}><td><b>업무 계정 {index + 1}</b><small>{person.display_name || '업무 표시명 미설정'}</small></td><td><select aria-label={`업무 계정 ${index + 1} 역할`} value={person.role} disabled={protectedAccount || mutationBusy} onChange={event => updatePerson(person, { role: event.target.value })}>{host && <option value="host">소유자(host)</option>}<option value="admin">관리자</option><option value="user">사용자</option>{!host && person.role === 'host' && <option value="host">소유자(host)</option>}</select><select aria-label={`업무 계정 ${index + 1} 유형`} value={person.user_kind || 'client'} disabled={protectedAccount || mutationBusy} onChange={event => updatePerson(person, { user_kind: event.target.value })}><option value="consultant">컨설턴트</option><option value="client">경영체</option></select></td><td><select aria-label={`업무 계정 ${index + 1} 경영체`} value={person.company_id || ''} disabled={protectedAccount || mutationBusy} onChange={event => updatePerson(person, { company_id: event.target.value || null })}><option value="">미배정</option>{companies.map(company => <option key={company.id} value={company.id}>{company.business_name}</option>)}</select></td><td><div className="user-status-actions"><button className={`toggle ${person.approved ? 'on' : ''}`} disabled={protectedAccount || mutationBusy} onClick={() => updatePerson(person, { approved: !person.approved })}>{person.approved ? '승인됨' : '승인 대기'}</button><button className={`toggle ${person.active ? 'on' : ''}`} disabled={protectedAccount || mutationBusy} onClick={() => updatePerson(person, { active: !person.active })}>{person.active ? '활성' : '중지'}</button></div></td></tr>; })}</tbody></table>{!people.length && <div className="empty-state">조회할 업무 계정이 없습니다.</div>}</div></section>}
      {editing && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !mutationBusy) setEditing(null); }}><form className="edit-modal" role="dialog" aria-modal="true" aria-labelledby="company-edit-title" onSubmit={saveCompany}><div className="section-head"><div><span className="eyebrow">COMPANY WORKFLOW</span><h2 id="company-edit-title">{editing === 'new' ? '경영체 추가' : '업무정보 수정'}</h2></div><button type="button" className="icon-button" aria-label="편집 닫기" disabled={mutationBusy} onClick={() => setEditing(null)}>×</button></div><p className="fine-print">업로드 내역의 담당자·대표자 연락처, 주소, 특이사항을 저장합니다. 생년은 연도만 입력하며 주민등록번호는 저장하지 않습니다.</p><div className="form-grid"><label>경영체명 *<input required maxLength={200} value={form.business_name} onBlur={fillKnownAddressOnBlur} onChange={event => setForm({ ...form, business_name: event.target.value })}/></label><label>사업자번호<input inputMode="numeric" maxLength={14} placeholder="000-00-00000" value={form.business_registration_number} onBlur={fillKnownAddressOnBlur} onChange={event => setForm({ ...form, business_registration_number: event.target.value })}/></label><label>설립연도<input inputMode="numeric" maxLength={4} placeholder="예: 2018" value={form.founded_year} onChange={event => setForm({ ...form, founded_year: event.target.value })}/></label><label>테마<input maxLength={100} value={form.theme} onChange={event => setForm({ ...form, theme: event.target.value })}/></label><label>진행연도<input type="number" min="2000" max="2100" value={form.program_year} onChange={event => setForm({ ...form, program_year: event.target.value })}/></label><label>발표 일정<input maxLength={100} value={form.presentation_date} onChange={event => setForm({ ...form, presentation_date: event.target.value })}/></label><label>IR 예정 일시<input type="datetime-local" value={form.ir_scheduled_at||''} onChange={event => setForm({ ...form, ir_scheduled_at: event.target.value })}/></label><label>진행 상태<select value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}>{!statusOptions.includes(form.status) && <option>{form.status}</option>}{statusOptions.map(value => <option key={value}>{value}</option>)}</select></label><label>담당 컨설턴트<select value={form.assigned_consultant_id} onChange={event => setForm({ ...form, assigned_consultant_id: event.target.value })}><option value="">미배정</option>{people.filter(person => person.role === 'user' && person.user_kind === 'consultant' && person.approved && person.active).map((person, index) => <option value={person.id} key={person.id}>{person.display_name || `컨설턴트 ${index + 1}`}</option>)}</select></label><label>협조도<input maxLength={100} value={form.cooperation_level} onChange={event => setForm({ ...form, cooperation_level: event.target.value })}/></label><label>회사 보고 상태<select value={form.report_status} onChange={event => setForm({ ...form, report_status: event.target.value })}>{!REPORT_STATUSES.includes(form.report_status) && <option>{form.report_status}</option>}{REPORT_STATUSES.map(value => <option key={value}>{value}</option>)}</select></label><label className="checkbox-label"><input type="checkbox" checked={form.ir_direct} onChange={event => setForm({ ...form, ir_direct: event.target.checked })}/>IR 직행 태그 (진행 상태와 별개)</label><label>대표자 이름<input maxLength={200} value={form.representative_name} onChange={event => setForm({ ...form, representative_name: event.target.value })}/></label><label>대표자 연락처<input maxLength={80} value={form.representative_phone} onChange={event => setForm({ ...form, representative_phone: event.target.value })}/></label><label>대표자 이메일<input type="email" maxLength={240} value={form.representative_email} onChange={event => setForm({ ...form, representative_email: event.target.value })}/></label><label>대표자 생년(연도)<input inputMode="numeric" maxLength={4} value={form.representative_birth_year} onChange={event => setForm({ ...form, representative_birth_year: event.target.value })}/></label><label>성별<input maxLength={30} value={form.representative_gender} onChange={event => setForm({ ...form, representative_gender: event.target.value })}/></label><label>담당자 이름<input maxLength={200} value={form.contact_name} onChange={event => setForm({ ...form, contact_name: event.target.value })}/></label><label>담당자 연락처<input maxLength={80} value={form.contact_phone} onChange={event => setForm({ ...form, contact_phone: event.target.value })}/></label><label>담당자 이메일<input type="email" maxLength={240} value={form.contact_email} onChange={event => setForm({ ...form, contact_email: event.target.value })}/></label><div className="span-two address-form-row"><label>사업장 주소<input maxLength={500} value={form.address} onChange={event => setForm({ ...form, address: event.target.value,address_verification:'확인 필요' })}/></label><button type="button" onClick={copyKnownAddress}>기존 주소 불러오기</button><button type="button" onClick={lookupAddress}>주소 검색</button></div><label>주소 확인<select value={form.address_verification} onChange={event => setForm({ ...form, address_verification: event.target.value })}><option>미확인</option><option>확인 필요</option><option>확인 완료</option><option>잠금</option></select></label><label>재도전<input maxLength={100} value={form.reapplicant || ''} onChange={event => setForm({ ...form, reapplicant: event.target.value })}/></label><label>특이사항<textarea maxLength={4000} rows={2} value={form.notes || ''} onChange={event => setForm({ ...form, notes: event.target.value })}/></label><label>인트윈 확인사항<textarea maxLength={4000} rows={2} value={form.intween_notes || ''} onChange={event => setForm({ ...form, intween_notes: event.target.value })}/></label><label className="span-two">경영체 업무 개요<textarea maxLength={4000} rows={3} value={form.business_summary} onChange={event => setForm({ ...form, business_summary: event.target.value })}/></label></div><div className="modal-actions"><button type="button" disabled={mutationBusy} onClick={() => setEditing(null)}>취소</button><button className="primary" disabled={mutationBusy}>{mutationBusy ? '저장 중…' : '저장'}</button></div></form></div>}
      {emailComposeOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!emailSending)setEmailComposeOpen(false);}}><form className="edit-modal email-compose" role="dialog" aria-modal="true" aria-labelledby="email-compose-title" onSubmit={sendCompanyEmail}><div className="section-head"><div><span className="eyebrow">COMPANY COMMUNICATION</span><h2 id="email-compose-title">{selected?.business_name} 메일 보내기</h2></div><button type="button" className="icon-button" disabled={emailSending} onClick={()=>setEmailComposeOpen(false)}>×</button></div><p className="fine-print">메일은 플랫폼에서 발송되고 시간·횟수·본문이 발송 내역에 저장됩니다. 두 번째 발송부터 제목과 본문에 재발송 표시가 붙습니다.</p><div className="form-grid"><label className="span-two">받는 사람<input required type="email" maxLength={240} value={emailDraft.recipient} onChange={event=>setEmailDraft({...emailDraft,recipient:event.target.value})}/></label><label className="span-two">제목<input required maxLength={300} value={emailDraft.subject} onChange={event=>setEmailDraft({...emailDraft,subject:event.target.value})}/></label><label className="span-two">본문<textarea required rows={9} maxLength={8000} value={emailDraft.body} onChange={event=>setEmailDraft({...emailDraft,body:event.target.value})}/></label><label className="checkbox-label span-two"><input type="checkbox" checked={emailDraft.replyToPrevious} onChange={event=>setEmailDraft({...emailDraft,replyToPrevious:event.target.checked})}/> 가능하면 이전 메일 대화에 이어 보내기</label></div><div className="modal-actions"><button type="button" disabled={emailSending} onClick={()=>setEmailComposeOpen(false)}>취소</button><button className="primary" disabled={emailSending}>{emailSending?'발송 중…':'메일 보내기'}</button></div></form></div>}
      <footer className="app-footer">인트윈 · 농금원 투자 전 지원사업 <span>서버 인증·역할/배정 검사와 Supabase RLS를 함께 사용합니다.</span></footer>
    </div></main></div>;
}
const NAV = [['overview', '◫', '대시보드', false], ['import', '⇪', '엑셀 업로드', true], ['companies', '▦', '기업 목록', false], ['ir', '◷', 'IR 캘린더', true], ['assign', '☰', '배정·방문 순서', false], ['reports', '✓', '보고 현황', false], ['review', '✎', '검수 의견', false], ['settlement', '₩', '보고·정산', false], ['users', '♙', '계정 및 권한', true]];
function Navigation({ section, setSection, admin, pseudoImport = false }) { return <>{NAV.filter(([id, , , adminOnly]) => admin || !adminOnly || (pseudoImport && id === 'import')).map(([id, icon, label]) => { const current = section === id || (id === 'companies' && section === 'detail'); return <button key={id} className={`side-link ${current ? 'selected' : ''}`} aria-current={current ? 'page' : undefined} onClick={() => setSection(id)}><span>{icon}</span>{!admin && id === 'overview' ? '내 업무' : !admin && id === 'companies' ? '내 배정 기업' : label}</button>; })}</>; }
function Stat({ label, value, note }) { return <div className="stat-card"><span>{label}</span><strong>{value}<small>개</small></strong><small className="stat-foot">{note}</small></div>; }
function toLocalDateTime(value){if(!value)return '';const date=new Date(value);if(Number.isNaN(date.getTime()))return '';const local=new Date(date.getTime()-date.getTimezoneOffset()*60000);return local.toISOString().slice(0,16);}
function IRCalendarView({companies,month,onMonthChange,onPick}){const grouped=companies.filter(c=>c.ir_scheduled_at).sort((a,b)=>new Date(a.ir_scheduled_at)-new Date(b.ir_scheduled_at));const inMonth=grouped.filter(c=>String(c.ir_scheduled_at).slice(0,7)===month);return <section className="surface ir-calendar"><div className="section-head"><div><h2>IR 일정 캘린더</h2><p>확정 상태와 예정 일시를 확인하고 기업 상세에서 변경합니다.</p></div><label>월 선택<input type="month" value={month} onChange={e=>onMonthChange(e.target.value)}/></label></div><div className="ir-calendar-grid">{inMonth.length?inMonth.map(company=><article className="ir-calendar-item" key={company.id}><time dateTime={company.ir_scheduled_at}>{new Date(company.ir_scheduled_at).toLocaleString('ko-KR',{dateStyle:'medium',timeStyle:'short'})}</time><b>{company.business_name}</b><span>{company.assigned_consultant_id?'담당 배정됨':'담당 미배정'}</span><Pill tone={company.ir_confirmed?'green':'amber'}>{company.ir_confirmed?'IR 확정':'일정 예정'}</Pill><button type="button" className="text-button" onClick={()=>onPick(company)}>기업 상세 →</button></article>):<div className="empty-state">선택한 달에 등록된 IR 일정이 없습니다. 기업 상세에서 IR 예정 일시를 추가하세요.</div>}</div><p className="fine-print">표시는 저장된 일정만 사용합니다. 일정 최적화나 자동 경로 계산은 하지 않습니다.</p></section>;}
function Fact({ label, value }) { return <div className="fact"><span>{label}</span><b>{value || '미기재'}</b></div>; }
const statusTone = status => /완료|제출/.test(status || '') ? 'green' : /대기|미배정|미기재/.test(status || '') ? 'amber' : /진행|검토|작성/.test(status || '') ? 'blue' : '';
const reportTone = status => status === '제출 완료' ? 'green' : status === '미제출' ? 'amber' : status ? 'blue' : '';
function CompanyTable({ rows, peopleById, onPick, empty, intakeName = '접수일', admin = false, startIndex = 1 }) {
  return <div className="table-wrap"><table className="company-table"><caption className="sr-only">기업별 진행 상태와 배정 현황</caption><thead><tr><th scope="col">순번</th><th scope="col">기업명</th><th scope="col">사업자번호</th><th scope="col">설립연도</th><th scope="col">구분</th><th scope="col">상태</th><th scope="col">담당 컨설턴트</th><th scope="col">{intakeName}</th>{admin && <><th scope="col">특이사항</th><th scope="col">인트윈 확인사항</th><th scope="col">등록자·시각</th></>}<th scope="col">상세</th></tr></thead><tbody>{rows.map((company,index)=>{const isNew=company.created_at&&Date.now()-new Date(company.created_at).getTime()<86400000;return <tr key={company.id}><td className="num">{startIndex+index}</td><td><b>{company.business_name}</b>{company.program_year&&<small>{company.program_year}년 사업</small>}{isNew&&<span className="new-company-dot" aria-label="24시간 이내 신규 등록" title="24시간 이내 신규 등록"/>}{/포기/.test(company.status||'')&&<Pill tone="red">포기</Pill>}{/재도전|^(o|y|true|1|예)$/i.test(company.reapplicant||'')&&<Pill tone="blue">재도전</Pill>}</td><td className="num">{company.business_registration_number||'—'}</td><td className="num">{company.founded_year||'—'}</td><td><Pill tone={company.ir_direct?'blue':''}>{company.ir_direct?'IR 직행':'컨설팅'}</Pill>{company.ir_confirmed&&<Pill tone="green">IR 확정</Pill>}</td><td><Pill tone={statusTone(company.status)}>{company.status||'상태 미기재'}</Pill></td><td>{peopleById[company.assigned_consultant_id]?.display_name||(company.assigned_consultant_id?'배정됨':'미배정')}</td><td className="num">{company.intake_date||'—'}</td>{admin&&<><td className="notes-col">{company.notes?<span className="note-tooltip" tabIndex={0} role="note" aria-label={`특이사항: ${company.notes}`} data-note={company.notes}>{company.notes}</span>:'—'}</td><td className="notes-col">{company.intween_notes?<span className="note-tooltip" tabIndex={0} role="note" aria-label={`인트윈 확인사항: ${company.intween_notes}`} data-note={company.intween_notes}>{company.intween_notes}</span>:'—'}</td><td className="registered-cell"><b className={isNew?'new-importer':''}>{company.imported_by||'이력 없음'}</b><small>{company.imported_at?new Date(company.imported_at).toLocaleString('ko-KR'):'—'}</small></td></>}<td><button className="row-arrow" aria-label={`${company.business_name} 상세 보기`} onClick={()=>onPick(company)}>→</button></td></tr>;})}</tbody></table>{empty&&!rows.length&&<div className="empty-state">기업이 없습니다. 검색어와 필터를 확인하세요.</div>}</div>;
}
function SessionCard({ item, editor, admin, address='', busy, departureBase, onSave, onUpload, onDownload, onRemove }) {
  const [draft, setDraft] = useState({ scheduled_on: item.scheduled_on || '', scheduled_time:item.scheduled_time||'', appointment_confirmed:!!item.appointment_confirmed, remote: !!item.remote, report_status: item.report_status || '미제출', report_note: item.report_note || '', departure_base: item.departure_base || '' });
  useEffect(() => { setDraft({ scheduled_on: item.scheduled_on || '', scheduled_time:item.scheduled_time||'', appointment_confirmed:!!item.appointment_confirmed, remote: !!item.remote, report_status: item.report_status || '미제출', report_note: item.report_note || '', departure_base: item.departure_base || '' }); }, [item]);
  const label = sessionLabel(item);
  const dirty = ['scheduled_on', 'scheduled_time', 'appointment_confirmed', 'report_status', 'report_note'].some(key => draft[key] !== (item[key] || (key === 'report_status' ? '미제출' : ''))) || draft.remote !== !!item.remote || (departureBase && draft.departure_base !== (item.departure_base || ''));
  async function save(event) {
    event.preventDefault();
    const patch = { scheduled_on: draft.scheduled_on || null, scheduled_time:draft.scheduled_time||null, appointment_confirmed:draft.appointment_confirmed, remote: draft.remote, report_status: draft.report_status, report_note: draft.report_note };
    if (departureBase) patch.departure_base = draft.departure_base;
    await onSave(patch);
  }
  return <form className="session-card" onSubmit={save}><div className="session-card-head"><strong>{label}</strong><Pill tone={draft.report_status === '제출 완료' ? 'green' : 'amber'}>{draft.report_status}</Pill>{Number(item.round_number) > 3 && <small>기존 회차 보존</small>}</div><div className="session-edit-grid"><label>방문 가능일<input aria-label={`${label} 방문 가능일`} type="date" value={draft.scheduled_on} disabled={!editor || busy} onChange={event => setDraft({ ...draft, scheduled_on: event.target.value })}/></label><label>방문 시간<input aria-label={`${label} 방문 시간`} type="time" value={draft.scheduled_time} disabled={!editor||busy} onChange={event=>setDraft({...draft,scheduled_time:event.target.value})}/></label><label className="checkbox-label"><input type="checkbox" checked={draft.appointment_confirmed} disabled={!editor||busy} onChange={event=>setDraft({...draft,appointment_confirmed:event.target.checked})}/>방문 일정 확정 (관리자에게 공유)</label><label>보고 상태<select aria-label={`${label} 보고 상태`} value={draft.report_status} disabled={!editor || busy} onChange={event => setDraft({ ...draft, report_status: event.target.value })}>{!REPORT_STATUSES.includes(draft.report_status) && <option>{draft.report_status}</option>}{REPORT_STATUSES.map(value => <option key={value}>{value}</option>)}</select></label><label className="checkbox-label"><input type="checkbox" checked={draft.remote} disabled={!editor || busy} onChange={event => setDraft({ ...draft, remote: event.target.checked })}/>비대면 상담</label><label>출발 거점 코드<input maxLength={80} value={draft.departure_base} disabled={!editor || busy || !departureBase} placeholder={departureBase ? '개인 주소 대신 업무 거점 코드' : '추가 스키마 승인·적용 대기'} onChange={event => setDraft({ ...draft, departure_base: event.target.value })}/></label>{address&&<div className="span-two map-link-row"><a href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(draft.departure_base||'')}&destination=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer">Google 지도 경로 열기 ↗</a><small>현재 출발 거점 또는 저장된 주소를 사용합니다. 경로 최적화는 하지 않습니다.</small></div>}<label>회차 보고서<input type="file" accept=".pdf,.hwp,.hwpx,.doc,.docx,.xls,.xlsx" disabled={!editor||busy} onChange={event=>{const file=event.target.files?.[0];if(file)onUpload(file);event.target.value="";}}/></label>{item.report_file_name&&<div className="report-file-row"><span>{item.report_file_name} · {item.report_file_size?Math.round(item.report_file_size/1024/1024*10)/10+"MB":""} · {item.report_file_uploaded_at?new Date(item.report_file_uploaded_at).toLocaleString("ko-KR"):""}</span><button type="button" className="text-button" onClick={onDownload}>다운로드</button></div>}<label className="span-two">업무 보고 메모<textarea maxLength={4000} rows={2} value={draft.report_note} disabled={!editor || busy} placeholder="회차 진행 내용만 입력. 개인정보 금지" onChange={event => setDraft({ ...draft, report_note: event.target.value })}/></label></div><div className="session-card-actions">{editor && <button className="primary" disabled={busy || !dirty}>변경 저장</button>}{admin && <button type="button" className="danger-button" disabled={busy} onClick={onRemove}>회차 삭제</button>}</div></form>;
}
