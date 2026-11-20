// Owner-only Google authorization. Secrets stay encrypted in the existing D1
// binding; legacy consultant OAuth remains in its original callback handler.
const ORIGIN='https://briefbooth.com';
const CALLBACK=ORIGIN+'/api/google/callback';
const COOKIE='__Secure-briefbooth-google';
const TTL=10*60*1000;
const SCOPES=['https://www.googleapis.com/auth/calendar.events.owned','https://www.googleapis.com/auth/calendar.freebusy'];
const encoder=new TextEncoder(),decoder=new TextDecoder();
export class GoogleConnectionError extends Error {
 constructor(status,message){super(message);this.name='GoogleConnectionError';this.status=status;}
}
const fail=(status,message,reason)=>{const error=new GoogleConnectionError(status,message);if(reason)error.reason=reason;throw error;};
const DIAGNOSTIC_PHASES=new Set(['request_validation','state_lookup','state_claim','code_validation','state_decrypt','baseline_check','token_exchange','candidate_tokens','candidate_identity','candidate_refresh','refreshed_identity','identity_match','calendar_probe','baseline_recheck','candidate_encrypt','candidate_stage','completion_validation','completion_refresh','completion_identity','completion_promotion']);
const DIAGNOSTIC_PROVIDERS=new Set(['token_exchange','token_refresh','tokeninfo','freebusy','events_list']);
const DIAGNOSTIC_CODES=new Set(['invalid_grant','invalid_client','invalid_request','redirect_uri_mismatch','access_denied','unsupported_grant_type','unauthorized_client','invalid_scope','invalid_token','rate_limit_exceeded','PERMISSION_DENIED','UNAUTHENTICATED','RESOURCE_EXHAUSTED','INVALID_ARGUMENT','NOT_FOUND','INTERNAL','UNAVAILABLE','forbidden','insufficientPermissions','rateLimitExceeded','userRateLimitExceeded','authError','backendError','invalid','notFound','network_error','malformed_response','unrecognized']);
const DIAGNOSTIC_REASONS=new Set(['scope_set_mismatch','subject_missing','subject_invalid','audience_missing','audience_invalid','audience_mismatch','authorized_party_mismatch','refresh_token_missing','access_token_missing','account_mismatch','provider_request_failed','validation_failed','unexpected_failure']);
function providerError(operation,status,code){const error=new GoogleConnectionError(503,'Google could not verify the connection. Please try again.');error.diagnostic={provider:operation,provider_status:status,provider_code:DIAGNOSTIC_CODES.has(code)?code:'unrecognized'};return error;}
function failureRecord(phase,error){
 // Only fixed enums and HTTP numbers enter logs or durable diagnostics. Never
 // serialize Error, provider payload, request URL, state, identity or credentials.
 const status=error instanceof GoogleConnectionError&&Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:503;
 const record={event:'briefbooth_google_oauth',stage:DIAGNOSTIC_PHASES.has(phase)?phase:'request_validation',status,reason:DIAGNOSTIC_REASONS.has(error?.reason)?error.reason:error instanceof GoogleConnectionError?'validation_failed':'unexpected_failure'};
 const detail=error instanceof GoogleConnectionError?error.diagnostic:null;
 if(DIAGNOSTIC_PROVIDERS.has(detail?.provider)){record.kind=detail.provider;record.reason='provider_request_failed';}
 if(Number.isInteger(detail?.provider_status)&&detail.provider_status>=100&&detail.provider_status<=599)record.providerStatus=detail.provider_status;
 if(DIAGNOSTIC_CODES.has(detail?.provider_code))record.providerCode=detail.provider_code;
 return record;
}
function warnFailure(phase,error){const diagnostic=JSON.stringify(failureRecord(phase,error));try{console.warn(diagnostic);}catch{}return diagnostic;}
async function retainFailure(env,operationHash,diagnostic){
 // Called only after a browser-bound handshake was claimed or owner completion
 // was authenticated. Retention is independent of encrypted handshake cleanup.
 // The row guard prevents a late failed completion overwriting a completed one.
 try{
  const now=Date.now();
  await env.RECOVERY_DB.batch([
   env.RECOVERY_DB.prepare("INSERT INTO recovery_google_failures(operation_hash,failed_ms,diagnostic) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM recovery_google_handshakes WHERE state_hash=? AND phase IN ('processing','failed','ready')) ON CONFLICT(operation_hash) DO UPDATE SET failed_ms=excluded.failed_ms,diagnostic=excluded.diagnostic").bind(operationHash,now,diagnostic,operationHash),
   env.RECOVERY_DB.prepare('DELETE FROM recovery_google_failures WHERE failed_ms<? OR operation_hash NOT IN (SELECT operation_hash FROM recovery_google_failures ORDER BY failed_ms DESC,operation_hash DESC LIMIT 100)').bind(now-7*86400000),
  ]);
 }catch{}
}
async function clearFailure(env,operationHash){try{await env.RECOVERY_DB.prepare("DELETE FROM recovery_google_failures WHERE operation_hash=? AND EXISTS(SELECT 1 FROM recovery_google_handshakes WHERE state_hash=? AND phase='completed')").bind(operationHash,operationHash).run();}catch{}}
export const googleConnectionEnabled=env=>env.RECOVERY_GOOGLE_OAUTH_ENABLED==='1';
function ownerId(env){let config;try{config=JSON.parse(env.RECOVERY_CONFIG_JSON);}catch{fail(503,'Google connection settings are unavailable.');}const id=config?.profile?.id;if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))fail(503,'Google connection settings are unavailable.');return id;}
function configured(env){if(!env.RECOVERY_DB||typeof env.RECOVERY_CAPABILITY_SECRET!=='string'||env.RECOVERY_CAPABILITY_SECRET.length<32||!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)fail(503,'Google connection settings are unavailable.');return ownerId(env);}
function ready(env){if(!googleConnectionEnabled(env))fail(503,'Google reconnection is not available.');return configured(env);}
function requestAt(request,method,path){const url=new URL(request.url);if(request.method!==method)fail(405,'This action is not supported.');if(url.origin!==ORIGIN||url.pathname!==path)fail(400,'This connection request is invalid.');if(method==='POST'&&request.headers.get('Origin')!==ORIGIN)fail(403,'Open this action from BriefBooth.');return url;}
function b64(bytes){return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
function unb64(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value))throw Error('Invalid encoding');return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));}
const random=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
async function hash(value){return b64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))));}
async function sealingKey(env){const master=await crypto.subtle.importKey('raw',encoder.encode(env.RECOVERY_CAPABILITY_SECRET),'HKDF',false,['deriveKey']);return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:encoder.encode('briefbooth-google-oauth-v1'),info:encoder.encode('encrypted-owner-google-credentials')},master,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
async function seal(env,owner,table,value){const iv=crypto.getRandomValues(new Uint8Array(12));const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(`${table}:${owner}`)},await sealingKey(env),encoder.encode(JSON.stringify(value)));return `v1.${b64(iv)}.${b64(new Uint8Array(bytes))}`;}
async function open(env,owner,table,value){try{const [version,iv,data,...rest]=String(value).split('.');if(version!=='v1'||rest.length)throw Error('Invalid envelope');const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv),additionalData:encoder.encode(`${table}:${owner}`)},await sealingKey(env),unb64(data));return JSON.parse(decoder.decode(plain));}catch{fail(503,'The saved Google connection could not be read. Your existing settings were not replaced.');}}
function secret(value){return typeof value==='string'&&value.length>0&&value.length<=16384&&!/[\r\n\u0000]/.test(value);}
function cookieValue(request){const matches=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(COOKIE+'='));if(matches.length!==1)return null;const value=matches[0].slice(COOKIE.length+1);const [state,browser,...rest]=value.split('.');return !rest.length&&/^r1_[A-Za-z0-9_-]{43}$/.test(state)&&/^[A-Za-z0-9_-]{43}$/.test(browser)?{state,browser,value}:null;}
const cookie=value=>`${COOKIE}=${value}; Path=/api/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`;
function json(value,headers={}){return Response.json(value,{headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer',...headers}});}
function redirect(result,value){return new Response(null,{status:303,headers:{Location:ORIGIN+'/studio/?google='+result,'Cache-Control':'no-store','Referrer-Policy':'no-referrer',...(value?{'Set-Cookie':cookie(value)}:{})}});}
async function provider(url,options={},operation){let response;try{response=await fetch(url,{...options,redirect:'manual',signal:AbortSignal.timeout(10000)});}catch{throw providerError(operation,null,'network_error');}if(!response.ok){let body;try{body=await response.json();}catch{}const code=typeof body?.error==='string'?body.error:body?.error?.status||body?.error?.errors?.[0]?.reason;throw providerError(operation,response.status,code);}let data;try{data=await response.json();}catch{throw providerError(operation,response.status,'malformed_response');}if(!data||typeof data!=='object'||Array.isArray(data))throw providerError(operation,response.status,'malformed_response');return data;}
async function refresh(env,refreshToken){const data=await provider('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:refreshToken,grant_type:'refresh_token'})},'token_refresh');if(!secret(data.access_token))fail(503,'Google did not return a usable connection.');return data;}
async function tokenIdentity(env,token,requiredScopeValidation=true){
 // Use Google's current user-access-token introspection contract (sub/aud/azp),
 // not the legacy profile-dependent user_id field. Match the official auth
 // library's POST/Bearer transport so access tokens never enter request URLs.
 // https://docs.cloud.google.com/docs/authentication/token-types#user-access-tokens
 const info=await provider('https://oauth2.googleapis.com/tokeninfo',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8',Authorization:'Bearer '+token}},'tokeninfo');
 const scopes=new Set(typeof info.scope==='string'?info.scope.split(/\s+/).filter(Boolean):[]);
 if(requiredScopeValidation&&(scopes.size!==SCOPES.length||!SCOPES.every(s=>scopes.has(s))))fail(400,'Allow only both requested Calendar permissions to connect Google.','scope_set_mismatch');
 if(info.sub===undefined||info.sub===null||info.sub==='')fail(400,'Google could not verify the existing business account.','subject_missing');
 if(typeof info.sub!=='string'||info.sub.length>256||/\s|[\u0000-\u001f\u007f]/.test(info.sub))fail(400,'Google could not verify the existing business account.','subject_invalid');
 if(info.aud===undefined||info.aud===null||info.aud==='')fail(400,'Google could not verify the existing business account.','audience_missing');
 if(typeof info.aud!=='string')fail(400,'Google could not verify the existing business account.','audience_invalid');
 if(info.aud!==env.GOOGLE_CLIENT_ID)fail(400,'Google could not verify the existing business account.','audience_mismatch');
 if(info.azp!==undefined&&info.azp!==env.GOOGLE_CLIENT_ID)fail(400,'Google could not verify the existing business account.','authorized_party_mismatch');
 // Keep the existing encrypted storage shape; userId now comes from sub.
 return {userId:info.sub,audience:info.aud};
}
async function verifyCalendar(token){const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};const now=new Date(),end=new Date(now.getTime()+60000);const free=await provider('https://www.googleapis.com/calendar/v3/freeBusy',{method:'POST',headers,body:JSON.stringify({timeMin:now.toISOString(),timeMax:end.toISOString(),items:[{id:'primary'}]})},'freebusy');const calendar=free.calendars?.primary;if(!calendar||calendar.errors?.length||!Array.isArray(calendar.busy))fail(503,'Google Calendar availability could not be verified.');
 const url=new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');url.searchParams.set('maxResults','1');url.searchParams.set('fields','kind');const events=await provider(url.href,{headers},'events_list');if(events.kind!=='calendar#events')fail(503,'Google Calendar event access could not be verified.');
}
export async function readGoogleCredential(env){
 // The migration is a deployment prerequisite. The UI/start feature flag must
 // never switch live bookings back to a superseded environment credential.
 const id=configured(env);const row=await env.RECOVERY_DB.prepare('SELECT revision,token_ciphertext FROM recovery_google_credentials WHERE owner_id=?').bind(id).first();
 if(!row){if(!secret(env.GOOGLE_REFRESH_TOKEN))fail(503,'Google Calendar needs attention.');return {refreshToken:env.GOOGLE_REFRESH_TOKEN,revision:0};}
 if(!Number.isSafeInteger(row.revision)||row.revision<1)fail(503,'The saved Google connection could not be read.');const token=await open(env,id,'recovery_google_credentials',row.token_ciphertext);if(!secret(token.refreshToken)||token.revision!==row.revision||typeof token.userId!=='string'||!token.userId||token.clientId!==env.GOOGLE_CLIENT_ID)fail(503,'The saved Google connection could not be read.');return {refreshToken:token.refreshToken,revision:row.revision};
}
export async function googleConnectionStatus(env){
 const id=configured(env),credential=await readGoogleCredential(env);const row=await env.RECOVERY_DB.prepare('SELECT updated_ms FROM recovery_google_credentials WHERE owner_id=?').bind(id).first();return {enabled:googleConnectionEnabled(env),connected:Boolean(credential.refreshToken),revision:credential.revision,updated_ms:row?.updated_ms??null};
}
export async function beginGoogleConnection(request,env,authenticatedOwnerId){
 requestAt(request,'POST','/api/recovery/google-connect');const id=ready(env);if(authenticatedOwnerId!==id)fail(403,'This account does not manage this Google connection.');
 await env.RECOVERY_DB.prepare('DELETE FROM recovery_google_handshakes WHERE state_hash IN (SELECT state_hash FROM recovery_google_handshakes WHERE expires_ms<=? ORDER BY expires_ms LIMIT 100)').bind(Date.now()).run();
 const credential=await readGoogleCredential(env);let identity;
 // The old grant establishes identity only; its historical scope set is not
 // the new grant being requested. Every candidate and completion stays strict.
 if(credential.revision===0){const access=await refresh(env,credential.refreshToken);identity=await tokenIdentity(env,access.access_token,false);}
 else{
  // This identity was verified before the earlier promotion. Keeping it sealed
  // allows repairing a revoked token without guessing or expanding scopes.
  const stored=await env.RECOVERY_DB.prepare('SELECT revision,token_ciphertext FROM recovery_google_credentials WHERE owner_id=?').bind(id).first();
  if(!stored||stored.revision!==credential.revision)fail(409,'Your Google connection changed. Start reconnection again.');
  const pinned=await open(env,id,'recovery_google_credentials',stored.token_ciphertext);
  if(pinned.revision!==credential.revision||pinned.refreshToken!==credential.refreshToken||pinned.clientId!==env.GOOGLE_CLIENT_ID||typeof pinned.userId!=='string'||!pinned.userId)fail(503,'The saved Google identity could not be verified.');
  identity={userId:pinned.userId,audience:pinned.clientId};
 }
 const state='r1_'+random(),browser=random(),verifier=random(),stateHash=await hash(state),now=Date.now();
 const envelope=await seal(env,id,'recovery_google_handshakes',{verifier,...identity,clientId:env.GOOGLE_CLIENT_ID,baselineFingerprint:await hash(credential.refreshToken)});
 await env.RECOVERY_DB.prepare("INSERT INTO recovery_google_handshakes(state_hash,owner_id,browser_hash,baseline_revision,verifier_ciphertext,phase,expires_ms,created_ms) VALUES(?,?,?,?,?,'pending',?,?)").bind(stateHash,id,await hash(browser),credential.revision,envelope,now+TTL,now).run();
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');for(const [key,value] of Object.entries({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:CALLBACK,response_type:'code',access_type:'offline',prompt:'consent',scope:SCOPES.join(' '),state,code_challenge:await hash(verifier),code_challenge_method:'S256',login_hint:'admin@customtechbuilt4u.com'}))url.searchParams.set(key,value);
 return json({url:url.href},{'Set-Cookie':cookie(state+'.'+browser)});
}
async function handshake(request,env,state){const browser=cookieValue(request);if(!browser||browser.state!==state)return null;const stateHash=await hash(state),row=await env.RECOVERY_DB.prepare('SELECT * FROM recovery_google_handshakes WHERE state_hash=?').bind(stateHash).first();if(!row||row.owner_id!==ownerId(env)||row.browser_hash!==await hash(browser.browser)||row.expires_ms<=Date.now())return null;return {row,stateHash,browser};}
async function unchanged(env,row,envelope){const current=await readGoogleCredential(env);if(current.revision!==row.baseline_revision||envelope.clientId!==env.GOOGLE_CLIENT_ID||await hash(current.refreshToken)!==envelope.baselineFingerprint)fail(409,'Your Google connection changed. Start reconnection again.');}
async function finish(request,env,trace){
 requestAt(request,'GET','/api/google/callback');ready(env);const url=new URL(request.url),state=url.searchParams.get('state')||'';
 trace.phase='state_lookup';
 if(!/^r1_[A-Za-z0-9_-]{43}$/.test(state))return redirect('expired');const flow=await handshake(request,env,state);if(!flow||flow.row.phase!=='pending')return redirect('expired');
 trace.phase='state_claim';const {row,stateHash,browser}=flow;const claimed=await env.RECOVERY_DB.prepare("UPDATE recovery_google_handshakes SET phase='processing' WHERE state_hash=? AND phase='pending' AND expires_ms>?").bind(stateHash,Date.now()).run();if(claimed.meta?.changes!==1)return redirect('expired');
 try{
  if(url.searchParams.has('error')){await env.RECOVERY_DB.prepare("UPDATE recovery_google_handshakes SET phase='failed' WHERE state_hash=? AND phase='processing'").bind(stateHash).run();return redirect('cancelled');}
  trace.phase='code_validation';const code=url.searchParams.get('code');if(!secret(code))throw new GoogleConnectionError(400,'Google did not complete authorization.');
  trace.phase='state_decrypt';const envelope=await open(env,row.owner_id,'recovery_google_handshakes',row.verifier_ciphertext);trace.phase='baseline_check';await unchanged(env,row,envelope);
  trace.phase='token_exchange';const exchanged=await provider('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,code,redirect_uri:CALLBACK,grant_type:'authorization_code',code_verifier:envelope.verifier})},'token_exchange');
  trace.phase='candidate_tokens';
  if(!secret(exchanged.refresh_token))fail(400,'Google did not grant offline Calendar access.','refresh_token_missing');
  if(!secret(exchanged.access_token))fail(400,'Google did not grant offline Calendar access.','access_token_missing');
  trace.phase='candidate_identity';const identity=await tokenIdentity(env,exchanged.access_token);trace.phase='candidate_refresh';const refreshed=await refresh(env,exchanged.refresh_token);trace.phase='refreshed_identity';const refreshedIdentity=await tokenIdentity(env,refreshed.access_token);
  trace.phase='identity_match';
  if(identity.userId!==envelope.userId||refreshedIdentity.userId!==envelope.userId)fail(403,'Choose the existing 4u Digital Google account.','account_mismatch');
  trace.phase='calendar_probe';await verifyCalendar(refreshed.access_token);trace.phase='baseline_recheck';await unchanged(env,row,envelope);
  trace.phase='candidate_encrypt';const candidate=await seal(env,row.owner_id,'recovery_google_candidate',{refreshToken:exchanged.refresh_token,userId:identity.userId,clientId:env.GOOGLE_CLIENT_ID});
  trace.phase='candidate_stage';
  const staged=await env.RECOVERY_DB.prepare("UPDATE recovery_google_handshakes SET phase='ready',candidate_ciphertext=?,expires_ms=? WHERE state_hash=? AND phase='processing' AND expires_ms>?").bind(candidate,Date.now()+TTL,stateHash,Date.now()).run();if(staged.meta?.changes!==1)return redirect('expired');
  return redirect('pending',browser.value);
 }catch(error){const diagnostic=warnFailure(trace.phase,error);trace.logged=true;await retainFailure(env,stateHash,diagnostic);await env.RECOVERY_DB.prepare("UPDATE recovery_google_handshakes SET phase='failed',candidate_ciphertext=NULL WHERE state_hash=? AND phase='processing'").bind(stateHash).run();return redirect(error instanceof GoogleConnectionError&&error.status===403?'account':error instanceof GoogleConnectionError&&error.message.includes('permissions')?'scope':'failed');}
}
export async function finishGoogleConnection(request,env){
 const trace={phase:'request_validation',logged:false};
 try{return await finish(request,env,trace);}catch(error){
  if(!trace.logged)warnFailure(trace.phase,error);
  if(error instanceof GoogleConnectionError&&[400,405].includes(error.status))return new Response('This connection request is invalid.',{status:error.status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  return redirect('failed');
 }
}
export async function completeGoogleConnection(request,env,authenticatedOwnerId){
 requestAt(request,'POST','/api/recovery/google-complete');const id=ready(env);if(authenticatedOwnerId!==id)fail(403,'This account does not manage this Google connection.');const browser=cookieValue(request);const flow=browser&&await handshake(request,env,browser.state);if(!flow)fail(409,'This connection request expired. Start reconnection again.');
 const {row,stateHash}=flow;if(row.phase==='completed'){await clearFailure(env,stateHash);return json({connected:true,revision:row.completed_revision},{'Set-Cookie':cookie(browser.value)});}if(row.phase!=='ready'||!row.candidate_ciphertext)fail(409,'Finish Google authorization before completing the connection.');
 let phase='completion_validation';
 try{
 const envelope=await open(env,id,'recovery_google_handshakes',row.verifier_ciphertext);await unchanged(env,row,envelope);const candidate=await open(env,id,'recovery_google_candidate',row.candidate_ciphertext);if(!secret(candidate.refreshToken)||candidate.clientId!==env.GOOGLE_CLIENT_ID||candidate.userId!==envelope.userId)fail(503,'The pending Google connection could not be verified.');
 phase='completion_refresh';const refreshed=await refresh(env,candidate.refreshToken);phase='completion_identity';const identity=await tokenIdentity(env,refreshed.access_token);if(identity.userId!==envelope.userId)fail(403,'Choose the existing 4u Digital Google account.','account_mismatch');
 phase='completion_promotion';
 const revision=row.baseline_revision+1,now=Date.now(),ciphertext=await seal(env,id,'recovery_google_credentials',{refreshToken:candidate.refreshToken,revision,userId:identity.userId,clientId:env.GOOGLE_CLIENT_ID});
 const valid="EXISTS(SELECT 1 FROM recovery_google_handshakes WHERE state_hash=? AND owner_id=? AND phase='ready' AND expires_ms>?)";
 const promotion=row.baseline_revision===0
  ?env.RECOVERY_DB.prepare(`INSERT INTO recovery_google_credentials(owner_id,revision,token_ciphertext,updated_ms,operation_hash) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM recovery_google_credentials WHERE owner_id=?) AND ${valid}`).bind(id,revision,ciphertext,now,stateHash,id,stateHash,id,now)
  :env.RECOVERY_DB.prepare(`UPDATE recovery_google_credentials SET revision=?,token_ciphertext=?,updated_ms=?,operation_hash=? WHERE owner_id=? AND revision=? AND ${valid}`).bind(revision,ciphertext,now,stateHash,id,row.baseline_revision,stateHash,id,now);
 await env.RECOVERY_DB.batch([promotion,env.RECOVERY_DB.prepare("UPDATE recovery_google_handshakes SET phase='completed',completed_revision=?,candidate_ciphertext=NULL WHERE state_hash=? AND phase='ready' AND EXISTS(SELECT 1 FROM recovery_google_credentials WHERE owner_id=? AND revision=? AND operation_hash=?)").bind(revision,stateHash,id,revision,stateHash)]);
 const completed=await env.RECOVERY_DB.prepare('SELECT phase,completed_revision FROM recovery_google_handshakes WHERE state_hash=?').bind(stateHash).first();if(completed?.phase==='completed'){await clearFailure(env,stateHash);return json({connected:true,revision:completed.completed_revision},{'Set-Cookie':cookie(browser.value)});}fail(409,'Your Google connection changed. Start reconnection again.');
 }catch(error){
  // A second completion may have read the ready row just before the first
  // committed. Reconcile that same operation; never write over a later one.
 let completed;try{completed=await env.RECOVERY_DB.prepare("SELECT completed_revision FROM recovery_google_handshakes WHERE state_hash=? AND owner_id=? AND phase='completed' AND expires_ms>?").bind(stateHash,id,Date.now()).first();}catch{}
 if(completed){await clearFailure(env,stateHash);return json({connected:true,revision:completed.completed_revision},{'Set-Cookie':cookie(browser.value)});}
 const diagnostic=warnFailure(phase,error);await retainFailure(env,stateHash,diagnostic);
  throw error;
 }
}
