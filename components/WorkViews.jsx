'use client';
import { useMemo, useState } from 'react';
import { companyReportLabel, REPORT_STATUSES, sessionLabel } from '../modules/workflow';

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

export function AssignmentView({ sessions, companies, peopleById, people = [], loading, error, onPick, admin = false, onAssign, mutationBusy = false }) {
  const { byId, consultant } = useJoin(companies, peopleById);
  const rows = useMemo(() => [...sessions].filter(item => byId[item.company_id]).sort((a, b) => (a.scheduled_on ? 0 : 1) - (b.scheduled_on ? 0 : 1) || String(a.scheduled_on || '').localeCompare(String(b.scheduled_on || '')) || byId[a.company_id].business_name.localeCompare(byId[b.company_id].business_name, 'ko')), [sessions, byId]);
  return <Frame title="배정·방문 순서" desc="등록된 회차를 방문 가능일 순서로 보여 줍니다. 날짜가 없는 회차는 아래에 모읍니다." loading={loading} error={error}>
    {admin&&<RegionMatchingPanel companies={companies} people={people} sessions={sessions} onAssign={onAssign} onPick={onPick} loading={loading} mutationBusy={mutationBusy}/>}
    {!rows.length ? <Empty>등록된 상담 회차가 없습니다. 기업 상세에서 회차를 등록하면 이곳에 순서대로 표시됩니다.</Empty>
      : <div className="table-wrap"><table className="view-table"><caption className="sr-only">방문 순서</caption><thead><tr><th>순서</th><th>방문 가능일</th><th>기업명</th><th>회차</th><th>담당 컨설턴트</th><th>방식</th><th>상세</th></tr></thead><tbody>{rows.map((item, index) => { const company = byId[item.company_id]; return <tr key={item.id}><td className="num">{index + 1}</td><td className="num">{item.scheduled_on || <Badge tone="amber">미정</Badge>}</td><td><b>{company.business_name}</b></td><td>{sessionLabel(item)}</td><td>{consultant(company)}</td><td>{item.remote ? '비대면' : '방문'}</td><td><button className="row-arrow" aria-label={`${company.business_name} 상세 보기`} onClick={() => onPick(company)}>→</button></td></tr>; })}</tbody></table></div>}
  </Frame>;
}


function areaParts(address) {
  const tokens=String(address||'').replace(/\([^)]*\)/g,' ').split(/\s+/).filter(Boolean);
  if(!tokens.length)return null;
  const province=tokens[0];
  const admin=tokens.slice(1).filter(token=>/(시|군|구)$/.test(token)).slice(0,2);
  const exact=[province,...admin].join(' ');
  const parent=admin.length>1?[province,admin[0]].join(' '):province;
  const label=admin.length?admin.join(' '):province;
  return {province,exact,parent,label};
}
function regionCandidates(company,companies,people,sessions) {
  const target=areaParts(company.address);
  const activeByConsultant={}, visitsByConsultant={};
  const companyById=Object.fromEntries(companies.map(item=>[item.id,item]));
  for(const item of companies) {
    const id=item.assigned_consultant_id;
    if(!id||item.status==='포기'||/완료/.test(item.status||''))continue;
    activeByConsultant[id]=(activeByConsultant[id]||0)+1;
  }
  const today=new Date().toISOString().slice(0,10);
  const nearDate=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  for(const item of sessions) {
    const assigned=companyById[item.company_id]?.assigned_consultant_id;
    if(assigned&&!item.remote&&item.scheduled_on>=today&&item.scheduled_on<=nearDate)
      visitsByConsultant[assigned]=(visitsByConsultant[assigned]||0)+1;
  }
  return people.filter(person=>person.role==='user'&&person.user_kind==='consultant'&&person.approved&&person.active)
    .map(person=>{
      const history=companies.filter(item=>item.assigned_consultant_id===person.id&&item.address&&item.status!=='포기').map(item=>areaParts(item.address)).filter(Boolean);
      let proximity=0;
      if(target)for(const old of history) {
        const level=old.exact===target.exact?3:old.parent===target.parent?2:old.province===target.province?1:0;
        proximity=Math.max(proximity,level);
      }
      const active=activeByConsultant[person.id]||0, visits=visitsByConsultant[person.id]||0;
      const fit=proximity===3?'같은 시·군·구':proximity===2?'같은 시·군 권역':proximity===1?'같은 시·도':target?'기존 지역 이력 없음':'주소 미확인';
      const load='담당 '+active+'개 · 30일 내 방문 '+visits+'건';
      return {person,proximity,active,visits,fit,load};
    }).sort((a,b)=>b.proximity-a.proximity||(a.active+a.visits*2)-(b.active+b.visits*2)||String(a.person.display_name).localeCompare(String(b.person.display_name),'ko'));
}

