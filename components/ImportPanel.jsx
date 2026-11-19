'use client';
import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../modules/api';
import { IMPORT_LIMITS, FIELD_LABELS, buildImportPreview, parseCsv } from '../modules/companyImport';

const EXAMPLE_ROWS = [
  { business_name: '[예시] 다온농식품', business_registration_number: '000-00-00001', founded_year: '2020', ir_direct: false, status: '배정 대기', intake_date: '1주차' },
  { business_name: '[예시] 새싹농업', business_registration_number: '000-00-00002', founded_year: '2018', ir_direct: true, status: '진단 대기', intake_date: '2주차' },
  { business_name: '[예시] 푸른들영농', business_registration_number: '000-00-00003', founded_year: '2022', ir_direct: false, status: '컨설팅 진행', intake_date: '3주차' },
];
const cellText = value => {
  if (value == null) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text).join('');
    if ('result' in value) return cellText(value.result);
    if ('text' in value) return cellText(value.text);
    return '';
  }
  return String(value);
};
async function readMatrix(file) {
  const buffer = await file.arrayBuffer();
  if (/\.csv$/i.test(file.name)) {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { text = new TextDecoder('euc-kr').decode(buffer); }
    return parseCsv(text);
  }
  let parseBuffer = buffer;
  const signature = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 8));
  const encryptedOle = signature.length === 8 && [0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].every((byte,index)=>signature[index]===byte);
  if (/\.xlsx$/i.test(file.name) && encryptedOle) {
    try {
      const module = await import('xlsx-populate/browser/xlsx-populate.min.js');
      const XlsxPopulate = module.default || module.XlsxPopulate || window.XlsxPopulate;
      const decrypted = await XlsxPopulate.fromDataAsync(buffer, { password:'2026' });
      parseBuffer = await decrypted.outputAsync('arraybuffer');
    } catch {
      throw new Error('PASSWORD_DECRYPT_FAILED');
    }
  }
  const XLSX = await import('xlsx');
  const codepages = await import('xlsx/dist/cpexcel.full.mjs');
  XLSX.set_cptable(codepages);
  const workbook = XLSX.read(parseBuffer, { type:'array', password:encryptedOle && /\.xlsx$/i.test(file.name) ? undefined : '2026', cellDates:true, sheetRows:IMPORT_LIMITS.maxRows + 51 });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('시트를 찾지 못했습니다.');
  return XLSX.utils.sheet_to_json(sheet, { header:1, raw:false, defval:'', blankrows:false })
    .slice(0, IMPORT_LIMITS.maxRows + 51)
    .map(row => row.slice(0,60).map(cellText));
}

