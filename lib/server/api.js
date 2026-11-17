import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL,SUPABASE_KEY,SUPABASE_CONFIGURED } from '../public-config';
import { ApiError, assertId, assertActive, assertAdmin, isAdmin, canReadCompany, assertCompanyWrite, companyPayload, sessionPayload, profilePayload, COMPANY_COLUMNS,PROFILE_COLUMNS,SESSION_COLUMNS,AUDIT_COLUMNS,CAPABILITIES } from './contracts';
const MAX_BODY=32768;
const JSON_HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Authorization'};
function respond(value,status,requestId){return new Response(JSON.stringify({...value,requestId}),{status,headers:{...JSON_HEADERS,'X-Request-ID':requestId}});}
async function jsonBody(request){
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new ApiError(415,'JSON_REQUIRED','application/json 요청만 허용합니다.');
  const declared=Number(request.headers.get('content-length')||0);
  if(!Number.isFinite(declared)||declared>MAX_BODY)throw new ApiError(413,'BODY_TOO_LARGE','요청은 32KB 이하여야 합니다.');
  const reader=request.body?.getReader();
  if(!reader)throw new ApiError(400,'INVALID_BODY','요청 본문이 필요합니다.');
  const chunks=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_BODY){await reader.cancel();throw new ApiError(413,'BODY_TOO_LARGE','요청은 32KB 이하여야 합니다.');}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ApiError(400,'INVALID_BODY','올바른 UTF-8 JSON 요청이 필요합니다.');}
}
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
async function execute(request,path){
  const method=request.method;
  const {db,profile}=await authorize(request);
  if(path.length===1&&path[0]==='me'&&method==='GET')return {data:profile,capabilities:CAPABILITIES};
  assertActive(profile);
  const [resource,id,child]=path;
  if(resource==='companies'&&path.length===1){
    if(method==='GET'){
      let query=db.from('companies').select(COMPANY_COLUMNS.join(',')).order('business_name').limit(1000);
      if(!isAdmin(profile))query=profile.user_kind==='consultant'?query.eq('assigned_consultant_id',profile.id):query.eq('id',profile.company_id||'00000000-0000-4000-8000-000000000000');
      return {data:await result(query)};
    }
    if(method==='POST'){
      assertAdmin(profile);const payload=companyPayload(await jsonBody(request),true);await checkAssignee(db,payload.assigned_consultant_id);
      return {data:await one(db.from('companies').insert(payload).select(COMPANY_COLUMNS.join(','))),status:201};
    }
  }
  if(resource==='companies'&&path.length===2){
    const company=await scopeCompany(db,profile,id);
    if(method==='GET')return {data:company};
    assertAdmin(profile);
    if(method==='PATCH'){const payload=companyPayload(await jsonBody(request));await checkAssignee(db,payload.assigned_consultant_id);return {data:await one(db.from('companies').update(payload).eq('id',id).select(COMPANY_COLUMNS.join(',')))};}
    if(method==='DELETE'){
      const linked=await result(db.from('consultation_sessions').select('id').eq('company_id',id).limit(1));
      if(linked.length)throw new ApiError(409,'COMPANY_HAS_SESSIONS','연결된 상담 회차가 있어 경영체 삭제를 차단했습니다. 기존 기록을 먼저 검토하세요.');
      await one(db.from('companies').delete().eq('id',id).select('id'));return {data:{id,deleted:true}};
    }
  }
  if(resource==='companies'&&child==='sessions'&&path.length===3){
    const company=await scopeCompany(db,profile,id);
    if(method==='GET')return {data:await result(db.from('consultation_sessions').select(SESSION_COLUMNS.join(',')).eq('company_id',id).order('kind').order('round_number'))};
    if(method==='POST'){
      assertCompanyWrite(profile,company);const payload=sessionPayload(await jsonBody(request),{create:true});
      return {data:await one(db.from('consultation_sessions').insert({...payload,company_id:id,updated_by:profile.id}).select(SESSION_COLUMNS.join(','))),status:201};
    }
  }
  if(resource==='sessions'&&path.length===2){
    const session=await one(db.from('consultation_sessions').select(SESSION_COLUMNS.join(',')).eq('id',assertId(id)));
    const company=await scopeCompany(db,profile,session.company_id);
    if(method==='GET')return {data:session};
    assertCompanyWrite(profile,company);
    if(method==='PATCH'){const payload=sessionPayload(await jsonBody(request),{current:session});return {data:await one(db.from('consultation_sessions').update({...payload,updated_by:profile.id}).eq('id',id).select(SESSION_COLUMNS.join(',')))};}
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