export function RegionMatchingPanel({companies,people,sessions,onAssign,onPick,loading,mutationBusy}) {
  const [areaFilter,setAreaFilter]=useState('전체');
  const [chosen,setChosen]=useState({});
  const unassigned=useMemo(()=>companies.filter(item=>!item.assigned_consultant_id&&item.status!=='포기'),[companies]);
  const areas=useMemo(()=>['전체',...Array.from(new Set(unassigned.map(item=>areaParts(item.address)?.label||'행정구역 미확인'))).sort((a,b)=>a.localeCompare(b,'ko'))],[unassigned]);
  const rows=useMemo(()=>unassigned.filter(item=>areaFilter==='전체'||(areaParts(item.address)?.label||'행정구역 미확인')===areaFilter),[unassigned,areaFilter]);
  const missingAddress=unassigned.filter(item=>!areaParts(item.address)).length;
  return <section className="region-match-panel" aria-label="지역 기반 담당자 추천">
    <div className="region-match-heading"><div><span className="eyebrow">컨설턴트 이동 부담을 고려한 배정</span><h3>미배정 경영체 지역 매칭 <span className="pill">{unassigned.length}건</span></h3><p>같은 시·군·구의 기존 담당 이력을 우선 찾고, 같은 권역과 담당량을 함께 비교합니다.</p></div><label>지역 필터<select value={areaFilter} onChange={event=>setAreaFilter(event.target.value)}>{areas.map(area=><option key={area}>{area}</option>)}</select></label></div>
    <div className="region-match-note"><span aria-hidden="true">ⓘ</span><span>추천은 등록 주소와 기존 배정 지역을 이용한 행정구역 기준입니다. 실제 이동 km·교통시간은 계산하지 않으므로 주소 확인 후 지도 경로를 확인해 주세요. 주소 미입력 {missingAddress}건</span></div>
    {loading?<div className="progress-box compact-progress"><progress aria-label="지역 매칭 후보 계산 중"/><span>지역과 담당량을 비교하고 있습니다.</span></div>:rows.length?<div className="region-match-list">{rows.map(company=>{
      const candidates=regionCandidates(company,companies,people,sessions);
      const picked=chosen[company.id]||candidates[0]?.person.id||'';
      const selected=candidates.find(item=>item.person.id===picked)||candidates[0];
      const area=areaParts(company.address);
      return <article className="region-match-card" key={company.id}>
        <div className="region-company"><button type="button" className="company-name-button" onClick={()=>onPick(company)}><b>{company.business_name}</b></button><span title={company.address || ''}>{area?.label || '주소 미확인'}{company.address ? ' · '+company.address : ''}</span><a href={company.address?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(company.address):undefined} target="_blank" rel="noreferrer" aria-disabled={!company.address} onClick={event=>{if(!company.address)event.preventDefault();}}>위치 확인 ↗</a></div>
        {candidates.length?<div className="region-recommendation"><label>배정 후보<select value={picked} disabled={mutationBusy} onChange={event=>setChosen(current=>({...current,[company.id]:event.target.value}))}>{candidates.map(item=><option key={item.person.id} value={item.person.id}>{item.person.display_name||'업무 담당자'} · {item.fit} · {item.load}</option>)}</select></label><div className="region-fit"><b>{selected?.fit}</b><span>{selected?.load}</span><small>{selected?.proximity>=2?'기존 담당 경영체의 같은 생활권 이력을 확인했습니다.':selected?.proximity===1?'같은 시·도 안의 기존 담당 이력을 참고했습니다.':'지역 이력이 없어 담당량이 적은 컨설턴트를 우선 제안합니다.'}</small></div><button type="button" className="primary" disabled={!picked||mutationBusy} onClick={()=>onAssign(company,picked)}>이 컨설턴트에게 배정</button></div>:<div className="region-fit empty">승인·활성된 컨설턴트 계정이 없습니다.</div>}
      </article>;
    })}</div>:<div className="empty-state">현재 배정 대기 중인 경영체가 없습니다.</div>}
  </section>;
}

