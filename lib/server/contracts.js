// Shared, deterministic API validation. No secrets, DB access or user content logging.
import { normalizeBizNo, formatBizNo, maskBizNo } from '../../modules/companyImport';
export { maskBizNo };
export const SESSION_LIST_COLUMNS = ['id','company_id','kind','round_number','scheduled_on','remote','scheduled_time','appointment_confirmed','departure_base','confirmed_by','confirmed_at','report_status','report_file_name','report_file_size','report_file_uploaded_at','created_at','updated_at'];
export const COMPANY_COLUMNS = ['id','business_name','theme','program_year','presentation_date','assigned_consultant_id','status','cooperation_level','report_status','intake_date','reapplicant','ir_direct','ir_confirmed','ir_confirmed_at','ir_scheduled_at','business_summary','business_registration_number','founded_year','created_at','updated_at'];
export const COMPANY_EDIT = ['business_registration_number','founded_year','business_name','theme','program_year','presentation_date','assigned_consultant_id','status','cooperation_level','report_status','intake_date','reapplicant','ir_direct','ir_confirmed','ir_confirmed_at','ir_scheduled_at','business_summary'];
export const PROFILE_COLUMNS = ['id','display_name','role','user_kind','company_id','approved','active','created_at','updated_at'];
export const SESSION_COLUMNS = ['id','company_id','kind','round_number','scheduled_on','remote','scheduled_time','appointment_confirmed','departure_base','confirmed_by','confirmed_at','report_status','report_note','report_file_path','report_file_name','report_file_size','report_file_uploaded_at','report_file_uploaded_by','updated_by','created_at','updated_at'];
export const AUDIT_COLUMNS = ['id','actor_id','entity_type','entity_id','action','created_at'];
export const CAPABILITIES = { departureBase: true, reportFiles: true, serverAuthorization: true, rlsMigrationApplied: false };
export class ApiError extends Error {
  constructor(status,code,message) { super(message); this.status=status; this.code=code; }
}
export function assertId(id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new ApiError(400,'INVALID_ID','올바른 대상 ID가 필요합니다.');
  return id;
}
export function isAdmin(profile) { return ['host','admin'].includes(profile?.role); }
export function assertActive(profile) {
  if (!profile?.active || !profile.approved) throw new ApiError(403,'ACCOUNT_PENDING','관리자 승인과 계정 활성화가 필요합니다.');
}
export function assertAdmin(profile) {
  if (!isAdmin(profile)) throw new ApiError(403,'FORBIDDEN','관리자 권한이 필요합니다.');
}
export function canReadCompany(profile,company) {
  if (isAdmin(profile)) return true;
  if (profile.role !== 'user') return false;
  return profile.user_kind === 'consultant' ? company.assigned_consultant_id === profile.id : profile.user_kind === 'client' && profile.company_id === company.id;
}
export function assertCompanyWrite(profile,company) {
  if (isAdmin(profile) || (profile.role==='user' && profile.user_kind==='consultant' && company.assigned_consultant_id===profile.id)) return;
  throw new ApiError(403,'FORBIDDEN','배정된 컨설턴트 또는 관리자만 회차를 수정할 수 있습니다.');
}
function objectPayload(value,allowed) {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new ApiError(400,'INVALID_BODY','JSON 객체가 필요합니다.');
  const keys=Object.keys(value);
  if (!keys.length || keys.some(k=>!allowed.includes(k))) throw new ApiError(400,'INVALID_FIELDS','허용되지 않은 필드가 포함되어 있거나 변경 항목이 없습니다.');
  return {...value};
}
function text(value,max=300,nullable=true) {
  if (value===null && nullable) return null;
  if (typeof value!=='string' || value.length>max || /\u0000/.test(value)) throw new ApiError(400,'INVALID_VALUE','텍스트 형식 또는 길이를 확인하세요.');
  return value.trim();
}
function bool(value) { if(typeof value!=='boolean')throw new ApiError(400,'INVALID_VALUE','참/거짓 값이 필요합니다.'); return value; }
export function companyPayload(body,create=false) {
  const payload=objectPayload(body,COMPANY_EDIT);
  for(const key of Object.keys(payload)) {
    const value=payload[key];
    if (key==='assigned_consultant_id') payload[key]=value===null||value===''?null:assertId(value);
    else if (key==='program_year') { if(value===null||value==='')payload[key]=null; else if(!Number.isInteger(value)||value<2000||value>2200)throw new ApiError(400,'INVALID_VALUE','사업 연도는 2000~2200 사이의 정수여야 합니다.'); }
    else if(key==='ir_direct'||key==='ir_confirmed')payload[key]=bool(value);
    else if(key==='ir_confirmed_at'||key==='ir_scheduled_at'){if(value===null||value==='')payload[key]=null;else if(typeof value!=='string'||Number.isNaN(Date.parse(value)))throw new ApiError(400,'INVALID_VALUE','IR 일정 또는 확정 일시를 확인하세요.');}
    else if(key==='business_registration_number'){
      if(value===null||value==='')payload[key]=null;
      else{const digits=normalizeBizNo(text(value,40,false));if(!digits)throw new ApiError(400,'INVALID_VALUE','사업자번호는 숫자 10자리여야 합니다.');payload[key]=formatBizNo(digits);}
    }
    else if(key==='founded_year'){
      if(value===null||value==='')payload[key]=null;
      else{const year=Number(String(value).trim());if(!Number.isInteger(year)||year<1900||year>2200)throw new ApiError(400,'INVALID_VALUE','설립연도는 1900~2200 사이의 4자리 연도여야 합니다.');payload[key]=String(year);}
    }
    else payload[key]=text(value,key==='business_summary'?4000:300);
  }
  if((create||'business_name' in payload)&&!payload.business_name)throw new ApiError(400,'INVALID_VALUE','경영체명이 필요합니다.');
  return payload;
}
export function sessionPayload(body,{create=false,current=null}={}) {
  const payload=objectPayload(body,['kind','round_number','scheduled_on','remote','scheduled_time','appointment_confirmed','departure_base','confirmed_by','confirmed_at','report_status','report_note']);
  if('kind' in payload && !['diagnosis','consulting'].includes(payload.kind))throw new ApiError(400,'INVALID_VALUE','상담 유형을 확인하세요.');
  if('round_number' in payload && !Number.isInteger(payload.round_number))throw new ApiError(400,'INVALID_VALUE','회차는 정수여야 합니다.');
  const kind=payload.kind??current?.kind;
  const round=payload.round_number??current?.round_number;
  const changesIdentity=create||'kind' in payload||'round_number' in payload;
  if(changesIdentity&&(!kind||!round||round<1||round>(kind==='diagnosis'?1:3)))throw new ApiError(400,'INVALID_ROUND','진단은 1회, 컨설팅은 최대 3회까지 새로 등록할 수 있습니다.');
  if('scheduled_on' in payload) {
    if(payload.scheduled_on==='')payload.scheduled_on=null;
    if(payload.scheduled_on!==null) {
      const value=payload.scheduled_on;
      if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new ApiError(400,'INVALID_DATE','방문일은 유효한 날짜여야 합니다.');
    }
  }
  if('remote' in payload)payload.remote=bool(payload.remote);
  if('appointment_confirmed' in payload)payload.appointment_confirmed=bool(payload.appointment_confirmed);
  if('scheduled_time' in payload){if(payload.scheduled_time==='')payload.scheduled_time=null;if(payload.scheduled_time!==null&&(typeof payload.scheduled_time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(payload.scheduled_time)))throw new ApiError(400,'INVALID_TIME','방문 시간을 확인하세요.');}
  if('departure_base' in payload)payload.departure_base=text(payload.departure_base,300);
  if('report_status' in payload&&!['미제출','작성 중','검토 중','제출 완료'].includes(payload.report_status))throw new ApiError(400,'INVALID_VALUE','보고 상태를 확인하세요.');
  if('report_note' in payload)payload.report_note=text(payload.report_note,4000);
  return payload;
}
export function profilePayload(body,actor,target) {
  assertAdmin(actor);
  const payload=objectPayload(body,['display_name','role','user_kind','company_id','approved','active']);
  if(actor.role!=='host'&&(target.role==='host'||payload.role==='host'))throw new ApiError(403,'HOST_REQUIRED','소유자 권한 변경은 host만 할 수 있습니다.');
  if('role' in payload&&!['host','admin','user'].includes(payload.role))throw new ApiError(400,'INVALID_VALUE','역할을 확인하세요.');
  if('user_kind' in payload&&!['consultant','client'].includes(payload.user_kind))throw new ApiError(400,'INVALID_VALUE','사용자 유형을 확인하세요.');
  if('company_id' in payload)payload.company_id=payload.company_id===null||payload.company_id===''?null:assertId(payload.company_id);
  if('approved' in payload)payload.approved=bool(payload.approved);
  if('active' in payload)payload.active=bool(payload.active);
  if('display_name' in payload)payload.display_name=text(payload.display_name,100,false);
  if(actor.id===target.id&&actor.role==='host'&&((payload.role&&payload.role!=='host')||payload.active===false||payload.approved===false))throw new ApiError(409,'HOST_SELF_PROTECTION','현재 host 자신의 승인·활성·소유자 권한은 해제할 수 없습니다.');
  return payload;
}
