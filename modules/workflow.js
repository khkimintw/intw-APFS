export const REPORT_STATUSES = ['미제출', '작성 중', '검토 중', '제출 완료'];
export function isAdmin(profile) { return ['host', 'admin'].includes(profile?.role); }
export function canEditSessions(profile) { return isAdmin(profile) || profile?.user_kind === 'consultant'; }
export function sessionError(candidate, existing = []) {
  const round = Number(candidate.round_number);
  if (!['diagnosis', 'consulting'].includes(candidate.kind)) return '상담 유형을 확인하세요.';
  const max = candidate.kind === 'diagnosis' ? 1 : 3;
  if (!Number.isInteger(round) || round < 1 || round > max) return candidate.kind === 'diagnosis' ? '진단은 1회만 등록할 수 있습니다.' : '컨설팅은 최대 3회까지 등록할 수 있습니다. 4회 확장은 운영 확인이 필요합니다.';
  if (existing.some(item => item.kind === candidate.kind && Number(item.round_number) === round)) return '같은 유형·회차가 이미 있습니다. 기존 기록을 확인하세요. 덮어쓰지 않았습니다.';
  if (candidate.scheduled_on && !/^\d{4}-\d{2}-\d{2}$/.test(candidate.scheduled_on)) return '방문 가능일 형식을 확인하세요.';
  return '';
}
export function sessionLabel(item) { return `${item.kind === 'diagnosis' ? '진단' : '컨설팅'} ${item.round_number}회`; }

export function companyReportLabel(value) {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(?:보고서\s*작성\s*)?(\d+)\s*회?$/);
  if (match) return `보고서 작성 ${match[1]}회`;
  return raw || '미기재';
}
