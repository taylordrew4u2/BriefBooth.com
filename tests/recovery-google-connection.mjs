import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import gateway from '../scripts/recovery-gateway.mjs';
import {recoveryTest} from '../scripts/recovery-backend.mjs';
import {readGoogleCredential} from '../scripts/recovery-google-connection.mjs';

const ORIGIN='https://briefbooth.com';
const SCOPES=['https://www.googleapis.com/auth/calendar.freebusy','https://www.googleapis.com/auth/calendar.events.owned'];
const originalFetch=globalThis.fetch;
const originalWarn=console.warn;
const diagnostics=[];
const LEAK='MUST-NOT-LOG-https://private.example.invalid/?code=secret-access-token-owner@example.invalid';
console.warn=(...args)=>diagnostics.push(args);
const originalNow=Date.now;
const fixtures=[];
let active;
function database(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(readFileSync(new URL('../recovery/schema.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../recovery/google-connection-migration.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../recovery/google-connection-migration.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../recovery/google-diagnostics-migration.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../recovery/google-diagnostics-migration.sql',import.meta.url),'utf8'));
 const DB={prepare(query){return {bind(...args){return {run(){return {meta:{changes:sql.prepare(query).run(...args).changes}};},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};}};}};},async batch(statements){sql.exec('BEGIN');try{const rows=statements.map(s=>s.run());sql.exec('COMMIT');return rows;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,DB};
}
async function fixture(){
 const {sql,DB}=database(),ownerId=crypto.randomUUID(),otherId=crypto.randomUUID(),serviceId=crypto.randomUUID();
 const config={profile:{id:ownerId,slug:'4u-digital',name:'4u Digital',timezone:'America/New_York',booking_mode:'approval',intake_questions:[]},services:[{id:serviceId,title:'Free consultation',duration:30,active:true,amount_cents:0,meeting_modes:['google_meet']}],availability:Array.from({length:7},(_,weekday)=>({weekday,start_time:'09:00',end_time:'17:00'})),preferences:{notice_hours:1,buffer_minutes:0,horizon_days:60}};
 const privateKey='test-private-owner-review-key-longer-than-thirty-two';
 const env={RECOVERY_DB:DB,RECOVERY_CONFIG_JSON:JSON.stringify(config),RECOVERY_CAPABILITY_SECRET:'test-only-capability-secret-longer-than-thirty-two-'+ownerId,RECOVERY_OWNER_TOKEN_SHA256:await recoveryTest.digest(privateKey),RECOVERY_OWNER_EMAIL:'admin@example.invalid',RECOVERY_GOOGLE_OAUTH_ENABLED:'1',GOOGLE_CLIENT_ID:'test-client-'+ownerId,GOOGLE_CLIENT_SECRET:'test-client-secret',GOOGLE_REFRESH_TOKEN:'test-current-refresh-'+ownerId,BREVO_API_KEY:'test-mail',RECOVERY_SUPABASE_URL:'https://test-project.supabase.co',RECOVERY_SUPABASE_PUBLISHABLE_KEY:'test-public-key'};
 const f={sql,env,ownerId,otherId,serviceId,config,privateKey,calls:[],unexpected:[],cookies:new Map(),mode:'normal',requestNumber:0,codeNumber:0,codeRefresh:new Map(),accessRefresh:new Map(),exchangeCount:0};
 fixtures.push(f);active=f;return f;
}
globalThis.fetch=async(input,options={})=>{
 const f=active,url=new URL(String(input)),params=new URLSearchParams(options.body instanceof URLSearchParams?options.body:String(options.body||''));
 f.calls.push({url:url.href,method:options.method||'GET',authorization:options.headers?.Authorization,params});
 if(url.hostname==='test-project.supabase.co'&&url.pathname==='/auth/v1/user'){
  const token=options.headers.Authorization?.slice(7);
  if(token==='header.owner.signature')return Response.json({id:f.ownerId,email:'admin@example.invalid',aud:'authenticated',email_confirmed_at:'2026-01-01T00:00:00Z'});
  if(token==='header.other.signature')return Response.json({id:f.otherId,email:'other@example.invalid',aud:'authenticated',email_confirmed_at:'2026-01-01T00:00:00Z',user_metadata:{owner_id:f.ownerId,role:'consultant'}});
  if(token==='header.unconfirmed.signature')return Response.json({id:f.ownerId,email:'admin@example.invalid',aud:'authenticated',email_confirmed_at:null});
  return new Response(null,{status:401});
 }
 if(url.origin==='https://oauth2.googleapis.com'&&url.pathname==='/token'){
  assert.equal(options.method,'POST');assert.equal(params.get('client_id'),f.env.GOOGLE_CLIENT_ID);assert.equal(params.get('client_secret'),f.env.GOOGLE_CLIENT_SECRET);
  if(params.get('grant_type')==='authorization_code'){
   f.exchangeCount++;
   assert.equal(params.get('redirect_uri'),ORIGIN+'/api/google/callback');
   assert.match(params.get('code_verifier')||'',/^[A-Za-z0-9_-]{43,128}$/);
   if(f.mode==='exchange-error')return Response.json({error:'invalid_grant'},{status:400});
   if(f.mode==='exchange-timeout')throw Error(LEAK);
   if(f.mode==='hostile-exchange')return Response.json({error:LEAK,error_description:LEAK,access_token:LEAK},{status:400});
   if(f.mode==='malformed-exchange')return new Response('{',{headers:{'Content-Type':'application/json'}});
   const refresh='test-candidate-refresh-'+params.get('code'),access='test-candidate-access-'+params.get('code');f.codeRefresh.set(params.get('code'),refresh);f.accessRefresh.set(access,refresh);
   return Response.json({access_token:access,...(f.mode==='missing-refresh'?{}:{refresh_token:refresh}),expires_in:3600,scope:(f.mode==='missing-scope'?SCOPES.slice(0,1):SCOPES).join(' '),token_type:'Bearer'});
  }
  assert.equal(params.get('grant_type'),'refresh_token');const refresh=params.get('refresh_token');if(refresh===f.blockedRefresh)return Response.json({error:'invalid_grant'},{status:400});const access='test-refreshed-access-'+refresh;f.accessRefresh.set(access,refresh);
  return Response.json({access_token:access,expires_in:3600,scope:SCOPES.join(' '),token_type:'Bearer'});
 }
 if(url.origin==='https://www.googleapis.com'&&url.pathname==='/oauth2/v2/tokeninfo'){
  assert.equal(options.method,'POST');const token=url.searchParams.get('access_token'),refresh=f.accessRefresh.get(token),candidate=refresh!==f.env.GOOGLE_REFRESH_TOKEN;
  assert.ok(refresh,'Only a token obtained from a verified exchange may be inspected');
  if(candidate&&f.mode==='identity-timeout')throw Error('Dummy identity timeout');
  if(candidate&&f.mode==='identity-error')return Response.json({error:'invalid_token'},{status:400});
  if(candidate&&f.mode==='malformed-identity')return Response.json(null);
  return Response.json({user_id:candidate&&f.mode==='wrong-account'?'wrong-google-subject':'business-google-subject',audience:candidate&&f.mode==='wrong-audience'?'another-client':f.env.GOOGLE_CLIENT_ID,scope:(candidate&&f.mode==='missing-scope'?SCOPES.slice(0,1):candidate&&f.mode==='extra-scope'?[...SCOPES,'https://www.googleapis.com/auth/userinfo.email']:SCOPES).join(' '),expires_in:3600,...(candidate?f.candidateIdentity||{}:f.baselineIdentity||{})});
 }
 if(url.origin==='https://www.googleapis.com'&&url.pathname==='/calendar/v3/freeBusy'){
  const refresh=f.accessRefresh.get(options.headers.Authorization?.slice(7));assert.ok(refresh);
  if(refresh!==f.env.GOOGLE_REFRESH_TOKEN&&f.mode==='calendar-error')return Response.json({error:'forbidden'},{status:403});
  return Response.json({calendars:{primary:{busy:[]}}});
 }
 if(url.origin==='https://www.googleapis.com'&&url.pathname==='/calendar/v3/calendars/primary/events'){
  assert.equal(options.method||'GET','GET');assert.equal(url.searchParams.get('fields'),'kind');assert.equal(url.searchParams.get('maxResults'),'1');
  return Response.json({kind:f.mode==='event-access-error'?'not-a-calendar-list':'calendar#events'});
 }
 f.unexpected.push(url.href);throw Error('Unexpected external request');
};
function responseCookie(f,response){
 const value=response.headers.get('set-cookie');if(!value)return;
 const pair=value.split(';',1)[0],at=pair.indexOf('='),name=pair.slice(0,at),token=pair.slice(at+1);
 if(/Max-Age=0/i.test(value)||!token)f.cookies.delete(name);else f.cookies.set(name,token);
}
async function request(f,path,{method='GET',data,token='header.owner.signature',origin=ORIGIN,cookie=true,cookieValue,updateCookies=true}={}){
 active=f;const headers={'cf-connecting-ip':'192.0.2.'+(++f.requestNumber%250)};
 if(token)headers.Authorization='Bearer '+token;
 if(method==='POST'){if(origin!==null)headers.Origin=origin;headers['Content-Type']='application/json';}
 if(cookieValue!==undefined)headers.Cookie=cookieValue;else if(cookie)headers.Cookie=[...f.cookies].map(([k,v])=>k+'='+v).join('; ');
 const r=await gateway.fetch(new Request(ORIGIN+path,{method,headers,body:method==='POST'?JSON.stringify(data||{}):undefined}),f.env);
 if(updateCookies)responseCookie(f,r);
 const text=await r.text();let body;try{body=JSON.parse(text);}catch{body=text;}
 return {status:r.status,body,headers:r.headers};
}
const api=(f,path,options)=>request(f,'/api/recovery/'+path,options);
async function begin(f){const result=await api(f,'google-connect',{method:'POST'});assert.equal(result.status,200);assert.ok(result.body.url);const url=new URL(result.body.url);return {...result,url,state:url.searchParams.get('state'),cookie:[...f.cookies].map(([k,v])=>k+'='+v).join('; ')};}
async function callback(f,flow,options={}){const code='test-code-'+(++f.codeNumber);const result=await request(f,'/api/google/callback?state='+encodeURIComponent(flow.state)+'&code='+code,{token:null,...options});return {...result,code};}
const redirectResult=response=>new URL(response.headers.get('location'),ORIGIN).searchParams.get('google');
async function credential(f){return readGoogleCredential(f.env);}
function storedDiagnostics(f){return f.sql.prepare('SELECT diagnostic FROM recovery_google_failures ORDER BY failed_ms,operation_hash').all().map(row=>JSON.parse(row.diagnostic));}
function assertPrivate(value,f){const text=JSON.stringify(value);for(const secret of [f.env.GOOGLE_REFRESH_TOKEN,f.env.GOOGLE_CLIENT_SECRET,...f.codeRefresh.values()])assert.ok(!text.includes(secret),'Credentials must not be disclosed');}

