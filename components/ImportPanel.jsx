'use client';
import { useRef, useState } from 'react';
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
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('시트를 찾지 못했습니다.');
  const matrix = [], width = Math.min(sheet.columnCount || 0, 60);
  sheet.eachRow({ includeEmpty: false }, (row, number) => {
    if (number > IMPORT_LIMITS.maxRows + 50) return; // far beyond the limit: preview will reject the file
    matrix.push(Array.from({ length: width }, (_, i) => cellText(row.getCell(i + 1).value)));
  });
  return matrix;
}

export default function ImportPanel({ session, companies, onDone }) {
  const [state, setState] = useState({ phase: 'idle' }); // idle | reading | preview | importing | done
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);
  const lock = useRef(false);

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
    if (!/\.(xlsx|csv)$/i.test(file.name)) { setError('.xlsx 또는 .csv 파일만 올릴 수 있습니다. (.xls는 지원하지 않습니다)'); return; }
    if (file.size > IMPORT_LIMITS.maxFileBytes) { setError('파일이 너무 큽니다. 5MB 이하로 줄여 주세요.'); return; }
    setState({ phase: 'reading', name: file.name });
    try {
      const preview = buildImportPreview(await readMatrix(file), companies);
      if (preview.error) { setError(preview.error); setState(preview.mapped ? { phase: 'idle', mapped: preview.mapped, ignored: preview.ignored } : { phase: 'idle' }); return; }
      setState({ phase: 'preview', name: file.name, ...preview });
    } catch { setError('파일을 읽지 못했습니다. 형식과 암호 설정을 확인해 주세요.'); setState({ phase: 'idle' }); }
  }

  async function run() {
    if (lock.current || state.phase !== 'preview') return;
    const rows = state.items.filter(item => item.status === 'new').map(item => item.values);
    if (!rows.length) return;
    lock.current = true; setError(''); setProgress({ done: 0, total: rows.length }); setState(prev => ({ ...prev, phase: 'importing' }));
    const total = { received: 0, inserted: 0, skipped_duplicate: 0, invalid: 0 };
    try {
      for (let i = 0; i < rows.length; i += IMPORT_LIMITS.batchRows) {
        const batch = rows.slice(i, i + IMPORT_LIMITS.batchRows);
        const counts = await apiRequest(session, '/companies/import', { method: 'POST', body: { rows: batch } });
        for (const key of Object.keys(total)) total[key] += Number(counts?.[key] || 0);
        setProgress({ done: Math.min(rows.length, i + batch.length), total: rows.length });
      }
      setResult(total); setState({ phase: 'done' });
    } catch (problem) { setError(`${problem.message} (이미 처리된 ${total.inserted.toLocaleString()}건은 등록되었습니다. 목록을 새로고침해 확인하세요.)`); setState({ phase: 'idle' }); }
    finally { lock.current = false; try { await onDone?.(); } catch { /* list refresh is best effort */ } }
  }

  const busy = state.phase === 'reading' || state.phase === 'importing';
  const preview = state.phase === 'preview' || state.phase === 'importing';
  const shown = preview ? state.items.slice(0, 20) : [];
  return <section className="surface import-card" aria-busy={busy}>
    <div className="section-head"><div><h2>엑셀 업로드</h2><p>.xlsx / .csv 파일에서 기업 정보를 일괄 등록합니다. 최대 {IMPORT_LIMITS.maxRows}행 · 5MB.</p></div></div>
    <div className="alert info">가져오는 항목: 기업명(필수), 사업자번호, 설립연도, 테마, 사업연도, 발표 일정, 접수, 상태, 구분(컨설팅/IR 직행). 연락처·주소·이메일·대표자 등 개인 정보 열은 자동으로 제외됩니다. 기업명 또는 사업자번호가 이미 있는 기업은 건너뜁니다(덮어쓰지 않음).</div>
    <section className="import-example" aria-labelledby="import-example-title">
      <div className="import-example-head"><div><h3 id="import-example-title">예시 데이터 미리보기</h3><p>아래 표는 형식 이해를 위한 가상 예시이며 실제 경영체 목록에 등록되지 않습니다.</p></div><button type="button" className="ghost-button" onClick={downloadTemplate}>빈 CSV 양식 다운로드</button></div>
      <div className="table-wrap"><table className="import-table sample-import-table"><caption className="sr-only">등록되지 않는 가상 예시 데이터</caption><thead><tr><th>기업명</th><th>사업자번호</th><th>설립연도</th><th>구분</th><th>상태</th><th>접수주차</th></tr></thead><tbody>{EXAMPLE_ROWS.map(row => <tr key={row.business_name}><td><b>{row.business_name}</b></td><td>{row.business_registration_number}</td><td>{row.founded_year}</td><td>{row.ir_direct ? 'IR 직행' : '컨설팅'}</td><td>{row.status}</td><td>{row.intake_date}</td></tr>)}</tbody></table></div>
      <p className="fine-print">CSV 양식은 머리글만 있는 빈 파일입니다. 예시 행은 가상 안내용으로만 화면에 표시합니다.</p>
    </section>
    <label className="upload-drop"><input type="file" accept=".xlsx,.csv" onChange={choose} disabled={busy}/><span>파일 선택 (.xlsx, .csv)</span><small>첫 번째 시트의 첫 행을 머리글로 읽습니다.</small></label>
    {state.phase === 'reading' && <div className="progress-box" role="status"><progress aria-label="파일 읽는 중"/><span>{state.name} 읽는 중…</span></div>}
    {error && <div className="alert error" role="alert">{error}</div>}
    {error && state.mapped && <p className="fine-print">인식한 열: {state.mapped.map(item => FIELD_LABELS[item.field]).join(', ') || '없음'}</p>}
    {preview && <>
      <div className="import-summary" role="status"><span>전체 <b>{state.counts.total}</b>행</span><span className="ok">신규 <b>{state.counts.new}</b></span><span className="warn">중복 건너뜀 <b>{state.counts.duplicate}</b></span><span className="bad">오류 <b>{state.counts.error}</b></span></div>
      <p className="fine-print">인식한 열: {state.mapped.map(item => `${item.label} → ${FIELD_LABELS[item.field]}`).join(' · ')}</p>
      {state.ignored.length > 0 && <p className="fine-print">제외한 열 {state.ignored.length}개: {state.ignored.map(item => `${item.label}(${item.reason})`).join(' · ')}</p>}
      <div className="table-wrap"><table className="import-table"><caption className="sr-only">가져오기 미리보기 (앞 20행)</caption><thead><tr><th>행</th><th>결과</th><th>기업명</th><th>사업자번호</th><th>설립연도</th><th>구분</th><th>상태</th></tr></thead><tbody>{shown.map(item => <tr key={item.line} className={item.status}><td>{item.line}</td><td>{item.status === 'new' ? '신규' : item.status === 'duplicate' ? '중복 건너뜀' : item.errors.join(', ')}</td><td>{item.values.business_name || '—'}</td><td>{item.values.business_registration_number ? item.values.business_registration_number.replace(/\d{5}$/, '*****') : '—'}</td><td>{item.values.founded_year || '—'}</td><td>{item.values.ir_direct ? 'IR 직행' : '컨설팅'}</td><td>{item.values.status || '배정 대기'}</td></tr>)}</tbody></table></div>
      {state.items.length > 20 && <p className="fine-print">앞 20행만 표시합니다. 나머지도 같은 규칙으로 처리됩니다.</p>}
      {state.phase === 'importing' && <div className="progress-box" role="status"><progress max={progress.total || 1} value={progress.done} aria-label="가져오기 진행률"/><span>등록 중 · {progress.done.toLocaleString()} / {progress.total.toLocaleString()}건 ({IMPORT_LIMITS.batchRows}건씩 전송)</span></div>}
      <div className="import-actions"><button className="primary" onClick={run} disabled={busy || !state.counts.new}>{state.phase === 'importing' ? '등록 중…' : `신규 ${state.counts.new}건 등록`}</button><button type="button" className="ghost-button" onClick={() => setState({ phase: 'idle' })} disabled={busy}>취소</button></div>
    </>}
    {state.phase === 'done' && result && <div className="alert info" role="status">완료: 접수 {result.received}건 · 등록 <b>{result.inserted}</b>건 · 중복 건너뜀 {result.skipped_duplicate}건 · 오류 {result.invalid}건. 기업 목록에서 확인하세요.</div>}
  </section>;
}
