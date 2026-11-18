// 경영체 목록 XLSX 내보내기. 화면 표에 이미 노출되는 업무 컬럼만 사용한다.
// 제외(개인정보 정책): 연락처·주소·개인이메일·주민번호·생년월일·원본 payload·관리자 notes·업무 개요 자유서술.
export const EXPORT_COLUMNS = [
  { key: 'no', header: '번호', width: 8 },
  { key: 'business_name', header: '경영체명', width: 32 },
  { key: 'theme', header: '테마', width: 18 },
  { key: 'program_year', header: '사업연도', width: 10 },
  { key: 'status', header: '진행 상태', width: 16 },
  { key: 'consultant', header: '담당 컨설턴트', width: 18 },
  { key: 'cooperation_level', header: '협조도', width: 12 },
  { key: 'report_status', header: '보고 상태', width: 12 },
  { key: 'presentation_date', header: '발표 일정', width: 16 },
  { key: 'ir_direct', header: 'IR 직행', width: 9 },
];

// 수식 주입 방지: 문자열 셀이 = + - @ 탭/CR로 시작하면 앞에 작은따옴표를 붙인다.
function safeText(value) {
  const text = value == null ? '' : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * rows: 이미 필터·정렬된 전체 결과. startRow/endRow: 1부터 시작하는 포함 범위(선택).
 * resolveConsultant(company) → 표시 이름. onProgress({ phase, done, total }).
 */
export function resolveRange(total, startText, endText) {
  const parse = text => (String(text ?? '').trim() === '' ? null : Number(text));
  const start = parse(startText), end = parse(endText);
  for (const value of [start, end]) if (value !== null && (!Number.isInteger(value) || value < 1)) return { error: '시작·끝 행은 1 이상의 정수로 입력하세요.' };
  const from = start ?? 1, to = Math.min(end ?? total, total);
  if (!total) return { error: '내보낼 행이 없습니다.' };
  if (from > total) return { error: `시작 행은 현재 결과 ${total.toLocaleString()}행 이하여야 합니다.` };
  if (to < from) return { error: '끝 행은 시작 행보다 크거나 같아야 합니다.' };
  return { from, to };
}

export async function buildCompanyXlsx(rows, { from, to, resolveConsultant, onProgress }) {
  const slice = rows.slice(from - 1, to), total = slice.length;
  onProgress?.({ phase: '엑셀 모듈 준비 중', done: 0, total });
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'intween';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('경영체 목록', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = EXPORT_COLUMNS.map(({ header, key, width }) => ({ header, key, width }));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: EXPORT_COLUMNS.length } };
  const CHUNK = 200;
  for (let index = 0; index < total; index += 1) {
    const company = slice[index];
    sheet.addRow({
      no: from + index,
      business_name: safeText(company.business_name),
      theme: safeText(company.theme),
      program_year: company.program_year ?? '',
      status: safeText(company.status),
      consultant: safeText(resolveConsultant(company)),
      cooperation_level: safeText(company.cooperation_level),
      report_status: safeText(company.report_status),
      presentation_date: safeText(company.presentation_date),
      ir_direct: company.ir_direct ? 'Y' : '',
    });
    if ((index + 1) % CHUNK === 0) { onProgress?.({ phase: '행 작성 중', done: index + 1, total }); await tick(); }
  }
  onProgress?.({ phase: '파일 생성 중', done: total, total });
  await tick();
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