try{
 // Feature flag does not change existing booking credentials or create a grant.
 {
  const f=await fixture();f.env.RECOVERY_GOOGLE_OAUTH_ENABLED='0';
  assert.deepEqual(await credential(f),{refreshToken:f.env.GOOGLE_REFRESH_TOKEN,revision:0});
  const status=await api(f,'google-status');assert.equal(status.status,200);assert.equal(status.body.enabled,false);assertPrivate(status.body,f);
  assert.ok((await api(f,'google-connect',{method:'POST'})).status>=400);assert.equal(f.exchangeCount,0);
 }
 // A current Auth-verified owner session is required; the private booking key
 // and caller-controlled owner metadata are deliberately not OAuth authority.
 {
  const f=await fixture();
  for(const token of [null,f.privateKey,'header.forged.signature','header.unconfirmed.signature','header.other.signature']){
   const result=await api(f,'google-connect',{method:'POST',token,data:{owner_id:f.ownerId,email:'admin@example.invalid'}});
   assert.ok([401,403].includes(result.status));
  }
  for(const origin of [null,'https://evil.example.invalid'])assert.equal((await api(f,'google-connect',{method:'POST',origin})).status,403);
  assert.equal(f.exchangeCount,0);assert.equal(f.calls.filter(c=>c.url.includes('googleapis.com')).length,0);
  assert.ok([401,403].includes((await api(f,'google-status',{token:'header.other.signature'})).status));
 }
 // Historical permissions establish the previous account's identity, not
 // what the replacement is allowed to request. A legacy grant must remain
 // reconnectable without carrying any broader permissions into the new URL.
 for(const scope of [
  'https://www.googleapis.com/auth/calendar',
  [...SCOPES,'openid','https://www.googleapis.com/auth/userinfo.email'].join(' '),
  '',
  undefined,
 ]){
  const f=await fixture();f.baselineIdentity={scope};const flow=await begin(f);
  assert.deepEqual(flow.url.searchParams.get('scope').split(' ').sort(),[...SCOPES].sort());
  assert.notEqual(flow.url.searchParams.get('include_granted_scopes'),'true','Do not deliberately merge historical permissions into the new grant');
  assert.deepEqual(await credential(f),{refreshToken:f.env.GOOGLE_REFRESH_TOKEN,revision:0});
  assert.equal(redirectResult(await callback(f,flow)),'pending');
  assert.equal((await api(f,'google-complete',{method:'POST'})).status,200);
  assert.equal((await credential(f)).revision,1);
 }
 // Relaxing historical scope checks cannot relax its trusted Google identity
 // binding. Reject mismatched clients and absent/invalid Google subject IDs.
 for(const baselineIdentity of [
  {audience:'unrelated-oauth-client'},
  {audience:undefined},
  {issued_to:'unrelated-oauth-client'},
  {user_id:undefined},
  {user_id:''},
  {user_id:42},
 ]){
  const f=await fixture();f.baselineIdentity={scope:'legacy-permission',...baselineIdentity};
  const denied=await api(f,'google-connect',{method:'POST'});assert.equal(denied.status,400);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM recovery_google_handshakes').get().n,0);
  assert.equal(f.exchangeCount,0);assert.deepEqual(await credential(f),{refreshToken:f.env.GOOGLE_REFRESH_TOKEN,revision:0});
 }
 // The exception applies only to the old grant. Broader candidate scopes must
 // still be rejected even when those same scopes existed in the old grant.
 {
  const f=await fixture();f.baselineIdentity={scope:[...SCOPES,'https://www.googleapis.com/auth/userinfo.email'].join(' ')};
  const flow=await begin(f);f.mode='extra-scope';const denied=await callback(f,flow);
  assert.equal(redirectResult(denied),'scope');assert.deepEqual(await credential(f),{refreshToken:f.env.GOOGLE_REFRESH_TOKEN,revision:0});
 }
 // Only the existing registered return URL and scopes enter Google's consent.
 {
  const f=await fixture(),cachedDay=new Date(Date.now()+4*86400000).toISOString().slice(0,10);
  assert.equal((await api(f,'slots?service='+f.serviceId+'&day='+cachedDay,{token:null})).status,200);
  const flow=await begin(f);
  assert.equal(flow.url.origin,'https://accounts.google.com');
  assert.equal(flow.url.searchParams.get('client_id'),f.env.GOOGLE_CLIENT_ID);
  assert.equal(flow.url.searchParams.get('redirect_uri'),ORIGIN+'/api/google/callback');
  assert.deepEqual(flow.url.searchParams.get('scope').split(' ').sort(),[...SCOPES].sort());
  assert.equal(flow.url.searchParams.get('response_type'),'code');
  assert.equal(flow.url.searchParams.get('access_type'),'offline');
  assert.equal(flow.url.searchParams.get('code_challenge_method'),'S256');
  assert.match(flow.state,/^r1_[A-Za-z0-9_-]+$/);
  assert.match(flow.headers.get('set-cookie'),/__Secure-briefbooth-google=/);
  for(const flag of ['HttpOnly','Secure','SameSite=Lax','Path=/api/'])assert.ok(flow.headers.get('set-cookie').includes(flag));
  assert.match(flow.headers.get('cache-control'),/no-store/);assertPrivate(flow.body,f);
  const response=await callback(f,flow);assert.equal(response.status,303);assert.equal(redirectResult(response),'pending');
  const exchange=f.calls.find(c=>c.params.get('grant_type')==='authorization_code');
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(exchange.params.get('code_verifier'))));
  const challenge=Buffer.from(hash).toString('base64url');assert.equal(challenge,flow.url.searchParams.get('code_challenge'));
  const stored=JSON.stringify(f.sql.prepare('SELECT * FROM recovery_google_handshakes').all());
  assert.ok(!stored.includes(exchange.params.get('code_verifier')));assertPrivate(stored,f);
  assert.deepEqual(await credential(f),{refreshToken:f.env.GOOGLE_REFRESH_TOKEN,revision:0},'Callback staging must not replace the working grant');
  const own=await api(f,'google-status');assert.equal(own.body.revision,0);assertPrivate(own.body,f);
  for(const token of [null,'header.other.signature',f.privateKey])assert.ok([401,403].includes((await api(f,'google-complete',{method:'POST',token})).status));
  assert.equal((await api(f,'google-complete',{method:'POST',origin:'https://evil.example.invalid'})).status,403);
  assert.equal((await credential(f)).refreshToken,f.env.GOOGLE_REFRESH_TOKEN);
  const done=await api(f,'google-complete',{method:'POST'});assert.equal(done.status,200);assert.equal(done.body.connected,true);assert.equal(done.body.revision,1);assertPrivate(done.body,f);
  const replacement=f.codeRefresh.get(response.code);assert.deepEqual(await credential(f),{refreshToken:replacement,revision:1});
  const credentials=JSON.stringify(f.sql.prepare('SELECT * FROM recovery_google_credentials').all());assertPrivate(credentials,f);
  const publicConfig=await api(f,'config',{token:null});assertPrivate(publicConfig.body,f);
  // Real backend availability must use the newly granted refresh token, even
  // when the process previously cached an access token for the old connection.
  const day=new Date(Date.now()+4*86400000).toISOString().slice(0,10);
  const available=await api(f,'slots?service='+f.serviceId+'&day='+day,{token:null});assert.equal(available.status,200);assert.ok(available.body.slots.length);
  const busyCall=f.calls.filter(c=>c.url.endsWith('/freeBusy')).at(-1);assert.equal(f.accessRefresh.get(busyCall.authorization.slice(7)),replacement);
  f.env.RECOVERY_GOOGLE_OAUTH_ENABLED='0';
  assert.deepEqual(await credential(f),{refreshToken:replacement,revision:1},'Disabling reconnect must never revert the active booking grant');
  const stillAvailable=await api(f,'slots?service='+f.serviceId+'&day='+day,{token:null});assert.equal(stillAvailable.status,200);
  assert.equal(f.accessRefresh.get(f.calls.filter(c=>c.url.endsWith('/freeBusy')).at(-1).authorization.slice(7)),replacement);
  assert.ok((await api(f,'google-connect',{method:'POST'})).status>=400);
  const storedRow=f.sql.prepare('SELECT token_ciphertext FROM recovery_google_credentials').get();
  f.sql.prepare('UPDATE recovery_google_credentials SET token_ciphertext=?').run(storedRow.token_ciphertext.slice(0,-8)+'tampered');
  await assert.rejects(()=>credential(f),/could not be read/,'Corruption must fail closed instead of silently restoring the old grant');
  f.sql.prepare('UPDATE recovery_google_credentials SET token_ciphertext=?').run(storedRow.token_ciphertext);
 }
 // Missing/wrong browser binding, expiry and tampered state cannot exchange a
 // provider code. Each flow is isolated so one failed attempt cannot mask another.
 for(const scenario of ['missing-cookie','wrong-cookie','tampered-state','expired']){
  const f=await fixture(),flow=await begin(f);
  if(scenario==='expired')f.sql.prepare('UPDATE recovery_google_handshakes SET expires_ms=?').run(Date.now()-1);
  if(scenario==='tampered-state')flow.state=flow.state.slice(0,-1)+(flow.state.endsWith('a')?'b':'a');
  const result=await callback(f,flow,scenario==='missing-cookie'?{cookie:false}:scenario==='wrong-cookie'?{cookieValue:'__Secure-briefbooth-google=not-the-browser'}:{});
  assert.equal(result.status,303);assert.notEqual(redirectResult(result),'pending');assert.equal(f.exchangeCount,0,scenario);
  assert.equal((await credential(f)).refreshToken,f.env.GOOGLE_REFRESH_TOKEN);
  assert.deepEqual(storedDiagnostics(f),[],'Unclaimed/invalid callbacks cannot write durable failures');
 }
 // Every provider validation failure leaves the current grant usable. No
 // provider error payload or credential is echoed to the browser.
 for(const mode of ['exchange-error','exchange-timeout','hostile-exchange','malformed-exchange','missing-refresh','missing-scope','extra-scope','identity-timeout','identity-error','malformed-identity','wrong-account','wrong-audience','calendar-error','event-access-error']){
  const f=await fixture(),flow=await begin(f);f.mode=mode;
  const diagnosticStart=diagnostics.length;
  const result=await callback(f,flow);assert.equal(result.status,303);assert.notEqual(redirectResult(result),'pending',mode);assertPrivate({body:result.body,location:result.headers.get('location')},f);
  assert.equal(diagnostics.length,diagnosticStart+1,'One safe diagnostic per failed callback: '+mode);
  const log=JSON.parse(diagnostics.at(-1)[0]);
  assert.deepEqual(storedDiagnostics(f),[log],mode+' persists exactly the safe console record');
  const failure=f.sql.prepare('SELECT operation_hash,failed_ms FROM recovery_google_failures').get();
  assert.equal(failure.operation_hash,f.sql.prepare('SELECT state_hash FROM recovery_google_handshakes').get().state_hash);
  assert.ok(Number.isSafeInteger(failure.failed_ms)&&failure.failed_ms<=Date.now());
  const expected={
   'exchange-error':{stage:'token_exchange',reason:'provider_request_failed',kind:'token_exchange',providerStatus:400,providerCode:'invalid_grant'},
   'exchange-timeout':{stage:'token_exchange',reason:'provider_request_failed',kind:'token_exchange',providerCode:'network_error'},
   'hostile-exchange':{stage:'token_exchange',reason:'provider_request_failed',kind:'token_exchange',providerStatus:400,providerCode:'unrecognized'},
   'malformed-exchange':{stage:'token_exchange',reason:'provider_request_failed',kind:'token_exchange',providerStatus:200,providerCode:'malformed_response'},
   'missing-refresh':{stage:'candidate_tokens',reason:'refresh_token_missing'},
   'missing-scope':{stage:'candidate_identity',reason:'scope_set_mismatch'},
   'extra-scope':{stage:'candidate_identity',reason:'scope_set_mismatch'},
   'wrong-account':{stage:'identity_match',reason:'account_mismatch'},
   'wrong-audience':{stage:'candidate_identity',reason:'audience_mismatch'},
   'calendar-error':{stage:'calendar_probe',reason:'provider_request_failed',kind:'freebusy',providerStatus:403,providerCode:'forbidden'},
  }[mode];
  if(expected)for(const [key,value] of Object.entries(expected))assert.equal(log[key],value,mode+' diagnostic '+key);
  if(mode==='exchange-timeout')assert.ok(!Object.hasOwn(log,'providerStatus'),'Network exceptions must not invent an HTTP response');
  assert.deepEqual(await credential(f),{refreshToken:f.env.GOOGLE_REFRESH_TOKEN,revision:0},mode);
  f.mode='normal';const day=new Date(Date.now()+4*86400000).toISOString().slice(0,10);
  const slots=await api(f,'slots?service='+f.serviceId+'&day='+day,{token:null});assert.equal(slots.status,200,mode+' must not interrupt existing bookings');
 }
 // Diagnostics distinguish missing/malformed identity claims without emitting
 // the account identifier or attacker-controlled claim values.
 for(const [candidateIdentity,reason] of [
  [{user_id:undefined},'user_id_missing'],
  [{user_id:42},'user_id_invalid'],
  [{audience:undefined},'audience_missing'],
  [{audience:LEAK},'audience_mismatch'],
  [{issued_to:LEAK},'issued_to_mismatch'],
 ]){
  const f=await fixture(),flow=await begin(f);f.candidateIdentity=candidateIdentity;
  assert.equal(redirectResult(await callback(f,flow)),'failed');
  const log=JSON.parse(diagnostics.at(-1)[0]);assert.equal(log.stage,'candidate_identity');assert.equal(log.reason,reason);
  assert.deepEqual(storedDiagnostics(f),[log]);
  assert.deepEqual(await credential(f),{refreshToken:f.env.GOOGLE_REFRESH_TOKEN,revision:0});
 }
 // Concurrent callbacks consume a state once; completed flow replay cannot
 // exchange again or advance the connection revision.
 {
  const f=await fixture(),flow=await begin(f);
  const results=await Promise.all([callback(f,flow,{cookieValue:flow.cookie,updateCookies:false}),callback(f,flow,{cookieValue:flow.cookie,updateCookies:false})]);
  assert.equal(f.exchangeCount,1);assert.equal(results.filter(r=>redirectResult(r)==='pending').length,1);
  const completions=await Promise.all([api(f,'google-complete',{method:'POST',cookieValue:flow.cookie,updateCookies:false}),api(f,'google-complete',{method:'POST',cookieValue:flow.cookie,updateCookies:false})]);
  assert.ok(completions.every(r=>r.status===200),'The same completed operation reconciles after concurrent responses');assert.equal((await credential(f)).revision,1);
  const replay=await callback(f,flow,{cookieValue:flow.cookie});assert.notEqual(redirectResult(replay),'pending');assert.equal(f.exchangeCount,1);assert.equal((await credential(f)).revision,1);
 }
 // A second browser completing a newer grant wins. The earlier staged flow
 // cannot restore stale credentials over that successful connection.
 {
  const f=await fixture(),oldFlow=await begin(f);f.cookies.clear();const newFlow=await begin(f);
  const older=await callback(f,oldFlow,{cookieValue:oldFlow.cookie,updateCookies:false});assert.equal(redirectResult(older),'pending');
  const newer=await callback(f,newFlow,{cookieValue:newFlow.cookie,updateCookies:false});assert.equal(redirectResult(newer),'pending');
  const complete=await api(f,'google-complete',{method:'POST',cookieValue:newFlow.cookie,updateCookies:false});assert.equal(complete.status,200);
  const expected=await credential(f);const stale=await api(f,'google-complete',{method:'POST',cookieValue:oldFlow.cookie,updateCookies:false});assert.ok(stale.status>=400);assert.deepEqual(await credential(f),expected);
 }
 // Once verified, the pinned Google identity allows repair of a revoked
 // refresh token. It does not let a different Google account take over bookings.
 {
  const f=await fixture(),flow=await begin(f);assert.equal(redirectResult(await callback(f,flow)),'pending');
  assert.equal((await api(f,'google-complete',{method:'POST'})).status,200);const current=await credential(f);f.blockedRefresh=current.refreshToken;
  const repair=await begin(f);f.mode='wrong-account';const denied=await callback(f,repair);assert.equal(redirectResult(denied),'account');assert.deepEqual(await credential(f),current);
  f.mode='normal';const retry=await begin(f),candidate=await callback(f,retry);assert.equal(redirectResult(candidate),'pending');
  const done=await api(f,'google-complete',{method:'POST'});assert.equal(done.status,200);assert.equal(done.body.revision,2);
  assert.equal((await credential(f)).refreshToken,f.codeRefresh.get(candidate.code));
 }
 // Cancellation, expiry after staging, and validation failure during completion
 // cannot remove the previous working grant or mark a replacement connected.
 for(const scenario of ['cancelled','staged-expired','complete-identity-error']){
  const f=await fixture(),flow=await begin(f);
  if(scenario==='cancelled'){
   const cancelled=await request(f,'/api/google/callback?state='+flow.state+'&error=access_denied',{token:null});
   assert.equal(redirectResult(cancelled),'cancelled');assert.equal(f.exchangeCount,0);
  }else{
   assert.equal(redirectResult(await callback(f,flow)),'pending');
   if(scenario==='staged-expired')f.sql.prepare('UPDATE recovery_google_handshakes SET expires_ms=?').run(Date.now()-1);
   else f.mode='identity-error';
   assert.ok((await api(f,'google-complete',{method:'POST'})).status>=400);
   if(scenario==='complete-identity-error'){
    assert.deepEqual(storedDiagnostics(f),[JSON.parse(diagnostics.at(-1)[0])]);
    assert.equal(storedDiagnostics(f)[0].stage,'completion_identity');
   }
  }
  assert.deepEqual(await credential(f),{refreshToken:f.env.GOOGLE_REFRESH_TOKEN,revision:0});
 }
 // A database failure before the atomic promotion leaves the original grant
 // active, and a deliberate retry can reconcile the still-valid staged flow.
 {
  const f=await fixture(),flow=await begin(f);assert.equal(redirectResult(await callback(f,flow)),'pending');
  const batch=f.env.RECOVERY_DB.batch;f.env.RECOVERY_DB.batch=async()=>{throw Error('Dummy write unavailable');};
  assert.equal((await api(f,'google-complete',{method:'POST'})).status,503);
  assert.deepEqual(await credential(f),{refreshToken:f.env.GOOGLE_REFRESH_TOKEN,revision:0});
  assert.equal(JSON.parse(diagnostics.at(-1)[0]).stage,'completion_promotion');
  assert.deepEqual(storedDiagnostics(f),[],'A failed database cannot promise durable diagnostics');
  f.env.RECOVERY_DB.batch=batch;assert.equal((await api(f,'google-complete',{method:'POST'})).status,200);assert.equal((await credential(f)).revision,1);
  assert.deepEqual(storedDiagnostics(f),[],'Successful retry retires the same operation failure');
  const before=f.sql.prepare('SELECT * FROM recovery_configuration').all(),beforeGrant=f.sql.prepare('SELECT * FROM recovery_google_credentials').all(),beforeHandshake=f.sql.prepare('SELECT * FROM recovery_google_handshakes').all();
  for(let n=0;n<2;n++)f.sql.exec(readFileSync(new URL('../recovery/google-diagnostics-migration.sql',import.meta.url),'utf8'));
  assert.deepEqual(f.sql.prepare('SELECT * FROM recovery_configuration').all(),before,'Diagnostic migration replay preserves settings');
  assert.deepEqual(f.sql.prepare('SELECT * FROM recovery_google_credentials').all(),beforeGrant,'Diagnostic migration replay preserves active encrypted grant');
  assert.deepEqual(f.sql.prepare('SELECT * FROM recovery_google_handshakes').all(),beforeHandshake,'Diagnostic migration replay preserves handshakes');
 }
 // Retrying a still-ready flow after a transient validation failure clears
 // only that resolved operation's durable failure without touching its grant.
 {
  const f=await fixture(),flow=await begin(f);assert.equal(redirectResult(await callback(f,flow)),'pending');
  f.mode='identity-error';assert.equal((await api(f,'google-complete',{method:'POST'})).status,503);
  assert.equal(storedDiagnostics(f)[0]?.stage,'completion_identity');
  f.mode='normal';assert.equal((await api(f,'google-complete',{method:'POST'})).status,200);
  assert.equal((await credential(f)).revision,1);assert.deepEqual(storedDiagnostics(f),[]);
 }
 // A late failure write racing with successful completion cannot resurrect a
 // resolved failure: the durable insert checks the current handshake phase.
 {
  const f=await fixture(),flow=await begin(f);assert.equal(redirectResult(await callback(f,flow)),'pending');
  const prepare=f.env.RECOVERY_DB.prepare,batch=f.env.RECOVERY_DB.batch;
  let release,started;const waiting=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  f.env.RECOVERY_DB.prepare=query=>{const statement=prepare(query);return {bind(...values){const bound=statement.bind(...values);if(query.includes('INSERT INTO recovery_google_failures'))bound.failureWrite=true;return bound;}};};
  f.env.RECOVERY_DB.batch=async statements=>{if(statements.some(s=>s.failureWrite)){started();await gate;}return batch(statements);};
  f.mode='identity-error';const failed=api(f,'google-complete',{method:'POST'});await waiting;
  f.mode='normal';const successful=await api(f,'google-complete',{method:'POST'});assert.equal(successful.status,200);
  release();assert.equal((await failed).status,503);
  f.env.RECOVERY_DB.prepare=prepare;f.env.RECOVERY_DB.batch=batch;
  assert.equal((await credential(f)).revision,1);assert.deepEqual(storedDiagnostics(f),[],'Late rejected attempt must not recreate resolved error');
 }
 // Diagnostic sinks are best-effort. An unavailable log sink or failure table
 // cannot turn a rejected grant into a promotion or prevent safe callback return.
 for(const sink of ['console','database','both']){
  const f=await fixture(),flow=await begin(f);f.mode='hostile-exchange';
  const prepare=f.env.RECOVERY_DB.prepare,savedWarn=console.warn;
  if(sink!=='console')f.env.RECOVERY_DB.prepare=query=>{if(query.includes('recovery_google_failures'))throw Error(LEAK);return prepare(query);};
  if(sink!=='database')console.warn=()=>{throw Error(LEAK);};
  let result;try{result=await callback(f,flow);}finally{console.warn=savedWarn;f.env.RECOVERY_DB.prepare=prepare;}
  assert.equal(result.status,303);assert.equal(redirectResult(result),'failed');
  assert.deepEqual(await credential(f),{refreshToken:f.env.GOOGLE_REFRESH_TOKEN,revision:0},sink);
  assert.equal(f.sql.prepare('SELECT phase FROM recovery_google_handshakes').get().phase,'failed');
  if(sink==='console')assert.equal(storedDiagnostics(f)[0]?.providerCode,'unrecognized','A broken console does not suppress durable capture');
 }
 // Retention bounds the diagnostic store and removes obsolete records; a
 // replay of the additive migration neither erases evidence nor modifies Auth.
 {
  const f=await fixture(),flow=await begin(f);f.mode='exchange-error';
  const dummy=JSON.stringify({event:'briefbooth_google_oauth',stage:'token_exchange',status:503,reason:'provider_request_failed',kind:'token_exchange',providerStatus:400,providerCode:'invalid_grant'});
  const put=f.sql.prepare('INSERT INTO recovery_google_failures(operation_hash,failed_ms,diagnostic) VALUES(?,?,?)');
  put.run('aged-operation',Date.now()-8*86400000,dummy);
  for(let n=0;n<105;n++)put.run('recent-operation-'+n,Date.now()-200000+n,dummy);
  assert.equal(redirectResult(await callback(f,flow)),'failed');
  const rows=f.sql.prepare('SELECT * FROM recovery_google_failures').all();
  assert.ok(rows.length<=100&&rows.length>0,'Keep at most the latest 100 bounded diagnostics');
  assert.ok(rows.every(row=>row.failed_ms>=Date.now()-7*86400000),'Drop diagnostics older than seven days');
  const before=JSON.stringify(rows);
  for(let n=0;n<2;n++)f.sql.exec(readFileSync(new URL('../recovery/google-diagnostics-migration.sql',import.meta.url),'utf8'));
  assert.equal(JSON.stringify(f.sql.prepare('SELECT * FROM recovery_google_failures').all()),before,'Migration replay preserves retained evidence');
  assert.deepEqual(await credential(f),{refreshToken:f.env.GOOGLE_REFRESH_TOKEN,revision:0});
 }
 // Only the explicit safe schema reaches console output. Scan every emitted
 // record against all dummy credentials, browser cookies and account values.
 const allowedKeys=new Set(['event','stage','status','reason','kind','providerStatus','providerCode']);
 const allowedStages=new Set(['request_validation','state_lookup','state_claim','code_validation','state_decrypt','baseline_check','token_exchange','candidate_tokens','candidate_identity','candidate_refresh','refreshed_identity','identity_match','calendar_probe','baseline_recheck','candidate_encrypt','candidate_stage','completion_validation','completion_refresh','completion_identity','completion_promotion']);
 const allowedReasons=new Set(['scope_set_mismatch','user_id_missing','user_id_invalid','audience_missing','audience_mismatch','issued_to_mismatch','refresh_token_missing','access_token_missing','account_mismatch','provider_request_failed','validation_failed','unexpected_failure']);
 const allowedKinds=new Set(['token_exchange','token_refresh','tokeninfo','freebusy','events_list']);
 const allowedCodes=new Set(['invalid_grant','invalid_client','invalid_request','redirect_uri_mismatch','access_denied','unsupported_grant_type','unauthorized_client','invalid_scope','invalid_token','rate_limit_exceeded','PERMISSION_DENIED','UNAUTHENTICATED','RESOURCE_EXHAUSTED','INVALID_ARGUMENT','NOT_FOUND','INTERNAL','UNAVAILABLE','forbidden','insufficientPermissions','rateLimitExceeded','userRateLimitExceeded','authError','backendError','invalid','notFound','network_error','malformed_response','unrecognized']);
 for(const args of diagnostics){
  assert.equal(args.length,1);assert.equal(typeof args[0],'string');const log=JSON.parse(args[0]);
  assert.equal(log.event,'briefbooth_google_oauth');assert.ok(allowedStages.has(log.stage));assert.ok(allowedReasons.has(log.reason));
  for(const key of Object.keys(log))assert.ok(allowedKeys.has(key),'Unexpected diagnostic field '+key);
  assert.ok(Number.isInteger(log.status)&&log.status>=100&&log.status<=599);
  if(Object.hasOwn(log,'kind'))assert.ok(allowedKinds.has(log.kind));
  if(Object.hasOwn(log,'providerCode'))assert.ok(allowedCodes.has(log.providerCode));
  if(Object.hasOwn(log,'providerStatus'))assert.ok(Number.isInteger(log.providerStatus)&&log.providerStatus>=100&&log.providerStatus<=599);
 }
 const allStoredDiagnostics=fixtures.flatMap(storedDiagnostics);
 for(const value of allStoredDiagnostics){for(const key of Object.keys(value))assert.ok(allowedKeys.has(key));assert.equal(value.event,'briefbooth_google_oauth');assert.ok(allowedStages.has(value.stage));assert.ok(allowedReasons.has(value.reason));}
 const allDiagnostics=JSON.stringify([diagnostics,allStoredDiagnostics]);assert.ok(!allDiagnostics.includes(LEAK));
 assert.ok(!/https?:|@|test-code-|test-candidate-|test-refreshed-|business-google-subject/.test(allDiagnostics),'No URL, email, token, authorization code or subject may be logged');
 for(const f of fixtures){
  assertPrivate([diagnostics,allStoredDiagnostics],f);
  for(const value of [f.ownerId,f.otherId,f.privateKey,f.env.RECOVERY_CAPABILITY_SECRET,f.env.GOOGLE_CLIENT_ID,...f.cookies.values()])assert.ok(!allDiagnostics.includes(value),'No private identifier or browser binding may be logged');
 }
 console.log('PASS current-owner Google OAuth binding, PKCE, scope/identity validation, encrypted staging, replay protection, D1 grant continuity and bounded durable sanitized failure diagnostics');
}finally{
 globalThis.fetch=originalFetch;Date.now=originalNow;console.warn=originalWarn;
 for(const f of fixtures){assert.deepEqual(f.unexpected,[],'No legacy RPC, connection writer, worker or unrelated service was contacted');f.sql.close();}
}
