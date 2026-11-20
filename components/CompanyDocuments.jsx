'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { COMPANY_DOCUMENT_CATEGORIES, companyDocumentCategoryLabel, deleteCompanyDocument, downloadCompanyDocument, listCompanyDocuments, uploadCompanyDocument, validateCompanyDocument } from '../modules/companyDocuments';
import { listPseudoFiles, readPseudoFile, removePseudoFile, savePseudoFile } from '../modules/pseudoCompanyFiles';
import { isAdmin } from '../modules/workflow';

const bytesLabel = size => {
  const bytes = Number(size || 0);
  if (!bytes) return '크기 정보 없음';
  return bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + 'KB' : (bytes / 1024 / 1024).toFixed(1) + 'MB';
};
const dateLabel = value => value ? new Date(value).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '시각 정보 없음';
const displayFileName = name => String(name || '').replace(/^[0-9a-f-]{36}__/i, '');

export default function CompanyDocuments({ company, session, profile }) {
  const pseudo = !!session?.pseudoMode;
  const [documents, setDocuments] = useState([]);
  const [filter, setFilter] = useState('all');
  const [category, setCategory] = useState(COMPANY_DOCUMENT_CATEGORIES[0].id);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const categoryCounts = useMemo(() => Object.fromEntries(COMPANY_DOCUMENT_CATEGORIES.map(item => [item.id, documents.filter(doc => doc.category === item.id).length])), [documents]);
  const visible = useMemo(() => filter === 'all' ? documents : documents.filter(doc => doc.category === filter), [documents, filter]);
  const admin = isAdmin(profile);

  const refresh = useCallback(async () => {
    if (!company?.id) return;
    setLoading(true);
    try { setDocuments(await (pseudo ? listPseudoFiles(session, company.id) : listCompanyDocuments(company.id))); setMessage(''); }
    catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  }, [company?.id, pseudo, session?.user?.id]);
  useEffect(() => { refresh(); }, [refresh]);

  async function chooseFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length || busy) return;
    setBusy(true); setMessage('');
    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        validateCompanyDocument(file);
        if (pseudo) await savePseudoFile(session, company.id, category, file);
        else await uploadCompanyDocument(company.id, category, file);
        setMessage('자료 ' + (index + 1) + '/' + files.length + '개 저장 중…');
      }
      await refresh();
      setMessage('자료 ' + files.length + '개를 저장했습니다.');
    } catch (error) {
      await refresh();
      setMessage(error.message);
    }
    finally {
      setBusy(false);
      notifyDocumentsUpdated();
    }
  }
  function notifyDocumentsUpdated() {
    window.dispatchEvent(new CustomEvent('apfs-company-documents-updated', { detail: { companyId: company.id } }));
  }
  async function download(doc) {
    try {
      const blob = doc.pseudo ? await readPseudoFile(session, company.id, doc.id) : await downloadCompanyDocument(doc.path);
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = displayFileName(doc.name); document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setMessage(error.message); }
  }
  async function remove(doc) {
    if (doc.pseudo) {
      try {
        await removePseudoFile(session, company.id, doc.id);
        await refresh();
        notifyDocumentsUpdated();
      } catch (error) { setMessage(error.message); }
      return;
    }
    if (!admin || !window.confirm(displayFileName(doc.name) + ' 자료를 삭제할까요?')) return;
    setBusy(true); setMessage('');
    try { await deleteCompanyDocument(doc.path); await refresh(); notifyDocumentsUpdated(); setMessage('자료를 삭제했습니다.'); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  return <section className="surface company-documents" aria-busy={loading || busy} aria-labelledby="company-documents-title">
    <div className="section-head"><div><span className="eyebrow">COMPANY FILES</span><h2 id="company-documents-title">경영체 자료</h2><p>IR·사업계획서·회차별 보고서를 종류별로 보관하고 내려받습니다. {pseudo ? '파일은 이 브라우저에 저장됩니다.' : '파일은 비공개 저장소에 저장됩니다.'}</p></div><span className="pill status">{documents.length}개</span></div>
    {pseudo && <div className="alert pseudo-file-note">예전 Pseudo 자료에 파일명만 저장되어 있었다면 분석할 파일을 다시 올려 주세요.</div>}
    <div className="company-documents-tools">
      <label>자료 구분<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">전체 구분 ({documents.length})</option>{COMPANY_DOCUMENT_CATEGORIES.map(item => <option key={item.id} value={item.id}>{item.label} ({categoryCounts[item.id]})</option>)}</select></label>
      <label>업로드 위치<select value={category} onChange={event => setCategory(event.target.value)}>{COMPANY_DOCUMENT_CATEGORIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="company-document-upload"><input type="file" multiple accept=".pdf,.hwp,.hwpx,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt" onChange={chooseFiles} disabled={busy}/><span>{busy ? '처리 중…' : '자료 올리기'}</span></label>
    </div>
    <p className="fine-print company-documents-hint">PDF, HWP/HWPX, Word, PowerPoint, Excel, CSV, TXT · 파일당 50MB 이하 · 여러 파일을 한 번에 올릴 수 있습니다.</p>
    {message && <p className="form-message" role="status">{message}</p>}
    {loading ? <div className="progress-box compact-progress" role="status"><progress aria-label="자료 목록을 불러오는 중"/><span>자료 목록 불러오는 중…</span></div> : visible.length ? <div className="company-document-list">{visible.map(doc => <article className="company-document-row" key={doc.path || doc.id}><span className="document-file-icon" aria-hidden="true">{(displayFileName(doc.name).split('.').pop() || 'FILE').toUpperCase().slice(0,4)}</span><div className="company-document-meta"><b title={displayFileName(doc.name)}>{displayFileName(doc.name)}</b><span><i>{companyDocumentCategoryLabel(doc.category)}</i><time>{dateLabel(doc.created_at)}</time><em>{bytesLabel(doc.size)}</em></span></div><div className="company-document-actions"><button type="button" className="ghost-button" onClick={() => download(doc)}>내려받기</button>{(admin || doc.pseudo) && <button type="button" className="ghost-button danger-button" disabled={busy} onClick={() => remove(doc)}>삭제</button>}</div></article>)}</div> : <div className="empty-state document-empty">{filter === 'all' ? '아직 등록된 자료가 없습니다.' : companyDocumentCategoryLabel(filter) + ' 자료가 없습니다.'}</div>}
  </section>;
}