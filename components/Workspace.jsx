'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../modules/api';
import { filterCompanies, intakeLabel, intakeOptions } from '../modules/companyFilters';
import { buildCompanyXlsx, downloadBlob, resolveRange } from '../modules/exportXlsx';
import { canEditSessions, isAdmin, REPORT_STATUSES, sessionError, sessionLabel } from '../modules/workflow';

const blank = { business_name: '', theme: '', presentation_date: '', program_year: String(new Date().getFullYear()), business_summary: '', assigned_consultant_id: '', status: '배정 대기', cooperation_level: '', report_status: '미제출', ir_direct: false };
const roleLabels = { host: '소유자(host)', admin: '관리자', user: '사용자' };
const PAGE_SIZES = [10, 20, 30, 40, 50, 'all'];
const SORTS = { name: ['경영체명', c => c.business_name], theme: ['테마', c => c.theme], year: ['사업연도', c => c.program_year], status: ['진행 상태', c => c.status], report: ['보고 상태', c => c.report_status] };
const statusOptions = ['배정 대기', '진단 대기', '컨설팅 진행', '보고서 검토', '완료'];
const auditActions = { INSERT: '생성', UPDATE: '수정', DELETE: '삭제', insert: '생성', update: '수정', delete: '삭제' };
function Pill({ children, tone = '' }) { return <span className={`pill ${tone}`}>{children}</span>; }

