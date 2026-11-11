import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleRecovery,recoveryTest} from '../scripts/recovery-backend.mjs';
import {deliverRecoveryEmails,recoveryMailFlags} from '../scripts/recovery-email.mjs';

const sql=new DatabaseSync(':memory:');
sql.exec(readFileSync(new URL('../recovery/schema.sql',import.meta.url),'utf8'));
let failBatch=false;
const DB={prepare(query){return {bind(...args){return {run(){return {meta:{changes:sql.prepare(query).run(...args).changes}};},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};}};}};},async batch(statements){if(failBatch){failBatch=false;throw new Error('Simulated local commit failure');}sql.exec('BEGIN');try{const results=statements.map(x=>x.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
const config={profile:{id:'owner',slug:'4u-digital',name:'4u Digital',timezone:'America/New_York',booking_mode:'approval',intake_questions:[]},services:[{id:'service',title:'Free consultation',duration:30,active:true,amount_cents:0,meeting_modes:['google_meet']}],availability:Array.from({length:7},(_,weekday)=>({weekday,start_time:'09:00',end_time:'20:00'})),preferences:{notice_hours:1,buffer_minutes:30,horizon_days:60}};
const ownerToken='test-owner-only-key-more-than-thirty-two-characters';
const env={RECOVERY_DB:DB,RECOVERY_CONFIG_JSON:JSON.stringify(config),RECOVERY_CAPABILITY_SECRET:'test-only-capability-secret-more-than-32-characters',RECOVERY_OWNER_TOKEN_SHA256:await recoveryTest.digest(ownerToken),RECOVERY_OWNER_EMAIL:'owner@example.com',GOOGLE_CLIENT_ID:'dummy-client',GOOGLE_CLIENT_SECRET:'dummy-secret',GOOGLE_REFRESH_TOKEN:'dummy-refresh',BREVO_API_KEY:'dummy-mail'};
const calendar=new Map(),calls=[],mail=[];
let patchMode='normal',pendingPatch=null,etagNumber=0,calendarFailure=false,externalBusy=[],freeBusyHook=null;
const newEtag=()=>`"version-${++etagNumber}"`;
function applyPatch(id,payload,etag){const event=calendar.get(id);if(!event)return new Response(null,{status:410});if(event.etag!==etag)return new Response(null,{status:412});Object.assign(event,payload,{etag:newEtag()});return Response.json(event);}
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{
 const u=new URL(String(url));const method=options.method||'GET';calls.push({path:u.pathname,method,ifMatch:options.headers?.['If-Match']});
 if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'dummy-access',expires_in:3600});
 if(u.hostname==='api.brevo.com'){
  if(u.pathname==='/v3/smtp/email'){mail.push(JSON.parse(options.body));return Response.json({messageId:`<reschedule-${mail.length}@example.invalid>`},{status:201});}
  return Response.json({events:[]});
 }
 if(u.hostname==='www.googleapis.com'){
  if(calendarFailure)return new Response(null,{status:503});
  if(u.pathname.endsWith('/freeBusy')){freeBusyHook?.();return Response.json({calendars:{primary:{busy:[...externalBusy,...[...calendar.values()].filter(e=>e.status!=='cancelled').map(e=>({start:e.start.dateTime,end:e.end.dateTime}))]}}});}
  const id=u.pathname.split('/').at(-1);
  if(method==='PATCH'){
   const payload=JSON.parse(options.body),etag=options.headers['If-Match'];
   if(patchMode==='forbidden')return new Response(null,{status:403});
   if(patchMode==='timeout-before'){pendingPatch={id,payload,etag};throw new Error('Network response lost before remote result');}
   const result=applyPatch(id,payload,etag);
   if(patchMode==='timeout-after')throw new Error('Network response lost after remote result');
   if(patchMode==='commit-failure')failBatch=true;
   return result;
  }
  if(method==='DELETE'){const found=calendar.delete(id);return new Response(null,{status:found?204:404});}
  const event=calendar.get(id);return event?Response.json(event):new Response(null,{status:404});
 }
 throw new Error('Unexpected mocked request');
};
const request=async(path,{method='GET',data,token=ownerToken,ip='192.0.2.100',origin='https://briefbooth.com'}={})=>{const headers={'cf-connecting-ip':ip};if(token)headers.Authorization='Bearer '+token;if(method==='POST'){headers.Origin=origin;headers['Content-Type']='application/json';}const response=await handleRecovery(new Request('https://briefbooth.com/api/recovery/'+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),env);return {status:response.status,body:await response.json()};};
const baseDay=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
const when=(offset,time)=>recoveryTest.localInstant(new Date(Date.parse(baseDay+'T12:00Z')+offset*86400000).toISOString().slice(0,10),time,config.profile.timezone);
let fixtureNumber=0;
async function fixture(offset,time='09:00'){
 const id=crypto.randomUUID(),requestId=crypto.randomUUID(),clientToken=id+'.'+('x'.repeat(43)),starts=when(offset,time),ends=starts+30*60000,eventId='bb'+id.replaceAll('-','');
 sql.prepare(`INSERT INTO recovery_bookings(id,owner_id,service_id,title,starts_ms,ends_ms,client_name,client_email,status,request_id,client_token_hash,event_id,meeting_url,created_ms,updated_ms)
 VALUES(?,?,?,?,?,?,?,?,'confirmed',?,?,?,?,?,?)`).run(id,'owner','service','Free consultation',starts,ends,'Dummy client',`client-${fixtureNumber}@example.invalid`,requestId,await recoveryTest.digest(clientToken),eventId,'https://meet.google.com/abc-defg-hij',Date.now(),Date.now());
 calendar.set(eventId,{id:eventId,status:'confirmed',etag:newEtag(),summary:'Free consultation',start:{dateTime:new Date(starts).toISOString()},end:{dateTime:new Date(ends).toISOString()},extendedProperties:{private:{briefbooth_booking_id:id}},conferenceData:{entryPoints:[{entryPointType:'video',uri:'https://meet.google.com/abc-defg-hij'}]}});
 const ip='192.0.2.'+(101+fixtureNumber++);
 return {id,clientToken,starts,ends,eventId,ip,change(time='12:00',operationId=crypto.randomUUID()){return {bookingId:id,operationId,startsAt:new Date(when(offset,time)).toISOString()};}};
}
const opFor=id=>sql.prepare('SELECT * FROM recovery_reschedule_operations WHERE operation_id=?').get(id);
const rowFor=id=>sql.prepare('SELECT * FROM recovery_bookings WHERE id=?').get(id);
const move=(f,data=f.change())=>request('reschedule',{method:'POST',data,ip:f.ip});
try{
 // The additive migration preserves existing booking/email rows and defaults.
 const migrationDb=new DatabaseSync(':memory:');
 migrationDb.exec("CREATE TABLE recovery_bookings(id TEXT PRIMARY KEY); CREATE TABLE recovery_emails(id TEXT PRIMARY KEY,booking_id TEXT); INSERT INTO recovery_bookings VALUES('preserved'); INSERT INTO recovery_emails VALUES('mail','preserved');");
 migrationDb.exec(readFileSync(new URL('../recovery/reschedule-migration.sql',import.meta.url),'utf8'));
 assert.deepEqual({...migrationDb.prepare('SELECT * FROM recovery_bookings').get()},{id:'preserved',notification_version:0});
 assert.deepEqual({...migrationDb.prepare('SELECT * FROM recovery_emails').get()},{id:'mail',booking_id:'preserved',booking_version:0});migrationDb.close();

 const f=await fixture(0),change=f.change();
 assert.equal((await request('reschedule',{method:'POST',data:change,token:null,ip:f.ip})).status,401);
 assert.equal((await request('reschedule',{method:'POST',data:change,token:f.clientToken,ip:f.ip})).status,401);
 assert.equal((await request('reschedule',{method:'POST',data:change,origin:'https://evil.invalid',ip:f.ip})).status,403);
 assert.equal((await request(`reschedule-slots?bookingId=${f.id}&day=${baseDay}`,{token:null,ip:f.ip})).status,401);
 const slots=await request(`reschedule-slots?bookingId=${f.id}&day=${baseDay}`,{ip:f.ip});assert.equal(slots.status,200);assert.ok(slots.body.slots.includes(change.startsAt));assert.ok(!slots.body.slots.includes(new Date(when(0,'09:15')).toISOString()));
 assert.equal((await move(f,f.change('09:15'))).status,409,'Never subtract merged free/busy around the current event');
 assert.equal((await move(f,{...change,bookingId:crypto.randomUUID()})).status,404);
 assert.equal((await move(f,{...change,operationId:'bad'})).status,400);
 assert.equal((await move(f,{...change,startsAt:'not-a-date'})).status,400);
 sql.prepare('UPDATE recovery_bookings SET action_until=? WHERE id=?').run(Date.now()+60000,f.id);assert.equal((await move(f,change)).status,409);sql.prepare('UPDATE recovery_bookings SET action_until=0 WHERE id=?').run(f.id);
 const first=await move(f,change);assert.equal(first.status,200);assert.equal(first.body.booking.starts_at,change.startsAt);assert.equal(first.body.booking.service_id,'service');assert.equal(first.body.booking.reschedule,null);assert.equal(first.body.booking.meeting_url,'https://meet.google.com/abc-defg-hij');
 assert.equal(rowFor(f.id).notification_version,1);assert.equal(opFor(change.operationId).state,'complete');assert.equal(calendar.get(f.eventId).start.dateTime,change.startsAt);assert.ok(calls.find(c=>c.method==='PATCH')?.ifMatch);
 assert.equal(mail.length,2);assert.ok(mail.every(m=>m.subject.includes('rescheduled')));
 const patchCount=calls.filter(c=>c.method==='PATCH').length;
 assert.equal((await move(f,change)).status,200);assert.equal(calls.filter(c=>c.method==='PATCH').length,patchCount);assert.equal(mail.length,2);
 assert.equal((await move(f,{...change,startsAt:new Date(when(0,'15:00')).toISOString()})).status,409);
 assert.equal((await request('manage',{token:f.clientToken,ip:f.ip})).body.booking.starts_at,change.startsAt);

 // A response lost after Google applies the PATCH reconciles without reapplying.
 const lost=await fixture(1),lostChange=lost.change();patchMode='timeout-after';
 const lostResult=await move(lost,lostChange);assert.equal(lostResult.status,202);assert.equal(lostResult.body.booking.reschedule.state,'applying');assert.equal(rowFor(lost.id).starts_ms,lost.starts);assert.equal(calendar.get(lost.eventId).start.dateTime,lostChange.startsAt);
 assert.equal((await request('manage',{token:lost.clientToken,ip:lost.ip})).body.booking.reschedule.operation_id,lostChange.operationId);
 const admin=await request('admin',{ip:lost.ip});assert.equal(admin.body.bookings.find(x=>x.id===lost.id).reschedule.operation_id,lostChange.operationId);
 const afterLostPatches=calls.filter(c=>c.method==='PATCH').length;patchMode='normal';assert.equal((await move(lost,lostChange)).status,200);assert.equal(calls.filter(c=>c.method==='PATCH').length,afterLostPatches);

 // Reconciliation remains possible after the old appointment's start passes.
 const elapsed=await fixture(9),elapsedChange=elapsed.change();patchMode='timeout-after';assert.equal((await move(elapsed,elapsedChange)).status,202);
 const realNow=Date.now;Date.now=()=>elapsed.starts+1;
 try{patchMode='normal';assert.equal((await move(elapsed,elapsedChange)).status,200);assert.equal(rowFor(elapsed.id).starts_ms,Date.parse(elapsedChange.startsAt));}finally{Date.now=realNow;}

 // A future pending target can be cancelled even after the old start passes.
 // Deleting the verified same event also makes a delayed conditional PATCH fail.
 for(const [offset,mode] of [[10,'timeout-after'],[11,'timeout-before']]){
  const lateCancel=await fixture(offset),lateChange=lateCancel.change();patchMode=mode;assert.equal((await move(lateCancel,lateChange)).status,202);const delayed=mode==='timeout-before'?pendingPatch:null;
  const realClock=Date.now;Date.now=()=>lateCancel.starts+1;
  try{
   patchMode='normal';const result=await request('cancel',{method:'POST',token:lateCancel.clientToken,ip:lateCancel.ip});assert.equal(result.status,200);assert.equal(result.body.booking.status,'cancelled');assert.equal(opFor(lateChange.operationId).state,'cancelled');assert.equal(calendar.has(lateCancel.eventId),false);
   if(delayed)assert.equal(applyPatch(delayed.id,delayed.payload,delayed.etag).status,410);
  }finally{Date.now=realClock;}
 }
 const started=await fixture(12);const realClock=Date.now;Date.now=()=>started.starts+1;
 try{assert.equal((await move(started)).status,409);assert.equal((await request('cancel',{method:'POST',token:started.clientToken,ip:started.ip})).status,409);}finally{Date.now=realClock;}

 // Never issue a new PATCH after the target time expires. A prior ambiguous
 // operation keeps its hold and remains owner-cancellable even if both times pass.
 const expiredTarget=await fixture(13,'15:00'),expiredChange=expiredTarget.change('12:00');patchMode='timeout-before';assert.equal((await move(expiredTarget,expiredChange)).status,202);
 const beforeExpiredPatches=calls.filter(c=>c.method==='PATCH').length;const previousClock=Date.now;
 Date.now=()=>when(13,'12:01');patchMode='normal';
 try{const retry=await move(expiredTarget,expiredChange);assert.equal(retry.status,202);assert.match(retry.body.message,/No new time change/);assert.equal(calls.filter(c=>c.method==='PATCH').length,beforeExpiredPatches);assert.equal(rowFor(expiredTarget.id).starts_ms,expiredTarget.starts);assert.equal(opFor(expiredChange.operationId).state,'applying');
  Date.now=()=>when(13,'16:00');assert.equal((await request('review',{method:'POST',data:{bookingId:expiredTarget.id,approve:false},ip:expiredTarget.ip})).status,200);assert.equal(opFor(expiredChange.operationId).state,'cancelled');
 }finally{Date.now=previousClock;}

 // A slow free/busy response cannot dispatch a PATCH after target expiry either.
 const slowCheck=await fixture(14,'15:00'),slowChange=slowCheck.change('12:00');patchMode='timeout-before';assert.equal((await move(slowCheck,slowChange)).status,202);
 const beforeSlowPatches=calls.filter(c=>c.method==='PATCH').length,slowClock=Date.now;
 Date.now=()=>when(14,'12:00')-1000;freeBusyHook=()=>{Date.now=()=>when(14,'12:00')+1;};patchMode='normal';
 try{const retry=await move(slowCheck,slowChange);assert.equal(retry.status,202);assert.match(retry.body.message,/No new time change/);assert.equal(calls.filter(c=>c.method==='PATCH').length,beforeSlowPatches);assert.equal(opFor(slowChange.operationId).state,'applying');}finally{Date.now=slowClock;freeBusyHook=null;}

 // A local crash after remote success retains both reservations and recovers.
 const crash=await fixture(2),crashChange=crash.change();patchMode='commit-failure';assert.equal((await move(crash,crashChange)).status,503);assert.equal(rowFor(crash.id).starts_ms,crash.starts);assert.equal(opFor(crashChange.operationId).state,'applying');patchMode='normal';assert.equal((await move(crash,crashChange)).status,200);assert.equal(rowFor(crash.id).notification_version,1);

 // An unresolved PATCH blocks both old/new slots and all competing operations.
 const pending=await fixture(3),pendingChange=pending.change();patchMode='timeout-before';const beforePendingMail=mail.length;
 assert.equal((await move(pending,pendingChange)).status,202);assert.equal(mail.length,beforePendingMail);
 const pendingDay=new Date(Date.parse(baseDay+'T12:00Z')+3*86400000).toISOString().slice(0,10);
 const held=await request(`slots?service=service&day=${pendingDay}`,{token:null,ip:pending.ip});assert.ok(!held.body.slots.includes(pendingChange.startsAt));assert.ok(!held.body.slots.includes(new Date(pending.starts).toISOString()));
 assert.equal((await move(pending,pending.change('15:00'))).status,409);
 const attemptedBook={serviceId:'service',startsAt:pendingChange.startsAt,name:'Other dummy',email:'other@example.invalid',requestId:crypto.randomUUID()};
 assert.equal((await request('book',{method:'POST',data:attemptedBook,token:null,ip:'192.0.2.200'})).status,409);
 // An old confirmation queued during a pending remote change cannot be sent.
 sql.prepare("INSERT INTO recovery_emails(id,booking_id,kind,recipient,subject,body,created_ms) VALUES(?,?,'confirmed_client','old@example.invalid','Old time','Old',?)").run(pending.id+':confirmed_client',pending.id,Date.now());
 await deliverRecoveryEmails(env,pending.id);assert.equal(mail.length,beforePendingMail);
 const late=pendingPatch;patchMode='normal';
 const cancel=await request('review',{method:'POST',data:{bookingId:pending.id,approve:false},ip:pending.ip});assert.equal(cancel.status,200);assert.equal(cancel.body.booking.status,'cancelled');assert.equal(opFor(pendingChange.operationId).state,'cancelled');assert.equal(applyPatch(late.id,late.payload,late.etag).status,410);assert.equal(calendar.has(pending.eventId),false);
 const freed=await request(`slots?service=service&day=${pendingDay}`,{token:null,ip:pending.ip});assert.ok(freed.body.slots.includes(pendingChange.startsAt));
 assert.equal((await move(pending,pendingChange)).status,409);

 // Two confirmed bookings racing for one target obtain exactly one reservation.
 const raceA=await fixture(4,'09:00'),raceB=await fixture(4,'10:30');patchMode='timeout-before';
 const race=await Promise.all([move(raceA,raceA.change('15:00')),move(raceB,raceB.change('15:00'))]);assert.deepEqual(race.map(x=>x.status).sort(),[202,409]);patchMode='normal';

 // A definite first-attempt Google rejection preserves old data and frees target.
 const rejected=await fixture(5),rejectedChange=rejected.change();patchMode='forbidden';const beforeRejectedMail=mail.length;
 assert.equal((await move(rejected,rejectedChange)).status,503);assert.equal(rowFor(rejected.id).starts_ms,rejected.starts);assert.equal(opFor(rejectedChange.operationId).state,'failed');assert.equal(mail.length,beforeRejectedMail);patchMode='normal';assert.equal((await move(rejected,rejected.change())).status,200);

 // Unrelated/manual event changes must not be overwritten.
 const changed=await fixture(6);calendar.get(changed.eventId).extendedProperties.private.briefbooth_booking_id='other-booking';assert.equal((await move(changed)).status,409);assert.equal(rowFor(changed.id).notification_version,0);
 const stale=await fixture(7),staleChange=stale.change();patchMode='timeout-before';assert.equal((await move(stale,staleChange)).status,202);const stalePatch=pendingPatch;calendar.get(stale.eventId).etag=newEtag();calendar.get(stale.eventId).summary='Manual edit';patchMode='normal';assert.equal((await move(stale,staleChange)).status,409);assert.equal(opFor(staleChange.operationId).state,'failed');assert.equal(applyPatch(stalePatch.id,stalePatch.payload,stalePatch.etag).status,412);assert.equal(calendar.get(stale.eventId).summary,'Manual edit');

 // New confirmation revisions supersede old queued mail; old delivery failures
 // do not hide success of the current time change, and retries cannot send them.
 const versioned=await fixture(8),versionChange=versioned.change();
 sql.prepare("INSERT INTO recovery_emails(id,booking_id,kind,recipient,subject,body,created_ms,delivery_status) VALUES(?,?,'confirmed_client','old@example.invalid','Old time','Old',?,'failed')").run(versioned.id+':confirmed_client',versioned.id,Date.now());
 const beforeVersionMail=mail.length;assert.equal((await move(versioned,versionChange)).status,200);assert.equal(mail.length,beforeVersionMail+2);
 assert.equal(sql.prepare('SELECT state FROM recovery_emails WHERE id=?').get(versioned.id+':confirmed_client').state,'superseded');
 sql.prepare("UPDATE recovery_emails SET delivery_status='delivered' WHERE booking_id=? AND booking_version=1").run(versioned.id);
 assert.equal((await recoveryMailFlags(env,versioned.id)).email_pending,false);
 sql.prepare("UPDATE recovery_emails SET state='queued',next_attempt_ms=0 WHERE id=?").run(versioned.id+':confirmed_client');
 await deliverRecoveryEmails(env,versioned.id);assert.equal(mail.length,beforeVersionMail+2);
 console.log('Recovery rescheduling: migration preservation, owner isolation, safe slots, ETag update, same-ID retry, ambiguous remote/local failures, two-slot reservations, competing requests, cancellation, and versioned email checks pass.');
}finally{globalThis.fetch=realFetch;sql.close();}
