import { supabase } from '../lib/supabase';

export const COMPANY_DOCUMENT_CATEGORIES = [
  { id: 'ir_materials', label: 'IR 자료' },
  { id: 'business_plan', label: '사업계획서' },
  { id: 'diagnosis_report', label: '기업진단보고서' },
  { id: 'consulting_report_1', label: '컨설팅 보고서 · 1회차' },
  { id: 'consulting_report_2', label: '컨설팅 보고서 · 2회차' },
  { id: 'consulting_report_3', label: '컨설팅 보고서 · 3회차' },
  { id: 'performance_confirmation', label: '수행 확인서' },
  { id: 'other', label: '기타 자료' },
];
const BUCKET = 'company-documents';
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['pdf','hwp','hwpx','doc','docx','ppt','pptx','xls','xlsx','csv','txt']);

function requireStorage() {
  if (!supabase) throw new Error('자료 저장소 설정을 확인하세요.');
  return supabase.storage.from(BUCKET);
}
function safeName(value) {
  return String(value || '').normalize('NFKC').replace(/[\\/]/g, '_').replace(/[^a-zA-Z0-9가-힣._-]/g, '_').slice(-120) || 'document';
}
export function validateCompanyDocument(file) {
  const ext = (String(file?.name || '').match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) throw new Error('PDF, HWP, HWPX, Word, PowerPoint, Excel, CSV, TXT 파일만 올릴 수 있습니다.');
  if (!file?.size) throw new Error('빈 파일은 올릴 수 없습니다.');
  if (file.size > MAX_FILE_BYTES) throw new Error('파일은 50MB 이하로 선택하세요.');
}
export async function listCompanyDocuments(companyId) {
  const bucket = requireStorage();
  const groups = await Promise.all(COMPANY_DOCUMENT_CATEGORIES.map(async category => {
    const { data, error } = await bucket.list(companyId + '/' + category.id, { limit: 100, offset: 0, sortBy: { column: 'created_at', order: 'desc' } });
    if (error) throw new Error('자료 목록을 불러오지 못했습니다. 회사 접근 권한을 확인하세요.');
    return (data || []).filter(item => item.id && item.name).map(item => ({
      id: item.id, name: item.name.replace(/^[0-9a-f-]{36}__/i, ''),
      path: companyId + '/' + category.id + '/' + item.name, category: category.id,
      size: Number(item.metadata?.size || 0), created_at: item.created_at || item.updated_at || null,
      owner_id: item.owner_id || item.owner || null,
    }));
  }));
  return groups.flat().sort((a,b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}
export async function uploadCompanyDocument(companyId, category, file) {
  validateCompanyDocument(file);
  if (!COMPANY_DOCUMENT_CATEGORIES.some(item => item.id === category)) throw new Error('자료 구분을 확인하세요.');
  const path = companyId + '/' + category + '/' + crypto.randomUUID() + '__' + safeName(file.name);
  const { error } = await requireStorage().upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || 'application/octet-stream' });
  if (error) throw new Error('자료를 저장하지 못했습니다. 파일 크기와 권한을 확인하세요.');
  return path;
}
export async function downloadCompanyDocument(path) {
  const { data, error } = await requireStorage().download(path);
  if (error || !data) throw new Error('자료를 내려받지 못했습니다. 파일 권한 또는 저장 상태를 확인하세요.');
  return data;
}
export async function deleteCompanyDocument(path) {
  const { error } = await requireStorage().remove([path]);
  if (error) throw new Error('자료를 삭제하지 못했습니다. 관리자에게 권한을 확인해 주세요.');
}
export function companyDocumentCategoryLabel(category) {
  return COMPANY_DOCUMENT_CATEGORIES.find(item => item.id === category)?.label || '기타 자료';
}