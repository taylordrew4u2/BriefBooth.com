import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleRecovery, recoveryTest } from '../scripts/recovery-backend.mjs';

const realNow=Date.now,realFetch=globalThis.fetch;
const start=Date.parse('2027-01-04T10:00:00Z');
const ownerKey='audit-only-owner-key-with-more-than-thirty-two-characters';
let current;
Date.now=()=>current.now;
globalThis.fetch=async(input,options={})=>{
 const f=current,url=new URL(input);
 if(url.hostname==='oauth2.googleapis.com')return Response.json({access_token:'dummy',expires_in:3600});
 if(url.hostname==='api.brevo.com'){
  if(options.method==='POST'){f.mail.push(JSON.parse(options.body));return Response.json({messageId:`<fixture-${f.mail.length}@example.invalid>`},{status:201});}
  return Response.json({events:[]});
 }
 assert.equal(url.hostname,'www.googleapis.com','All external requests are mocked');
 if(url.pathname.endsWith('/freeBusy')){f.onBusy?.();return Response.json({calendars:{primary:{busy:[]}}});}
 const id=url.pathname.split('/').at(-1);
 if(options.method==='POST'){
  f.creates++;const event=JSON.parse(options.body);event.status='confirmed';event.conferenceData.entryPoints=[{entryPointType:'video',uri:'https://meet.google.com/abc-defg-hij'}];f.pendingEvent=event;
  if(f.createMode!=='lost-before')f.events.set(event.id,event);
  if(f.createMode.startsWith('lost'))throw Error('Ambiguous creation response');
  return Response.json(event,{status:201});
 }
 if(options.method==='DELETE'){f.deletes++;f.events.delete(id);if(f.deleteLost)throw Error('Deletion response lost');return new Response(null,{status:204});}
 if(f.checkFailure)throw Error('Provider lookup unavailable');
 return f.events.has(id)?Response.json(f.events.get(id)):new Response(null,{status:404});
};
async function fixture(notice=0){
 current?.sql.close();const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../recovery/schema.sql',import.meta.url),'utf8'));
 const f={sql,now:start-1000,events:new Map(),mail:[],creates:0,deletes:0,createMode:'normal',ip:0};current=f;
 const db={prepare(query){return {bind(...args){return {run(){return {meta:{changes:sql.prepare(query).run(...args).changes}};},async first(){const row=sql.prepare(query).get(...args)||null;if(query.startsWith('UPDATE recovery_bookings SET status=')&&args[0]==='confirming')f.afterMarked?.();return row;},async all(){return {results:sql.prepare(query).all(...args)};}};}};},async batch(statements){sql.exec('BEGIN');try{const rows=statements.map(s=>s.run());sql.exec('COMMIT');return rows;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const config={profile:{id:'owner',slug:'4u-digital',name:'4u Digital',timezone:'UTC',booking_mode:'approval'},services:[{id:'service',title:'Test consultation',duration:30,active:true,amount_cents:0,meeting_modes:['google_meet']}],availability:Array.from({length:7},(_,weekday)=>({weekday,start_time:'09:00',end_time:'20:00'})),preferences:{notice_hours:notice,horizon_days:60,buffer_minutes:0}};
 f.env={RECOVERY_DB:db,RECOVERY_CONFIG_JSON:JSON.stringify(config),RECOVERY_CAPABILITY_SECRET:'audit-only-capability-secret-over-thirty-two-characters',RECOVERY_OWNER_TOKEN_SHA256:await recoveryTest.digest(ownerKey),RECOVERY_OWNER_EMAIL:'owner@example.invalid',GOOGLE_CLIENT_ID:'dummy-client',GOOGLE_CLIENT_SECRET:'dummy-secret',GOOGLE_REFRESH_TOKEN:'dummy-refresh',BREVO_API_KEY:'dummy-mail'};
 return f;
}
async function call(path,data,token=ownerKey){
 const headers={Origin:'https://briefbooth.com','Content-Type':'application/json','cf-connecting-ip':'192.0.2.'+(++current.ip)};if(token)headers.Authorization='Bearer '+token;
 const response=await handleRecovery(new Request('https://briefbooth.com/api/recovery/'+path,{method:'POST',headers,body:data===undefined?undefined:JSON.stringify(data)}),current.env);
 return {status:response.status,body:await response.json()};
}
const book=(starts=start)=>call('book',{configRevision:1,serviceId:'service',startsAt:new Date(starts).toISOString(),name:'Fixture client',email:'client@example.invalid',requestId:crypto.randomUUID()},null);
const approve=id=>call('review',{bookingId:id,approve:true});
const cancel=id=>call('review',{bookingId:id,approve:false});
const row=id=>current.sql.prepare('SELECT * FROM recovery_bookings WHERE id=?').get(id);
try{
 // Neither a slot's start nor the configured notice boundary may pass while
 // availability is checked. No reservation or notification may be created.
 for(const notice of [0,1]){
  const f=await fixture(notice);f.onBusy=()=>{f.now=start+1000;};
  assert.equal((await book(start+notice*3600000)).status,409);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM recovery_bookings').get().n,0);assert.equal(f.mail.length,0);assert.equal(f.creates,0);
 }
 // Approval also rechecks after provider waits, including after writing its
 // fresh creation marker. A create not yet dispatched is never ambiguous.
 for(const stage of ['busy','marked']){
  const f=await fixture(),b=await book();assert.equal(b.status,201);
  if(stage==='busy')f.onBusy=()=>{f.now=start+1000;};else f.afterMarked=()=>{f.now=start+1000;};
  assert.equal((await approve(b.body.bookingId)).status,409);assert.equal(row(b.body.bookingId).status,'pending_approval');assert.equal(row(b.body.bookingId).event_id,null);assert.equal(f.creates,0);assert.equal(f.mail.length,2);
 }
 // Reconciliation after the start may acknowledge an already-created,
 // correctly owned event without issuing another create or changing its ID.
 {
  const f=await fixture(),b=await book();f.createMode='lost-after';assert.equal((await approve(b.body.bookingId)).status,503);
  const originalId=row(b.body.bookingId).event_id;f.now=start+1000;f.createMode='normal';
  const ready=await approve(b.body.bookingId);assert.equal(ready.status,200);assert.equal(ready.body.booking.status,'confirmed');assert.equal(f.creates,1);assert.equal(row(b.body.bookingId).event_id,originalId);
  assert.equal((await cancel(b.body.bookingId)).status,409,'New owner cancellation of a past confirmed appointment is still prohibited');
  assert.equal((await call('cancel',undefined,b.body.token)).status,409);assert.equal(f.events.size,1);
 }
 // An absent event after an ambiguous creation is not proof that it will never
 // arrive. Do not create after start or release its deterministic reservation.
 {
  const f=await fixture(),b=await book();f.createMode='lost-before';assert.equal((await approve(b.body.bookingId)).status,503);
  const originalId=row(b.body.bookingId).event_id;f.now=start+1000;f.createMode='normal';
  const pending=await approve(b.body.bookingId);assert.equal(pending.status,202);assert.equal(pending.body.booking.status,'confirming');assert.equal(f.creates,1);assert.equal(f.events.size,0);
  assert.equal((await call('cancel',undefined,b.body.token)).status,409,'Only owner cleanup may begin after start');
  f.checkFailure=true;assert.equal((await cancel(b.body.bookingId)).status,503);assert.equal(row(b.body.bookingId).status,'cancelling');assert.equal(row(b.body.bookingId).event_id,originalId);
  f.checkFailure=false;assert.equal((await cancel(b.body.bookingId)).status,202);assert.equal(row(b.body.bookingId).status,'cancelling');assert.equal(f.deletes,0);
  f.events.set(f.pendingEvent.id,f.pendingEvent);assert.equal((await cancel(b.body.bookingId)).body.booking.status,'cancelled');assert.equal(f.events.size,0);assert.equal(f.creates,1);assert.equal(f.deletes,1);
 }
 // A cancellation authorized before start remains retryable afterward, both
 // after a failed lookup and a lost successful-delete response.
 for(const failure of ['lookup','delete']){
  const f=await fixture(),b=await book();assert.equal((await approve(b.body.bookingId)).status,200);
  if(failure==='lookup')f.checkFailure=true;else f.deleteLost=true;
  assert.equal((await call('cancel',undefined,b.body.token)).status,503);assert.equal(row(b.body.bookingId).status,'cancelling');
  f.now=start+1000;f.checkFailure=false;f.deleteLost=false;
  const done=await call('cancel',undefined,b.body.token);assert.equal(done.status,200);assert.equal(done.body.booking.status,'cancelled');assert.equal(f.events.size,0);assert.equal(f.deletes,1);
  const notices=f.mail.length;assert.equal((await cancel(b.body.bookingId)).status,200);assert.equal(f.mail.length,notices);
 }
 console.log('Recovery clock boundaries: fresh reservation/approval cutoffs, late same-event confirmation, absent-event ambiguity, owner-only uncertain cleanup, and late cancellation reconciliation pass.');
}finally{Date.now=realNow;globalThis.fetch=realFetch;current?.sql.close();}
