// Company import helpers shared by the browser preview and the admin-only bulk API.
// Only approved business fields are ever imported. Contact / address / e-mail / person columns are dropped.
export const IMPORT_LIMITS = Object.freeze({ maxRows: 500, batchRows: 100, maxFileBytes: 5 * 1024 * 1024 });
export const IMPORT_FIELDS = Object.freeze(['business_name', 'business_registration_number', 'founded_year', 'theme', 'program_year', 'presentation_date', 'intake_date', 'status', 'ir_direct']);
export const FIELD_LABELS = Object.freeze({ business_name: '기업명', business_registration_number: '사업자번호', founded_year: '설립연도', theme: '테마', program_year: '사업연도', presentation_date: '발표 일정', intake_date: '접수', status: '상태', ir_direct: '구분' });

const norm = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s\-_.·/:()[\]]/g, '');
const ALIASES = {
  business_name: ['기업명', '회사명', '경영체명', '업체명', '상호', '상호명', '사업체명', '법인명', '기업'],
  business_registration_number: ['사업자번호', '사업자등록번호', '사업자등록no', '사업자reg', '사업자등록'],
  founded_year: ['설립연도', '설립년도', '창업연도', '창업년도', '설립'],
  theme: ['테마', '분야'],
  program_year: ['사업연도', '진행연도', '지원연도', '연도'],
  presentation_date: ['발표일정', '발표일', '발표'],
  intake_date: ['접수주차', '접수일', '접수일자', '접수'],
  status: ['상태', '진행상태'],
  ir_direct: ['구분', 'ir직행', 'ir'],
};
const ALIAS_LOOKUP = new Map(Object.entries(ALIASES).flatMap(([field, names]) => names.map(name => [norm(name), field])));
// Anything that could identify a person or contact point is refused outright (never mapped, never sent).
const SENSITIVE = /연락|전화|휴대|핸드폰|모바일|tel|phone|mobile|주소|address|메일|mail|대표|성명|이름|담당|생년|주민|직위|직급|팩스|fax|계좌|카카오|sns/i;

export function normalizeName(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/\(주\)|\(유\)|\(사\)|주식회사|유한회사|유한책임회사|사단법인|재단법인/g, '').replace(/[\s\-_.,·/:()[\]'"]/g, '');
}
export function normalizeBizNo(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length === 10 ? digits : '';
}
export const formatBizNo = digits => `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
/** Display/export form: last five digits hidden. Idempotent for already masked values. */
export function maskBizNo(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text.includes('*')) return text;
  const digits = normalizeBizNo(text);
  if (digits) return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-*****`;
  return text.length > 3 ? text.slice(0, 3) + '*'.repeat(Math.min(text.length - 3, 8)) : '***';
}

/** headers: string[] → { fieldByColumn: {index: field}, mapped: [{index,label,field}], ignored: [{index,label,reason}] } */
export function mapHeaders(headers) {
  const fieldByColumn = {}, mapped = [], ignored = [], seen = new Set();
  headers.forEach((raw, index) => {
    const label = String(raw ?? '').trim();
    if (!label) return;
    if (SENSITIVE.test(label.normalize('NFKC'))) { ignored.push({ index, label, reason: '개인·연락처 정보라 가져오지 않습니다' }); return; }
    const field = ALIAS_LOOKUP.get(norm(label));
    if (!field) { ignored.push({ index, label, reason: '사용하지 않는 열' }); return; }
    if (seen.has(field)) { ignored.push({ index, label, reason: '같은 항목이 이미 매핑됨' }); return; }
    seen.add(field); fieldByColumn[index] = field; mapped.push({ index, label, field });
  });
  return { fieldByColumn, mapped, ignored };
}

