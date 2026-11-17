import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleRecovery,recoveryTest} from '../scripts/recovery-backend.mjs';

const sql=new DatabaseSync(':memory:');
sql.exec(readFileSync(new URL('../recovery/schema.sql',import.meta.url),'utf8'));
const DB={prepare(query){return {bind(...args){const run=()=>({meta:{changes:sql.prepare(query).run(...args).changes}});return {run,async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};}};}};},async batch(statements){sql.exec('BEGIN');try{const result=statements.map(s=>s.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
const ownerId=crypto.randomUUID(),clientId=crypto.randomUUID(),otherId=crypto.randomUUID(),serviceId=crypto.randomUUID();
const config={profile:{id:ownerId,slug:'4u-digital',name:'4u Digital',headline:'Original headline',bio:'Original introduction',timezone:'America/New_York',booking_mode:'approval',published:true,intake_questions:[{id:'project-types',type:'short',label:'Project',required:false}],preserved:'profile-field'},services:[{id:serviceId,owner_id:ownerId,title:'Free consultation',description:'Environment description',duration:30,active:true,amount_cents:0,meeting_modes:['google_meet'],preserved:'service-field'}],availability:Array.from({length:7},(_,weekday)=>({id:'hours-'+weekday,owner_id:ownerId,weekday,start_time:'09:00',end_time:'20:00'})),preferences:{notice_hours:1,buffer_minutes:0,horizon_days:60,reminders:true},overrides:[{day:'2030-12-25',enabled:false,start_time:'09:00',end_time:'17:00'}]};
const privateKey='test-only-private-owner-key-longer-than-thirty-two-characters';
const env={RECOVERY_DB:DB,RECOVERY_CONFIG_JSON:JSON.stringify(config),RECOVERY_CAPABILITY_SECRET:'test-only-capability-secret-longer-than-thirty-two',RECOVERY_OWNER_TOKEN_SHA256:await recoveryTest.digest(privateKey),RECOVERY_OWNER_EMAIL:'admin@example.invalid',GOOGLE_CLIENT_ID:'dummy-client',GOOGLE_CLIENT_SECRET:'dummy-secret',GOOGLE_REFRESH_TOKEN:'dummy-refresh',BREVO_API_KEY:'dummy-mail',RECOVERY_SUPABASE_URL:'https://test-project.supabase.co',RECOVERY_SUPABASE_PUBLISHABLE_KEY:'dummy-public-key'};
const users=new Map([
 ['header.owner.signature',{id:ownerId,email:'admin@example.invalid'}],
 ['header.client.signature',{id:clientId,email:'  CLIENT@example.invalid  '}],
 ['header.other.signature',{id:otherId,email:'other@example.invalid',user_metadata:{role:'consultant',owner_id:ownerId,email:'admin@example.invalid'}}],
 ['header.unconfirmed.signature',{id:clientId,email:'client@example.invalid',unconfirmed:true}],
 ['header.anonymous.signature',{id:clientId,email:'client@example.invalid',is_anonymous:true}],
]);
let authMode='normal',authCalls=0,mailCount=0,requestNumber=0,onBusy=null;
const calls=[],calendar=new Map(),realFetch=globalThis.fetch;
globalThis.fetch=async(input,options={})=>{
 const url=new URL(String(input));calls.push({url:url.href,method:options.method||'GET'});
 if(url.hostname==='test-project.supabase.co'){
  authCalls++;assert.equal(url.pathname,'/auth/v1/user');assert.equal(options.headers.apikey,'dummy-public-key');assert.equal(options.redirect,'error');
  if(authMode==='offline')throw Error('Offline');
  if(authMode==='null')return Response.json(null);
  if(authMode==='unavailable')return new Response(null,{status:503});
  const user=users.get(options.headers.Authorization?.slice(7));
  if(!user)return new Response(null,{status:401});
  return Response.json({aud:'authenticated',email_confirmed_at:user.unconfirmed?null:'2026-01-01T00:00:00Z',...user});
 }
 if(url.hostname==='oauth2.googleapis.com')return Response.json({access_token:'dummy-access',expires_in:3600});
 if(url.hostname==='api.brevo.com')return url.pathname.endsWith('/email')?Response.json({messageId:`<mail-${++mailCount}@example.invalid>`},{status:201}):Response.json({events:[]});
 if(url.hostname==='www.googleapis.com'){
  if(url.pathname.endsWith('/freeBusy')){onBusy?.();return Response.json({calendars:{primary:{busy:[]}}});}
  const id=url.pathname.split('/').at(-1);
  if(options.method==='POST'&&id==='events'){const event=JSON.parse(options.body);event.status='confirmed';event.etag='"created"';event.conferenceData.entryPoints=[{entryPointType:'video',uri:'https://meet.google.com/abc-defg-hij'}];calendar.set(event.id,event);return Response.json(event,{status:201});}
  if(options.method==='PATCH'){const event=calendar.get(id);if(!event)return new Response(null,{status:404});if(options.headers['If-Match']!==event.etag)return new Response(null,{status:412});Object.assign(event,JSON.parse(options.body),{etag:'"updated"'});return Response.json(event);}
  if(options.method==='DELETE'){calendar.delete(id);return new Response(null,{status:204});}
  return calendar.has(id)?Response.json(calendar.get(id)):new Response(null,{status:404});
 }
 throw Error('Unexpected external request');
};
async function request(path,{method='GET',data,token='header.owner.signature',origin='https://briefbooth.com'}={}){
 const headers={'cf-connecting-ip':'192.0.2.'+(++requestNumber%250)};
 if(token)headers.Authorization='Bearer '+token;
 if(method==='POST'){headers.Origin=origin;if(data!==undefined)headers['Content-Type']='application/json';}
 const response=await handleRecovery(new Request('https://briefbooth.com/api/recovery/'+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),env);
 return {status:response.status,body:await response.json()};
}
const ownerConfig=()=>request('owner-config');
function edit(value){return {revision:value.revision,profile:Object.fromEntries(['name','headline','bio','timezone'].map(k=>[k,value.config.profile[k]])),services:value.config.services.map(s=>Object.fromEntries(['id','title','description','duration','active'].map(k=>[k,s[k]]))),availability:value.config.availability.map(a=>({weekday:a.weekday,start_time:a.start_time,end_time:a.end_time})),preferences:Object.fromEntries(['notice_hours','horizon_days','buffer_minutes'].map(k=>[k,value.config.preferences[k]]))};}
const save=data=>request('owner-config',{method:'POST',data});
const day=new Date(Date.now()+4*86400000).toISOString().slice(0,10);
const time=value=>new Date(recoveryTest.localInstant(day,value,config.profile.timezone)).toISOString();
async function fixture(email='client@example.invalid',source='recovery',status='cancelled',owner=ownerId){
 const id=crypto.randomUUID(),requestId=crypto.randomUUID(),token=id+'.'+'x'.repeat(43),now=Date.now(),starts=Date.now()+20*86400000;
 sql.prepare(`INSERT INTO recovery_bookings(id,owner_id,service_id,title,starts_ms,ends_ms,client_name,client_email,status,request_id,client_token_hash,source,created_ms,updated_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,owner,serviceId,'Existing consultation',starts,starts+30*60000,'Dummy client',email,status,requestId,await recoveryTest.digest(token),source,now,now);
 return {id,token};
}
try{
 // The migration is idempotent and leaves existing booking data alone.
 const beforeMigration=await fixture();
 sql.exec(readFileSync(new URL('../recovery/account-settings-migration.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../recovery/account-settings-migration.sql',import.meta.url),'utf8'));
 assert.equal(sql.prepare('SELECT status FROM recovery_bookings WHERE id=?').get(beforeMigration.id).status,'cancelled');
 assert.ok(sql.prepare("EXPLAIN QUERY PLAN SELECT * FROM recovery_bookings WHERE owner_id=? AND client_email=? AND source='recovery' ORDER BY created_ms DESC,id DESC LIMIT 101").all(ownerId,'client@example.invalid').some(row=>row.detail.includes('recovery_bookings_client_history')));

 // Concurrent first reads bootstrap once; saved settings win over later env edits.
 const first=await Promise.all([ownerConfig(),ownerConfig()]);assert.ok(first.every(r=>r.status===200&&r.body.revision===1));
 assert.equal(sql.prepare('SELECT count(*) n FROM recovery_configuration').get().n,1);
 assert.match(first[0].body.config.services[0].description,/businesses and people/);
 env.RECOVERY_CONFIG_JSON=JSON.stringify({...config,profile:{...config.profile,name:'Stale environment name'},availability:[]});
 assert.equal((await ownerConfig()).body.config.profile.name,'4u Digital');
 assert.equal((await ownerConfig()).body.config.availability.length,7);
 env.RECOVERY_CONFIG_JSON=JSON.stringify(config);

 // Session authority comes from Auth, never editable claims or request identity.
 const authBeforeKey=authCalls;assert.equal((await request('admin',{token:privateKey})).status,200);assert.equal(authCalls,authBeforeKey);
 assert.equal((await request('admin',{token:null})).status,401);
 assert.equal((await request('admin',{token:'header.forged.signature'})).status,401);
 assert.equal((await request('admin',{token:'header.other.signature'})).status,403);
 assert.equal((await request('owner-config',{token:'header.client.signature'})).status,403);
 assert.equal((await request('client-bookings',{token:'header.unconfirmed.signature'})).status,401);
 assert.equal((await request('client-bookings',{token:'header.anonymous.signature'})).status,401);
 authMode='null';assert.equal((await ownerConfig()).status,401);authMode='offline';assert.equal((await ownerConfig()).status,503);
 authMode='unavailable';assert.equal((await ownerConfig()).status,503);authMode='normal';
 const user=users.get('header.owner.signature');users.delete('header.owner.signature');assert.equal((await ownerConfig()).status,401);users.set('header.owner.signature',user);
 assert.ok(!JSON.stringify(first[0].body).includes(privateKey));assert.ok(!JSON.stringify(first[0].body).includes('dummy-refresh'));
 assert.deepEqual(first[0].body.calendar,{configured:true,provider:'google_meet'});

 // Client history is bounded and email-scoped, without exporting capabilities.
 const wrong=await fixture('other@example.invalid'),legacy=await fixture('client@example.invalid','supabase'),foreign=await fixture('client@example.invalid','recovery','cancelled',otherId);
 for(let n=0;n<102;n++)await fixture();
 const page=await request('client-bookings',{token:'header.client.signature'});assert.equal(page.status,200);assert.equal(page.body.bookings.length,100);assert.ok(page.body.next_cursor);
 const second=await request('client-bookings?cursor='+encodeURIComponent(page.body.next_cursor),{token:'header.client.signature'});
 const listed=[...page.body.bookings,...second.body.bookings];assert.equal(listed.length,103);assert.equal(new Set(listed.map(b=>b.id)).size,103);
 assert.ok(!listed.some(b=>[wrong.id,legacy.id,foreign.id].includes(b.id)));assert.ok(listed.every(b=>!('token' in b)&&!('client_token_hash' in b)&&!('client_email' in b)));
 assert.equal((await request('client-bookings?cursor=invalid',{token:'header.client.signature'})).status,400);
 assert.equal((await request('client-bookings?email=other@example.invalid',{token:'header.client.signature'})).body.bookings.length,100);
 assert.equal((await request('manage?bookingId='+wrong.id,{token:'header.client.signature'})).status,404);
 assert.equal((await request('manage?bookingId='+legacy.id,{token:'header.client.signature'})).status,404);
 assert.equal((await request('manage?bookingId='+foreign.id,{token:'header.client.signature'})).status,404);
 assert.equal((await request('manage?bookingId='+beforeMigration.id,{token:privateKey})).status,401);
 assert.equal((await request('manage?bookingId='+beforeMigration.id,{token:'header.client.signature'})).status,200);
 assert.equal((await request('manage',{token:beforeMigration.token})).status,200);
 const pending=await fixture('client@example.invalid','recovery','pending_approval');
 assert.equal((await request('cancel',{method:'POST',token:'header.other.signature',data:{bookingId:pending.id}})).status,404);
 assert.equal((await request('cancel',{method:'POST',token:'header.client.signature',data:{bookingId:pending.id},origin:'https://evil.invalid'})).status,403);
 assert.equal((await request('cancel',{method:'POST',token:'header.client.signature',data:{bookingId:pending.id}})).body.booking.status,'cancelled');
 assert.equal((await request('manage',{token:pending.token})).body.booking.status,'cancelled');

 const snapshot=await ownerConfig(),draft=edit(snapshot.body);
 // Every uneditable identity/payment/connection field is rejected or preserved.
 for(const malicious of [
  {...draft,owner_id:otherId},
  {...draft,profile:{...draft.profile,id:otherId}},
  {...draft,profile:{...draft.profile,booking_mode:'instant'}},
  {...draft,services:[{...draft.services[0],amount_cents:100}]},
  {...draft,services:[{...draft.services[0],meeting_modes:['zoom']}]},
  {...draft,services:[{...draft.services[0],id:crypto.randomUUID()}]},
  {...draft,services:[]},
  {...draft,availability:[{weekday:1,start_time:'17:00',end_time:'09:00'}]},
  {...draft,availability:[{weekday:1,start_time:['09:00'],end_time:'17:00'}]},
  {...draft,availability:[draft.availability[0],draft.availability[0]]},
  {...draft,preferences:{...draft.preferences,buffer_minutes:121}},
  {...draft,profile:{...draft.profile,timezone:'Not/A_Zone'}},
  {...draft,services:[{...draft.services[0],duration:0}]},
  {...draft,services:[{...draft.services[0],title:'Header\ninjection'}]},
 ])assert.equal((await save(malicious)).status,400);
 assert.equal((await request('owner-config',{method:'POST',data:draft,token:'header.client.signature'})).status,403);
 assert.equal((await request('owner-config',{method:'POST',data:draft,origin:'https://evil.invalid'})).status,403);
 assert.equal((await ownerConfig()).body.revision,snapshot.body.revision);

 const originalBooking=sql.prepare('SELECT starts_ms,ends_ms,title FROM recovery_bookings WHERE id=?').get(beforeMigration.id);
 draft.profile.bio='The saved public introduction.';draft.services[0].description='The saved consultation description.';draft.services[0].duration=60;
 draft.availability=draft.availability.map(a=>({...a,start_time:'12:00',end_time:'18:00'}));
 const concurrent=await Promise.all([save(draft),save({...draft,profile:{...draft.profile,name:'Concurrent window'}})]);
 assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
 const saved=await ownerConfig();assert.equal(saved.body.revision,2);assert.equal(saved.body.config.profile.preserved,'profile-field');assert.equal(saved.body.config.services[0].preserved,'service-field');
 assert.deepEqual(saved.body.config.overrides,config.overrides);assert.deepEqual(saved.body.config.profile.intake_questions,config.profile.intake_questions);
 assert.equal(saved.body.config.profile.id,ownerId);assert.equal(saved.body.config.profile.slug,'4u-digital');assert.equal(saved.body.config.profile.booking_mode,'approval');assert.equal(saved.body.config.preferences.reminders,true);
 assert.equal(saved.body.config.availability[0].id,'hours-0');assert.equal(saved.body.config.availability[0].owner_id,ownerId);
 assert.deepEqual(sql.prepare('SELECT starts_ms,ends_ms,title FROM recovery_bookings WHERE id=?').get(beforeMigration.id),originalBooking);
 const publicConfig=await request('config',{token:null});assert.equal(publicConfig.body.revision,saved.body.revision);assert.equal(publicConfig.body.profile.bio,draft.profile.bio);assert.equal(publicConfig.body.services[0].description,draft.services[0].description);
 const slots=await request('slots?service='+serviceId+'&day='+day,{token:null});assert.ok(slots.body.slots.includes(time('12:00')));assert.ok(!slots.body.slots.includes(time('09:00')));assert.ok(!slots.body.slots.includes(time('17:30')));

 // A settings update during Google's availability lookup cannot insert a booking
 // against the stale rules, even if the browser used an earlier available slot.
 const booking={configRevision:publicConfig.body.revision,serviceId,startsAt:time('13:00'),name:'Dummy request',email:'new@example.invalid',requestId:crypto.randomUUID()};
 // A browser opened before the duration edit must reload before it can book.
 for(const configRevision of [undefined,1,'2']){const stale=await request('book',{method:'POST',data:{...booking,configRevision},token:null});assert.equal(stale.status,409);assert.equal(stale.body.code,'config_changed');}
 assert.equal(sql.prepare('SELECT count(*) n FROM recovery_bookings WHERE request_id=?').get(booking.requestId).n,0);
 onBusy=()=>{sql.prepare('UPDATE recovery_configuration SET revision=revision+1 WHERE owner_id=?').run(ownerId);onBusy=null;};
 const raced=await request('book',{method:'POST',data:booking,token:null});assert.equal(raced.status,409);assert.equal(raced.body.code,'config_changed');
 assert.equal(sql.prepare('SELECT count(*) n FROM recovery_bookings WHERE request_id=?').get(booking.requestId).n,0);
 booking.configRevision=(await request('config',{token:null})).body.revision;
 const booked=await request('book',{method:'POST',data:booking,token:null});assert.equal(booked.status,201);
 assert.match(sql.prepare("SELECT body FROM recovery_emails WHERE booking_id=? AND kind='request_owner'").get(booked.body.bookingId).body,/https:\/\/briefbooth.com\/studio\/\nSign in/);
 assert.equal((await request('review',{method:'POST',data:{bookingId:booked.body.bookingId,approve:true}})).body.booking.status,'confirmed');
 const clientUser=users.get('header.client.signature');users.set('header.client.signature',{...clientUser,email:'new@example.invalid'});
 assert.equal((await request('manage?bookingId='+booked.body.bookingId,{token:'header.client.signature'})).body.booking.meeting_url,'https://meet.google.com/abc-defg-hij');
 users.set('header.client.signature',clientUser);
 const recorded=sql.prepare('SELECT ends_ms-starts_ms duration FROM recovery_bookings WHERE id=?').get(booked.body.bookingId);assert.equal(recorded.duration,60*60000);
 const hide=edit((await ownerConfig()).body);hide.services[0].active=false;assert.equal((await save(hide)).status,200);
 assert.equal((await request('config',{token:null})).body.services.length,0);
 assert.equal((await request('book',{method:'POST',data:{...booking,configRevision:hide.revision+1,requestId:crypto.randomUUID()},token:null})).status,404);
 const repeat=await request('book',{method:'POST',data:booking,token:null});assert.equal(repeat.status,200);assert.equal(repeat.body.token,booked.body.token);
 assert.equal((await request('manage',{token:booked.body.token})).body.booking.id,booked.body.bookingId);
 // Existing appointments retain their duration even if the service changes or
 // is hidden; authenticated owners can still safely move/cancel those records.
 const shorter=await fixture('client@example.invalid','recovery','confirmed');
 const old=sql.prepare('SELECT * FROM recovery_bookings WHERE id=?').get(shorter.id),eventId='bb'+shorter.id.replaceAll('-','');
 sql.prepare('UPDATE recovery_bookings SET event_id=?,meeting_url=? WHERE id=?').run(eventId,'https://meet.google.com/abc-defg-hij',shorter.id);
 calendar.set(eventId,{id:eventId,status:'confirmed',etag:'"before"',start:{dateTime:new Date(old.starts_ms).toISOString()},end:{dateTime:new Date(old.ends_ms).toISOString()},extendedProperties:{private:{briefbooth_booking_id:shorter.id}},conferenceData:{entryPoints:[{entryPointType:'video',uri:'https://meet.google.com/abc-defg-hij'}]}});
 const movable=await request('reschedule-slots?bookingId='+shorter.id+'&day='+day);assert.equal(movable.status,200);assert.ok(movable.body.slots.includes(time('17:30')));
 onBusy=()=>{sql.prepare('UPDATE recovery_configuration SET revision=revision+1 WHERE owner_id=?').run(ownerId);onBusy=null;};
 const change={bookingId:shorter.id,operationId:crypto.randomUUID(),startsAt:time('17:30')};
 assert.equal((await request('reschedule',{method:'POST',data:change})).status,409);assert.equal(sql.prepare('SELECT count(*) n FROM recovery_reschedule_operations WHERE booking_id=?').get(shorter.id).n,0);
 const moved=await request('reschedule',{method:'POST',data:change});assert.equal(moved.status,200);assert.equal(Date.parse(moved.body.booking.ends_at)-Date.parse(moved.body.booking.starts_at),30*60000);
 assert.equal(moved.body.booking.meeting_url,'https://meet.google.com/abc-defg-hij');
 assert.equal((await request('review',{method:'POST',data:{bookingId:shorter.id,approve:false}})).body.booking.status,'cancelled');assert.equal(calendar.has(eventId),false);
 assert.ok(calls.filter(c=>c.url.includes('supabase.co')).every(c=>c.method==='GET'&&new URL(c.url).pathname==='/auth/v1/user'),'No legacy data writes or privileged Auth calls');
 console.log('Recovery accounts/settings: verified session ownership, private-key fallback, verified client history/cancellation, guest links, safe one-time config seed, optimistic edits, immutable/free fields, availability updates and concurrent settings/booking protection pass.');
}finally{globalThis.fetch=realFetch;sql.close();}