export const REPORT_TEMPLATES = [
 {type:'diagnosis',path:'/report-templates/diagnosis_2026.hwp',filename:'1. 기업진단보고서 (2026 ver.).hwp',title:'기업진단 보고서',detail:'기업 현황과 진단 의견, 요약 의견 및 현장 사진을 정리합니다.'},
 {type:'consulting',path:'/report-templates/consulting_2026.hwp',filename:'2. 컨설팅 보고서 (2026 ver.).hwp',title:'컨설팅 보고서',detail:'기업·제품·인력 현황과 회차별 컨설팅 내용 및 성과를 기록합니다.'},
 {type:'confirmation',path:'/report-templates/performance_confirmation_2026.hwp',filename:'3. 2026 투자 전 지원사업_수행 확인서 (2026 ver.).hwp',title:'수행 확인서',detail:'최종 컨설팅 회차 후 기업 서명을 받는 확인서입니다.'},
];
export function ReportsView({sessions,companies,peopleById,loading,error,onPick}) {
 const {byId,consultant}=useJoin(companies,peopleById), [filter,setFilter]=useState('전체');
 const counts=useMemo(()=>Object.fromEntries(REPORT_STATUSES.map(status=>[status,sessions.filter(item=>(item.report_status||'미제출')===status).length])),[sessions]);
 const rows=sessions.filter(item=>byId[item.company_id]&&(filter==='전체'||(item.report_status||'미제출')===filter));
 return <Frame title="보고 현황" desc="회차별 보고 상태와 기업별 회사 보고 상태입니다." loading={loading} error={error}>
 <section className="report-template-section" aria-labelledby="report-template-heading">
 <div className="report-template-heading"><div><h3 id="report-template-heading">보고 양식</h3><p>업무 단계에 맞는 2026년 양식을 내려받아 작성하세요.</p></div></div>
 <div className="report-template-grid">{REPORT_TEMPLATES.map(item=><article className="report-template-card" key={item.path}><div className="report-template-icon" aria-hidden="true">HWP</div><div className="report-template-copy"><h4>{item.title}</h4><p>{item.detail}</p><small>2026년 양식 · HWP</small></div><div className="report-template-actions"><a className="template-download" href={item.path} download={item.filename}>양식 다운로드</a></div></article>)}</div>
 </section>
 <div className="stat-grid view-stats">{REPORT_STATUSES.map(status=><button key={status} type="button" className={"stat-card stat-button "+(filter===status?'on':'')} aria-pressed={filter===status} onClick={()=>setFilter(filter===status?'전체':status)}><span>{status}</span><strong>{counts[status]}<small>회차</small></strong></button>)}</div>
 {!sessions.length?<Empty>등록된 상담 회차가 없어 보고 현황이 없습니다.</Empty>:<div className="table-wrap"><table className="view-table"><caption className="sr-only">회차별 보고 상태</caption><thead><tr><th>기업명</th><th>회차</th><th>회차 보고 상태</th><th>회사 보고 상태</th><th>담당 컨설턴트</th><th>상세</th></tr></thead><tbody>{rows.map(item=>{const company=byId[item.company_id];return <tr key={item.id}><td><b>{company.business_name}</b></td><td>{sessionLabel(item)}</td><td><Badge tone={tone(item.report_status||'미제출')}>{item.report_status||'미제출'}</Badge></td><td>{company.report_status?<Badge tone={tone(company.report_status)}>{companyReportLabel(company.report_status)}</Badge>:'—'}</td><td>{consultant(company)}</td><td><button className="row-arrow" aria-label={company.business_name+' 상세 보기'} onClick={()=>onPick(company)}>→</button></td></tr>;})}</tbody></table>{!rows.length&&<Empty>선택한 상태의 회차가 없습니다.</Empty>}</div>}
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
