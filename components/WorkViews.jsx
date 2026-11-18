'use client';
import { useMemo, useState } from 'react';
import { REPORT_STATUSES, sessionLabel } from '../modules/workflow';

const tone = status => status === '제출 완료' ? 'green' : status === '미제출' ? 'amber' : status ? 'blue' : '';
const Badge = ({ children, tone: t }) => <span className={`pill ${t || ''}`}>{children}</span>;
function Frame({ title, desc, loading, error, children }) {
  return <section className="surface view-card" aria-busy={loading}><div className="section-head"><div><h2>{title}</h2><p>{desc}</p></div></div>
    {loading && <div className="progress-box" role="status"><progress aria-label="불러오는 중"/><span>자료를 불러오는 중입니다.</span></div>}
    {error && <div className="alert error" role="alert">{error}</div>}{!loading && children}</section>;
}
const Empty = ({ children }) => <div className="empty-state">{children}</div>;
function useJoin(companies, peopleById) {
  const byId = useMemo(() => Object.fromEntries(companies.map(company => [company.id, company])), [companies]);
  const consultant = company => company ? (peopleById[company.assigned_consultant_id]?.display_name || (company.assigned_consultant_id ? '배정됨' : '미배정')) : '—';
  return { byId, consultant };
}

export function AssignmentView({ sessions, companies, peopleById, loading, error, onPick }) {
  const { byId, consultant } = useJoin(companies, peopleById);
  const rows = useMemo(() => [...sessions].filter(item => byId[item.company_id]).sort((a, b) => (a.scheduled_on ? 0 : 1) - (b.scheduled_on ? 0 : 1) || String(a.scheduled_on || '').localeCompare(String(b.scheduled_on || '')) || byId[a.company_id].business_name.localeCompare(byId[b.company_id].business_name, 'ko')), [sessions, byId]);
  return <Frame title="배정·방문 순서" desc="등록된 회차를 방문 가능일 순서로 보여 줍니다. 날짜가 없는 회차는 아래에 모읍니다." loading={loading} error={error}>
    {!rows.length ? <Empty>등록된 상담 회차가 없습니다. 기업 상세에서 회차를 등록하면 이곳에 순서대로 표시됩니다.</Empty>
      : <div className="table-wrap"><table className="view-table"><caption className="sr-only">방문 순서</caption><thead><tr><th>순서</th><th>방문 가능일</th><th>기업명</th><th>회차</th><th>담당 컨설턴트</th><th>방식</th><th>상세</th></tr></thead><tbody>{rows.map((item, index) => { const company = byId[item.company_id]; return <tr key={item.id}><td className="num">{index + 1}</td><td className="num">{item.scheduled_on || <Badge tone="amber">미정</Badge>}</td><td><b>{company.business_name}</b></td><td>{sessionLabel(item)}</td><td>{consultant(company)}</td><td>{item.remote ? '비대면' : '방문'}</td><td><button className="row-arrow" aria-label={`${company.business_name} 상세 보기`} onClick={() => onPick(company)}>→</button></td></tr>; })}</tbody></table></div>}
  </Frame>;
}

export function ReportsView({ sessions, companies, peopleById, loading, error, onPick }) {
  const { byId, consultant } = useJoin(companies, peopleById);
  const [filter, setFilter] = useState('전체');
  const counts = useMemo(() => Object.fromEntries(REPORT_STATUSES.map(status => [status, sessions.filter(item => (item.report_status || '미제출') === status).length])), [sessions]);
  const rows = sessions.filter(item => byId[item.company_id] && (filter === '전체' || (item.report_status || '미제출') === filter));
  return <Frame title="보고 현황" desc="회차별 보고 상태와 기업별 회사 보고 상태입니다." loading={loading} error={error}>
    <div className="stat-grid view-stats">{REPORT_STATUSES.map(status => <button key={status} type="button" className={`stat-card stat-button ${filter === status ? 'on' : ''}`} aria-pressed={filter === status} onClick={() => setFilter(filter === status ? '전체' : status)}><span>{status}</span><strong>{counts[status]}<small>회차</small></strong></button>)}</div>
    {!sessions.length ? <Empty>등록된 상담 회차가 없어 보고 현황이 없습니다.</Empty>
      : <div className="table-wrap"><table className="view-table"><caption className="sr-only">회차별 보고 상태</caption><thead><tr><th>기업명</th><th>회차</th><th>회차 보고 상태</th><th>회사 보고 상태</th><th>담당 컨설턴트</th><th>상세</th></tr></thead><tbody>{rows.map(item => { const company = byId[item.company_id]; return <tr key={item.id}><td><b>{company.business_name}</b></td><td>{sessionLabel(item)}</td><td><Badge tone={tone(item.report_status || '미제출')}>{item.report_status || '미제출'}</Badge></td><td>{company.report_status ? <Badge tone={tone(company.report_status)}>{company.report_status}</Badge> : '—'}</td><td>{consultant(company)}</td><td><button className="row-arrow" aria-label={`${company.business_name} 상세 보기`} onClick={() => onPick(company)}>→</button></td></tr>; })}</tbody></table>{!rows.length && <Empty>선택한 상태의 회차가 없습니다.</Empty>}</div>}
  </Frame>;
}

