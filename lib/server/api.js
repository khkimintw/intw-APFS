import { PSEUDO_ANALYSIS_MAX_BYTES } from '../../modules/pseudoCompanyFiles';
import { createClient } from '@supabase/supabase-js';
import { ASSESSMENT_RUBRIC, SURVEY_RESPONSE_COUNT, CRITICAL_AXES, EARLY_STAGE_COMPENSABLE_AXES } from '../../modules/assessmentWeights';
import { IMPORT_LIMITS, IMPORT_FIELDS, normalizeName, normalizeBizNo, sanitizeImportRow } from '../../modules/companyImport';
import { SUPABASE_URL,SUPABASE_KEY,SUPABASE_CONFIGURED } from '../public-config';
import { ApiError, assertId, assertActive, assertAdmin, isAdmin, canReadCompany, assertCompanyWrite, companyPayload, sessionPayload, profilePayload, SESSION_LIST_COLUMNS, COMPANY_COLUMNS,PROFILE_COLUMNS,SESSION_COLUMNS,AUDIT_COLUMNS,CAPABILITIES } from './contracts';
const MAX_BODY=32768,IMPORT_MAX_BODY=524288;
const DEFAULT_EMAIL_REPLY_TO='sasurae@intw.co.kr';
const NOTIFICATION_COLUMNS='id,kind,title,body,company_id,read_at,created_at';
const JSON_HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Authorization'};
function respond(value,status,requestId){return new Response(JSON.stringify({...value,requestId}),{status,headers:{...JSON_HEADERS,'X-Request-ID':requestId}});}
async function jsonBody(request,MAX_BODY_BYTES=MAX_BODY){
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new ApiError(415,'JSON_REQUIRED','application/json 요청만 허용합니다.');
  const declared=Number(request.headers.get('content-length')||0);
  if(!Number.isFinite(declared)||declared>MAX_BODY_BYTES)throw new ApiError(413,'BODY_TOO_LARGE','요청 본문이 허용 크기를 넘었습니다.');
  const reader=request.body?.getReader();
  if(!reader)throw new ApiError(400,'INVALID_BODY','요청 본문이 필요합니다.');
  const chunks=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_BODY_BYTES){await reader.cancel();throw new ApiError(413,'BODY_TOO_LARGE','요청 본문이 허용 크기를 넘었습니다.');}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ApiError(400,'INVALID_BODY','올바른 UTF-8 JSON 요청이 필요합니다.');}
}
const PRIVATE_COMPANY_EDIT=['representative_name','representative_phone','representative_email','representative_birth_year','representative_gender','contact_name','contact_phone','contact_email','address','address_verification','notes','intween_notes'];
function companyPrivatePayload(body){const payload={};for(const key of PRIVATE_COMPANY_EDIT)if(key in body){const value=body[key];if(key==='address_verification'){if(!['미확인','확인 필요','확인 완료','잠금'].includes(value))throw new ApiError(400,'INVALID_VALUE','주소 확인 상태를 선택하세요.');payload[key]=value;continue;}if(value===null){payload[key]=null;continue;}const max=['notes','intween_notes'].includes(key)?4000:key==='address'?500:240;if(typeof value!=='string'||value.length>max||value.includes('\0'))throw new ApiError(400,'INVALID_VALUE','경영체 연락처 또는 주소 정보를 확인하세요.');payload[key]=value.trim();}return payload;}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function validEmail(value){return typeof value==='string'&&value.length<=240&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);}
function splitCompanyBody(body){const business={},privateData={};for(const [key,value] of Object.entries(body||{})){if(PRIVATE_COMPANY_EDIT.includes(key))privateData[key]=value;else business[key]=value;}return {business,privateData};}
function dbFailure(error){
  if(error?.code==='23505')throw new ApiError(409,'DUPLICATE','이미 등록된 항목입니다. 기존 기록은 덮어쓰지 않았습니다.');
  if(error?.code==='23503')throw new ApiError(409,'REFERENCE_CONFLICT','연결된 항목을 확인하세요.');
  if(error?.code==='42501'||error?.code==='PGRST301')throw new ApiError(403,'RLS_DENIED','데이터 접근 권한이 없거나 계정 상태가 변경되었습니다.');
  if(error?.code==='23514'||error?.code==='22P02')throw new ApiError(400,'INVALID_VALUE','입력 형식 또는 정책 조건을 확인하세요.');
  throw new ApiError(503,'DATA_UNAVAILABLE','요청을 처리하지 못했습니다. 연결 또는 스키마 설정을 확인하세요.');
}
async function result(query){const {data,error}=await query;if(error)dbFailure(error);return data;}
async function one(query){const data=await result(query.maybeSingle());if(!data)throw new ApiError(404,'NOT_FOUND','항목을 찾을 수 없거나 접근할 수 없습니다.');return data;}
async function authorize(request){
  if(!SUPABASE_CONFIGURED)throw new ApiError(503,'NOT_CONFIGURED','APFS 전용 URL과 publishable key 설정을 확인하세요.');
  const raw=request.headers.get('authorization')||'';
  const match=/^Bearer ([A-Za-z0-9_.-]{20,8192})$/.exec(raw);
  if(!match)throw new ApiError(401,'AUTH_REQUIRED','로그인이 필요합니다.');
  // A user access token is verified by Auth; it is never decoded as a source of truth.
  const db=createClient(SUPABASE_URL,SUPABASE_KEY,{global:{headers:{Authorization:`Bearer ${match[1]}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  let auth;
  try{auth=await db.auth.getUser(match[1]);}catch{throw new ApiError(503,'AUTH_UNAVAILABLE','인증 서비스에 연결하지 못했습니다.');}
  if(auth.error||!auth.data?.user)throw new ApiError(401,'INVALID_SESSION','로그인이 만료되었거나 유효하지 않습니다.');
  const profile=await one(db.from('profiles').select(PROFILE_COLUMNS.join(',')).eq('id',auth.data.user.id));
  return {db,profile};
}
async function scopeCompany(db,profile,id){
  const company=await one(db.from('companies').select(COMPANY_COLUMNS.join(',')).eq('id',assertId(id)));
  if(!canReadCompany(profile,company))throw new ApiError(404,'NOT_FOUND','항목을 찾을 수 없거나 접근할 수 없습니다.');
  return company;
}
async function checkAssignee(db,id){
  if(!id)return;
  const profile=await one(db.from('profiles').select(PROFILE_COLUMNS.join(',')).eq('id',id));
  if(profile.role!=='user'||profile.user_kind!=='consultant'||!profile.active||!profile.approved)throw new ApiError(400,'INVALID_ASSIGNEE','승인된 활성 컨설턴트만 배정할 수 있습니다.');
}
// Business registration numbers are public program data; private contact details stay in the admin-only table.
function present(profile,company){return company;}
async function enrichAdminCompanies(db, companies){
  if(!companies.length)return companies;
  const ids=companies.map(company=>company.id);
  const [details,events]=await Promise.all([
    result(db.from('company_admin_private').select('company_id,notes,representative_email,representative_name,representative_phone,representative_birth_year,representative_gender,contact_name,contact_phone,contact_email,address,address_verification,intween_notes,source_payload').in('company_id',ids)),
    result(db.from('company_import_events').select('company_id,actor_id,created_at').in('company_id',ids).order('created_at',{ascending:false}).limit(2000)),
  ]);
  const profileIds=[...new Set(events.map(event=>event.actor_id).filter(Boolean))];
  const profiles=profileIds.length?await result(db.from('profiles').select('id,display_name').in('id',profileIds)):[];
  const privateById=new Map(details.map(item=>[item.company_id,item]));
  const eventById=new Map();for(const event of events)if(!eventById.has(event.company_id))eventById.set(event.company_id,event);
  const profileById=new Map(profiles.map(item=>[item.id,item.display_name]));
  return companies.map(company=>{const detail=privateById.get(company.id),event=eventById.get(company.id);return {...company,notes:detail?.notes||'',representative_email:detail?.representative_email||'',representative_name:detail?.representative_name||company.representative_name||'',representative_phone:detail?.representative_phone||company.representative_phone||'',representative_birth_year:detail?.representative_birth_year||'',representative_gender:detail?.representative_gender||'',contact_name:detail?.contact_name||'',contact_phone:detail?.contact_phone||'',contact_email:detail?.contact_email||'',address:detail?.address||'',address_verification:detail?.address_verification||'미확인',intween_notes:detail?.intween_notes||'',source_payload:detail?.source_payload||{},imported_by:event?(profileById.get(event.actor_id)||'업무 계정'):'이전 기록 (등록자 이력 없음)',imported_at:event?.created_at||company.created_at||null};});
}
async function importHistory(db){
  const batches=await result(db.from('company_import_batches').select('id,actor_id,source_filename,received_count,inserted_count,duplicate_count,invalid_count,created_at,undone_at').order('created_at',{ascending:false}).limit(50));
  if(!batches.length)return [];
  const actorIds=[...new Set(batches.map(item=>item.actor_id).filter(Boolean))];
  const profiles=actorIds.length?await result(db.from('profiles').select('id,display_name').in('id',actorIds)):[];
  const names=new Map(profiles.map(person=>[person.id,person.display_name]));
  return batches.map(batch=>({...batch,uploaded_by:names.get(batch.actor_id)||'업무 계정'}));
}
async function allCompanyKeys(db){
  const keys=[];
  for(let from=0;from<10000;from+=1000){
    const page=await result(db.from('companies').select('business_name,business_registration_number').order('id').range(from,from+999));
    keys.push(...page);if(page.length<1000)break;
  }
  return keys;
}
async function importCompanies(db,profile,request){
  assertAdmin(profile);
  const body=await jsonBody(request,IMPORT_MAX_BODY);
  if(!body||typeof body!=='object'||!Array.isArray(body.rows))throw new ApiError(400,'INVALID_BODY','rows 배열이 필요합니다.');
  if(!body.rows.length||body.rows.length>IMPORT_LIMITS.batchRows)throw new ApiError(400,'BATCH_LIMIT',`한 요청에는 1~${IMPORT_LIMITS.batchRows}행만 보낼 수 있습니다.`);
  const rows=body.rows.map(raw=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return {_invalid:true};
    const picked={};for(const key of IMPORT_FIELDS)if(key in raw&&key!=='source_payload')picked[key]=raw[key];
    const {values,errors}=sanitizeImportRow(picked);
    if(errors.length)return {_invalid:true};
    if(raw.source_payload&&typeof raw.source_payload==='object'&&!Array.isArray(raw.source_payload)){
      const entries=Object.entries(raw.source_payload).slice(0,60).map(([k,v])=>[String(k).slice(0,120),String(v??'').slice(0,400)]);
      values.source_payload=Object.fromEntries(entries);
    }
    return values;
  });
  const {data,error}=await db.rpc('import_company_batch',{p_rows:rows,p_filename:String(body.filename||'').slice(0,240),p_batch_id:body.batch_id||null,p_received_count:Number(body.received_count||body.rows.length),p_duplicate_count:null,p_invalid_count:null});
  if(error)dbFailure(error);
  return {data:{...data,received:body.rows.length,invalid:Number(data?.invalid||0)}};
}
async function undoCompanyImport(db,profile,request){
  assertAdmin(profile);
  const body=await jsonBody(request);
  const id=assertId(body?.batch_id);
  const {data,error}=await db.rpc('undo_company_import_batch',{p_batch_id:id});
  if(error){if(error.code==='23514')throw new ApiError(409,'IMPORT_UNDO_BLOCKED','이 업로드에 이미 수정되었거나 회차가 연결된 경영체가 있어 안전하게 취소할 수 없습니다.');dbFailure(error);}
  return {data};
}


const AI_DOC_MIME={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',doc:'application/msword',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',ppt:'application/vnd.ms-powerpoint',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xls:'application/vnd.ms-excel',txt:'text/plain',csv:'text/csv',md:'text/markdown'};
const AI_DOC_CATEGORIES=new Set(['ir_materials','business_plan','diagnosis_report','consulting_report_1','consulting_report_2','consulting_report_3','performance_confirmation','other']);
async function analyzeCompanyDocuments(db,profile,companyId,request){
  const company=await scopeCompany(db,profile,companyId);
  assertCompanyWrite(profile,company);
  if(company.status==='포기')throw new ApiError(409,'ABANDONED_AI_BLOCKED','포기 처리된 경영체는 분석할 수 없습니다.');
  const body=await jsonBody(request,16384);
  const paths=Array.isArray(body?.paths)?body.paths:[];
  if(paths.length<1||paths.length>5)throw new ApiError(400,'AI_FILE_COUNT','분석할 파일을 1~5개 선택하세요.');
  const files=[];let combined=0;
  for(const rawPath of paths){
    if(typeof rawPath!=='string'||rawPath.length>700)throw new ApiError(400,'AI_FILE_PATH','선택한 파일 경로를 확인하세요.');
    const parts=rawPath.split('/');
    if(parts.length!==3||parts[0]!==companyId||!AI_DOC_CATEGORIES.has(parts[1])||!/^[0-9a-f-]{36}__/i.test(parts[2]))throw new ApiError(400,'AI_FILE_PATH','해당 경영체의 자료만 분석할 수 있습니다.');
    const ext=(parts[2].match(/\.([a-z0-9]+)$/i)||[])[1]?.toLowerCase();
    const mime=AI_DOC_MIME[ext];
    if(!mime)throw new ApiError(415,'AI_FILE_UNSUPPORTED','HWP/HWPX는 PDF로 변환한 뒤 분석할 수 있습니다. 선택 파일 형식을 확인하세요.');
    const {data,error}=await db.storage.from('company-documents').download(rawPath);
    if(error||!data)throw new ApiError(404,'AI_FILE_UNAVAILABLE','선택한 자료를 읽지 못했습니다. 권한과 파일 상태를 확인하세요.');
    combined+=data.size;
    if(data.size>15*1024*1024||combined>15*1024*1024)throw new ApiError(413,'AI_FILE_TOO_LARGE','분석할 자료는 전체 15MB 이하로 선택하세요.');
    files.push(await aiFileInput(data, parts[2].replace(/^[0-9a-f-]{36}__/i,''), mime));
  }
  return runCompanyAnalysis(company, files);
}

async function aiFileInput(file, filename, mime) {
  const bytes = Buffer.from(await file.arrayBuffer());
  return { type: 'input_file', filename, file_data: 'data:' + mime + ';base64,' + bytes.toString('base64') };
}

async function analyzePseudoDocuments(profile, request) {
  assertAdmin(profile);
  const length = Number(request.headers.get('content-length') || 0);
  if (length > PSEUDO_ANALYSIS_MAX_BYTES + 65536) {
    throw new ApiError(413, 'AI_FILE_TOO_LARGE', 'Pseudo 분석 자료는 합계 4MB 이하로 선택하세요.');
  }
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) {
    throw new ApiError(415, 'AI_FILE_TYPE', '분석할 파일을 첨부하세요.');
  }
  const form = await request.formData().catch(() => null);
  const uploads = form?.getAll('files') || [];
  if (!uploads.length || uploads.length > 5) throw new ApiError(400, 'AI_FILE_COUNT', '분석할 파일을 1~5개 선택하세요.');
  const files = [];
  let total = 0;
  for (const file of uploads) {
    if (typeof file === 'string' || !file.size) throw new ApiError(400, 'AI_FILE_EMPTY', '빈 파일은 분석할 수 없습니다.');
    total += file.size;
    if (total > PSEUDO_ANALYSIS_MAX_BYTES) throw new ApiError(413, 'AI_FILE_TOO_LARGE', 'Pseudo 분석 자료는 합계 4MB 이하로 선택하세요.');
    const name = file.name.slice(-200);
    const extension = name.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
    if (!Object.hasOwn(AI_DOC_MIME, extension)) throw new ApiError(415, 'AI_FILE_UNSUPPORTED', 'HWP/HWPX는 PDF로 변환한 뒤 분석할 수 있습니다.');
    files.push(await aiFileInput(file, name, AI_DOC_MIME[extension]));
  }
  return runCompanyAnalysis({ business_name: String(form.get('company_name') || '').slice(0, 200), business_summary: String(form.get('business_summary') || '').slice(0, 2500) }, files);
}

async function runCompanyAnalysis(company, files) {
  const apiKey=String(process.env.OPENAI_API_KEY||'').trim();
  if(!apiKey)throw new ApiError(503,'AI_NOT_CONFIGURED','AI 분석 연결이 아직 설정되지 않았습니다. 관리자에게 OpenAI API 키 설정을 요청하세요.');
  const model=String(process.env.OPENAI_MODEL||'gpt-4.1-mini').trim().slice(0,80);
  const rubricText=ASSESSMENT_RUBRIC.map(axis=>axis.label+' ('+axis.weight+'%): '+axis.indicators.map(item=>item.id+' '+item.label+' ['+item.weight+'%]').join('; ')).join('\n');
  const instruction='초기 사업계획서 검토자입니다. 제공 자료에 없는 사실을 만들지 마세요. 아래 설문 기반 평가축과 하위지표를 빠짐없이 평가하세요.\n'+rubricText+'\n응답은 10명이며 각 상위 축 가중치는 순위응답의 Borda 점수를 100%로 정규화했고, 각 축의 하위 지표도 같은 방식으로 축 안에서 정규화했습니다. 전문가 설문 응답 기반 참고 배점이며 모집단 전체의 의견으로 단정하지 마세요. 각 지표는 score 1~4 정수, 자료에 근거가 전혀 없으면 1점과 evidence에 근거 부족을 명시합니다. 점수 3~4는 파일명 및 확인 가능한 페이지/슬라이드 또는 짧은 근거 인용을 적고, 위치를 확인할 수 없으면 추정하지 마세요. 각 metric은 code, score, evidence, note를 포함합니다. 반환할 JSON에는 summary, metrics 25개, strengths, risks, missingEvidence, recommendations, sources, disclaimer가 필요합니다. 문제/솔루션 적합성(응답자 '+CRITICAL_AXES[0].respondents+'/10), 팀 역량('+CRITICAL_AXES[1].respondents+'/10), 시장/경쟁력('+CRITICAL_AXES[2].respondents+'/10)은 응답자가 특히 치명적으로 본 축이므로 낮은 점수와 근거 부족을 보고서에서 명확히 표시하세요. 초기 단계에서 보완 가능하다고 본 축: '+EARLY_STAGE_COMPENSABLE_AXES.map(item=>item.label+' '+item.respondents+'/10').join(', ')+'. 회사의 단계가 자료에 확인될 때만 이 의견을 참고해 보완 여지를 서술하고, 자동으로 점수 가산 또는 감점을 하지 마세요. 점수와 결론은 참고용이며 공식 심사결과나 투자 가능성 단정이 아닙니다.';
  let response;
  try{
    const userText='다음 경영체의 선택 자료를 검토해 구조화 보고서를 작성하세요.\n경영체명: '+String(company.business_name||'').slice(0,200)+'\n사업 개요: '+String(company.business_summary||'').slice(0,2500)+'\n보고서 작성일: '+new Date().toLocaleDateString('ko-KR');
    response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},signal:AbortSignal.timeout(52000),body:JSON.stringify({model,store:false,input:[{role:'developer',content:[{type:'input_text',text:instruction}]},{role:'user',content:[{type:'input_text',text:userText},...files]}],text:{format:{type:'json_object'}}})});
  }catch(error){
    if(error?.name==='TimeoutError'||error?.name==='AbortError')throw new ApiError(504,'AI_TIMEOUT','분석 시간이 길어져 중단했습니다. 파일 수를 줄이거나 작은 파일로 다시 시도하세요.');
    throw new ApiError(502,'AI_UNAVAILABLE','AI 분석 서비스에 연결하지 못했습니다.');
  }
  const payload=await response.json().catch(()=>({}));
  if (response.status === 429) {
    const quotaCodes = [
      'insufficient_quota', 'billing_hard_limit_reached', 'credit_balance_exhausted',
      'organization_spend_limit_exceeded', 'project_spend_limit_exceeded', 'organization_usage_limit_exceeded',
    ];
    if ([payload.error?.code, payload.error?.type].some(code => quotaCodes.includes(code))) {
      throw new ApiError(429, 'AI_QUOTA_EXHAUSTED', 'OpenAI API 사용 한도가 부족합니다. 관리자에게 OpenAI 프로젝트의 크레딧, 결제 상태와 사용 한도를 확인해 달라고 요청하세요.');
    }
    throw new ApiError(429, 'AI_RATE_LIMIT', 'OpenAI 요청 속도 제한에 도달했습니다. 잠시 기다렸다가 다시 시도하세요.');
  }
  if (!response.ok) {
    throw new ApiError(502, 'AI_FAILED', 'AI 분석을 완료하지 못했습니다. 파일 형식과 API 설정을 확인하세요.');
  }
  const output=String(payload.output_text||payload.output?.flatMap(item=>item.content||[]).find(item=>item.type==='output_text')?.text||'');
  let report;
  try{report=JSON.parse(output);}catch{throw new ApiError(502,'AI_INVALID_REPORT','AI가 보고서 형식으로 응답하지 않았습니다. 다시 시도하세요.');}
  const boundedList=(value,max=12)=>Array.isArray(value)?value.slice(0,max).map(item=>typeof item==='string'?item.slice(0,1400):item&&typeof item==='object'?Object.fromEntries(Object.entries(item).slice(0,8).map(([key,v])=>[String(key).slice(0,80),String(v??'').slice(0,1400)])):String(item).slice(0,1400)):[];
  const returnedMetrics=new Map((Array.isArray(report.metrics)?report.metrics:[]).filter(item=>item&&typeof item==='object').map(item=>[String(item.code||''),item]));
  const metrics=ASSESSMENT_RUBRIC.flatMap(axis=>{const axisIndicatorTotal=axis.indicators.reduce((sum,item)=>sum+item.weight,0);return axis.indicators.map(indicator=>{const raw=returnedMetrics.get(indicator.id)||{};const n=Number(raw.score);const score=Number.isInteger(n)&&n>=1&&n<=4?n:1;return {code:indicator.id,axis:axis.label,axisWeight:axis.weight,name:indicator.label,indicatorWeight:indicator.weight,combinedWeight:Number((axis.weight*indicator.weight/axisIndicatorTotal).toFixed(2)),score,evidence:String(raw.evidence||'자료에서 직접 근거를 확인하지 못함').slice(0,1400),note:String(raw.note||'').slice(0,1400)};});});
  const combinedWeightTotal=metrics.reduce((sum,item)=>sum+item.combinedWeight,0);const overallScore=Math.round(metrics.reduce((sum,item)=>sum+item.score*item.combinedWeight,0)/combinedWeightTotal/4*100);
  return {data:{company_name:company.business_name,created_at:new Date().toISOString(),model,summary:String(report.summary||'').slice(0,4000),overallScore,scoreBasis:'설문 응답 '+SURVEY_RESPONSE_COUNT+'명의 순위 기반 Borda 가중치 적용. 상위 축과 축별 지표를 각각 정규화해 합산한 1~4점 가중평균을 100점으로 환산했습니다.',weights:ASSESSMENT_RUBRIC,criticalAxes:CRITICAL_AXES,earlyStageCompensableAxes:EARLY_STAGE_COMPENSABLE_AXES,strengths:boundedList(report.strengths),risks:boundedList(report.risks),missingEvidence:boundedList(report.missingEvidence),recommendations:boundedList(report.recommendations),metrics,sources:boundedList(report.sources,5),disclaimer:String(report.disclaimer||'설문 응답을 반영한 AI 검토 참고자료이며 공식 심사결과가 아닙니다.').slice(0,1000)}};
}

async function execute(request,path){
  const method=request.method;
  const {db,profile}=await authorize(request);
  if(path.length===1&&path[0]==='me'&&method==='GET')return {data:profile,capabilities:CAPABILITIES};
  assertActive(profile);
  const [resource,id,child]=path;
  if(resource==='pseudo-ai-analysis'&&path.length===1&&method==='POST')return analyzePseudoDocuments(profile,request);
  if(resource==='pseudo-emails'&&path.length===1&&method==='POST'){
    assertAdmin(profile);
    const body=await jsonBody(request);
    const recipient=String(body.recipient||'').trim().toLowerCase();
    const subject=String(body.subject||'').trim();
    const message=String(body.body||'').trim();
    const configured=String(process.env.P1_PSEUDO_TEST_RECIPIENTS||'khkim.intw@gmail.com,kh.kim@intw.co.kr').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean);
    if(body.mode!=='pseudo')throw new ApiError(400,'PSEUDO_MODE_REQUIRED','Pseudo 테스트 화면에서만 보낼 수 있습니다.');
    if(!validEmail(recipient)||!configured.includes(recipient))throw new ApiError(403,'PSEUDO_RECIPIENT_DENIED','Pseudo 테스트 메일은 등록된 GIA·IIA 테스트 주소로만 보낼 수 있습니다.');
    if(!subject||subject.length>300||!message||message.length>8000)throw new ApiError(400,'INVALID_EMAIL','메일 제목과 본문을 확인하세요.');
    const apiKey=process.env.RESEND_API_KEY,from=process.env.P1_EMAIL_FROM;
    if(!apiKey||!from)throw new ApiError(503,'EMAIL_NOT_CONFIGURED','Resend 발신 주소와 API 키가 설정되어 있지 않습니다.');
    const sendNumber=Math.max(1,Math.min(100,Number(body.send_number)||1));
    const finalSubject=`[Pseudo 테스트 ${sendNumber}회] ${subject.replace(/^\[Pseudo 테스트(?:\s+\d+회)?\]\s*/,'')}`;
    const replyTo=String(process.env.P1_EMAIL_REPLY_TO||'').trim()||DEFAULT_EMAIL_REPLY_TO;
    const text=`[Pseudo 테스트 메일 · ${sendNumber}회 발송]\n\n${message}\n\n--\n이 메일은 APFS Pseudo 테스트 화면에서 발송했습니다.\n회신 주소: ${replyTo}`;
    const messageId=crypto.randomUUID();
    let response;
    try{response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':`pseudo-email-${messageId}`},body:JSON.stringify({from,to:[recipient],subject:finalSubject,text,reply_to:replyTo})});}
    catch{throw new ApiError(502,'EMAIL_SEND_FAILED','메일 발송 서비스에 연결하지 못했습니다.');}
    const provider=await response.json().catch(()=>({}));
    if(!response.ok||!provider.id)throw new ApiError(502,'EMAIL_SEND_FAILED','Resend에서 메일을 접수하지 못했습니다. 발신 도메인과 설정을 확인하세요.');
    return {data:{id:messageId,provider_email_id:provider.id,recipient,subject:finalSubject,body:text,status:'sent',sent_at:new Date().toISOString(),send_number:isFinite(sendNumber)?sendNumber:1,pseudo_test:true}};
  }
  if(resource==='companies'&&path.length===3&&child==='ai-analysis'&&method==='POST')return analyzeCompanyDocuments(db,profile,id,request);
  if(resource==='notifications'&&path.length===1&&method==='GET'){
    // Own notifications only (also enforced by RLS).
    const items=await result(db.from('notifications').select(NOTIFICATION_COLUMNS).eq('user_id',profile.id).order('created_at',{ascending:false}).limit(30));
    const {count,error}=await db.from('notifications').select('id',{count:'exact',head:true}).eq('user_id',profile.id).is('read_at',null);
    if(error)dbFailure(error);
    return {data:{items,unread:count||0}};
  }
  if(resource==='notifications'&&path.length===2&&id==='read'&&method==='POST'){
    const body=await jsonBody(request);
    let query=db.from('notifications').update({read_at:new Date().toISOString()}).eq('user_id',profile.id).is('read_at',null);
    if(body?.all!==true){
      if(!Array.isArray(body?.ids)||!body.ids.length||body.ids.length>100)throw new ApiError(400,'INVALID_VALUE','읽음 처리할 알림을 확인하세요.');
      query=query.in('id',body.ids.map(assertId));
    }
    const rows=await result(query.select('id'));
    return {data:{updated:rows.length}};
  }
  if(resource==='companies'&&path.length===2&&id==='import'&&method==='POST')return importCompanies(db,profile,request);
  if(resource==='companies'&&path.length===2&&id==='import-history'&&method==='GET'){assertAdmin(profile);return {data:await importHistory(db)};}
  if(resource==='companies'&&path.length===2&&id==='import-undo'&&method==='POST')return undoCompanyImport(db,profile,request);
  if(resource==='companies'&&path.length===1){
    if(method==='GET'){
      let query=db.from('companies').select(COMPANY_COLUMNS.join(',')).order('business_name').limit(1000);
      if(!isAdmin(profile))query=profile.user_kind==='consultant'?query.eq('assigned_consultant_id',profile.id):query.eq('id',profile.company_id||'00000000-0000-4000-8000-000000000000');
      const rows=await result(query);return {data:isAdmin(profile)?await enrichAdminCompanies(db,rows):rows.map(company=>({...present(profile,company),notes:'',representative_email:''}))};
    }
    if(method==='POST'){
      const body=await jsonBody(request);
      const consultantSubmission=profile.role==='user'&&profile.user_kind==='consultant';
      if(!isAdmin(profile)&&!consultantSubmission)throw new ApiError(403,'FORBIDDEN','경영체 등록은 관리자 또는 컨설턴트 계정만 요청할 수 있습니다.');
      const {business,privateData}=splitCompanyBody(body);
      let safeBusiness=business,safePrivate=privateData;
      if(consultantSubmission){
        const allowedBusiness=['business_name','business_registration_number','founded_year','theme','program_year','presentation_date','business_summary'];
        const allowedPrivate=['address'];
        if(Object.keys(business).some(key=>!allowedBusiness.includes(key))||Object.keys(privateData).some(key=>!allowedPrivate.includes(key)))throw new ApiError(400,'INVALID_FIELDS','등록 요청에 허용되지 않은 필드가 포함되어 있습니다.');
        safeBusiness={...Object.fromEntries(Object.entries(business).filter(([key])=>allowedBusiness.includes(key))),assigned_consultant_id:profile.id,status:'등록 검토',ir_direct:false,ir_confirmed:false,ir_confirmed_at:null,ir_scheduled_at:null};
        safePrivate=Object.fromEntries(Object.entries(privateData).filter(([key])=>allowedPrivate.includes(key)));
        if(safePrivate.address)safePrivate.address_verification='확인 필요';
      }
      const payload=companyPayload(safeBusiness,true);
      if(!consultantSubmission)await checkAssignee(db,payload.assigned_consultant_id);
      const company=await one(db.from('companies').insert(payload).select(COMPANY_COLUMNS.join(',')));
      const details=companyPrivatePayload(safePrivate);
      if(Object.keys(details).length){
        if(consultantSubmission)await result(db.from('company_admin_private').insert({company_id:company.id,...details}));
        else await result(db.from('company_admin_private').upsert({company_id:company.id,...details},{onConflict:'company_id'}));
      }
      await result(db.from('company_import_events').insert({company_id:company.id,actor_id:profile.id}));
      return {data:consultantSubmission?present(profile,company):{...company,...details},status:201};
    }
  }
  if(resource==='companies'&&path.length===2){
    const company=await scopeCompany(db,profile,id);
    if(method==='GET')return {data:isAdmin(profile)?(await enrichAdminCompanies(db,[company]))[0]:present(profile,company)};
    assertAdmin(profile);
    if(method==='PATCH'){const {business,privateData}=splitCompanyBody(await jsonBody(request));const current=await one(db.from('companies').select('status').eq('id',id));const payload=companyPayload(business);if(current.status==='포기'&&payload.status&&payload.status!=='포기'&&payload.status!=='배정 대기')throw new ApiError(409,'ABANDONED_RESTORE_REQUIRED','포기 기업은 ‘포기 해제 (배정 대기)’로 먼저 복귀해야 합니다.');if(current.status==='포기'&&(payload.ir_confirmed===true||payload.ir_scheduled_at))throw new ApiError(409,'ABANDONED_IR_BLOCKED','포기 기업에는 IR 확정이나 일정을 등록할 수 없습니다.');if(payload.status==='포기'){payload.ir_confirmed=false;payload.ir_confirmed_at=null;payload.ir_scheduled_at=null;}await checkAssignee(db,payload.assigned_consultant_id);const row=await one(db.from('companies').update(payload).eq('id',id).select(COMPANY_COLUMNS.join(',')));const details=companyPrivatePayload(privateData);if('address' in details){const current=await result(db.from('company_admin_private').select('address,address_verification').eq('company_id',id).maybeSingle());if(current?.address_verification==='잠금'&&details.address!==current.address&&(details.address_verification||'잠금')==='잠금')throw new ApiError(409,'ADDRESS_LOCKED','주소가 잠겨 있습니다. 주소 확인 상태를 먼저 잠금 해제하세요.');}if(Object.keys(details).length)await result(db.from('company_admin_private').upsert({company_id:id,...details},{onConflict:'company_id'}));return {data:{...row,...details}};}
    if(method==='DELETE'){
      const linked=await result(db.from('consultation_sessions').select('id').eq('company_id',id).limit(1));
      if(linked.length)throw new ApiError(409,'COMPANY_HAS_SESSIONS','연결된 상담 회차가 있어 경영체 삭제를 차단했습니다. 기존 기록을 먼저 검토하세요.');
      await one(db.from('companies').delete().eq('id',id).select('id'));return {data:{id,deleted:true}};
    }
  }
  if(resource==='companies'&&path.length===3&&child==='emails'){
    assertAdmin(profile);
    const company=await scopeCompany(db,profile,id);
    if(method==='GET')return {data:await result(db.from('company_email_messages').select('id,company_id,actor_id,recipient,subject,body,send_number,is_resend,in_reply_to,provider_email_id,provider_message_id,status,error_message,sent_at,created_at').eq('company_id',id).order('created_at',{ascending:false}).limit(100))};
    if(method==='POST'){
      if(company.status==='포기')throw new ApiError(409,'ABANDONED_EMAIL_BLOCKED','포기 처리된 기업에는 메일을 보낼 수 없습니다.');
      const body=await jsonBody(request);
      const recipient=String(body.recipient||'').trim();
      const subject=String(body.subject||'').trim();
      const message=String(body.body||'').trim();
      if(!validEmail(recipient))throw new ApiError(400,'INVALID_RECIPIENT','받는 사람 이메일 주소를 확인하세요.');
      if(!subject||subject.length>300||!message||message.length>8000)throw new ApiError(400,'INVALID_EMAIL','메일 제목과 본문을 확인하세요.');
      const apiKey=process.env.RESEND_API_KEY;
      const from=process.env.P1_EMAIL_FROM;
      if(!apiKey||!from)throw new ApiError(503,'EMAIL_NOT_CONFIGURED','메일 발송 설정이 아직 완료되지 않았습니다. 관리자에게 발신 도메인과 Resend API 키 설정을 요청하세요.');
      const previous=await result(db.from('company_email_messages').select('id,send_number,provider_message_id').eq('company_id',id).eq('status','sent').order('send_number',{ascending:false}).limit(1));
      const last=previous[0]||null;
      const sendNumber=(Number(last?.send_number)||0)+1;
      const isResend=sendNumber>1;
      const threadRequested=body.replyToPrevious===true&&!!last?.provider_message_id;
      const finalSubject=isResend?`[재발송 ${sendNumber}회] ${subject.replace(/^\[재발송(?:\s+\d+회)?\]\s*/,'')}`:subject;
      const replyTo=String(process.env.P1_EMAIL_REPLY_TO||'').trim()||DEFAULT_EMAIL_REPLY_TO;
      const bodyCore=isResend?`[재발송 안내] 확인을 위해 다시 보내드립니다. (${sendNumber}회 발송)\n\n${message}`:message;
      const finalBody=bodyCore;
      const outboundText=`${bodyCore}\n\n--\n이 메일에 회신하시면 ${replyTo}(으)로 전달됩니다. 문의 사항은 ${replyTo}로 회신해 주세요.`;
      const log=await one(db.from('company_email_messages').insert({company_id:id,actor_id:profile.id,recipient,subject:finalSubject,body:finalBody,send_number:sendNumber,is_resend:isResend,in_reply_to:threadRequested?last.id:null,status:'pending'}).select('id,send_number'));
      let providerId=null,messageId=null;
      try{
        const headers=threadRequested?{'In-Reply-To':last.provider_message_id,'References':last.provider_message_id}:undefined;
        const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':`company-email-${log.id}`},body:JSON.stringify({from,to:[recipient],subject:finalSubject,text:outboundText,reply_to:replyTo,headers})});
        const payload=await response.json().catch(()=>({}));
        if(!response.ok||!payload.id)throw new Error(response.status===429?'메일 발송 한도에 도달했습니다. 잠시 후 다시 시도하세요.':'메일 공급자에서 발송을 거부했습니다. 발신 도메인과 설정을 확인하세요.');
        providerId=payload.id;
        try{const lookup=await fetch(`https://api.resend.com/emails/${encodeURIComponent(providerId)}`,{headers:{Authorization:`Bearer ${apiKey}`}});if(lookup.ok){const detail=await lookup.json();messageId=detail.message_id||null;}}catch{}
        const saved=await one(db.from('company_email_messages').update({provider_email_id:providerId,provider_message_id:messageId,status:'sent',sent_at:new Date().toISOString(),error_message:null}).eq('id',log.id).select('id,company_id,actor_id,recipient,subject,body,send_number,is_resend,in_reply_to,provider_email_id,provider_message_id,status,error_message,sent_at,created_at'));
        // A database trigger creates in-app notifications only after this confirmed sent update.
        return {data:saved,threaded:threadRequested};
      }catch(error){
        await result(db.from('company_email_messages').update({provider_email_id:providerId,status:'failed',error_message:String(error?.message||'발송 실패').slice(0,300)}).eq('id',log.id));
        if(error instanceof ApiError)throw error;
        throw new ApiError(502,'EMAIL_SEND_FAILED',String(error?.message||'메일 발송에 실패했습니다.').slice(0,300));
      }
    }
  }
  if(resource==='companies'&&child==='sessions'&&path.length===3){
    const company=await scopeCompany(db,profile,id);
    if(method==='GET')return {data:await result(db.from('consultation_sessions').select(SESSION_COLUMNS.join(',')).eq('company_id',id).order('kind').order('round_number'))};
    if(method==='POST'){
      assertCompanyWrite(profile,company);if(company.status==='포기')throw new ApiError(409,'ABANDONED_SESSION_BLOCKED','포기 처리된 기업에는 새 회차를 등록할 수 없습니다.');const payload=sessionPayload(await jsonBody(request),{create:true});
      return {data:await one(db.from('consultation_sessions').insert({...payload,company_id:id,updated_by:profile.id}).select(SESSION_COLUMNS.join(','))),status:201};
    }
  }
  if(resource==='sessions'&&path.length===1&&method==='GET'){
    // Cross-company schedule/report overview. Free-text notes are never included.
    let query=db.from('consultation_sessions').select(SESSION_LIST_COLUMNS.join(',')).order('scheduled_on',{ascending:true,nullsFirst:false}).limit(1000);
    if(!isAdmin(profile)){
      let scoped=db.from('companies').select('id').limit(1000);
      scoped=profile.user_kind==='consultant'?scoped.eq('assigned_consultant_id',profile.id):scoped.eq('id',profile.company_id||'00000000-0000-4000-8000-000000000000');
      const ids=(await result(scoped)).map(company=>company.id);
      if(!ids.length)return {data:[]};
      query=query.in('company_id',ids);
    }
    return {data:await result(query)};
  }
  if(resource==='sessions'&&path.length===3&&child==='report'){
    const reportSession=await one(db.from('consultation_sessions').select(SESSION_COLUMNS.join(',')).eq('id',assertId(id)));
    const company=await scopeCompany(db,profile,reportSession.company_id);
    if(method==='GET'){
      if(!reportSession.report_file_path)return {data:null};
      const {data,error}=await db.storage.from('consultation-reports').createSignedUrl(reportSession.report_file_path,60,{download:reportSession.report_file_name||true});
      if(error)dbFailure(error);
      return {data:{name:reportSession.report_file_name,size:reportSession.report_file_size,uploaded_at:reportSession.report_file_uploaded_at,url:data.signedUrl}};
    }
    if(method==='POST'){
      assertCompanyWrite(profile,company);
      if(company.status==='포기')throw new ApiError(409,'ABANDONED_REPORT_BLOCKED','포기 처리된 기업에는 보고서를 추가할 수 없습니다.');
      const body=await jsonBody(request);
      const pathName=String(body.path||''),parts=pathName.split('/');
      if(parts.length!==3||parts[0]!==company.id||parts[1]!==reportSession.id||parts[2].length>220)throw new ApiError(400,'INVALID_FILE_PATH','업로드한 파일 경로를 확인할 수 없습니다.');
      const original=String(body.name||'보고서'),ext=(original.match(/\.([a-z0-9]+)$/i)||[])[1]?.toLowerCase()||'';
      if(!['pdf','hwp','hwpx','doc','docx','xlsx','xls'].includes(ext))throw new ApiError(415,'FILE_TYPE','PDF, HWP, HWPX, DOC, DOCX, XLS, XLSX 파일만 올릴 수 있습니다.');
      const bucket=db.storage.from('consultation-reports');
      const {data:objects,error:listError}=await bucket.list(company.id+'/'+reportSession.id,{limit:100,search:parts[2]});
      if(listError)dbFailure(listError);
      const object=objects?.find(item=>item.name===parts[2]);
      if(!object||Number(object.metadata?.size||0)>20*1024*1024)throw new ApiError(400,'FILE_NOT_FOUND','비공개 저장소에서 업로드 파일을 확인하지 못했습니다.');
      const oldPath=reportSession.report_file_path;
      const saved=await one(db.from('consultation_sessions').update({report_file_path:pathName,report_file_name:original.slice(0,240),report_file_size:Number(object.metadata?.size||0),report_file_uploaded_at:new Date().toISOString(),report_file_uploaded_by:profile.id,updated_by:profile.id}).eq('id',reportSession.id).select('id,report_file_name,report_file_size,report_file_uploaded_at'));
      if(oldPath&&oldPath!==pathName)await bucket.remove([oldPath]);
      return {data:saved};
    }
  }
  if(resource==='sessions'&&path.length===2){
    const session=await one(db.from('consultation_sessions').select(SESSION_COLUMNS.join(',')).eq('id',assertId(id)));
    const company=await scopeCompany(db,profile,session.company_id);
    if(method==='GET')return {data:session};
    assertCompanyWrite(profile,company);
    if(company.status==='포기'&&method!=='GET')throw new ApiError(409,'ABANDONED_SESSION_BLOCKED','포기 처리된 기업의 회차는 수정하거나 삭제할 수 없습니다.');
    if(method==='PATCH'){const payload=sessionPayload(await jsonBody(request),{current:session});if(payload.appointment_confirmed===true){payload.confirmed_by=profile.id;payload.confirmed_at=new Date().toISOString();}else if(payload.appointment_confirmed===false){payload.confirmed_by=null;payload.confirmed_at=null;}return {data:await one(db.from('consultation_sessions').update({...payload,updated_by:profile.id}).eq('id',id).select(SESSION_COLUMNS.join(',')))};}
    if(method==='DELETE'){assertAdmin(profile);await one(db.from('consultation_sessions').delete().eq('id',id).select('id'));return {data:{id,deleted:true}};}
  }
  if(resource==='profiles'){
    assertAdmin(profile);
    if(path.length===1&&method==='GET')return {data:await result(db.from('profiles').select(PROFILE_COLUMNS.join(',')).order('created_at',{ascending:false}).limit(1000))};
    if(path.length===2&&method==='PATCH'){
      const target=await one(db.from('profiles').select(PROFILE_COLUMNS.join(',')).eq('id',assertId(id)));
      const payload=profilePayload(await jsonBody(request),profile,target);
      if(payload.company_id)await scopeCompany(db,profile,payload.company_id);
      return {data:await one(db.from('profiles').update(payload).eq('id',id).select(PROFILE_COLUMNS.join(',')))};
    }
  }
  if(resource==='audit'&&path.length===1&&method==='GET'){
    assertAdmin(profile);
    const companyId=new URL(request.url).searchParams.get('company_id');
    let query=db.from('audit_events').select(AUDIT_COLUMNS.join(',')).order('created_at',{ascending:false}).limit(100);
    if(companyId){
      await scopeCompany(db,profile,companyId);
      const sessions=await result(db.from('consultation_sessions').select('id').eq('company_id',companyId).limit(100));
      query=query.in('entity_id',[companyId,...sessions.map(s=>s.id)]);
    }
    return {data:await result(query)};
  }
  throw new ApiError(404,'NOT_FOUND','지원하지 않는 API 경로 또는 요청 방식입니다.');
}
export async function handleApi(request,context){
  const requestId=crypto.randomUUID();
  try{
    if(!['GET','HEAD'].includes(request.method)){
      const origin=request.headers.get('origin');
      if(origin&&origin!==new URL(request.url).origin)throw new ApiError(403,'ORIGIN_DENIED','다른 출처의 변경 요청은 허용하지 않습니다.');
    }
    const params=await context.params;
    const {status=200,...body}=await execute(request,params.path||[]);
    return respond(body,status,requestId);
  }catch(error){
    if(error instanceof ApiError)return respond({error:{code:error.code,message:error.message}},error.status,requestId);
    // Never log JWTs, request bodies, DB messages, SQL or personal data.
    return respond({error:{code:'INTERNAL_ERROR',message:'요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.'}},500,requestId);
  }
}
