import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleRecovery,recoveryTest} from '../scripts/recovery-backend.mjs';
const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../recovery/schema.sql',import.meta.url),'utf8'));
const DB={prepare(query){return {bind(...args){return {async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const result=sql.prepare(query).run(...args);return {meta:{changes:result.changes}};}};}};}};
const config={profile:{id:'owner',slug:'4u-digital',name:'4u Digital',timezone:'America/New_York',booking_mode:'approval',intake_questions:[{id:'need',label:'What do you need?',type:'multiple',required:true,options:['Website','App']}]},services:[{id:'service',title:'Free consultation',duration:30,active:true,amount_cents:0,meeting_modes:['google_meet']}],availability:Array.from({length:7},(_,weekday)=>({weekday,start_time:'09:00',end_time:'20:00'})),preferences:{notice_hours:1,buffer_minutes:60,horizon_days:60}};
const ownerToken='test-owner-secret-token-that-is-at-least-32-chars';
const env={RECOVERY_DB:DB,RECOVERY_CONFIG_JSON:JSON.stringify(config),RECOVERY_CAPABILITY_SECRET:'test-only-capability-secret-that-is-32-characters',RECOVERY_OWNER_TOKEN_SHA256:await recoveryTest.digest(ownerToken),RECOVERY_OWNER_EMAIL:'owner@example.com',GOOGLE_CLIENT_ID:'dummy-client',GOOGLE_CLIENT_SECRET:'dummy-secret',GOOGLE_REFRESH_TOKEN:'dummy-refresh',BREVO_API_KEY:'dummy-mail'};
let calendarBusy=[],mail=[],events=new Map(),calls=[],meetPending=false,failCalendar=false,failCreate=false,failDelete=false,mailTimeout=false,mailRejected=false,malformedBusy=false;
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,opts={})=>{
 const u=String(url);calls.push({url:u,method:opts.method||'GET'});
 if(u==='https://oauth2.googleapis.com/token')return Response.json({access_token:'dummy-access',expires_in:3600});
 if(u==='https://api.brevo.com/v3/smtp/email'){if(mailTimeout)throw new Error('timeout after possible delivery');if(mailRejected)return new Response('',{status:429});mail.push(JSON.parse(opts.body));return Response.json({messageId:'dummy'});}
 if(u.includes('www.googleapis.com/calendar/v3/')){
  if(failCalendar)return new Response('',{status:503});
  if(u.endsWith('/freeBusy'))return Response.json(malformedBusy?{calendars:{primary:{errors:[{reason:'forbidden'}]}}}:{calendars:{primary:{busy:calendarBusy}}});
  const path=u.split('/calendar/v3/')[1];
  if(opts.method==='POST'&&path.startsWith('calendars/primary/events?')){if(failCreate)return new Response('',{status:503});const event=JSON.parse(opts.body);if(events.has(event.id))return new Response('',{status:409});if(!meetPending)event.conferenceData.entryPoints=[{entryPointType:'video',uri:'https://meet.google.com/abc-defg-hij'}];events.set(event.id,event);return Response.json(event);}
  const id=path.split('/').at(-1);
  if(opts.method==='DELETE'){if(failDelete)return new Response('',{status:503});const had=events.delete(id);return new Response(null,{status:had?204:404});}
  const e=events.get(id);return e?Response.json(e):new Response('',{status:404});
 }
 throw new Error('Unexpected external request');
};
const request=async(path,{method='GET',data,token,origin='https://briefbooth.com',ip='192.0.2.1'}={})=>{const headers={'cf-connecting-ip':ip};if(token)headers.Authorization='Bearer '+token;if(method==='POST'){headers.Origin=origin;if(data!==undefined)headers['Content-Type']='application/json';}const r=await handleRecovery(new Request('https://briefbooth.com/api/recovery/'+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),env);return {status:r.status,body:await r.json()};};
const day=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
const input=(time='10:00',id=crypto.randomUUID())=>({serviceId:'service',startsAt:new Date(recoveryTest.localInstant(day,time,config.profile.timezone)).toISOString(),name:'Test Client',email:'client@example.com',notes:'Dummy only',answers:{need:'Website'},requestId:id});
try{
 const savedOwnerHash=env.RECOVERY_OWNER_TOKEN_SHA256;delete env.RECOVERY_OWNER_TOKEN_SHA256;assert.equal((await request('config')).status,503);env.RECOVERY_OWNER_TOKEN_SHA256=savedOwnerHash;
 const c=await request('config');assert.equal(c.status,200);assert.equal(c.body.profile.intake_questions.length,1);assert.ok(!JSON.stringify(c).includes('dummy-secret'));
 assert.equal((await request('book',{method:'POST',data:input(),origin:'https://attacker.example'})).status,403);
 assert.equal((await request('admin')).status,401);
 assert.equal((await request('manage?token=forbidden-query-token')).status,404);
 const required=input();delete required.answers;assert.equal((await request('book',{method:'POST',data:required})).status,400);
 const invalid=input();invalid.answers.need='Invalid';assert.equal((await request('book',{method:'POST',data:invalid})).status,400);
 malformedBusy=true;assert.equal((await request(`slots?service=service&day=${day}`)).status,503);malformedBusy=false;
 failCalendar=true;assert.equal((await request(`slots?service=service&day=${day}`)).status,503);failCalendar=false;
 calendarBusy=[{start:new Date(recoveryTest.localInstant(day,'12:00',config.profile.timezone)).toISOString(),end:new Date(recoveryTest.localInstant(day,'12:30',config.profile.timezone)).toISOString()}];
 const availability=await request(`slots?service=service&day=${day}`);assert.equal(availability.status,200);assert.ok(!availability.body.slots.includes(input('11:30').startsAt));assert.ok(availability.body.slots.includes(input('10:00').startsAt));calendarBusy=[];
 const one=input();one.answers.need='Website\nApp';const two={...input('10:15'),email:'second@example.com'};
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
 // Email ambiguity is recorded and not blindly resent on booking retry.
 meetPending=false;mailTimeout=true;const later=input('16:00');later.email='later@example.com';const sent=await request('book',{method:'POST',data:later,ip:'192.0.2.3'});assert.equal(sent.status,201);assert.equal(sent.body.email_pending,true);assert.equal(sql.prepare("SELECT count(*) n FROM recovery_emails WHERE state='uncertain'").get().n,2);mailTimeout=false;
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
 const adminMail=await request('admin',{token:ownerToken});const queuedRow=adminMail.body.bookings.find(x=>x.id===queued.body.bookingId);assert.equal(queuedRow.email_pending,false);assert.equal(queuedRow.email_uncertain,false);assert.equal(queuedRow.email_queued,false);
 assert.equal(recoveryTest.localInstant('2027-03-14','02:30','America/New_York'),null);
 const futureConfig={...config,overrides:[{day,enabled:false}]};assert.deepEqual(recoveryTest.schedule(futureConfig,config.services[0],day,Date.now()),[]);
 // Confirm throttling prevents arbitrary unlimited email booking attempts.
 for(let i=0;i<9;i++)await request('book',{method:'POST',data:{...input('18:00'),email:'blocked'+i+'@example.com'},ip:'192.0.2.99'});
 const limited=await request('book',{method:'POST',data:{...input('19:00'),email:'limit@example.com'},ip:'192.0.2.99'});assert.equal(limited.status,429);
 console.log('Recovery backend: auth, intake, fresh availability, buffer/overlap, concurrent reservation, idempotency, provider retries, action leases, cancellation, email ambiguity, DST, and rate limits pass.');
} finally {globalThis.fetch=realFetch;sql.close();}
