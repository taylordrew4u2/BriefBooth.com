import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleRecovery,recoveryTest} from '../scripts/recovery-backend.mjs';
import {reconcileRecoveryMail, deliverRecoveryEmails} from '../scripts/recovery-email.mjs';
const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../recovery/schema.sql',import.meta.url),'utf8'));
const DB={
 prepare(query){return {bind(...args){
  const run=()=>({meta:{changes:sql.prepare(query).run(...args).changes}});
  return {run,async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};}};
 }};},
 async batch(statements){
  sql.exec('BEGIN');
  try {const result=statements.map(statement=>statement.run());sql.exec('COMMIT');return result;}
  catch(error){sql.exec('ROLLBACK');throw error;}
 },
};
const config={profile:{id:'owner',slug:'4u-digital',name:'4u Digital',timezone:'America/New_York',booking_mode:'approval',intake_questions:[{id:'project-types',label:'What do you need?',type:'multiple',required:true,options:['Website','App','Other / not sure yet']},{id:'old-context',label:'Previous context question',type:'short',required:false}]},services:[{id:'service',title:'Free consultation',duration:30,active:true,amount_cents:0,meeting_modes:['google_meet']}],availability:Array.from({length:7},(_,weekday)=>({weekday,start_time:'09:00',end_time:'20:00'})),preferences:{notice_hours:1,buffer_minutes:60,horizon_days:60}};
const ownerToken='test-owner-secret-token-that-is-at-least-32-chars';
const env={RECOVERY_DB:DB,RECOVERY_CONFIG_JSON:JSON.stringify(config),RECOVERY_CAPABILITY_SECRET:'test-only-capability-secret-that-is-32-characters',RECOVERY_OWNER_TOKEN_SHA256:await recoveryTest.digest(ownerToken),RECOVERY_OWNER_EMAIL:'owner@example.com',GOOGLE_CLIENT_ID:'dummy-client',GOOGLE_CLIENT_SECRET:'dummy-secret',GOOGLE_REFRESH_TOKEN:'dummy-refresh',BREVO_API_KEY:'dummy-mail'};
const brevoEvents=new Map();
let calendarBusy=[],mail=[],events=new Map(),calls=[],meetPending=false,failCalendar=false,failCreate=false,failDelete=false,mailTimeout=false,mailRejected=false,malformedBusy=false,lateCreate=false,pendingRemoteEvent,rejectCreate=0,failConference=false;
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,opts={})=>{
 const u=String(url);calls.push({url:u,method:opts.method||'GET'});
 if(u==='https://oauth2.googleapis.com/token')return Response.json({access_token:'dummy-access',expires_in:3600});
 if(u==='https://api.brevo.com/v3/smtp/email'){if(mailTimeout)throw new Error('timeout after possible delivery');if(mailRejected)return new Response('',{status:429});mail.push(JSON.parse(opts.body));return Response.json({messageId:'<mail-'+mail.length+'@test.invalid>'},{status:201});}
 if(u.startsWith('https://api.brevo.com/v3/smtp/statistics/events?'))return Response.json({events:brevoEvents.get(new URL(u).searchParams.get('messageId'))||[]});
 if(u.includes('www.googleapis.com/calendar/v3/')){
  if(failCalendar)return new Response('',{status:503});
  if(u.endsWith('/freeBusy'))return Response.json(malformedBusy?{calendars:{primary:{errors:[{reason:'forbidden'}]}}}:{calendars:{primary:{busy:calendarBusy}}});
  const path=u.split('/calendar/v3/')[1];
  if(opts.method==='POST'&&path.startsWith('calendars/primary/events?')){if(failCreate)return new Response('',{status:503});if(rejectCreate)return new Response('',{status:rejectCreate});const event=JSON.parse(opts.body);if(lateCreate){pendingRemoteEvent=event;throw new Error('response lost while creation continues');}if(events.has(event.id))return new Response('',{status:409});if(failConference)event.conferenceData.createRequest.status={statusCode:'failure'};else if(!meetPending)event.conferenceData.entryPoints=[{entryPointType:'video',uri:'https://meet.google.com/abc-defg-hij'}];events.set(event.id,event);return Response.json(event);}
  const id=path.split('/').at(-1);
  if(opts.method==='DELETE'){if(failDelete)return new Response('',{status:503});const had=events.delete(id);return new Response(null,{status:had?204:404});}
  const e=events.get(id);return e?Response.json(e):new Response('',{status:404});
 }
 throw new Error('Unexpected external request');
};
const request=async(path,{method='GET',data,token,origin='https://briefbooth.com',ip='192.0.2.1',ctx}={})=>{const headers={'cf-connecting-ip':ip};if(token)headers.Authorization='Bearer '+token;if(method==='POST'){if(origin)headers.Origin=origin;if(data!==undefined)headers['Content-Type']='application/json';}const r=await handleRecovery(new Request('https://briefbooth.com/api/recovery/'+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),env,ctx);return {status:r.status,body:await r.json()};};
const day=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
const input=(time='10:00',id=crypto.randomUUID())=>({configRevision:1,serviceId:'service',startsAt:new Date(recoveryTest.localInstant(day,time,config.profile.timezone)).toISOString(),name:'Test Client',email:'client@example.com',notes:'Dummy only',answers:{'project-types':'Website'},requestId:id});
try{
 const savedOwnerHash=env.RECOVERY_OWNER_TOKEN_SHA256;delete env.RECOVERY_OWNER_TOKEN_SHA256;assert.equal((await request('config')).status,503);env.RECOVERY_OWNER_TOKEN_SHA256=savedOwnerHash;
 const c=await request('config');assert.equal(c.status,200);assert.deepEqual(c.body.profile.intake_questions.map(question=>question.id),['project-types']);assert.ok(!JSON.stringify(c).includes('dummy-secret'));
 assert.equal((await request('book',{method:'POST',data:input(),origin:'https://attacker.example'})).status,403);
 assert.equal((await request('admin')).status,401);
 assert.equal((await request('manage?token=forbidden-query-token')).status,404);
 const required=input();delete required.name;assert.equal((await request('book',{method:'POST',data:required})).status,400);
 const invalid=input();invalid.answers['project-types']='Invalid';assert.equal((await request('book',{method:'POST',data:invalid})).status,400);
 malformedBusy=true;assert.equal((await request(`slots?service=service&day=${day}`)).status,503);malformedBusy=false;
 failCalendar=true;assert.equal((await request(`slots?service=service&day=${day}`)).status,503);failCalendar=false;
 calendarBusy=[{start:new Date(recoveryTest.localInstant(day,'12:00',config.profile.timezone)).toISOString(),end:new Date(recoveryTest.localInstant(day,'12:30',config.profile.timezone)).toISOString()}];
 const availability=await request(`slots?service=service&day=${day}`);assert.equal(availability.status,200);assert.ok(!availability.body.slots.includes(input('11:30').startsAt));assert.ok(availability.body.slots.includes(input('10:00').startsAt));calendarBusy=[];
 const one=input();one.answers['project-types']='Website\nApp';const two={...input('10:15'),email:'second@example.com'};
 const concurrent=await Promise.all([request('book',{method:'POST',data:one}),request('book',{method:'POST',data:two,ip:'192.0.2.2'})]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[201,409]);const won=concurrent.find(r=>r.status===201),winningInput=concurrent[0].status===201?one:two;assert.equal(won.body.status,'pending_approval');assert.equal(events.size,0);assert.equal(mail.length,2);
 const retry=await request('book',{method:'POST',data:winningInput});assert.equal(retry.status,200);assert.equal(retry.body.token,won.body.token);assert.equal(mail.length,2);
 const altered=await request('book',{method:'POST',data:{...winningInput,name:'Different'}});assert.equal(altered.status,409);
 const privateView=await request('manage',{token:won.body.token});assert.equal(privateView.status,200);assert.equal(privateView.body.booking.meeting_url,null);assert.ok(!('client_email' in privateView.body.booking));
 assert.equal((await request('manage',{token:won.body.token.slice(0,-1)+'x'})).status,404);
 const admin=await request('admin',{token:ownerToken});assert.equal(admin.body.bookings.length,1);assert.equal(admin.body.bookings[0].client_email,winningInput.email);
 // Failed provider creation must keep reservation and never announce confirmation.
 failCreate=true;let approval=await request('review',{method:'POST',token:ownerToken,data:{bookingId:won.body.bookingId,approve:true}});assert.equal(approval.status,503);assert.equal(sql.prepare('SELECT status FROM recovery_bookings WHERE id=?').get(won.body.bookingId).status,'confirming');assert.equal(mail.length,2);failCreate=false;
 meetPending=true;approval=await request('review',{method:'POST',token:ownerToken,data:{bookingId:won.body.bookingId,approve:true}});assert.equal(approval.status,202);assert.equal(approval.body.booking.status,'confirming');assert.equal(approval.body.booking.meeting_url,null);assert.equal(events.size,1);assert.equal(mail.length,2);
 const e=[...events.values()][0];e.conferenceData.entryPoints=[{entryPointType:'video',uri:'https://meet.google.com/abc-defg-hij'}];
 approval=await request('review',{method:'POST',token:ownerToken,data:{bookingId:won.body.bookingId,approve:true}});assert.equal(approval.status,200);assert.equal(approval.body.booking.status,'confirmed');assert.equal(events.size,1);assert.equal(mail.length,4);
 await request('review',{method:'POST',token:ownerToken,data:{bookingId:won.body.bookingId,approve:true}});assert.equal(events.size,1);assert.equal(mail.length,4);
 // A held action lease prevents a concurrent client cancellation from racing creation.
 sql.prepare('UPDATE recovery_bookings SET action_until=? WHERE id=?').run(Date.now()+60000,won.body.bookingId);assert.equal((await request('cancel',{method:'POST',token:won.body.token})).status,409);sql.prepare('UPDATE recovery_bookings SET action_until=0 WHERE id=?').run(won.body.bookingId);
 const originalMarker=e.extendedProperties.private.briefbooth_booking_id;e.extendedProperties.private.briefbooth_booking_id='foreign';assert.equal((await request('cancel',{method:'POST',token:won.body.token})).status,409);assert.equal(events.size,1);e.extendedProperties.private.briefbooth_booking_id=originalMarker;
 failDelete=true;assert.equal((await request('cancel',{method:'POST',token:won.body.token})).status,503);assert.equal(sql.prepare('SELECT status FROM recovery_bookings WHERE id=?').get(won.body.bookingId).status,'cancelling');failDelete=false;
 const cancelled=await request('cancel',{method:'POST',token:won.body.token});assert.equal(cancelled.status,200);assert.equal(cancelled.body.booking.status,'cancelled');assert.equal(events.size,0);assert.equal(mail.length,6);
 await request('cancel',{method:'POST',token:won.body.token});assert.equal(mail.length,6);
 // An ambiguous creation must not report completed cancellation on a first 404.
 lateCreate=true;const delayedInput={...input('09:00'),email:'delayed@example.com'};
 const delayed=await request('book',{method:'POST',data:delayedInput,ip:'192.0.2.66'});assert.equal(delayed.status,201);
 const delayedApproval=await request('review',{method:'POST',token:ownerToken,data:{bookingId:delayed.body.bookingId,approve:true}});assert.equal(delayedApproval.status,503);
 const beforeDelayedCancel=mail.length;const cancellationPending=await request('cancel',{method:'POST',token:delayed.body.token,ip:'192.0.2.66'});assert.equal(cancellationPending.status,202);assert.equal(cancellationPending.body.booking.status,'cancelling');assert.equal(mail.length,beforeDelayedCancel);
 assert.equal((await request('cancel',{method:'POST',token:delayed.body.token,ip:'192.0.2.66'})).status,202);
 const held=await request(`slots?service=service&day=${day}`);assert.ok(!held.body.slots.includes(delayedInput.startsAt));
 lateCreate=false;events.set(pendingRemoteEvent.id,pendingRemoteEvent);
 const reconciled=await request('cancel',{method:'POST',token:delayed.body.token,ip:'192.0.2.66'});assert.equal(reconciled.status,200);assert.equal(reconciled.body.booking.status,'cancelled');assert.equal(events.size,0);assert.equal(mail.length,beforeDelayedCancel+2);
 // A fresh definite provider rejection restores a cancellable pending request.
 rejectCreate=403;const rejectedInput={...input('09:00'),email:'rejected@example.com'};
 const rejected=await request('book',{method:'POST',data:rejectedInput,ip:'192.0.2.67'});assert.equal(rejected.status,201);
 const rejection=await request('review',{method:'POST',token:ownerToken,data:{bookingId:rejected.body.bookingId,approve:true}});assert.equal(rejection.status,503);
 const rejectedRow=sql.prepare('SELECT status,event_id FROM recovery_bookings WHERE id=?').get(rejected.body.bookingId);assert.equal(rejectedRow.status,'pending_approval');assert.equal(rejectedRow.event_id,null);assert.equal(events.size,0);
 assert.equal((await request('cancel',{method:'POST',token:rejected.body.token,ip:'192.0.2.67'})).body.booking.status,'cancelled');rejectCreate=0;
 // A later403 cannot erase a previous uncertain creation, even after a404 read.
 lateCreate=true;const priorInput={...input('09:00'),email:'prior-uncertain@example.com'};
 const prior=await request('book',{method:'POST',data:priorInput,ip:'192.0.2.68'});assert.equal(prior.status,201);
 assert.equal((await request('review',{method:'POST',token:ownerToken,data:{bookingId:prior.body.bookingId,approve:true}})).status,503);
 lateCreate=false;rejectCreate=403;
 assert.equal((await request('review',{method:'POST',token:ownerToken,data:{bookingId:prior.body.bookingId,approve:true}})).status,503);
 assert.equal(sql.prepare('SELECT status FROM recovery_bookings WHERE id=?').get(prior.body.bookingId).status,'confirming');
 assert.equal((await request('cancel',{method:'POST',token:prior.body.token,ip:'192.0.2.68'})).status,202);
 rejectCreate=0;events.set(pendingRemoteEvent.id,pendingRemoteEvent);
 assert.equal((await request('cancel',{method:'POST',token:prior.body.token,ip:'192.0.2.68'})).body.booking.status,'cancelled');assert.equal(events.size,0);
 // Google's terminal conference failure is explicit and owner-cancellable.
 failConference=true;const failedMeetInput={...input('09:00'),email:'failed-meet@example.com'};
 const failedMeet=await request('book',{method:'POST',data:failedMeetInput,ip:'192.0.2.69'});assert.equal(failedMeet.status,201);
 const beforeFailedMeet=mail.length;const failedMeetApproval=await request('review',{method:'POST',token:ownerToken,data:{bookingId:failedMeet.body.bookingId,approve:true}});
 assert.equal(failedMeetApproval.status,409);assert.equal(failedMeetApproval.body.booking.meeting_error,'google_meet_failed');assert.equal(failedMeetApproval.body.booking.meeting_url,null);assert.equal(mail.length,beforeFailedMeet);assert.equal(events.size,1);
 const failedMeetStatus=await request('manage',{token:failedMeet.body.token});assert.equal(failedMeetStatus.body.booking.meeting_error,'google_meet_failed');
 const ownerCancel=await request('review',{method:'POST',token:ownerToken,data:{bookingId:failedMeet.body.bookingId,approve:false}});assert.equal(ownerCancel.status,200);assert.equal(ownerCancel.body.booking.status,'cancelled');assert.equal(ownerCancel.body.booking.meeting_error,null);assert.equal(events.size,0);assert.equal(mail.length,beforeFailedMeet+2);failConference=false;
 // If Google subsequently supplies a valid link, a safe retry clears the error.
 failConference=true;const recoveredMeetInput={...input('09:00'),email:'recovered-meet@example.com'};
 const recoveredMeet=await request('book',{method:'POST',data:recoveredMeetInput,ip:'192.0.2.70'});assert.equal(recoveredMeet.status,201);
 assert.equal((await request('review',{method:'POST',token:ownerToken,data:{bookingId:recoveredMeet.body.bookingId,approve:true}})).status,409);
 const recoveredEvent=[...events.values()][0];recoveredEvent.conferenceData.createRequest.status.statusCode='success';recoveredEvent.conferenceData.entryPoints=[{entryPointType:'video',uri:'https://meet.google.com/abc-defg-hij'}];failConference=false;
 const meetReady=await request('review',{method:'POST',token:ownerToken,data:{bookingId:recoveredMeet.body.bookingId,approve:true}});assert.equal(meetReady.status,200);assert.equal(meetReady.body.booking.status,'confirmed');assert.equal(meetReady.body.booking.meeting_error,null);
 assert.equal((await request('cancel',{method:'POST',token:recoveredMeet.body.token,ip:'192.0.2.70'})).body.booking.status,'cancelled');assert.equal(events.size,0);
 // Email ambiguity is recorded and not blindly resent on booking retry.
 meetPending=false;mailTimeout=true;const later=input('16:00');later.email='later@example.com';delete later.answers;delete later.notes;const sent=await request('book',{method:'POST',data:later,ip:'192.0.2.3'});assert.equal(sent.status,201);assert.equal(sent.body.email_pending,true);assert.equal(sql.prepare("SELECT count(*) n FROM recovery_emails WHERE state='uncertain'").get().n,2);mailTimeout=false;
 const mailBefore=mail.length;await request('book',{method:'POST',data:later,ip:'192.0.2.3'});assert.equal(mail.length,mailBefore);
 const uncertainBefore=mail.length;const retryUncertain=await request('notifications',{method:'POST',token:ownerToken,data:{bookingId:sent.body.bookingId}});assert.equal(retryUncertain.body.email_uncertain,true);assert.equal(retryUncertain.body.email_queued,false);assert.equal(mail.length,uncertainBefore);
 const decline=await request('review',{method:'POST',token:ownerToken,data:{bookingId:sent.body.bookingId,approve:false}});assert.equal(decline.body.booking.status,'declined');assert.equal(events.size,0);
 // A stale action cannot override a state written under a newer lease.
 sql.prepare('UPDATE recovery_bookings SET action_nonce=?,action_until=? WHERE id=?').run('new-lease',Date.now()+60000,sent.body.bookingId);
 await assert.rejects(()=>recoveryTest.transition(env,sent.body.bookingId,'old-lease',['declined'],'confirmed'),/changed/);
 assert.equal(sql.prepare('SELECT status FROM recovery_bookings WHERE id=?').get(sent.body.bookingId).status,'declined');
 sql.prepare('UPDATE recovery_bookings SET action_nonce=?,action_until=? WHERE id=?').run('expired-lease',Date.now()-1,sent.body.bookingId);
 await assert.rejects(()=>recoveryTest.transition(env,sent.body.bookingId,'expired-lease',['declined'],'confirmed'),/changed/);
 sql.prepare('UPDATE recovery_bookings SET action_nonce=NULL,action_until=0 WHERE id=?').run(sent.body.bookingId);
 // Outbox rejection leaves queued notices; cancellation supersedes pending text.
 mailRejected=true;const queuedInput={...input('13:30'),email:'queued@example.com'};
 const queued=await request('book',{method:'POST',data:queuedInput,ip:'192.0.2.44'});assert.equal(queued.status,201);assert.equal(queued.body.email_pending,true);
 // Simulate a process failing after the terminal state commit, before mail enqueue.
 sql.prepare("UPDATE recovery_bookings SET status='cancelled' WHERE id=?").run(queued.body.bookingId);
 mailRejected=false;const beforeFinal=mail.length;const recovered=await request('cancel',{method:'POST',token:queued.body.token,ip:'192.0.2.44'});assert.equal(recovered.status,200);assert.equal(mail.length,beforeFinal+2);assert.ok(mail.slice(beforeFinal).every(m=>m.subject.includes('cancelled')));
 assert.equal(sql.prepare("SELECT count(*) n FROM recovery_emails WHERE booking_id=? AND kind LIKE 'request_%' AND state='superseded'").get(queued.body.bookingId).n,2);
 const adminMail=await request('admin',{token:ownerToken});const queuedRow=adminMail.body.bookings.find(x=>x.id===queued.body.bookingId);assert.equal(queuedRow.email_pending,true);assert.equal(queuedRow.email_uncertain,false);assert.equal(queuedRow.email_queued,false);
 assert.equal(recoveryTest.localInstant('2027-03-14','02:30','America/New_York'),null);
 const futureConfig={...config,overrides:[{day,enabled:false}]};assert.deepEqual(recoveryTest.schedule(futureConfig,config.services[0],day,Date.now()),[]);
 // Confirm throttling prevents arbitrary unlimited email booking attempts.
 for(let i=0;i<9;i++)await request('book',{method:'POST',data:{...input('18:00'),email:'blocked'+i+'@example.com'},ip:'192.0.2.99'});
 const limited=await request('book',{method:'POST',data:{...input('19:00'),email:'limit@example.com'},ip:'192.0.2.99'});assert.equal(limited.status,429);
 // Delivery evidence is scoped to both provider ID and recipient. Pending is not delivered.
 const deliveryInput={...input('11:00'),email:'delivery@example.com',startsAt:new Date(Date.parse(input('11:00').startsAt)+86400000).toISOString()};
 const delivery=await request('book',{method:'POST',data:deliveryInput,ip:'192.0.2.80'});
 assert.equal(delivery.status,201);
 assert.equal(delivery.body.email_pending,true);
 assert.equal(delivery.body.email_uncertain,false);
 const mailRows=sql.prepare(`SELECT a.*, e.recipient, e.kind FROM recovery_email_attempts a
   JOIN recovery_emails e ON e.id=a.email_id WHERE e.booking_id=? ORDER BY a.attempt_number`);
 const findMail=kind=>mailRows.all(delivery.body.bookingId).filter(row=>row.kind===kind).at(-1);
 const event=(row,name,reason='',email=row.recipient,messageId=row.provider_message_id)=>({messageId,email,event:name,reason});
 const report=(row,...items)=>brevoEvents.set('<'+row.provider_message_id+'>',items);
 const check=()=>reconcileRecoveryMail(env,delivery.body.bookingId,{polling:true});
 const spamcop='551 Sending IP listed by SpamCop';
 const ownerMail=findMail('request_owner'), clientMail=findMail('request_client');
 assert.match(clientMail.provider_message_id,/^mail-\d+@test.invalid$/);
 assert.ok(mail.some(item=>item.headers.idempotencyKey===clientMail.id&&item.tags.includes('briefbooth-recovery-'+clientMail.id)));
 report(ownerMail,event(ownerMail,'delivered','', 'unrelated@example.com'),event(ownerMail,'delivered','','owner@example.com','foreign-id'));
 report(clientMail,event(clientMail,'deferred',spamcop));
 let checkResult=await check();
 assert.deepEqual(checkResult.retries,[]);
 assert.equal(findMail('request_owner').outcome,'accepted');
 assert.equal(findMail('request_client').outcome,'accepted');
 report(ownerMail,event(ownerMail,'softBounces',spamcop),event(ownerMail,'opened'));
 await check();
 assert.equal(findMail('request_owner').outcome,'delivered','Delivery evidence beats out-of-order terminal events');
 report(ownerMail,event(ownerMail,'softBounces',spamcop));
 assert.deepEqual((await check()).retries,[]);
 for(let n=1;n<=4;n++){
   const current=findMail('request_client');
   assert.equal(current.attempt_number,n);
   report(current,event(current,'softBounces',spamcop));
   const [first,duplicate]=await Promise.all([check(),check()]);
   assert.equal(first.retries.length+duplicate.retries.length,n<4?1:0);
   if(n<4){
     const before=mail.length;
     await Promise.all([deliverRecoveryEmails(env,delivery.body.bookingId),deliverRecoveryEmails(env,delivery.body.bookingId)]);
     assert.equal(mail.length,before+1,'Concurrent retry sends at most once');
     assert.notEqual(findMail('request_client').id,current.id);
   }
 }
 const failed=await request('notifications',{method:'POST',token:ownerToken,ip:'192.0.2.80',data:{bookingId:delivery.body.bookingId}});
 assert.equal(failed.body.email_failed,true);
 assert.equal(failed.body.email_queued,false);
 assert.equal(mailRows.all(delivery.body.bookingId).filter(r=>r.kind==='request_client').length,4);
 const deliveryCancelled=await request('cancel',{method:'POST',token:delivery.body.token,ip:'192.0.2.80'});
 assert.equal(deliveryCancelled.status,200);
 assert.equal(deliveryCancelled.body.email_failed,false,'Old-stage delivery errors do not follow a cancellation');
 const cancelledClient=findMail('cancelled_client'), cancelledOwner=findMail('cancelled_owner');
 report(cancelledClient,event(cancelledClient,'hardBounces',spamcop));
 report(cancelledOwner,event(cancelledOwner,'delivered'));
 assert.deepEqual((await check()).retries,[],'A hard bounce is never retried');
 assert.equal(findMail('cancelled_client').outcome,'failed');
 assert.equal(findMail('cancelled_owner').outcome,'delivered');
 assert.ok(calls.some(call=>new URL(call.url).searchParams.get('messageId')==='<'+cancelledClient.provider_message_id+'>'));
 // A request canceled after a retry is queued must never receive that stale retry.
 const staleInput={...deliveryInput,email:'stale@example.com',startsAt:new Date(Date.parse(deliveryInput.startsAt)+7200000).toISOString(),requestId:crypto.randomUUID()};
 const stale=await request('book',{method:'POST',data:staleInput,ip:'192.0.2.81'});
 assert.equal(stale.status,201);
 const staleClient=mailRows.all(stale.body.bookingId).find(row=>row.kind==='request_client');
 report(staleClient,event(staleClient,'softBounces',spamcop));
 assert.deepEqual((await reconcileRecoveryMail(env,stale.body.bookingId,{polling:true})).retries,[staleClient.email_id]);
 await request('cancel',{method:'POST',token:stale.body.token,ip:'192.0.2.81'});
 const beforeStale=mail.length;
 await deliverRecoveryEmails(env,stale.body.bookingId,null,staleClient.email_id);
 assert.equal(mail.length,beforeStale);
 // Legacy accepted rows do not have an ID, so remain unknown and are not resent.
 sql.prepare("DELETE FROM recovery_email_attempts WHERE email_id=?").run(cancelledClient.email_id);
 sql.prepare("UPDATE recovery_emails SET delivery_status='unknown', attempt_count=0 WHERE id=?").run(cancelledClient.email_id);
 const beforeLegacy=mail.length;
 const legacy=await request('notifications',{method:'POST',token:ownerToken,ip:'192.0.2.80',data:{bookingId:delivery.body.bookingId}});
 assert.equal(legacy.body.email_uncertain,true);
 assert.equal(mail.length,beforeLegacy);
 // The deployed gateway's request context runs an exact delivery check after returning.
 const background=[];
 const pollInput={...deliveryInput,email:'poll@example.com',startsAt:new Date(Date.parse(deliveryInput.startsAt)+14400000).toISOString(),requestId:crypto.randomUUID()};
 const polled=await request('book',{method:'POST',data:pollInput,ip:'192.0.2.82',ctx:{waitUntil(task){background.push(task);}}});
 assert.equal(polled.status,201);
 assert.equal(polled.body.email_pending,true);
 assert.equal(background.length,1);
 for(const row of mailRows.all(polled.body.bookingId))report(row,event(row,'delivered'));
 await Promise.all(background);
 const pollStatus=await request('manage',{token:polled.body.token,ip:'192.0.2.82'});
 assert.equal(pollStatus.body.email_pending,false);
 assert.equal(mailRows.all(polled.body.bookingId).filter(row=>row.outcome==='delivered').length,2);
 // Cursor pagination keeps older actionable requests reachable beyond200 rows,
 // including timestamp ties, without crossing the configured owner's boundary.
 const pagedInsert=sql.prepare('INSERT INTO recovery_bookings(id,owner_id,service_id,title,starts_ms,ends_ms,client_name,client_email,status,created_ms,updated_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
 const pagingBase=Date.now()+1000000;
 for(let i=0;i<205;i++)pagedInsert.run('10000000-0000-4000-8000-'+String(i).padStart(12,'0'),'owner','service','History item',pagingBase,pagingBase+30*60000,'Test','test@example.com','cancelled',pagingBase+Math.floor(i/3),pagingBase);
 const olderPendingId='20000000-0000-4000-8000-000000000000';
 pagedInsert.run(olderPendingId,'owner','service','Older pending request',pagingBase,pagingBase+30*60000,'Test','test@example.com','pending_approval',1,1);
 pagedInsert.run('30000000-0000-4000-8000-000000000000','another-owner','service','Other owner private request',pagingBase,pagingBase+30*60000,'Other','other@example.com','pending_approval',pagingBase+100000,pagingBase);
 assert.equal((await request('admin?cursor=invalid',{token:ownerToken})).status,400);
 const invalidTuple=btoa(JSON.stringify([-1,olderPendingId])).replace(/=+$/,'');
 assert.equal((await request('admin?cursor='+encodeURIComponent(invalidTuple),{token:ownerToken})).status,400);
 const firstPage=await request('admin',{token:ownerToken});assert.equal(firstPage.status,200);assert.equal(firstPage.body.bookings.length,200);assert.ok(firstPage.body.next_cursor);assert.ok(!firstPage.body.bookings.some(b=>b.id===olderPendingId));
 assert.equal((await request('admin?cursor='+encodeURIComponent(firstPage.body.next_cursor))).status,401,'A cursor grants no owner access');
 const allPaged=[...firstPage.body.bookings];let nextCursor=firstPage.body.next_cursor;
 while(nextCursor){const page=await request('admin?cursor='+encodeURIComponent(nextCursor),{token:ownerToken});assert.equal(page.status,200);assert.ok(page.body.bookings.length<=200);allPaged.push(...page.body.bookings);nextCursor=page.body.next_cursor;}
 const expectedIds=sql.prepare('SELECT id FROM recovery_bookings WHERE owner_id=? ORDER BY created_ms DESC,id DESC').all('owner').map(r=>r.id);
 assert.deepEqual(allPaged.map(b=>b.id),expectedIds,'No omitted, duplicate or out-of-order records across timestamp ties');
 assert.ok(allPaged.some(b=>b.id===olderPendingId&&b.status==='pending_approval'));
 assert.ok(allPaged.every(b=>b.title!=='Other owner private request'));
 // Owners can cancel a confirmed consultation without obtaining the client's
 // private link. Use the same verified deletion and retry path as client cancel.
 const ownerCancelInput={...input('10:00'),email:'owner-cancel@example.com',startsAt:new Date(Date.parse(input('10:00').startsAt)+2*86400000).toISOString()};
 const ownerCancelRequest=await request('book',{method:'POST',data:ownerCancelInput,ip:'192.0.2.83'});
 assert.equal(ownerCancelRequest.status,201);
 const ownerReview=data=>request('review',{method:'POST',token:ownerToken,ip:'192.0.2.83',data});
 assert.equal((await ownerReview({bookingId:ownerCancelRequest.body.bookingId,approve:true})).body.booking.status,'confirmed');
 const cancelByOwner={bookingId:ownerCancelRequest.body.bookingId,approve:false};
 assert.equal((await request('review',{method:'POST',data:cancelByOwner,ip:'192.0.2.83'})).status,401);
 assert.equal((await request('review',{method:'POST',token:ownerCancelRequest.body.token,data:cancelByOwner,ip:'192.0.2.83'})).status,401);
 assert.equal((await ownerReview({bookingId:'30000000-0000-4000-8000-000000000000',approve:false})).status,404);
 sql.prepare('UPDATE recovery_bookings SET action_until=? WHERE id=?').run(Date.now()+60000,ownerCancelRequest.body.bookingId);
 assert.equal((await ownerReview(cancelByOwner)).status,409);
 sql.prepare('UPDATE recovery_bookings SET action_until=0 WHERE id=?').run(ownerCancelRequest.body.bookingId);
 const ownerEventId='bb'+ownerCancelRequest.body.bookingId.replaceAll('-','');
 assert.ok(events.has(ownerEventId));
 const beforeOwnerCancellationMail=mail.length;
 failDelete=true;
 assert.equal((await ownerReview(cancelByOwner)).status,503);
 assert.equal(sql.prepare('SELECT status FROM recovery_bookings WHERE id=?').get(ownerCancelRequest.body.bookingId).status,'cancelling');
 assert.ok(events.has(ownerEventId));
 assert.equal(mail.length,beforeOwnerCancellationMail,'A failed calendar deletion must not announce cancellation');
 failDelete=false;
 const ownerCancelled=await ownerReview(cancelByOwner);
 assert.equal(ownerCancelled.status,200);
 assert.equal(ownerCancelled.body.booking.status,'cancelled');
 assert.equal(events.has(ownerEventId),false);
 assert.equal(mail.length,beforeOwnerCancellationMail+2);
 assert.ok(mail.slice(beforeOwnerCancellationMail).every(message=>message.subject.includes('cancelled')));
 const deletesAfterOwnerCancel=calls.filter(call=>call.method==='DELETE').length;
 assert.equal((await ownerReview(cancelByOwner)).status,200,'Repeating owner cancellation is safe');
 assert.equal(calls.filter(call=>call.method==='DELETE').length,deletesAfterOwnerCancel);
 assert.equal(mail.length,beforeOwnerCancellationMail+2);
 console.log('Recovery backend: auth, intake, fresh availability, buffer/overlap, concurrent reservation, idempotency, provider retries, action leases, cancellation, scoped email delivery and retries, DST, rate limits, and owner cursor pagination pass.');
} finally {globalThis.fetch=realFetch;sql.close();}
