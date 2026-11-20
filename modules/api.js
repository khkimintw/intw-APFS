import { pseudoRequest } from './pseudoApi';

async function liveRequest(session, path, options = {}) {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (!session?.access_token) throw new Error('로그인이 필요합니다. 다시 로그인해 주세요.');
  let response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: options.method || 'GET',
      headers: { Authorization: `Bearer ${session.access_token}`, ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}) },
      ...(options.body ? { body: isFormData ? options.body : JSON.stringify(options.body) } : {}),
      cache: 'no-store', signal: options.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  let result;
  try { result = await response.json(); } catch { throw new Error('서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
  if (!response.ok || result.error) throw new Error(result.error?.message || '요청을 완료하지 못했습니다. 권한과 입력을 확인해 주세요.');
  return options.includeMeta ? result : result.data;
}

export async function apiRequest(session, path, options = {}) {
  if (session?.pseudoMode) return pseudoRequest(session, path, options);
  return liveRequest(session, path, options);
}

// Pseudo preview remains local except this explicit endpoint, which sends real mail
// only to the server-side allowlist of test inboxes.
export async function sendPseudoTestEmail(session, body) {
  return liveRequest(session, '/pseudo-emails', { method: 'POST', body });
}

export function requestPseudoAnalysis(session, body) {
  return liveRequest(session, '/pseudo-ai-analysis', { method: 'POST', body });
}
