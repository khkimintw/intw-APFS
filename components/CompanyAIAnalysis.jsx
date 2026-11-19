'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../modules/api';
import { COMPANY_DOCUMENT_CATEGORIES, listCompanyDocuments } from '../modules/companyDocuments';
import { isAdmin } from '../modules/workflow';
import { ASSESSMENT_RUBRIC, SURVEY_RESPONSE_COUNT, CRITICAL_AXES, EARLY_STAGE_COMPENSABLE_AXES } from '../modules/assessmentWeights';

const SUPPORTED = new Set(['pdf','doc','docx','ppt','pptx','xls','xlsx','csv','txt','md']);
const extOf = name => (String(name || '').match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
const label = file => String(file || '').replace(/^[0-9a-f-]{36}__/i, '');
const fmtDate = value => value ? new Date(value).toLocaleString('ko-KR') : '';
const escMd = value => String(value || '').replace(/\r/g,'').trim();
function reportMarkdown(report) {
  const lines = ['# 사업계획서·IR 검토 참고 보고서','', '- 경영체: '+report.company_name, '- 분석 시각: '+fmtDate(report.created_at), '- 모델: '+report.model, '- 설문 가중 점수: '+(report.overallScore == null ? '산정 불가' : report.overallScore+'/100'),'','> '+(report.disclaimer || '설문 기반 AI 검토 참고자료입니다.'),'','## 요약','',escMd(report.summary),'','## 평가 항목',''];
  (report.metrics||[]).forEach(item => lines.push('- **'+(item.code||'')+' '+(item.name||'항목')+'** · '+(item.score == null?'점수 보류':item.score+'/4')+' · 축 '+item.axisWeight+'% / 지표 '+item.indicatorWeight+'% / 합산 '+item.combinedWeight+'%\n  - 근거: '+(item.evidence||'확인된 근거 없음')+'\n  - 메모: '+(item.note||'—')));
  for (const [title,key] of [['강점','strengths'],['주요 위험','risks'],['추가 확인 자료','missingEvidence'],['개선 권고','recommendations']]) { lines.push('','## '+title,''); (report[key]||[]).forEach(item=>lines.push('- '+(typeof item==='string'?item:JSON.stringify(item)))); }
  lines.push('','## 분석에 사용한 자료','',...(report.sources||[]).map(item=>'- '+item),'','## 산정 기준','',escMd(report.scoreBasis));
  return lines.join('\n');
}
function saveText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const sampleReport = company => ({
  company_name:company.business_name,created_at:new Date().toISOString(),model:'Pseudo 미리보기',
  overallScore:null,scoreBasis:'가상 화면 예시입니다. 파일 내용은 업로드·분석하지 않았습니다.',
  summary:'실제 분석 전 미리보기입니다. 실제 모드에서는 선택된 PDF·Office 자료를 바탕으로 핵심 내용과 확인할 항목을 정리합니다.',
  strengths:['제공 자료의 요약과 근거를 이곳에서 확인합니다.'],risks:['자료 간 숫자·일정이 다른지 교차 확인합니다.'],
  missingEvidence:['시장 규모와 매출 가정의 출처'],recommendations:['근거가 부족한 수치에 출처와 산정 기준을 추가합니다.'],
  metrics:[{name:'시장·고객',score:null,evidence:'실제 자료 미분석',note:'실제 분석 후 근거를 표시합니다.'},{name:'실행 계획',score:null,evidence:'실제 자료 미분석',note:'실제 분석 후 근거를 표시합니다.'}],
  sources:[],disclaimer:'Pseudo 예시 보고서입니다. 실제 파일 내용이나 AI 분석 결과가 아닙니다.'
});

export default function CompanyAIAnalysis({ company, session, profile }) {
  const pseudo=!!session?.pseudoMode;
  const permitted=pseudo||isAdmin(profile)||(profile?.role==='user'&&profile?.user_kind==='consultant');
  const [documents,setDocuments]=useState([]);
  const [selected,setSelected]=useState([]);
  const [loading,setLoading]=useState(true);
  const [running,setRunning]=useState(false);
  const [message,setMessage]=useState('');
  const [report,setReport]=useState(null);
  const categories=useMemo(()=>Object.fromEntries(COMPANY_DOCUMENT_CATEGORIES.map(item=>[item.id,item.label])),[]);
  const refresh=useCallback(async()=>{
    if(!company?.id)return;
    if(pseudo){try{setDocuments(JSON.parse(sessionStorage.getItem('apfs-pseudo-company-documents-'+company.id)||'[]'));}catch{setDocuments([]);}setLoading(false);return;}
    setLoading(true);try{setDocuments(await listCompanyDocuments(company.id));setMessage('');}catch(e){setMessage(e.message);}finally{setLoading(false);}
  },[company?.id,pseudo]);
  useEffect(()=>{refresh();},[refresh]);
  function toggle(path){setSelected(items=>items.includes(path)?items.filter(item=>item!==path):items.concat(path).slice(-5));setReport(null);}
  async function analyze(){
    if(!selected.length||running)return;
    setRunning(true);setMessage('선택한 자료를 안전하게 읽고 분석 요청을 준비합니다.');
    try{
      if(pseudo){setReport(sampleReport(company));setMessage('Pseudo 예시 보고서를 만들었습니다. 실제 문서 내용은 전송하지 않았습니다.');}
      else {const result=await apiRequest(session,'/companies/'+encodeURIComponent(company.id)+'/ai-analysis',{method:'POST',body:{paths:selected}});setReport(result);setMessage('분석 참고 보고서를 만들었습니다. 근거와 점수는 사람이 검토해 주세요.');}
    }catch(e){setMessage(e.message||'분석을 완료하지 못했습니다.');}
    finally{setRunning(false);}
  }
  const safeBase=String(company.business_name||'company').replace(/[\\/:*?"<>|]/g,'_').slice(0,60);
  return <section className="surface company-ai-analysis" aria-labelledby="company-ai-title">
    <div className="section-head"><div><span className="eyebrow">SASURAE AI · REVIEW ASSISTANT</span><h2 id="company-ai-title">사업계획서·IR AI 분석</h2><p>설문 응답을 반영한 5개 평가축과 25개 지표(각 1~4점)로 핵심, 근거, 위험 요인과 보완 제안을 정리합니다.</p></div><span className="pill status">설문 반영 · {SURVEY_RESPONSE_COUNT}명</span></div>
    <details className="ai-rubric-details"><summary>설문 가중치 기준 보기</summary><p>설문 응답 {SURVEY_RESPONSE_COUNT}명의 순위 응답을 Borda 점수로 환산했습니다. 상위 축과 축별 5개 지표의 가중치는 각각 100%가 되도록 정규화했습니다.</p><div className="ai-rubric-grid">{ASSESSMENT_RUBRIC.map(axis=><article key={axis.id}><b>{axis.label} · {axis.weight}%</b><ul>{axis.indicators.map(item=><li key={item.id}>{item.label} <strong>{item.weight}%</strong></li>)}</ul></article>)}</div><p>응답자가 특히 중요하다고 고른 축: {CRITICAL_AXES.map(item=>item.label+' '+item.respondents+'/10').join(' · ')}. 초기 단계에서 보완 가능하다고 본 축: {EARLY_STAGE_COMPENSABLE_AXES.map(item=>item.label+' '+item.respondents+'/10').join(' · ')}.</p></details>\n    {pseudo&&<div className="alert pseudo-file-note">Pseudo 미리보기입니다. 파일명만 사용한 샘플 결과를 만들며 실제 파일은 전송하지 않습니다.</div>}
    {!permitted&&<p className="fine-print">관리자 또는 배정된 컨설턴트가 분석할 수 있습니다.</p>}
    {loading?<div className="progress-box compact-progress"><progress aria-label="분석할 자료 불러오는 중"/><span>자료 목록을 불러오는 중…</span></div>:<div className="ai-file-picker"><div className="ai-file-picker-head"><b>분석에 사용할 자료 ({selected.length}/5)</b><button type="button" className="ghost-button" onClick={refresh}>목록 새로고침</button></div>{documents.length?documents.map(doc=>{const ext=extOf(doc.name),supported=SUPPORTED.has(ext);return <label className={'ai-file-choice'+(!supported?' unsupported':'')} key={doc.path||doc.id}><input type="checkbox" checked={selected.includes(doc.path||doc.id)} disabled={!permitted||!supported||running||(!selected.includes(doc.path||doc.id)&&selected.length>=5)} onChange={()=>toggle(doc.path||doc.id)}/><span><b>{label(doc.name)}</b><small>{categories[doc.category]||'자료'} · {ext.toUpperCase()} · {fmtDate(doc.created_at)}</small></span><em>{supported?'분석 가능':'PDF 변환 필요'}</em></label>}) : <p className="empty-state">분석할 자료가 없습니다. 위 자료함에 IR 자료나 사업계획서를 먼저 올려주세요.</p>}</div>}
    <div className="ai-analysis-actions"><button type="button" className="primary" disabled={!permitted||running||!selected.length||company?.status==='포기'} onClick={analyze}>{running?'분석 중…':'선택 자료 분석'}</button><span>PDF·Word·PowerPoint·Excel·CSV·TXT · 합계 최대 15MB</span></div>
    {running&&<div className="progress-box compact-progress" role="status"><progress/><span>문서를 읽고 요약·평가 항목·보완점을 정리하고 있습니다. 파일 수와 분량에 따라 시간이 걸릴 수 있습니다.</span></div>}
    {message&&<p className="form-message" role="status">{message}</p>}
    {report&&<div className="ai-report" aria-live="polite"><div className="ai-report-head"><div><span className="eyebrow">분석 참고 보고서</span><h3>{report.company_name}</h3><time>{fmtDate(report.created_at)}</time></div><strong>{report.overallScore==null?'—':report.overallScore}<small>{report.overallScore==null?'점수 미산정':'/ 100 가중'}</small></strong></div><p className="ai-disclaimer">{report.disclaimer}</p><h4>핵심 요약</h4><p>{report.summary||'요약이 없습니다.'}</p>{report.metrics?.length>0&&<><h4>평가 항목과 근거</h4><div className="ai-metrics">{report.metrics.map((item,i)=><article key={i}><b>{item.name||'평가 항목'}</b><span>{item.score==null?'근거 부족':item.score+' / 4점 · '+item.combinedWeight+'% 가중'}</span><p>{item.evidence||'근거를 확인하지 못했습니다.'}</p><small>{item.note||''}</small></article>)}</div></>}{[['강점','strengths'],['위험 요인','risks'],['추가 확인','missingEvidence'],['보완 제안','recommendations']].map(([title,key])=><div key={key}><h4>{title}</h4>{report[key]?.length?<ul>{report[key].map((item,i)=><li key={i}>{typeof item==='string'?item:JSON.stringify(item)}</li>)}</ul>:<p className="fine-print">확인된 내용 없음</p>}</div>)}<div className="ai-report-actions"><button type="button" className="ghost-button" onClick={()=>saveText(safeBase+'_AI_검토보고서.md',reportMarkdown(report),'text/markdown;charset=utf-8')}>Markdown 내려받기</button><button type="button" className="ghost-button" onClick={()=>saveText(safeBase+'_AI_검토보고서.json',JSON.stringify(report,null,2),'application/json;charset=utf-8')}>JSON 내려받기</button></div></div>}
  </section>;
}