export default function ImportPanel({ session, companies, onDone }) {
  const [state, setState] = useState({ phase: 'idle' }); // idle | reading | preview | importing | done
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState('');
  const lock = useRef(false);
  useEffect(() => { let active=true; apiRequest(session, '/companies/import-history').then(rows => { if(active)setHistory(rows||[]); }).catch(() => { if(active)setHistoryError('최근 등록 이력을 불러오지 못했습니다.'); }); return () => { active=false; }; }, [session]);

  function downloadTemplate() {
    const csv = '\uFEFF기업명,사업자등록번호,설립연도,테마,사업연도,발표일정,접수주차,상태,구분\r\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = '농금원_경영체_업로드_빈양식.csv';
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function choose(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(''); setResult(null);
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { setError('.xls, .xlsx 또는 .csv 파일만 올릴 수 있습니다.'); return; }
    if (file.size > IMPORT_LIMITS.maxFileBytes) { setError('파일이 너무 큽니다. 5MB 이하로 줄여 주세요.'); return; }
    setState({ phase: 'reading', name: file.name });
    try {
      const preview = buildImportPreview(await readMatrix(file), companies);
      if (preview.error) { setError(preview.error); setState(preview.mapped ? { phase: 'idle', mapped: preview.mapped, ignored: preview.ignored } : { phase: 'idle' }); return; }
      setState({ phase: 'preview', name: file.name, ...preview });
    } catch (problem) {
      const detail=String(problem?.message||'').toLowerCase();
      setError(detail.includes('password_decrypt_failed') ? '암호 2026으로 파일을 열지 못했습니다. 암호가 바뀌었거나 지원하지 않는 Excel 암호화 형식일 수 있습니다. Excel에서 열리는지 확인한 뒤, 계속 실패하면 보호를 해제하고 XLSX 또는 CSV로 저장해 주세요.' : /password|encrypt|decrypt|encryption|cfb|unsupported/.test(detail) ? '파일 암호를 확인할 수 없습니다. Excel에서 암호를 입력해 열고 보호를 해제한 뒤 XLSX 또는 CSV로 다시 저장해 주세요.' : '파일을 읽지 못했습니다. 파일 형식과 첫 번째 시트의 머리글을 확인해 주세요.');
      setState({ phase: 'idle' });
    }
  }

  async function run() {
    if (lock.current || state.phase !== 'preview') return;
    const rows = state.items.map(item => item.status === 'error' ? { _invalid: true } : item.values);
    const batchId = crypto.randomUUID();
    if (!rows.length) return;
    lock.current = true; setError(''); setProgress({ done: 0, total: rows.length }); setState(prev => ({ ...prev, phase: 'importing' }));
    const total = { received: 0, inserted: 0, skipped_duplicate: 0, invalid: 0 };
    try {
      for (let i = 0; i < rows.length; i += IMPORT_LIMITS.batchRows) {
        const batch = rows.slice(i, i + IMPORT_LIMITS.batchRows);
        const counts = await apiRequest(session, '/companies/import', { method: 'POST', body: { rows: batch, filename: state.name, batch_id: batchId, received_count: rows.length } });
        for (const key of Object.keys(total)) total[key] += Number(counts?.[key] || 0);
        setProgress({ done: Math.min(rows.length, i + batch.length), total: rows.length });
      }
      setResult(total); setState({ phase: 'done' });
    } catch (problem) { setError(`${problem.message} (이미 처리된 ${total.inserted.toLocaleString()}건은 등록되었습니다. 목록을 새로고침해 확인하세요.)`); setState({ phase: 'idle' }); }
    finally { lock.current = false; try { await onDone?.(); } catch { /* list refresh is best effort */ } try { setHistory(await apiRequest(session, '/companies/import-history')||[]); setHistoryError(''); } catch { setHistoryError('최근 등록 이력을 새로고침하지 못했습니다.'); } }
  }

  const busy = state.phase === 'reading' || state.phase === 'importing';
  const preview = state.phase === 'preview' || state.phase === 'importing';
  const shown = preview ? state.items.slice(0, 20) : [];
  return <section className="surface import-card" aria-busy={busy}>
    <div className="section-head"><div><h2>엑셀 업로드</h2><p>.xls / .xlsx / .csv 파일에서 기업 정보를 일괄 등록합니다. 파일 열기 암호 2026을 자동으로 시도하고, 시트 편집 보호는 읽기에 영향을 주지 않습니다. 최대 {IMPORT_LIMITS.maxRows}행 · 5MB.</p></div></div>
    <div className="alert info">관리자 전용 가져오기입니다. 경영체·대표자·담당자·주소·특이사항을 역할별 접근제어가 적용된 영역에 저장합니다. 주민등록번호·계좌번호는 가져오지 않습니다. 기업명 또는 사업자번호가 이미 있으면 중복으로 건너뜁니다.</div>
    <section className="import-example" aria-labelledby="import-example-title">
      <div className="import-example-head"><div><h3 id="import-example-title">예시 데이터 미리보기</h3><p>아래 표는 형식 이해를 위한 가상 예시이며 실제 경영체 목록에 등록되지 않습니다.</p></div><button type="button" className="ghost-button" onClick={downloadTemplate}>빈 CSV 양식 다운로드</button></div>
      <div className="table-wrap"><table className="import-table sample-import-table"><caption className="sr-only">등록되지 않는 가상 예시 데이터</caption><thead><tr><th>기업명</th><th>사업자번호</th><th>설립연도</th><th>구분</th><th>상태</th><th>접수주차</th></tr></thead><tbody>{EXAMPLE_ROWS.map(row => <tr key={row.business_name}><td><b>{row.business_name}</b></td><td>{row.business_registration_number}</td><td>{row.founded_year}</td><td>{row.ir_direct ? 'IR 직행' : '컨설팅'}</td><td>{row.status}</td><td>{row.intake_date}</td></tr>)}</tbody></table></div>
      <p className="fine-print">CSV 양식은 머리글만 있는 빈 파일입니다. 예시 행은 가상 안내용으로만 화면에 표시합니다.</p>
    </section>
    <label className="upload-drop"><input type="file" accept=".xls,.xlsx,.csv" onChange={choose} disabled={busy}/><span>파일 선택 (.xls, .xlsx, .csv)</span><small>첫 번째 시트의 첫 행을 머리글로 읽습니다. 파일 열기 암호가 설정된 XLSX도 암호 2026으로 브라우저에서 해독해 읽습니다. 파일·암호는 서버로 전송하지 않습니다.</small></label>
    {state.phase === 'reading' && <div className="progress-box" role="status"><progress aria-label="파일 읽는 중"/><span>{state.name} 읽는 중…</span></div>}
    {error && <div className="alert error" role="alert">{error}</div>}
    {error && state.mapped && <p className="fine-print">인식한 열: {state.mapped.map(item => FIELD_LABELS[item.field]).join(', ') || '없음'}</p>}
    {preview && <>
      <div className="import-summary" role="status"><span>전체 <b>{state.counts.total}</b>행</span><span className="ok">신규 <b>{state.counts.new}</b></span><span className="warn">중복 건너뜀 <b>{state.counts.duplicate}</b></span><span className="bad">오류 <b>{state.counts.error}</b></span></div>
      <p className="fine-print">인식한 열: {state.mapped.map(item => `${item.label} → ${FIELD_LABELS[item.field]}`).join(' · ')}</p>
      {state.ignored.length > 0 && <p className="fine-print">제외한 열 {state.ignored.length}개: {state.ignored.map(item => `${item.label}(${item.reason})`).join(' · ')}</p>}
      <div className="table-wrap"><table className="import-table"><caption className="sr-only">가져오기 미리보기 (앞 20행)</caption><thead><tr><th>행</th><th>결과</th><th>기업명</th><th>사업자번호</th><th>설립연도</th><th>구분</th><th>상태</th></tr></thead><tbody>{shown.map(item => <tr key={item.line} className={item.status}><td>{item.line}</td><td>{item.status === 'new' ? '신규' : item.status === 'duplicate' ? '중복 건너뜀' : item.errors.join(', ')}</td><td>{item.values.business_name || '—'}</td><td>{item.values.business_registration_number || '—'}</td><td>{item.values.founded_year || '—'}</td><td>{item.values.ir_direct ? 'IR 직행' : '컨설팅'}</td><td>{item.values.status || '배정 대기'}</td></tr>)}</tbody></table></div>
      {state.items.length > 20 && <p className="fine-print">앞 20행만 표시합니다. 나머지도 같은 규칙으로 처리됩니다.</p>}
      {state.phase === 'importing' && <div className="progress-box" role="status"><progress max={progress.total || 1} value={progress.done} aria-label="가져오기 진행률"/><span>등록 중 · {progress.done.toLocaleString()} / {progress.total.toLocaleString()}건 ({IMPORT_LIMITS.batchRows}건씩 전송)</span></div>}
      <div className="import-actions"><button className="primary" onClick={run} disabled={busy || !state.counts.new}>{state.phase === 'importing' ? '등록 중…' : `신규 ${state.counts.new}건 등록`}</button><button type="button" className="ghost-button" onClick={() => setState({ phase: 'idle' })} disabled={busy}>취소</button></div>
    </>}
    {state.phase === 'done' && result && <div className="alert info" role="status">완료: 접수 {result.received}건 · 등록 <b>{result.inserted}</b>건 · 중복 건너뜀 {result.skipped_duplicate}건 · 오류 {result.invalid}건. 중복·오류 행은 위 미리보기에서 확인하세요.</div>}
    <section className="import-history" aria-labelledby="import-history-title"><div className="section-head"><div><h3 id="import-history-title">최근 등록 이력</h3><p>경영체가 등록된 시각과 작업 계정을 기록합니다.</p></div></div>{historyError && <p className="fine-print" role="status">{historyError}</p>}{history.length ? <div className="table-wrap"><table className="import-table"><caption className="sr-only">최근 업로드 이력과 되돌리기</caption><thead><tr><th>파일</th><th>작업자·시각</th><th>결과</th><th>작업</th></tr></thead><tbody>{history.map(item=><tr key={item.id}><td>{item.source_filename || '파일명 없음'}</td><td><b>{item.uploaded_by}</b><small><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString('ko-KR')}</time></small></td><td>등록 {item.inserted_count} · 중복 {item.duplicate_count} · 오류 {item.invalid_count}</td><td>{item.undone_at ? <span className="pill">되돌림 완료</span> : item.inserted_count > 0 ? <button type="button" className="ghost-button danger-button" disabled={busy} onClick={async()=>{if(!window.confirm(`${item.source_filename||'이 업로드'}에서 추가된 ${item.inserted_count}개 경영체를 되돌릴까요? 수정했거나 회차가 연결된 데이터는 안전을 위해 취소되지 않습니다.`))return;setError('');try{await apiRequest(session,'/companies/import-undo',{method:'POST',body:{batch_id:item.id}});setHistory(await apiRequest(session,'/companies/import-history')||[]);await onDone?.();}catch(problem){setError(problem.message);}}}>업로드 취소</button> : <span>등록 없음</span>}</td></tr>)}</tbody></table></div>:!historyError&&<p className="fine-print">업로드 이력을 불러왔습니다. 새 배치부터 파일 단위로 기록됩니다.</p>}</section>
  </section>;
}
