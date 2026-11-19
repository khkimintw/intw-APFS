import { createClient } from '@supabase/supabase-js';
import { IMPORT_LIMITS, IMPORT_FIELDS, normalizeName, normalizeBizNo, sanitizeImportRow } from '../../modules/companyImport';
import { SUPABASE_URL,SUPABASE_KEY,SUPABASE_CONFIGURED } from '../public-config';
import { ApiError, assertId, assertActive, assertAdmin, isAdmin, canReadCompany, assertCompanyWrite, companyPayload, sessionPayload, profilePayload, SESSION_LIST_COLUMNS, COMPANY_COLUMNS,PROFILE_COLUMNS,SESSION_COLUMNS,AUDIT_COLUMNS,CAPABILITIES } from './contracts';
const MAX_BODY=32768,IMPORT_MAX_BODY=524288;
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

async function execute(request,path){
  const method=request.method;
  const {db,profile}=await authorize(request);
  if(path.length===1&&path[0]==='me'&&method==='GET')return {data:profile,capabilities:CAPABILITIES};
  assertActive(profile);
  const [resource,id,child]=path;
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
      assertAdmin(profile);const {business,privateData}=splitCompanyBody(await jsonBody(request));const payload=companyPayload(business,true);await checkAssignee(db,payload.assigned_consultant_id);
      const company=await one(db.from('companies').insert(payload).select(COMPANY_COLUMNS.join(',')));const details=companyPrivatePayload(privateData);if(Object.keys(details).length)await result(db.from('company_admin_private').upsert({company_id:company.id,...details},{onConflict:'company_id'}));
      return {data:{...company,...details},status:201};
    }
  }
  if(resource==='companies'&&path.length===2){
    const company=await scopeCompany(db,profile,id);
    if(method==='GET')return {data:isAdmin(profile)?(await enrichAdminCompanies(db,[company]))[0]:present(profile,company)};
    assertAdmin(profile);
    if(method==='PATCH'){const {business,privateData}=splitCompanyBody(await jsonBody(request));const payload=companyPayload(business);await checkAssignee(db,payload.assigned_consultant_id);const row=await one(db.from('companies').update(payload).eq('id',id).select(COMPANY_COLUMNS.join(',')));const details=companyPrivatePayload(privateData);if('address' in details){const current=await result(db.from('company_admin_private').select('address,address_verification').eq('company_id',id).maybeSingle());if(current?.address_verification==='잠금'&&details.address!==current.address&&(details.address_verification||'잠금')==='잠금')throw new ApiError(409,'ADDRESS_LOCKED','주소가 잠겨 있습니다. 주소 확인 상태를 먼저 잠금 해제하세요.');}if(Object.keys(details).length)await result(db.from('company_admin_private').upsert({company_id:id,...details},{onConflict:'company_id'}));return {data:{...row,...details}};}
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
