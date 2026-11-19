import { SUPABASE_URL, SUPABASE_KEY } from '../lib/public-config';

function storageUrl(path) {
  return SUPABASE_URL + '/storage/v1/object/consultation-reports/' + path.split('/').map(encodeURIComponent).join('/');
}

export async function uploadReportFile(session, companyId, sessionId, file) {
  if (!session?.access_token) throw new Error('로그인이 필요합니다. 다시 로그인해 주세요.');
  if (!file?.size || file.size > 20 * 1024 * 1024) throw new Error('보고서 파일은 20MB 이하로 선택하세요.');
  const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  if (!['pdf','hwp','hwpx','doc','docx','xlsx','xls'].includes(ext)) throw new Error('PDF, HWP, HWPX, DOC, DOCX, XLS, XLSX 파일만 올릴 수 있습니다.');
  const safe = file.name.normalize('NFKC').replace(/[^a-zA-Z0-9가-힣._-]/g, '_').slice(-120) || 'report.' + ext;
  const path = companyId + '/' + sessionId + '/' + crypto.randomUUID() + '-' + safe;
  let response;
  try {
    response = await fetch(storageUrl(path), { method:'POST', headers:{ apikey:SUPABASE_KEY, Authorization:'Bearer '+session.access_token, 'Content-Type':file.type||'application/octet-stream' }, body:file });
  } catch { throw new Error('비공개 보고서 저장소에 연결하지 못했습니다.'); }
  if (!response.ok) throw new Error('파일을 올리지 못했습니다. 배정 권한과 파일 크기를 확인하세요.');
  return { path, name:file.name, file_size:file.size };
}

export async function removeReportFile(session, path) {
  if (!path || !session?.access_token) return;
  try { await fetch(storageUrl(path), { method:'DELETE', headers:{ apikey:SUPABASE_KEY, Authorization:'Bearer '+session.access_token } }); } catch { /* private orphan cleanup is best effort */ }
}
