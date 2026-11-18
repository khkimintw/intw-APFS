'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { isAdmin } from '../modules/workflow';
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

const TEMPLATE_BUCKET = 'agri-report-templates';
const REPORT_TEMPLATES = [
 {path:'diagnosis_2026.hwp',filename:'1. 기업진단보고서 (2026 ver.).hwp',title:'기업진단 보고서',detail:'기업 현황과 진단 의견, 요약 의견 및 현장 사진을 정리합니다.'},
 {path:'consulting_2026.hwp',filename:'2. 컨설팅 보고서 (2026 ver.).hwp',title:'컨설팅 보고서',detail:'기업·제품·인력 현황과 회차별 컨설팅 내용 및 성과를 기록합니다.'},
 {path:'performance_confirmation_2026.hwp',filename:'3. 2026 투자 전 지원사업_수행 확인서 (2026 ver.).hwp',title:'수행 확인서',detail:'최종 컨설팅 회차 후 기업 서명을 받는 확인서입니다.'},
];
export function ReportsView({sessions,companies,peopleById,loading,error,onPick,session,profile}) {
 const {byId,consultant}=useJoin(companies,peopleById), [filter,setFilter]=useState('전체'), [available,setAvailable]=useState({}), [templateError,setTemplateError]=useState(''), [busyPath,setBusyPath]=useState('');
 const admin=isAdmin(profile), counts=useMemo(()=>Object.fromEntries(REPORT_STATUSES.map(status=>[status,sessions.filter(item=>(item.report_status||'미제출')===status).length])),[sessions]);
 const rows=sessions.filter(item=>byId[item.company_id]&&(filter==='전체'||(item.report_status||'미제출')===filter));
 async function refreshTemplates(){setTemplateError('');if(!supabase||!session?.access_token)return;const {data,error:listError}=await supabase.storage.from(TEMPLATE_BUCKET).list('',{limit:100});if(listError){setTemplateError('양식 목록을 불러오지 못했습니다. 로그인 권한을 확인해 주세요.');return;}setAvailable(Object.fromEntries((data||[]).map(item=>[item.name,true])));}
 useEffect(()=>{refreshTemplates();},[session?.access_token]);
 async function downloadTemplate(item){setBusyPath(item.path);setTemplateError('');const {data,error:downloadError}=await supabase.storage.from(TEMPLATE_BUCKET).download(item.path);if(downloadError||!data){setTemplateError('파일을 내려받지 못했습니다. 잠시 후 다시 시도해 주세요.');setBusyPath('');return;}const url=URL.createObjectURL(data),anchor=document.createElement('a');anchor.href=url;anchor.download=item.filename;anchor.click();URL.revokeObjectURL(url);setBusyPath('');}
 async function uploadTemplate(item,file,input){if(!file)return;if(!/\.hwp$/i.test(file.name)){setTemplateError('한글 양식(.hwp) 파일을 선택해 주세요.');input.value='';return;}if(file.size>10*1024*1024){setTemplateError('파일 크기는 10MB 이하여야 합니다.');input.value='';return;}setBusyPath(item.path);setTemplateError('');const {error:uploadError}=await supabase.storage.from(TEMPLATE_BUCKET).upload(item.path,file,{upsert:true,contentType:file.type||'application/octet-stream'});if(uploadError)setTemplateError('양식 등록에 실패했습니다. 관리자 권한과 파일 형식을 확인해 주세요.');else await refreshTemplates();input.value='';setBusyPath('');}
 return <Frame title="보고 현황" desc="회차별 보고 상태와 기업별 회사 보고 상태입니다." loading={loading} error={error}>
 <section className="report-template-section" aria-labelledby="report-template-heading">
 <div className="report-template-heading"><div><h3 id="report-template-heading">보고 양식</h3><p>업무 단계에 맞는 양식을 내려받아 작성하세요. 등록 파일은 승인된 사용자만 이용할 수 있습니다.</p></div></div>
 <div className="report-template-grid">{REPORT_TEMPLATES.map(item=><article className="report-template-card" key={item.path}><div className="report-template-icon" aria-hidden="true">HWP</div><div className="report-template-copy"><h4>{item.title}</h4><p>{item.detail}</p><small>{available[item.path]?'2026년 양식 · HWP':'양식 등록 대기'}</small></div><div className="report-template-actions"><button type="button" className="template-download" disabled={!available[item.path]||busyPath===item.path} onClick={()=>downloadTemplate(item)}>{busyPath===item.path?'처리 중…':'양식 다운로드'}</button>{admin&&<label className="template-upload-button">{available[item.path]?'양식 교체':'양식 등록'}<input type="file" accept=".hwp,application/x-hwp,application/octet-stream" onChange={event=>uploadTemplate(item,event.target.files?.[0],event.target)}/></label>}</div></article>)}</div>
 {templateError&&<div className="alert error" role="alert">{templateError}</div>}{admin&&<p className="template-admin-note">관리자·소유자 전용: 전달받은 원본 HWP 파일을 각 카드에 등록하면 승인된 사용자가 안전하게 내려받을 수 있습니다.</p>}
 </section>
 <div className="stat-grid view-stats">{REPORT_STATUSES.map(status=><button key={status} type="button" className={"stat-card stat-button "+(filter===status?'on':'')} aria-pressed={filter===status} onClick={()=>setFilter(filter===status?'전체':status)}><span>{status}</span><strong>{counts[status]}<small>회차</small></strong></button>)}</div>
 {!sessions.length?<Empty>등록된 상담 회차가 없어 보고 현황이 없습니다.</Empty>:<div className="table-wrap"><table className="view-table"><caption className="sr-only">회차별 보고 상태</caption><thead><tr><th>기업명</th><th>회차</th><th>회차 보고 상태</th><th>회사 보고 상태</th><th>담당 컨설턴트</th><th>상세</th></tr></thead><tbody>{rows.map(item=>{const company=byId[item.company_id];return <tr key={item.id}><td><b>{company.business_name}</b></td><td>{sessionLabel(item)}</td><td><Badge tone={tone(item.report_status||'미제출')}>{item.report_status||'미제출'}</Badge></td><td>{company.report_status?<Badge tone={tone(company.report_status)}>{company.report_status}</Badge>:'—'}</td><td>{consultant(company)}</td><td><button className="row-arrow" aria-label={company.business_name+' 상세 보기'} onClick={()=>onPick(company)}>→</button></td></tr>;})}</tbody></table>{!rows.length&&<Empty>선택한 상태의 회차가 없습니다.</Empty>}</div>}
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
