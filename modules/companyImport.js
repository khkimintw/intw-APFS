// Shared importer whitelist. PII columns are ingested only by the authenticated admin import API.
export const IMPORT_LIMITS = Object.freeze({ maxRows: 500, batchRows: 20, maxFileBytes: 5 * 1024 * 1024 });
export const IMPORT_FIELDS = Object.freeze([
  'business_name','business_registration_number','founded_year','theme','program_year','presentation_date','intake_date','status','ir_direct','reapplicant',
  'representative_name','representative_phone','representative_email','representative_birth_year','representative_gender',
  'contact_name','contact_phone','contact_email','address','business_summary','revenue_2024','notes','intween_notes','source_payload'
]);
export const FIELD_LABELS = Object.freeze({
  business_name:'경영체명',business_registration_number:'사업자번호',founded_year:'설립연도',theme:'테마',program_year:'진행연도',presentation_date:'발표 일정',intake_date:'접수일자',status:'진행상황',ir_direct:'IR 직행',reapplicant:'재도전',
  representative_name:'대표자 이름',representative_phone:'대표자 연락처',representative_email:'대표자 이메일',representative_birth_year:'생년',representative_gender:'성별',
  contact_name:'담당자 이름',contact_phone:'담당자 연락처',contact_email:'담당자 이메일',address:'주소',business_summary:'사업 개요',revenue_2024:'2024 매출액',notes:'특이사항',intween_notes:'인트윈 확인사항'
});
const norm = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s\-_.·/:()[\]]/g, '');
const ALIASES = {
  business_name:['기업명','회사명','경영체명','업체명','상호','상호명','사업체명','법인명','기업'],
  business_registration_number:['사업자번호','사업자등록번호','사업자등록no','사업자reg','사업자등록'],
  founded_year:['설립연도','설립년도','창업연도','창업년도','설립'],theme:['테마','분야'],
  program_year:['사업연도','진행연도','지원연도','연도'],presentation_date:['발표일정','발표일','발표'],intake_date:['접수주차','접수일','접수일자','접수'],
  status:['상태','진행상황','진행상태'],ir_direct:['구분','ir직행','ir'],reapplicant:['재도전','재신청'],
  representative_name:['대표이름','대표자명','대표명','대표이름'],representative_phone:['대표핸드폰','대표휴대전화','대표연락처','대표전화'],representative_email:['대표이메일','대표e메일','대표메일'],
  representative_birth_year:['생년','생년월일','대표생년','대표생년월일'],representative_gender:['성별','대표성별'],
  contact_name:['담당자이름','담당자명'],contact_phone:['담당자핸드폰','담당자휴대전화','담당자연락처'],contact_email:['담당자이메일','담당자e메일','담당자메일'],
  address:['주소','사업장주소','경영체주소'],business_summary:['개념','사업개요','경영체개요'],revenue_2024:['24년매출액','2024년매출액','매출액'],
  notes:['특이사항','특이사항메모'],intween_notes:['인트윈확인사항','인트윈메모','내부확인사항']
};
const ALIAS_LOOKUP = new Map(Object.entries(ALIASES).flatMap(([field,names])=>names.map(name=>[norm(name),field])));
const SENSITIVE = /주민등록번호|주민번호|계좌|카드번호|전체생년월일|비밀번호|password|accountnumber|ssn/i;
export function normalizeName(value) { return String(value ?? '').normalize('NFKC').toLowerCase().replace(/\(주\)|\(유\)|\(사\)|주식회사|유한회사|유한책임회사|사단법인|재단법인/g,'').replace(/[\s\-_.,·/:()[\]'”"“]/g,''); }
export function normalizeBizNo(value) { const digits=String(value ?? '').replace(/\D/g,''); return digits.length===10?digits:''; }
export const formatBizNo = digits => `${digits.slice(0,3)}-${digits.slice(3,5)}-${digits.slice(5)}`;
export function maskBizNo(value) { return String(value ?? '').trim(); }
export function mapHeaders(headers) {
  const fieldByColumn={},mapped=[],ignored=[],seen=new Set();
  headers.forEach((raw,index)=>{const label=String(raw ?? '').trim(); if(!label)return;
    if(SENSITIVE.test(label.normalize('NFKC'))){ignored.push({index,label,reason:'민감 식별 정보는 가져오지 않습니다'});return;}
    const field=ALIAS_LOOKUP.get(norm(label)); if(!field){ignored.push({index,label,reason:'사용하지 않는 열'});return;}
    if(seen.has(field)){ignored.push({index,label,reason:'같은 항목이 이미 매핑됨'});return;}
    seen.add(field);fieldByColumn[index]=field;mapped.push({index,label,field});
  });return {fieldByColumn,mapped,ignored};
}
const yearOf=value=>{const m=/^\s*(\d{4})/.exec(String(value ?? ''));return m?Number(m[1]):NaN;};
const clean=(value,max)=>{const s=String(value ?? '').replace(/\u0000/g,'').trim();return s.length>max?null:s;};
export function sanitizeImportRow(raw) {
  const errors=[],values={};
  const fields={business_name:300,business_registration_number:40,founded_year:10,theme:100,presentation_date:100,intake_date:100,status:100,reapplicant:100,
    representative_name:200,representative_phone:80,representative_email:240,representative_birth_year:10,representative_gender:30,
    contact_name:200,contact_phone:80,contact_email:240,address:500,business_summary:4000,revenue_2024:100,notes:4000,intween_notes:4000};
  for(const [key,max] of Object.entries(fields)){const v=clean(raw?.[key],max);if(v===null){errors.push(`${FIELD_LABELS[key]||key} 값이 너무 깁니다`);continue;}if(v)values[key]=v;}
  if(!values.business_name)errors.push('경영체명이 비어 있습니다');
  if(values.business_registration_number){const d=normalizeBizNo(values.business_registration_number);if(d)values.business_registration_number=formatBizNo(d);else errors.push('사업자번호는 숫자 10자리여야 합니다');}
  if(values.founded_year){const y=yearOf(values.founded_year);if(y>=1900&&y<=2200)values.founded_year=String(y);else errors.push('설립연도 형식 오류');}
  if(values.representative_birth_year){const y=yearOf(values.representative_birth_year);if(y>=1900&&y<=new Date().getFullYear())values.representative_birth_year=String(y);else errors.push('대표자 생년은 연도 4자리로 입력해 주세요');}
  if(values.program_year){const y=yearOf(values.program_year);if(y>=2000&&y<=2200)values.program_year=y;else errors.push('사업연도 형식 오류');}
  const category=String(raw?.ir_direct ?? '').trim().toLowerCase();
  if(typeof raw?.ir_direct==='boolean')values.ir_direct=raw.ir_direct;
  else if(!category)values.ir_direct=false;
  else if(/ir|직행|^(o|y|true|1|예)$/.test(category))values.ir_direct=true;
  else if(/컨설팅|^(x|n|false|0|아니오)$/.test(category))values.ir_direct=false;
  else errors.push('구분은 컨설팅 또는 IR 직행이어야 합니다');
  if(values.reapplicant&&!/재도전|예|yes|true|1|o|y/i.test(values.reapplicant))values.reapplicant='';
  return {values,errors};
}
export function buildImportPreview(matrix,existing=[]) {
  const rows=matrix.filter(row=>row.some(cell=>String(cell ?? '').trim()!==''));
  if(!rows.length)return {error:'비어 있는 파일입니다.'};
  const {fieldByColumn,mapped,ignored}=mapHeaders(rows[0]);
  if(!mapped.some(item=>item.field==='business_name'))return {error:'경영체명 열을 찾지 못했습니다. 머리글을 확인하세요.',mapped,ignored};
  const body=rows.slice(1);if(!body.length)return {error:'데이터 행이 없습니다.',mapped,ignored};
  if(body.length>IMPORT_LIMITS.maxRows)return {error:`한 번에 ${IMPORT_LIMITS.maxRows}행까지만 가져올 수 있습니다. (현재 ${body.length}행)`,mapped,ignored};
  const names=new Set(existing.map(x=>normalizeName(x.business_name)).filter(Boolean)),numbers=new Set(existing.map(x=>normalizeBizNo(x.business_registration_number)).filter(Boolean));
  const items=body.map((cells,i)=>{const raw={},source={};for(const [index,field] of Object.entries(fieldByColumn))raw[field]=cells[index];rows[0].forEach((header,index)=>{const label=String(header??'').trim();if(label&&!SENSITIVE.test(label.normalize('NFKC')))source[label.slice(0,120)]=String(cells[index]??'').slice(0,400);});
    const {values,errors}=sanitizeImportRow(raw);values.source_payload=source;const item={line:i+2,values,errors,status:errors.length?'error':'new'};
    if(!errors.length){const n=normalizeName(values.business_name),b=normalizeBizNo(values.business_registration_number);if(names.has(n)||(b&&numbers.has(b)))item.status='duplicate';else{names.add(n);if(b)numbers.add(b);}}
    return item;});
  return {mapped,ignored,items,counts:{total:items.length,new:items.filter(x=>x.status==='new').length,duplicate:items.filter(x=>x.status==='duplicate').length,error:items.filter(x=>x.status==='error').length}};
}
export function parseCsv(text) {
  const rows=[];let row=[],cell='',quoted=false;const source=String(text).replace(/^﻿/,'');
  for(let i=0;i<source.length;i++){const ch=source[i];if(quoted){if(ch==='"'){if(source[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=ch;}else if(ch==='"')quoted=true;else if(ch===','){row.push(cell);cell='';}else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&source[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}else cell+=ch;}
  if(cell!==''||row.length){row.push(cell);rows.push(row);}return rows;
}