export default function Workspace({ session, profile, onSignOut, capabilities = {} }) {
  const admin = isAdmin(profile), host = profile.role === 'host', editor = canEditSessions(profile);
  const [section, setSection] = useState('overview');
  const [companies, setCompanies] = useState([]), [people, setPeople] = useState([]), [selectedId, setSelectedId] = useState('');
  const [sessions, setSessions] = useState([]), [audits, setAudits] = useState([]), [loadedCompany, setLoadedCompany] = useState('');
  const [search, setSearch] = useState(''), [searchDraft, setSearchDraft] = useState(''), [theme, setTheme] = useState('전체'), [directOnly, setDirectOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState('전체'), [consultantFilter, setConsultantFilter] = useState('전체'), [intakeFilter, setIntakeFilter] = useState('전체');
  const [busy, setBusy] = useState(true), [mutationBusy, setMutationBusy] = useState(false), [detailBusy, setDetailBusy] = useState(false);
  const [error, setError] = useState(''), [toast, setToast] = useState(''), [auditMessage, setAuditMessage] = useState('');
  const [editing, setEditing] = useState(null), [form, setForm] = useState(blank);
  const [sessionForm, setSessionForm] = useState({ kind: 'consulting', round_number: 1, scheduled_on: '' });
  const [pageSize, setPageSize] = useState(10), [page, setPage] = useState(1), [sortKey, setSortKey] = useState('name'), [sortDir, setSortDir] = useState('asc');
  const [rangeStart, setRangeStart] = useState(''), [rangeEnd, setRangeEnd] = useState('');
  const [exportState, setExportState] = useState(null), [exportError, setExportError] = useState('');
  const detailSequence = useRef(0), mutationLock = useRef(false);
  const peopleById = useMemo(() => Object.fromEntries(people.map(person => [person.id, person])), [people]);
  const selected = companies.find(company => company.id === selectedId) || companies[0];
  const visible = useMemo(() => filterCompanies(companies, { search, theme, status: statusFilter, consultant: consultantFilter, intake: intakeFilter, directOnly }), [companies, search, theme, statusFilter, consultantFilter, intakeFilter, directOnly]);
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
  useEffect(() => { setPage(1); }, [search, theme, statusFilter, consultantFilter, intakeFilter, directOnly, sortKey, sortDir, pageSize]);
  const statuses = useMemo(() => ['전체', ...new Set(companies.map(company => company.status).filter(Boolean))], [companies]);
  const intakeName = useMemo(() => intakeLabel(companies), [companies]);
  const intakes = useMemo(() => ['전체', ...intakeOptions(companies)], [companies]);
  const consultants = useMemo(() => admin ? [...new Set(companies.map(company => company.assigned_consultant_id).filter(Boolean))].filter(id => peopleById[id]).map(id => ({ id, name: peopleById[id].display_name || '업무 담당자' })) : [], [companies, peopleById, admin]);
  const hasUnassigned = useMemo(() => admin && companies.some(company => !company.assigned_consultant_id), [companies, admin]);
  const filtersActive = !!(search || theme !== '전체' || statusFilter !== '전체' || consultantFilter !== '전체' || intakeFilter !== '전체' || directOnly);
  function resetFilters() { setSearch(''); setSearchDraft(''); setTheme('전체'); setStatusFilter('전체'); setConsultantFilter('전체'); setIntakeFilter('전체'); setDirectOnly(false); }
  const themes = useMemo(() => ['전체', ...new Set(companies.map(company => company.theme).filter(Boolean))], [companies]);
  const currentSessions = loadedCompany === selected?.id ? sessions : [];
  const missingReports = currentSessions.filter(item => item.report_status !== '제출 완료');
  const stats = useMemo(() => ({ total: companies.length, waiting: companies.filter(company => /대기|미배정|미기재/.test(company.status || '')).length, consulting: companies.filter(company => /진행/.test(company.status || '')).length, done: companies.filter(company => /완료|제출/.test(company.status || '')).length }), [companies]);

  const refresh = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const [nextCompanies, nextPeople] = await Promise.all([apiRequest(session, '/companies'), admin ? apiRequest(session, '/profiles') : Promise.resolve([])]);
      setCompanies(nextCompanies || []); setPeople(nextPeople || []);
      setSelectedId(id => nextCompanies?.some(company => company.id === id) ? id : nextCompanies?.[0]?.id || '');
    } catch (problem) { setError(problem.message); }
    finally { setBusy(false); }
  }, [session, admin]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);

  const refreshDetail = useCallback(async (companyId, signal) => {
    const sequence = ++detailSequence.current;
    setDetailBusy(true); setAudits([]); setAuditMessage('');
    try {
      const nextSessions = await apiRequest(session, `/companies/${companyId}/sessions`, { signal });
      if (sequence !== detailSequence.current || signal?.aborted) return;
      setSessions(nextSessions || []); setLoadedCompany(companyId);
      if (admin && capabilities.audit !== false) {
        try {
          const nextAudits = await apiRequest(session, `/audit?company_id=${encodeURIComponent(companyId)}`, { signal });
          if (sequence === detailSequence.current && !signal?.aborted) setAudits(nextAudits || []);
        } catch (problem) { if (problem.name !== 'AbortError' && sequence === detailSequence.current) setAuditMessage(problem.message); }
      }
    } catch (problem) { if (problem.name !== 'AbortError' && sequence === detailSequence.current) { setSessions([]); setLoadedCompany(''); setError(problem.message); } }
    finally { if (sequence === detailSequence.current) setDetailBusy(false); }
  }, [session, admin, capabilities.audit]);
  useEffect(() => {
    if (!selected?.id) { setSessions([]); setLoadedCompany(''); return; }
    const controller = new AbortController();
    refreshDetail(selected.id, controller.signal);
    return () => { controller.abort(); ++detailSequence.current; };
  }, [selected?.id, refreshDetail]);

  async function mutate(action, success) {
    if (mutationLock.current) return false;
    mutationLock.current = true; setMutationBusy(true); setError('');
    try { await action(); setToast(success); return true; }
    catch (problem) { setError(problem.message); return false; }
    finally { mutationLock.current = false; setMutationBusy(false); }
  }
  function pick(company) { setSelectedId(company.id); setSection('detail'); setError(''); }
  function startCreate() { if (!admin) return; setForm({ ...blank }); setEditing('new'); }
  function startEdit(company) { if (!admin) return; setForm(Object.fromEntries(Object.keys(blank).map(key => [key, company[key] ?? blank[key]]))); setEditing(company.id); }
  async function exportXlsx() {
    if (exportState) return;
    setExportError('');
    const range = resolveRange(sorted.length, rangeStart, rangeEnd);
    if (range.error) { setExportError(range.error); return; }
    setExportState({ phase: '준비 중', done: 0, total: range.to - range.from + 1 });
    try {
      const blob = await buildCompanyXlsx(sorted, { ...range, resolveConsultant: company => peopleById[company.assigned_consultant_id]?.display_name || (company.assigned_consultant_id ? '배정됨' : '미배정'), onProgress: setExportState });
      downloadBlob(blob, `경영체목록_${new Date().toISOString().slice(0, 10)}_${range.from}-${range.to}.xlsx`);
      setToast(`${(range.to - range.from + 1).toLocaleString()}행을 XLSX로 내보냈습니다.`);
    } catch { setExportError('XLSX 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
    finally { setExportState(null); }
  }
  async function saveCompany(event) {
    event.preventDefault(); if (!admin) return;
    const payload = { ...form, business_name: form.business_name.trim(), program_year: form.program_year ? Number(form.program_year) : null, assigned_consultant_id: form.assigned_consultant_id || null };
    if (!payload.business_name) { setError('경영체명을 입력하세요.'); return; }
    const ok = await mutate(async () => {
      const data = await apiRequest(session, editing === 'new' ? '/companies' : `/companies/${editing}`, { method: editing === 'new' ? 'POST' : 'PATCH', body: payload });
      setEditing(null); setSelectedId(data.id); await refresh();
    }, '경영체 업무정보를 저장했습니다.');
    if (ok) setSection('detail');
  }
  async function removeCompany(company) {
    if (!admin || !window.confirm('경영체 업무정보를 삭제할까요? 연결된 회차가 있으면 서버에서 삭제를 차단합니다.')) return;
    await mutate(async () => { await apiRequest(session, `/companies/${company.id}`, { method: 'DELETE' }); await refresh(); setSection('companies'); }, '경영체 업무정보를 삭제했습니다.');
  }
  async function addSession(event) {
    event.preventDefault(); if (!selected || !editor || loadedCompany !== selected.id) return;
    const problem = sessionError(sessionForm, currentSessions);
    if (problem) { setError(problem); return; }
    await mutate(async () => {
      await apiRequest(session, `/companies/${selected.id}/sessions`, { method: 'POST', body: { kind: sessionForm.kind, round_number: Number(sessionForm.round_number), scheduled_on: sessionForm.scheduled_on || null } });
      setSessionForm({ kind: 'consulting', round_number: 1, scheduled_on: '' }); await refreshDetail(selected.id);
    }, '새 상담 회차를 등록했습니다. 기존 회차는 덮어쓰지 않았습니다.');
  }
  async function updateSession(item, patch) {
    if (!editor || !selected || loadedCompany !== selected.id) return;
    return mutate(async () => {
      await apiRequest(session, `/sessions/${item.id}`, { method: 'PATCH', body: patch });
      await refreshDetail(selected.id);
    }, '방문 일정과 보고 상태를 저장했습니다.');
  }
  async function removeSession(item) {
    if (!admin || !window.confirm('이 상담 회차를 삭제할까요? 되돌리려면 관리자의 데이터 복원이 필요합니다.')) return;
    await mutate(async () => { await apiRequest(session, `/sessions/${item.id}`, { method: 'DELETE' }); await refreshDetail(selected.id); }, '상담 회차를 삭제했습니다.');
  }
  async function updatePerson(person, patch) {
    if (!admin || (person.role === 'host' && !host)) return;
    await mutate(async () => {
      await apiRequest(session, `/profiles/${person.id}`, { method: 'PATCH', body: patch });
      setPeople(await apiRequest(session, '/profiles') || []);
    }, '계정의 승인·권한 설정을 저장했습니다.');
  }
  const title = section === 'overview' ? (admin ? '사업 현황' : '내 배정 업무') : section === 'companies' ? '경영체 관리' : section === 'users' ? '계정 및 권한' : '경영체 상세';

  return <div className="app-shell"><a className="skip-link" href="#workspace-content">본문으로 이동</a><aside className="sidebar"><a className="logo" href="#overview" onClick={() => setSection('overview')}><span className="brand-mark small-mark">i</span><span><strong>intween</strong><small>AGRI PROGRAM</small></span></a><div className="side-caption">WORKSPACE</div><Navigation section={section} setSection={setSection} admin={admin} /><div className="sidebar-bottom"><span className="user-avatar">U</span><div className="user-meta"><b>업무 계정</b><small>{roleLabels[profile.role]}{profile.role === 'user' ? ` · ${profile.user_kind === 'consultant' ? '컨설턴트' : '경영체'}` : ''}</small></div><button className="icon-button" aria-label="로그아웃" onClick={onSignOut}>↗</button></div></aside>
    <main className="workspace-main" id="workspace-content"><header className="topbar"><div className="crumb">업무공간 <span>/</span> {title}</div><div className="top-actions"><button className="text-button" onClick={refresh} disabled={busy || mutationBusy}>새로고침</button><Pill>{roleLabels[profile.role]}</Pill><button className="text-button mobile-signout" onClick={onSignOut}>로그아웃</button></div></header><div className="mobile-nav"><Navigation section={section} setSection={setSection} admin={admin}/></div><div className="page-content"><div className="page-heading"><div><span className="eyebrow">AGRI SUPPORT WORKSPACE</span><h1>{title}</h1><p>{admin ? '사업 진행과 회차별 제출 현황을 확인하세요.' : '서버에서 허용된 배정 기업과 회차만 표시합니다.'}</p></div>{admin && section === 'companies' && <button className="primary" disabled={mutationBusy} onClick={startCreate}>＋ 경영체 추가</button>}</div>
      {error && <div className="alert error" role="alert">{error}<button onClick={() => setError('')}>닫기</button></div>}{toast && <div className="toast" role="status">✓ {toast}</div>}
      {section === 'overview' && <><div className="welcome-card"><div><span className="eyebrow light">INTWEEN · AGRI SUPPORT</span><h2>{admin ? '사업 진행 상황을 확인하세요' : '내 배정 기업의 업무를 이어가세요'}</h2><p>개인 연락처·주소·개인이메일을 표시하지 않는 업무 화면입니다.</p><button className="light-button" onClick={() => setSection('companies')}>경영체 목록 보기 <span>→</span></button></div><div className="welcome-art" aria-hidden="true"><div className="art-circle circle-a"/><div className="art-circle circle-b"/><span>農</span></div></div>
        {admin && <><div className="stat-grid"><Stat label="전체 경영체" value={busy ? '—' : stats.total} note="조회 가능한 전체 업무자료"/><Stat label="확인 필요" value={busy ? '—' : stats.waiting} note="배정·진행 상태 확인"/><Stat label="진행 중" value={busy ? '—' : stats.consulting} note="경영체 상태 기준"/><Stat label="완료·제출" value={busy ? '—' : stats.done} note="경영체 상태 기준 / 회차 실적과 별개"/></div><div className="alert info">사업 목표: 진단 90건 · 맞춤형 컨설팅 330건 · IR 15건 · 월 30건 페이스. 아래 현황은 경영체 상태 집계이며 목표 달성 실적을 대신하지 않습니다.</div></>}
        <div className="dashboard-grid"><section className="surface"><div className="section-head"><div><h2>{admin ? '등록 경영체' : '내 배정 기업'}</h2><p>경영체를 선택하면 회차와 방문 일정을 확인합니다.</p></div><button className="text-button" onClick={() => setSection('companies')}>전체 보기 →</button></div><CompanyTable rows={companies.slice(0, 7)} peopleById={peopleById} onPick={pick} empty={!busy} intakeName={intakeName}/></section><aside className="surface quick-panel"><h2>빠른 업무</h2><p>자주 사용하는 업무 메뉴입니다.</p><button className="quick-action" onClick={() => setSection('companies')}><span className="quick-icon">▦</span><span><b>경영체 목록</b><small>배정 기업과 진행 상태</small></span><span className="arrow">→</span></button><button className="quick-action" disabled={!selected} onClick={() => selected && pick(selected)}><span className="quick-icon green">◷</span><span><b>회차별 일정·보고</b><small>방문 가능일과 미제출 상태</small></span><span className="arrow">→</span></button>{admin && <button className="quick-action" onClick={() => setSection('users')}><span className="quick-icon purple">♙</span><span><b>사용자 승인·권한</b><small>승인·활성·업무 범위</small></span><span className="arrow">→</span></button>}<div className="source-note"><span>i</span><p>승인된 업무자료만 사용합니다. 지도·AI·사업자 조회·정산 공급자는 연결하지 않았습니다.</p></div></aside></div></>}
      {section === 'companies' && <div className="company-layout"><section className="surface list-card" aria-busy={busy}><div className="section-head"><div><h2>{admin ? '경영체 목록' : '내 배정 기업'}</h2><p>전체 {companies.length.toLocaleString()}개 · 조회 결과 <b>{sorted.length.toLocaleString()}</b>개</p></div></div>
        <form className="filter-bar" role="search" aria-label="경영체 조회" onSubmit={event => { event.preventDefault(); setSearch(searchDraft); }}>
          <input type="search" className="filter-search" value={searchDraft} onChange={event => setSearchDraft(event.target.value)} placeholder="경영체명·테마·상태 검색" aria-label="경영체 검색"/>
          <select value={theme} onChange={event => setTheme(event.target.value)} aria-label="테마 필터">{themes.map(value => <option key={value} value={value}>{value === '전체' ? '테마 전체' : value}</option>)}</select>
          <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label="진행 상태 필터">{statuses.map(value => <option key={value} value={value}>{value === '전체' ? '상태 전체' : value}</option>)}</select>
          {admin && <select value={consultantFilter} onChange={event => setConsultantFilter(event.target.value)} aria-label="담당자 필터"><option value="전체">담당자 전체</option>{hasUnassigned && <option value="none">미배정</option>}{consultants.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select>}
          {intakes.length > 1 && <select value={intakeFilter} onChange={event => setIntakeFilter(event.target.value)} aria-label={`${intakeName} 필터`}>{intakes.map(value => <option key={value} value={value}>{value === '전체' ? `${intakeName} 전체` : value}</option>)}</select>}
          <button className="primary filter-submit">조회</button><button type="button" className="ghost-button" onClick={resetFilters} disabled={!filtersActive && !searchDraft}>초기화</button>
        </form>
        <div className="list-tools"><button type="button" className={`chip ${directOnly ? 'on' : ''}`} aria-pressed={directOnly} onClick={() => setDirectOnly(!directOnly)}>IR 직행만 보기</button>
          <details className="export-tool"><summary>내보내기 (XLSX)</summary>
            <form className="export-box" onSubmit={event => { event.preventDefault(); exportXlsx(); }}><p>현재 검색·필터·정렬{directOnly ? '·IR 직행' : ''}이 적용된 {sorted.length.toLocaleString()}행이 대상입니다. 행 범위를 비워 두면 전체를 내보냅니다. 연락처·주소·개인이메일·주민번호·생년월일은 포함되지 않습니다.</p><div className="export-fields"><label>시작 행<input type="number" inputMode="numeric" min="1" max={sorted.length || undefined} value={rangeStart} onChange={event => setRangeStart(event.target.value)} placeholder="1" disabled={!!exportState}/></label><label>끝 행<input type="number" inputMode="numeric" min="1" max={sorted.length || undefined} value={rangeEnd} onChange={event => setRangeEnd(event.target.value)} placeholder={sorted.length ? String(sorted.length) : ''} disabled={!!exportState}/></label><button className="primary" disabled={busy || !sorted.length || !!exportState}>{exportState ? '생성 중…' : 'XLSX 내보내기'}</button></div>
              {exportState && <div className="progress-box" role="status"><progress max={exportState.total || 1} value={exportState.done} aria-label="XLSX 생성 진행률"/><span>{exportState.phase} · {exportState.done.toLocaleString()} / {exportState.total.toLocaleString()}행</span></div>}
              {exportError && <div className="alert error" role="alert">{exportError}</div>}</form></details>
          <div className="list-controls"><label>정렬<select value={sortKey} onChange={event => setSortKey(event.target.value)}>{Object.entries(SORTS).map(([key, [label]]) => <option key={key} value={key}>{label}</option>)}</select></label><label>순서<select value={sortDir} onChange={event => setSortDir(event.target.value)}><option value="asc">오름차순</option><option value="desc">내림차순</option></select></label><label>페이지당<select value={pageSize} onChange={event => setPageSize(event.target.value === 'all' ? 'all' : Number(event.target.value))}>{PAGE_SIZES.map(value => <option key={value} value={value}>{value === 'all' ? '전체' : `${value}개`}</option>)}</select></label></div></div>
        {busy && <div className="progress-box" role="status"><progress aria-label="경영체 목록 불러오는 중"/><span>경영체 목록을 불러오는 중입니다. 데이터가 많으면 시간이 걸릴 수 있습니다.</span></div>}
        <CompanyTable rows={pageRows} peopleById={peopleById} onPick={pick} empty={!busy} intakeName={intakeName}/>
        <nav className="pager" aria-label="경영체 목록 페이지"><span aria-live="polite">{sorted.length ? `${pageFrom.toLocaleString()}–${pageTo.toLocaleString()} / ${sorted.length.toLocaleString()}행` : '표시할 행 없음'}</span>{pageSize !== 'all' && <div className="pager-buttons"><button disabled={currentPage <= 1} onClick={() => setPage(1)} aria-label="첫 페이지">«</button><button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>이전</button><span>{currentPage} / {totalPages}</span><button disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>다음</button><button disabled={currentPage >= totalPages} onClick={() => setPage(totalPages)} aria-label="마지막 페이지">»</button></div>}</nav>
</section><aside className="surface company-help"><span className="eyebrow">WORKSPACE GUIDE</span><h3>화면 설명</h3><p>경영체 업무정보를 검색하고 테마·상태·담당자·접수 정보별로 확인합니다.</p><div className="guide-item"><b>검색·필터</b><span>검색어를 입력하고 조회를 누르면 적용됩니다. 테마·상태·담당자·접수 필터는 선택 즉시 반영되며, IR 직행만 모아 볼 수 있습니다.</span></div><div className="guide-item"><b>진행 상태</b><span>진단·컨설팅·보고서 진행 상태를 확인하고 상세 화면에서 회차를 관리합니다.</span></div><div className="guide-item"><b>목록·엑셀</b><span>페이지당 개수를 선택하고 검색된 자료를 전체 또는 행 범위로 내려받습니다.</span></div><div className="guide-note">내보내기 파일에는 개인 연락처와 주소 등 민감한 정보가 포함되지 않습니다.</div></aside></div>}
      {section === 'detail' && selected && <div className="detail-grid"><section className="surface"><div className="section-head"><div><button className="back-link" onClick={() => setSection('companies')}>← 경영체 목록</button><h2>{selected.business_name}</h2><p>{selected.theme || '테마 미입력'} · {selected.program_year || '연도 미입력'}년 사업 {selected.ir_direct && <Pill>IR 직행 태그</Pill>}</p></div>{admin && <div className="inline-actions"><button disabled={mutationBusy} onClick={() => startEdit(selected)}>정보 수정</button><button className="danger-button" disabled={mutationBusy} onClick={() => removeCompany(selected)}>삭제</button></div>}</div><div className="detail-facts"><Fact label="담당 컨설턴트" value={peopleById[selected.assigned_consultant_id]?.display_name || (selected.assigned_consultant_id ? '배정됨' : '미배정')}/><Fact label="협조도" value={selected.cooperation_level}/><Fact label="회사 보고 상태" value={selected.report_status}/></div>{selected.business_summary && <div className="summary-box"><b>경영체 개요</b><p>{selected.business_summary}</p></div>}
        <div className="section-head compact"><div><h3>상담·방문 회차</h3><p>진단 1회 · 컨설팅 최대 3회. 기존 4회차 기록은 보존하며 조회·수정할 수 있습니다.</p></div><button className="text-button" disabled={detailBusy || mutationBusy} onClick={() => refreshDetail(selected.id)}>회차 새로고침</button></div>
        {editor && <form className="session-form" onSubmit={addSession}><label className="sr-only" htmlFor="new-session-kind">상담 유형</label><select id="new-session-kind" value={sessionForm.kind} onChange={event => setSessionForm({ ...sessionForm, kind: event.target.value, round_number: 1 })}><option value="diagnosis">기업 진단</option><option value="consulting">맞춤형 컨설팅</option></select><label className="sr-only" htmlFor="new-session-round">등록 회차</label><select id="new-session-round" value={sessionForm.round_number} onChange={event => setSessionForm({ ...sessionForm, round_number: Number(event.target.value) })}>{(sessionForm.kind === 'diagnosis' ? [1] : [1, 2, 3]).map(value => <option key={value} value={value}>{value}회</option>)}</select><label className="sr-only" htmlFor="new-session-date">방문 가능일</label><input id="new-session-date" type="date" value={sessionForm.scheduled_on} onChange={event => setSessionForm({ ...sessionForm, scheduled_on: event.target.value })}/><button className="primary" disabled={mutationBusy || detailBusy || loadedCompany !== selected.id}>새 회차 등록</button></form>}
        {detailBusy && <p role="status">회차와 변경 이력을 불러오는 중입니다.</p>}<div className="session-list">{currentSessions.map(item => <SessionCard key={item.id} item={item} editor={editor} admin={admin} busy={mutationBusy || detailBusy} departureBase={!!capabilities.departureBase} onSave={patch => updateSession(item, patch)} onRemove={() => removeSession(item)}/>)}{!detailBusy && !currentSessions.length && <div className="empty-state">등록된 회차가 없습니다.</div>}</div>
        <div className="alert info">보고서 파일 업로드·Storage 연결은 아직 활성화하지 않았습니다. 아래 상태는 업무 보고 상태 기록이며 실제 파일 제출을 대신하지 않습니다. 메모에는 이름·연락처·주소·개인이메일을 입력하지 마세요.</div>
      </section><aside><section className="surface detail-aside"><h3>진행 정보</h3><div className="status-block"><span>진행 상태</span><Pill tone="status">{selected.status || '상태 미기재'}</Pill></div><div className="status-block"><span>발표 일정</span><b>{selected.presentation_date || '미정'}</b></div><div className="status-block"><span>접수일</span><b>{selected.intake_date || '미기재'}</b></div><div className="status-block"><span>보고 확인 필요</span><b>{currentSessions.length ? `${missingReports.length}회차` : '회차 없음'}</b></div>{missingReports.length > 0 && <ul className="missing-list">{missingReports.map(item => <li key={item.id}>{sessionLabel(item)} · {item.report_status || '미제출'}</li>)}</ul>}</section>
        {admin && <section className="surface"><h3>서버 감사 이력</h3><p className="fine-print">이벤트 종류·시각만 표시합니다. 회사·회차 원문과 개인 식별정보를 표시하지 않습니다.</p>{auditMessage && <p className="alert info">{auditMessage}</p>}{audits.length ? <ol className="audit-list">{audits.map(item => <li key={item.id}><b>{auditActions[item.action] || '업무 변경'}</b><span>{item.entity_type === 'consultation_sessions' ? '상담 회차' : item.entity_type === 'companies' ? '경영체 업무정보' : '업무 기록'}</span><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString('ko-KR')}</time></li>)}</ol> : !detailBusy && <p className="empty-state">조회된 감사 이벤트가 없습니다. DB 감사 트리거 적용 여부는 관리자가 확인해야 합니다.</p>}</section>}</aside></div>}
      {section === 'detail' && !selected && <section className="surface empty-state">조회 가능한 경영체가 없습니다.</section>}
      {section === 'users' && admin && <section className="surface"><div className="section-head"><div><h2>계정 승인·권한</h2><p>승인과 활성 상태를 확인한 뒤 역할·유형·업무 범위를 지정하세요. 로그인 이메일과 개인 식별정보는 표시하지 않습니다.</p></div></div><div className="alert info">소유자(host) 권한은 host만 지정할 수 있습니다. 관리자 자신과 소유자 계정의 권한 보호는 서버에서도 검사합니다.</div><div className="table-wrap"><table><caption className="sr-only">업무 계정별 승인·역할·배정 범위</caption><thead><tr><th scope="col">업무 계정</th><th scope="col">역할·유형</th><th scope="col">소속 경영체</th><th scope="col">승인·활성</th></tr></thead><tbody>{people.map((person, index) => { const protectedAccount = (!host && person.role === 'host') || (person.id === session.user.id); return <tr key={person.id}><td><b>업무 계정 {index + 1}</b><small>{person.display_name || '업무 표시명 미설정'}</small></td><td><select aria-label={`업무 계정 ${index + 1} 역할`} value={person.role} disabled={protectedAccount || mutationBusy} onChange={event => updatePerson(person, { role: event.target.value })}>{host && <option value="host">소유자(host)</option>}<option value="admin">관리자</option><option value="user">사용자</option>{!host && person.role === 'host' && <option value="host">소유자(host)</option>}</select><select aria-label={`업무 계정 ${index + 1} 유형`} value={person.user_kind || 'client'} disabled={protectedAccount || mutationBusy} onChange={event => updatePerson(person, { user_kind: event.target.value })}><option value="consultant">컨설턴트</option><option value="client">경영체</option></select></td><td><select aria-label={`업무 계정 ${index + 1} 경영체`} value={person.company_id || ''} disabled={protectedAccount || mutationBusy} onChange={event => updatePerson(person, { company_id: event.target.value || null })}><option value="">미배정</option>{companies.map(company => <option key={company.id} value={company.id}>{company.business_name}</option>)}</select></td><td><div className="user-status-actions"><button className={`toggle ${person.approved ? 'on' : ''}`} disabled={protectedAccount || mutationBusy} onClick={() => updatePerson(person, { approved: !person.approved })}>{person.approved ? '승인됨' : '승인 대기'}</button><button className={`toggle ${person.active ? 'on' : ''}`} disabled={protectedAccount || mutationBusy} onClick={() => updatePerson(person, { active: !person.active })}>{person.active ? '활성' : '중지'}</button></div></td></tr>; })}</tbody></table>{!people.length && <div className="empty-state">조회할 업무 계정이 없습니다.</div>}</div></section>}
      {editing && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !mutationBusy) setEditing(null); }}><form className="edit-modal" role="dialog" aria-modal="true" aria-labelledby="company-edit-title" onSubmit={saveCompany}><div className="section-head"><div><span className="eyebrow">COMPANY WORKFLOW</span><h2 id="company-edit-title">{editing === 'new' ? '경영체 추가' : '업무정보 수정'}</h2></div><button type="button" className="icon-button" aria-label="편집 닫기" disabled={mutationBusy} onClick={() => setEditing(null)}>×</button></div><p className="fine-print">개인 연락처·주소·개인이메일·주민번호·생년월일은 수집하지 않습니다. 메모에는 업무 진행 내용만 입력하세요.</p><div className="form-grid"><label>경영체명 *<input required maxLength={200} value={form.business_name} onChange={event => setForm({ ...form, business_name: event.target.value })}/></label><label>테마<input maxLength={100} value={form.theme} onChange={event => setForm({ ...form, theme: event.target.value })}/></label><label>진행연도<input type="number" min="2000" max="2100" value={form.program_year} onChange={event => setForm({ ...form, program_year: event.target.value })}/></label><label>발표 일정<input maxLength={100} value={form.presentation_date} onChange={event => setForm({ ...form, presentation_date: event.target.value })}/></label><label>진행 상태<select value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}>{!statusOptions.includes(form.status) && <option>{form.status}</option>}{statusOptions.map(value => <option key={value}>{value}</option>)}</select></label><label>담당 컨설턴트<select value={form.assigned_consultant_id} onChange={event => setForm({ ...form, assigned_consultant_id: event.target.value })}><option value="">미배정</option>{people.filter(person => person.role === 'user' && person.user_kind === 'consultant' && person.approved && person.active).map((person, index) => <option value={person.id} key={person.id}>{person.display_name || `컨설턴트 ${index + 1}`}</option>)}</select></label><label>협조도<input maxLength={100} value={form.cooperation_level} onChange={event => setForm({ ...form, cooperation_level: event.target.value })}/></label><label>회사 보고 상태<select value={form.report_status} onChange={event => setForm({ ...form, report_status: event.target.value })}>{!REPORT_STATUSES.includes(form.report_status) && <option>{form.report_status}</option>}{REPORT_STATUSES.map(value => <option key={value}>{value}</option>)}</select></label><label className="checkbox-label"><input type="checkbox" checked={form.ir_direct} onChange={event => setForm({ ...form, ir_direct: event.target.checked })}/>IR 직행 태그 (진행 상태와 별개)</label><label className="span-two">경영체 업무 개요<textarea maxLength={4000} rows={3} value={form.business_summary} onChange={event => setForm({ ...form, business_summary: event.target.value })}/></label></div><div className="modal-actions"><button type="button" disabled={mutationBusy} onClick={() => setEditing(null)}>취소</button><button className="primary" disabled={mutationBusy}>{mutationBusy ? '저장 중…' : '저장'}</button></div></form></div>}
      <footer className="app-footer">인트윈 · 농금원 투자 전 지원사업 <span>서버 인증·역할/배정 검사와 Supabase RLS를 함께 사용합니다.</span></footer>
    </div></main></div>;
}
function Navigation({ section, setSection, admin }) { return <><button className={`side-link ${section === 'overview' ? 'selected' : ''}`} onClick={() => setSection('overview')}><span>◫</span>{admin ? '사업 현황' : '내 업무'}</button><button className={`side-link ${section === 'companies' || section === 'detail' ? 'selected' : ''}`} onClick={() => setSection('companies')}><span>▦</span>{admin ? '경영체 관리' : '내 배정 기업'}</button>{admin && <button className={`side-link ${section === 'users' ? 'selected' : ''}`} onClick={() => setSection('users')}><span>♙</span>계정 및 권한</button>}</>; }
function Stat({ label, value, note }) { return <div className="stat-card"><span>{label}</span><strong>{value}<small>개</small></strong><small className="stat-foot">{note}</small></div>; }
function Fact({ label, value }) { return <div className="fact"><span>{label}</span><b>{value || '미기재'}</b></div>; }
const statusTone = status => /완료|제출/.test(status || '') ? 'green' : /대기|미배정|미기재/.test(status || '') ? 'amber' : /진행|검토|작성/.test(status || '') ? 'blue' : '';
const reportTone = status => status === '제출 완료' ? 'green' : status === '미제출' ? 'amber' : status ? 'blue' : '';
function CompanyTable({ rows, peopleById, onPick, empty, intakeName = '접수일' }) { return <div className="table-wrap"><table className="company-table"><caption className="sr-only">경영체별 진행 상태와 배정 현황</caption><thead><tr><th scope="col">경영체</th><th scope="col">테마</th><th scope="col">진행 상태</th><th scope="col">담당 컨설턴트</th><th scope="col">보고 상태</th><th scope="col">{intakeName}</th><th scope="col">상세</th></tr></thead><tbody>{rows.map(company => <tr key={company.id}><td><b>{company.business_name}</b><small>{company.program_year ? `${company.program_year}년 사업` : '연도 미입력'}{company.ir_direct && <span className="ir-tag">IR 직행</span>}</small></td><td>{company.theme || '—'}</td><td><Pill tone={statusTone(company.status)}>{company.status || '상태 미기재'}</Pill></td><td>{peopleById[company.assigned_consultant_id]?.display_name || (company.assigned_consultant_id ? '배정됨' : '미배정')}</td><td>{company.report_status ? <Pill tone={reportTone(company.report_status)}>{company.report_status}</Pill> : '—'}</td><td className="num">{company.intake_date || '—'}</td><td><button className="row-arrow" aria-label={`${company.business_name} 상세 보기`} onClick={() => onPick(company)}>→</button></td></tr>)}</tbody></table>{empty && !rows.length && <div className="empty-state">경영체가 없습니다. 검색어와 필터를 확인하세요.</div>}</div>; }
function SessionCard({ item, editor, admin, busy, departureBase, onSave, onRemove }) {
  const [draft, setDraft] = useState({ scheduled_on: item.scheduled_on || '', remote: !!item.remote, report_status: item.report_status || '미제출', report_note: item.report_note || '', departure_base: item.departure_base || '' });
  useEffect(() => { setDraft({ scheduled_on: item.scheduled_on || '', remote: !!item.remote, report_status: item.report_status || '미제출', report_note: item.report_note || '', departure_base: item.departure_base || '' }); }, [item]);
  const label = sessionLabel(item);
  const dirty = ['scheduled_on', 'report_status', 'report_note'].some(key => draft[key] !== (item[key] || (key === 'report_status' ? '미제출' : ''))) || draft.remote !== !!item.remote || (departureBase && draft.departure_base !== (item.departure_base || ''));
  async function save(event) {
    event.preventDefault();
    const patch = { scheduled_on: draft.scheduled_on || null, remote: draft.remote, report_status: draft.report_status, report_note: draft.report_note };
    if (departureBase) patch.departure_base = draft.departure_base;
    await onSave(patch);
  }
  return <form className="session-card" onSubmit={save}><div className="session-card-head"><strong>{label}</strong><Pill tone={draft.report_status === '제출 완료' ? 'green' : 'amber'}>{draft.report_status}</Pill>{Number(item.round_number) > 3 && <small>기존 회차 보존</small>}</div><div className="session-edit-grid"><label>방문 가능일<input aria-label={`${label} 방문 가능일`} type="date" value={draft.scheduled_on} disabled={!editor || busy} onChange={event => setDraft({ ...draft, scheduled_on: event.target.value })}/></label><label>보고 상태<select aria-label={`${label} 보고 상태`} value={draft.report_status} disabled={!editor || busy} onChange={event => setDraft({ ...draft, report_status: event.target.value })}>{!REPORT_STATUSES.includes(draft.report_status) && <option>{draft.report_status}</option>}{REPORT_STATUSES.map(value => <option key={value}>{value}</option>)}</select></label><label className="checkbox-label"><input type="checkbox" checked={draft.remote} disabled={!editor || busy} onChange={event => setDraft({ ...draft, remote: event.target.checked })}/>비대면 상담</label><label>출발 거점 코드<input maxLength={80} value={draft.departure_base} disabled={!editor || busy || !departureBase} placeholder={departureBase ? '개인 주소 대신 업무 거점 코드' : '추가 스키마 승인·적용 대기'} onChange={event => setDraft({ ...draft, departure_base: event.target.value })}/></label><label className="span-two">업무 보고 메모<textarea maxLength={4000} rows={2} value={draft.report_note} disabled={!editor || busy} placeholder="회차 진행 내용만 입력. 개인정보 금지" onChange={event => setDraft({ ...draft, report_note: event.target.value })}/></label></div><div className="session-card-actions">{editor && <button className="primary" disabled={busy || !dirty}>변경 저장</button>}{admin && <button type="button" className="danger-button" disabled={busy} onClick={onRemove}>회차 삭제</button>}</div></form>;
}
