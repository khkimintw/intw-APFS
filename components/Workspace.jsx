'use client';
import { useState } from 'react';
import { Frame, Badge, Metric } from './Ui';
import { consultants, initialCompanies, importCandidates } from '../modules/demo';
export default function Workspace() {
  const [role,setRole]=useState('관리자');
  const [identity,setIdentity]=useState(consultants[1]);
  const [companies,setCompanies]=useState(initialCompanies);
  const [selected,setSelected]=useState('DEMO-01');
  const [filter,setFilter]=useState('전체');
  const [query,setQuery]=useState('');
  const [imported,setImported]=useState([]);
  const [skipped,setSkipped]=useState([]);
  const [events,setEvents]=useState([]);
  const [message,setMessage]=useState('합성 데이터를 선택해 업무 흐름을 살펴보세요.');
  const admin=role==='관리자';
  const accessible=companies.filter(c=>admin||c.consultant===identity);
  const visible=accessible.filter(c=>(filter!=='IR 직행'||c.direct)&&c.name.includes(query));
  const company=accessible.find(c=>c.id===selected)||accessible[0];
  const sessions=companies.flatMap(c=>c.visits);
  const diagnostic=sessions.filter(v=>v.type==='진단'&&v.report==='제출 시연').length;
  const consulting=sessions.filter(v=>v.type==='컨설팅'&&v.report==='제출 시연').length;
  function log(text){setMessage(text);setEvents(items=>[text,...items]);}
  function updateCompany(id,fn){setCompanies(items=>items.map(c=>c.id===id?fn(c):c));}
  function duplicate(candidate){
    return companies.find(c=>c.id===candidate.companyId)?.visits.some(v=>v.type===candidate.type&&v.round===candidate.round);
  }
  function addCandidate(candidate){
    if(!admin||duplicate(candidate)||imported.includes(candidate.id)||skipped.includes(candidate.id))return;
    updateCompany(candidate.companyId,c=>({...c,visits:[...c.visits,{id:`import-${candidate.id}`,type:candidate.type,round:candidate.round,date:'미정',origin:'미입력',report:'미제출'}]}));
    setImported(items=>[...items,candidate.id]);log(`${candidate.name} ${candidate.type} ${candidate.round}회 등록 시연. 외부 쓰기 없음.`);
  }
  return <Frame title="농금원 업무 워크플로우" subtitle="배정부터 회차 보고까지, 담당 업무의 진행 상태를 한눈에 확인합니다." links={admin?[["overview","업무 현황"],["imports","업로드 검토"],["companies","기업·배정"],["visits","회차 보고"]]:[["companies","내 배정 기업"],["visits","방문·보고 상태"]]}>
    <section className="panel"><h2>합성 화면 역할 선택</h2><div className="toolbar"><label htmlFor="role">시연 역할</label><select id="role" value={role} onChange={e=>{setRole(e.target.value);setEvents([]);setMessage('역할 화면이 변경되었습니다. 실제 로그인 기능은 없습니다.');}}><option>관리자</option><option>컨설턴트</option></select>{!admin&&<><label htmlFor="identity">합성 사용자</label><select id="identity" value={identity} onChange={e=>{setIdentity(e.target.value);setEvents([]);}}>{consultants.slice(1).map(c=><option key={c}>{c}</option>)}</select></>}</div><p className="muted">역할 선택은 UI 시연입니다. 실제 인증·서버 권한·RLS는 없으므로 보안 통제로 사용할 수 없습니다. 경영체 로그인은 제공하지 않습니다.</p></section>
    {admin&&<section id="overview"><h2>관리자 KPI · 합성 보고 제출 건수</h2><div className="metrics"><Metric label="진단 / 목표 90건" value={`${diagnostic} / 90`}><progress value={diagnostic} max={90} aria-label="진단 합성 진행률"/></Metric><Metric label="컨설팅 / 목표 330건" value={`${consulting} / 330`}><progress value={consulting} max={330} aria-label="컨설팅 합성 진행률"/></Metric><Metric label="IR 선발 / 목표 15건" value="0 / 15"><small>IR 직행 태그와 선발은 별개</small></Metric><Metric label="월 목표 페이스" value="30건"><small>월별 실적 집계는 미연결</small></Metric></div></section>}
    {admin&&<section id="imports" className="panel"><h2>주간 업로드 · 합성 회차 중복 검토</h2><p>Excel 업로드를 대신하는 고정 합성 미리보기입니다. 기업 ID + 상담 유형 + 회차로 기존 회차와 이번 등록 결과를 비교합니다. 실제 열 매핑·파일 파싱은 미구현입니다.</p><div className="table-wrap"><table><caption>기업 이름 대신 합성 ID로 중복 판단 / 실제 행 없음</caption><thead><tr><th scope="col">합성 행</th><th scope="col">기업</th><th scope="col">회차</th><th scope="col">검토 결과</th><th scope="col">조치</th></tr></thead><tbody>{importCandidates.map(c=>{const done=imported.includes(c.id),skip=skipped.includes(c.id),dup=duplicate(c);return <tr key={c.id}><td>{c.id}</td><td>{c.name}</td><td>{c.type} {c.round}회</td><td><Badge tone={dup&&!done?'warn':'ok'}>{done?'등록 시연 완료':skip?'제외 처리':dup?'중복 · 등록 차단':'검토 가능'}</Badge></td><td><div className="toolbar"><button disabled={done||skip||dup} onClick={()=>addCandidate(c)}>등록 시연</button><button disabled={done||skip} onClick={()=>{setSkipped(items=>[...items,c.id]);log(`${c.id} 합성 행을 화면에서 제외 처리했습니다.`);}}>제외</button></div></td></tr>;})}</tbody></table></div><button disabled>실제 Excel 업로드 · 미연결</button></section>}
    <section id="companies" className="panel"><h2>{admin?'전체 기업·컨설턴트 배정':'내 배정 기업'}</h2><div className="toolbar"><label htmlFor="search">합성 기업 검색</label><input id="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="합성 경영체 이름"/><label htmlFor="filter">구분 태그</label><select id="filter" value={filter} onChange={e=>setFilter(e.target.value)}><option>전체</option><option>IR 직행</option></select></div><div className="table-wrap"><table><caption>{admin?'관리자 합성 기업 목록':'선택한 합성 컨설턴트에 배정된 기업만 표시'}</caption><thead><tr><th scope="col">기업</th><th scope="col">상태 / 태그</th><th scope="col">배정</th><th scope="col">보고</th><th scope="col">상세</th></tr></thead><tbody>{visible.map(c=><tr key={c.id}><td>{c.name}<br/><small>{c.id}</small></td><td>{c.status}<br/>{c.direct&&<Badge>IR 직행</Badge>}</td><td>{admin?<select aria-label={`${c.name} 컨설턴트 배정`} value={c.consultant} onChange={e=>{const value=e.target.value;updateCompany(c.id,item=>({...item,consultant:value,status:value==='미배정'?'배정 대기':item.status==='배정 대기'?'진단 대기':item.status}));log(`${c.name} → ${value} 배정 시연`);}}>{consultants.map(v=><option key={v}>{v}</option>)}</select>:c.consultant}</td><td>{c.visits.filter(v=>v.report==='제출 시연').length} / {c.visits.length} 제출 시연</td><td><button aria-pressed={company?.id===c.id} onClick={()=>setSelected(c.id)}>회차 보기</button></td></tr>)}</tbody></table></div>{!visible.length&&<p className="empty">조건에 맞는 배정 기업이 없습니다.</p>}</section>
    <section id="visits" className="panel"><h2>상담·방문 회차 / {company?.name||'배정 없음'}</h2><p className="muted">진단 1회·컨설팅 최대 3회 정책. 아래 일정과 출발 기준지는 합성 입력만 사용하세요. 실제 보고서 파일은 업로드하지 않습니다.</p>{company?.visits.length ? <div className="table-wrap"><table><caption>선택 기업의 회차별 일정과 보고 상태</caption><thead><tr><th scope="col">회차</th><th scope="col">방문 가능일</th><th scope="col">출발 기준지</th><th scope="col">보고 상태</th><th scope="col">조치</th></tr></thead><tbody>{company.visits.map(v=><tr key={v.id}><td>{v.type} {v.round}회</td><td><input aria-label={`${v.type} ${v.round}회 방문 가능일`} type="date" value={v.date==='미정'?'':v.date} onChange={e=>{const date=e.target.value||'미정';updateCompany(company.id,c=>({...c,visits:c.visits.map(x=>x.id===v.id?{...x,date}:x)}));}}/></td><td><input aria-label={`${v.type} ${v.round}회 합성 출발 기준지`} maxLength={80} value={v.origin} onChange={e=>{const origin=e.target.value;updateCompany(company.id,c=>({...c,visits:c.visits.map(x=>x.id===v.id?{...x,origin}:x)}));}}/></td><td><Badge tone={v.report==='미제출'?'warn':'ok'}>{v.report}</Badge></td><td><button disabled={v.report==='제출 시연'} onClick={()=>{updateCompany(company.id,c=>({...c,visits:c.visits.map(x=>x.id===v.id?{...x,report:'제출 시연'}:x)}));log(`${company.name} ${v.type} ${v.round}회 제출 상태 시연. 파일 업로드 없음.`);}}>제출 상태 시연</button></td></tr>)}</tbody></table></div>:<p className="empty">등록된 회차가 없습니다. 관리자가 합성 업로드 검토에서 진단 회차를 등록할 수 있습니다.</p>}</section>
    <div className="grid"><section className="panel"><h2>미연결 기능</h2><p>실제 Google Sheets·Excel 읽기/쓰기, 지도·방문 순서 계산, AI 분석, 사업자번호 조회, IR 파일·문서 변환은 연결되지 않았습니다.</p><div className="toolbar"><button disabled>지도 · 미연결</button><button disabled>AI 분석 · 비활성</button><button disabled>사업자 조회 · 비활성</button><button disabled>문서 변환 · 미연결</button>{admin&&<button disabled>정산 · 미연결</button>}</div></section><section className="panel"><h2>화면 내 작업 안내</h2><p role="status">{message}</p><p className="muted">실제 감사 로그가 아닙니다. 새로고침하거나 역할을 바꾸면 이 안내 이력은 초기화됩니다.</p>{events.length>0&&<ol className="history">{events.map((e,i)=><li key={`${events.length-i}-${e}`}>{e}</li>)}</ol>}</section></div>
  </Frame>;
}