export function ReviewView({ sessions, companies, peopleById, loading, error, onPick }) {
  const { byId, consultant } = useJoin(companies, peopleById);
  const pending = sessions.filter(item => item.report_status === '검토 중' && byId[item.company_id]);
  return <Frame title="검수 의견" desc="검토 중 상태인 보고를 모아 봅니다." loading={loading} error={error}>
    <h3>검토 대기 보고 {pending.length}건</h3>
    {!pending.length ? <Empty>검토 중인 보고가 없습니다.</Empty>
      : <div className="table-wrap"><table className="view-table"><caption className="sr-only">검토 대기 보고</caption><thead><tr><th>기업명</th><th>회차</th><th>담당 컨설턴트</th><th>상세</th></tr></thead><tbody>{pending.map(item => { const company = byId[item.company_id]; return <tr key={item.id}><td><b>{company.business_name}</b></td><td>{sessionLabel(item)}</td><td>{consultant(company)}</td><td><button className="row-arrow" aria-label={`${company.business_name} 상세 보기`} onClick={() => onPick(company)}>→</button></td></tr>; })}</tbody></table></div>}
    <h3>등록된 검수 의견</h3>
    <Empty>저장된 검수 의견이 없습니다. 검수 의견 기록 기능은 아직 연결되지 않았습니다.</Empty>
  </Frame>;
}

export function SettlementView({ sessions, companies, loading, error, onPick }) {
  const rows = useMemo(() => companies.map(company => { const own = sessions.filter(item => item.company_id === company.id); const done = own.filter(item => item.report_status === '제출 완료').length; return { company, total: own.length, done, open: own.length - done }; }).filter(row => row.total).sort((a, b) => b.open - a.open || a.company.business_name.localeCompare(b.company.business_name, 'ko')), [sessions, companies]);
  const total = rows.reduce((sum, row) => sum + row.total, 0), done = rows.reduce((sum, row) => sum + row.done, 0);
  return <Frame title="보고·정산" desc="기업별 보고 제출 현황입니다. 정산 금액·기록은 아직 연결된 데이터가 없습니다." loading={loading} error={error}>
    <div className="stat-grid view-stats"><div className="stat-card"><span>등록 회차</span><strong>{total}<small>회차</small></strong></div><div className="stat-card"><span>보고 제출 완료</span><strong>{done}<small>회차</small></strong></div><div className="stat-card"><span>미완료</span><strong>{total - done}<small>회차</small></strong></div></div>
    {!rows.length ? <Empty>등록된 회차가 없어 보고 제출 현황이 없습니다.</Empty>
      : <div className="table-wrap"><table className="view-table"><caption className="sr-only">기업별 보고 제출 현황</caption><thead><tr><th>기업명</th><th>등록 회차</th><th>제출 완료</th><th>미완료</th><th>상세</th></tr></thead><tbody>{rows.map(row => <tr key={row.company.id}><td><b>{row.company.business_name}</b></td><td className="num">{row.total}</td><td className="num">{row.done}</td><td className="num">{row.open ? <Badge tone="amber">{row.open}</Badge> : <Badge tone="green">0</Badge>}</td><td><button className="row-arrow" aria-label={`${row.company.business_name} 상세 보기`} onClick={() => onPick(row.company)}>→</button></td></tr>)}</tbody></table></div>}
    <h3>정산 기록</h3>
    <Empty>등록된 정산 기록이 없습니다. 정산 금액·지급 내역 기능은 아직 연결되지 않았습니다.</Empty>
  </Frame>;
}