const yearOf = value => { const match = /^\s*(\d{4})/.exec(String(value ?? '')); return match ? Number(match[1]) : NaN; };
const clean = (value, max) => { const text = String(value ?? '').replace(/\u0000/g, '').trim(); return text.length > max ? null : text; };
/** Validate/normalise one raw row (object keyed by approved field names; extra keys are ignored). */
export function sanitizeImportRow(raw) {
  const errors = [], values = {};
  const name = clean(raw?.business_name, 300);
  if (!name) errors.push(name === null ? '기업명이 너무 깁니다' : '기업명이 비어 있습니다'); else values.business_name = name;
  const bizRaw = String(raw?.business_registration_number ?? '').trim();
  if (bizRaw) { const digits = normalizeBizNo(bizRaw); if (digits) values.business_registration_number = formatBizNo(digits); else errors.push('사업자번호는 숫자 10자리여야 합니다'); }
  const fy = String(raw?.founded_year ?? '').trim();
  if (fy) { const year = yearOf(fy); if (year >= 1900 && year <= 2200) values.founded_year = String(year); else errors.push('설립연도 형식 오류'); }
  const py = String(raw?.program_year ?? '').trim();
  if (py) { const year = yearOf(py); if (year >= 2000 && year <= 2200) values.program_year = year; else errors.push('사업연도 형식 오류'); }
  for (const [key, max] of [['theme', 100], ['presentation_date', 100], ['intake_date', 100], ['status', 100]]) {
    const text = clean(raw?.[key], max);
    if (text === null) errors.push(`${FIELD_LABELS[key]} 값이 너무 깁니다`); else if (text) values[key] = text;
  }
  const category = String(raw?.ir_direct ?? '').trim().toLowerCase();
  if (typeof raw?.ir_direct === 'boolean') values.ir_direct = raw.ir_direct;
  else if (!category) values.ir_direct = false;
  else if (/ir|직행|^(o|y|true|1|예)$/.test(category)) values.ir_direct = true;
  else if (/컨설팅|^(x|n|false|0|아니오)$/.test(category)) values.ir_direct = false;
  else errors.push('구분은 컨설팅 또는 IR 직행이어야 합니다');
  return { values, errors };
}

/** matrix: any[][] (first non-empty row = header). Returns parsed rows with validation + duplicate status. */
export function buildImportPreview(matrix, existing = []) {
  const rows = matrix.filter(row => row.some(cell => String(cell ?? '').trim() !== ''));
  if (!rows.length) return { error: '비어 있는 파일입니다.' };
  const { fieldByColumn, mapped, ignored } = mapHeaders(rows[0]);
  if (!mapped.some(item => item.field === 'business_name')) return { error: '기업명 열을 찾지 못했습니다. 머리글에 "기업명"(또는 회사명·경영체명)이 필요합니다.', mapped, ignored };
  const body = rows.slice(1);
  if (!body.length) return { error: '데이터 행이 없습니다.', mapped, ignored };
  if (body.length > IMPORT_LIMITS.maxRows) return { error: `한 번에 ${IMPORT_LIMITS.maxRows}행까지만 가져올 수 있습니다. (현재 ${body.length}행)`, mapped, ignored };
  const names = new Set(existing.map(item => normalizeName(item.business_name)).filter(Boolean));
  const numbers = new Set(existing.map(item => normalizeBizNo(item.business_registration_number)).filter(Boolean));
  const items = body.map((cells, i) => {
    const raw = {};
    Object.entries(fieldByColumn).forEach(([index, field]) => { raw[field] = cells[index]; });
    const { values, errors } = sanitizeImportRow(raw);
    const item = { line: i + 2, values, errors, status: errors.length ? 'error' : 'new' };
    if (!errors.length) {
      const n = normalizeName(values.business_name), b = normalizeBizNo(values.business_registration_number);
      if (names.has(n) || (b && numbers.has(b))) item.status = 'duplicate';
      else { names.add(n); if (b) numbers.add(b); }
    }
    return item;
  });
  return { mapped, ignored, items, counts: { total: items.length, new: items.filter(i => i.status === 'new').length, duplicate: items.filter(i => i.status === 'duplicate').length, error: items.filter(i => i.status === 'error').length } };
}

/** Minimal RFC4180-style CSV parser (quotes, doubled quotes, CRLF). */
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  const source = String(text).replace(/^﻿/, '');
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) { if (ch === '"') { if (source[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && source[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
