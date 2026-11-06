import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

// Real PostgreSQL permissions, locking, queue and worker logic, with a local HTTP
// recording stub. No real provider, key, client address, booking, or network is used.
const db = new PGlite();
await db.exec(`
 create role anon; create role authenticated; create role service_role;
 create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to anon,authenticated,service_role;
 create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,slug text unique,name text);
 create table public.bookings(id uuid primary key default gen_random_uuid(),owner_id uuid references public.profiles(id) on delete cascade,client_name text,client_email text,status text default 'pending_approval');
 alter table public.bookings enable row level security;
 create policy owner_bookings on public.bookings for select to authenticated using(owner_id=auth.uid());
 grant select on public.bookings to authenticated;
 create schema briefbooth_private;
 create table briefbooth_private.booking_emails(id uuid primary key default gen_random_uuid(),accepted_at timestamptz,status text default 'pending');
 create function briefbooth_private.send_booking_emails() returns void language sql as $$select null::void$$;
 create schema four_u_private;
 create table four_u_private.project_briefs(id uuid primary key default gen_random_uuid(),accepted_at timestamptz,status text default 'pending');
 create function four_u_private.send_project_briefs(uuid default null) returns void language sql as $$select null::void$$;
 create schema vault;
 create table vault.decrypted_secrets(name text,decrypted_secret text);
 create schema extensions;
 create type extensions.http_header as (field text,value text);
 create function extensions.http_header(text,text) returns extensions.http_header language sql as $$select row($1,$2)::extensions.http_header$$;
 create type extensions.http_request as (method text,uri text,headers extensions.http_header[],content_type text,content text);
 create type extensions.http_response as (status int,content_type text,headers extensions.http_header[],content text);
 create function extensions.http_set_curlopt(text,text) returns boolean language sql as $$select true$$;
 create table public.test_email_requests(payload jsonb,uri text);
 create function extensions.http(req extensions.http_request) returns extensions.http_response language plpgsql as $$
 begin
  insert into public.test_email_requests values(req.content::jsonb,req.uri);
  if current_setting('test.http',true)='timeout' then raise exception 'private test timeout detail'; end if;
  return row(coalesce(nullif(current_setting('test.http',true),'')::int,201),'application/json',null,
   coalesce(nullif(current_setting('test.http_body',true),''),'0')::text)::extensions.http_response;
 end; $$;
 create schema cron;
 create table cron.jobs(id int generated always as identity,jobname text,schedule text,command text);
 create function cron.schedule(text,text,text) returns int language sql as $$insert into cron.jobs(jobname,schedule,command) values($1,$2,$3) returning id$$;
`);
const owner = 'adc53778-f007-4c58-bd47-ba7a675abb29';
const other = '00000000-0000-4000-8000-000000000002';
const clientUser = '00000000-0000-4000-8000-000000000003';
await db.query(`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ($1,'owner@example.test',now(),'{}'),($2,'other@example.test',now(),'{}'),($3,'client-auth@example.test',now(),'{"account_type":"client"}')`, [owner,other,clientUser]);
await db.query("insert into public.profiles values($1,'4u-digital','4u Digital'),($2,'other-consultant','Another consultant')",[owner,other]);
await db.exec(readFileSync('supabase/migrations/20261023200000_account_roles.sql','utf8'));
const originalWorkers = (await db.query(`select pg_get_functiondef('briefbooth_private.send_booking_emails()'::regprocedure) booking,pg_get_functiondef('four_u_private.send_project_briefs(uuid)'::regprocedure) brief`)).rows[0];
const migration = readFileSync('supabase/migrations/20261023201000_project_planner_emails.sql','utf8');
await db.exec(migration);
const plannerBeforeLock = (await db.query("select pg_get_functiondef('four_u_private.send_planner_emails()'::regprocedure) fn")).rows[0].fn;
const lockMigration = readFileSync('supabase/migrations/20261023201500_planner_worker_lock.sql','utf8');
await db.exec(lockMigration);
const plannerAfterLock = (await db.query("select pg_get_functiondef('four_u_private.send_planner_emails()'::regprocedure) fn")).rows[0].fn;
assert(plannerBeforeLock.includes('pg_try_advisory_xact_lock(492483717)'));
assert(!plannerAfterLock.includes('pg_try_advisory_xact_lock(492483717)'));
assert(plannerAfterLock.includes('pg_advisory_xact_lock(492483717)'));
assert(plannerAfterLock.includes("set_config('lock_timeout','10s',true)"));
await assert.rejects(()=>db.exec(lockMigration),/Planner worker lock guard changed/,'Repeated or unexpected function patch fails closed');
const currentWorkers = (await db.query(`select pg_get_functiondef('briefbooth_private.send_booking_emails()'::regprocedure) booking,pg_get_functiondef('four_u_private.send_project_briefs(uuid)'::regprocedure) brief`)).rows[0];
assert.deepEqual(currentWorkers,originalWorkers,'Existing provider workers are byte-for-byte unchanged');
assert.deepEqual((await db.query('select jobname,schedule from cron.jobs order by id')).rows,[
 {jobname:'4u-digital-planner-emails',schedule:'* * * * *'},
 {jobname:'4u-digital-planner-email-retention',schedule:'23 * * * *'},
]);
const request = (n) => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function as(user, callback, role='authenticated') {
 await db.exec('reset role');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user || '']);
 await db.exec(`set role ${role}`);
 try { return await callback(); } finally { await db.exec('reset role'); }
}
const book = async (email='client@example.test',bookingOwner=owner,name='Client <img src=x onerror="alert(1)">') => (await db.query('insert into public.bookings(owner_id,client_name,client_email) values($1,$2,$3) returning id',[bookingOwner,name,email])).rows[0].id;
const send = (booking,id) => db.query('select public.send_4u_project_planner($1,$2) result',[booking,id]).then(r=>r.rows[0].result);
const status = (booking) => db.query('select public.get_4u_project_planner_status($1) result',[booking]).then(r=>r.rows[0].result);
const rows = async () => (await db.query('select * from four_u_private.planner_emails order by created_at,id')).rows;
const count = async () => Number((await db.query('select count(*) n from four_u_private.planner_emails')).rows[0].n);
const providerCalls = async () => (await db.query('select * from public.test_email_requests')).rows;
async function provider(code=201,body=JSON.stringify({messageId:'<test-message@example.test>'})) {
 await db.query("select set_config('test.http',$1,false),set_config('test.http_body',$2,false)",[String(code),body]);
}
async function clearQueue() {
 await db.exec('delete from four_u_private.planner_emails; delete from public.test_email_requests; delete from briefbooth_private.booking_emails; delete from four_u_private.project_briefs;');
 await provider();
}
const a = await book(); const sameClient = await book('CLIENT@example.test'); const b = await book('second@example.test'); const otherBooking = await book('other-client@example.test',other);
for (const role of ['anon','authenticated','service_role']) {
 const direct = (await db.query("select has_schema_privilege($1,'four_u_private','USAGE') allowed",[role])).rows[0].allowed;
 assert.equal(direct,false,`${role} has no private schema usage`);
 await as(owner,()=>assert.rejects(()=>db.query('select * from four_u_private.planner_emails'),/permission denied/),role);
}
assert.equal((await db.query("select has_function_privilege('anon','public.send_4u_project_planner(uuid,uuid)','EXECUTE') allowed")).rows[0].allowed,false);
assert.equal((await db.query("select has_function_privilege('authenticated','public.send_4u_project_planner(uuid,uuid)','EXECUTE') allowed")).rows[0].allowed,true);
for (const user of [null,other,clientUser]) {
 await as(user,()=>assert.rejects(()=>send(a,request(1)),/Only the verified 4u Digital/));
 await as(user,()=>assert.rejects(()=>status(a),/Only the verified 4u Digital/));
}
await as(owner,()=>assert.rejects(()=>send(a,request(1)),/permission denied/),'anon');
await db.query('update auth.users set email_confirmed_at=null where id=$1',[owner]);
await as(owner,()=>assert.rejects(()=>send(a,request(1)),/Only the verified/));
await db.query('update auth.users set email_confirmed_at=now() where id=$1',[owner]);
await db.query("update briefbooth_private.account_roles set role='client' where user_id=$1",[owner]);
await as(owner,()=>assert.rejects(()=>send(a,request(1)),/Only the verified/));
await db.query("update briefbooth_private.account_roles set role='consultant' where user_id=$1",[owner]);
for (const booking of [otherBooking,request(999)]) {
 await as(owner,()=>assert.rejects(()=>send(booking,request(1)),/Booking not found or you do not have access/));
 await as(owner,()=>assert.rejects(()=>status(booking),/Booking not found or you do not have access/));
}
for (const [booking,id] of [[null,request(1)],[a,null],[a,'10000000-0000-1000-8000-000000000001'],[a,'not-a-uuid']]) {
 await as(owner,()=>assert.rejects(()=>send(booking,id),/Choose a client booking|valid reference|invalid input syntax/));
}
assert.equal(await count(),0,'Authorization and malformed requests create no queue rows');
const notSent = await as(owner,()=>status(a)); assert.equal(notSent.status,'not_sent'); assert.equal(notSent.can_send,true);
const initial = await as(owner,()=>send(a,request(1)));
assert.equal(initial.status,'pending'); assert.equal(initial.recipient,'client@example.test'); assert.equal(initial.can_send,false);
assert.equal((await providerCalls()).length,0,'Authenticated RPC only queues, with no provider request in its transaction');
assert.deepEqual(await as(owner,()=>send(a,request(1))),initial,'Same request replays without inserting or dispatching');
assert.equal(await count(),1);
await as(owner,()=>assert.rejects(()=>send(b,request(1)),/different client or booking/));
await as(owner,()=>assert.rejects(()=>send(sameClient,request(2)),/already queued/));
assert.equal((await as(owner,()=>status(sameClient))).request_id,request(1),'Cooldown is client-recipient-wide across owned bookings');
await db.exec("insert into vault.decrypted_secrets values('briefbooth_brevo_api_key','test-only-never-a-real-key')");
await provider(); await db.query('select four_u_private.send_planner_emails()');
const accepted = await as(owner,()=>status(a)); assert.equal(accepted.status,'accepted'); assert.equal(accepted.can_send,false); assert(accepted.accepted_at);
assert.equal((new Date(accepted.cooldown_until)-new Date(accepted.accepted_at))/3600000,24);
assert.equal((await rows())[0].attempts,1);
const call = (await providerCalls())[0]; assert.equal(call.uri,'https://api.brevo.com/v3/smtp/email');
const payload = call.payload;
assert.deepEqual(payload.sender,{name:'4u Digital',email:'admin@customtechbuilt4u.com'});
assert.deepEqual(payload.replyTo,payload.sender); assert.deepEqual(payload.to,[{email:'client@example.test'}]);
assert.equal(payload.subject,'Your 4u Digital project planner');
assert.equal(payload.headers.idempotencyKey,request(1)); assert.deepEqual(payload.tags,['4u-digital','project-planner']);
assert(payload.textContent.includes('https://customtechbuilt4u.com/project-brief/'));
assert(payload.htmlContent.includes('href="https://customtechbuilt4u.com/project-brief/"'));
for (const key of ['cc','bcc','attachment','templateId']) assert.equal(payload[key],undefined);
assert(!payload.htmlContent.includes('<img')); assert(!payload.htmlContent.includes('Client '),'Client-controlled names never become HTML or headers');
const textParagraphs = payload.textContent.split('\n\n');
for (const paragraph of textParagraphs) assert(payload.htmlContent.includes(paragraph),'Every plain-text paragraph is present in HTML');
await db.query('select four_u_private.send_planner_emails()');
assert.equal((await providerCalls()).length,1,'Accepted notification is never automatically sent twice');
const replay = await as(owner,()=>send(a,request(1))); assert.equal(replay.status,'accepted');
await as(owner,()=>assert.rejects(()=>send(sameClient,request(3)),/Wait 24 hours/));
await db.query("update four_u_private.planner_emails set created_at=now()-interval '3 days' where id=$1",[request(1)]);
await as(owner,()=>assert.rejects(()=>send(a,request(3)),/Wait 24 hours/,'Cooldown starts at provider acceptance, not old queue time'));
await db.query("update four_u_private.planner_emails set accepted_at=now()-interval '25 hours' where id=$1",[request(1)]);
assert.equal((await as(owner,()=>status(a))).can_send,true);
await as(owner,()=>send(a,request(3))); assert.equal(await count(),2);
// Mutating the original recipient cannot redirect an idempotent replay or queued mail.
await db.query("update public.bookings set client_email='changed@example.test' where id=$1",[a]);
await as(owner,()=>assert.rejects(()=>send(a,request(3)),/different client or booking/));
await db.query('select four_u_private.send_planner_emails()');
assert.equal((await rows()).find(r=>r.id===request(3)).status,'failed');
assert.equal((await providerCalls()).length,1);
await clearQueue();

for (const bad of ['client@example.test\r\nBcc: outside@example.test','client@example.test\u0001','client@example.test,other@example.test','a..b@example.test','.a@example.test','bad']) {
 const invalidBooking = await book(bad);
 await as(owner,()=>assert.rejects(()=>send(invalidBooking,request(50)),/valid client email/));
}
assert.equal(await count(),0,'Malformed booking addresses cannot create provider payloads');
// PGlite serializes DB transactions; issuing both requests together still exercises
// the actual SQL guard and UUID/cooldown lock rather than a JavaScript dedupe mock.
const raceBooking = await book('race@example.test');
const race = await as(owner,()=>Promise.allSettled([send(raceBooking,request(60)),send(raceBooking,request(61))]));
assert.equal(race.filter(r=>r.status==='fulfilled').length,1); assert.equal(await count(),1);
await clearQueue();
for (let i=0;i<10;i++) { const dailyBooking=await book(`daily-${i}@example.test`); await as(owner,()=>send(dailyBooking,request(100+i))); }
await as(owner,async()=>assert.rejects(()=>send(b,request(111)),/free planner email limit/)); assert.equal(await count(),10);
const cappedNew = await as(owner,()=>status(b));
assert.equal(cappedNew.status,'not_sent'); assert.equal(cappedNew.can_send,false); assert.match(cappedNew.last_error,/free planner email limit/);
const nextUtcDay = (await db.query("select (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')+interval '1 day' next_day")).rows[0].next_day;
assert.equal(new Date(cappedNew.cooldown_until).getTime(),new Date(nextUtcDay).getTime(),'Global cap advertises the next UTC allowance window');
const eligibleBooking = await book('older-accepted@example.test');
await db.query(`insert into four_u_private.planner_emails(id,owner_id,booking_id,recipient,status,created_at,accepted_at)
 values($1,$2,$3,'older-accepted@example.test','accepted',now()-interval '3 days',now()-interval '25 hours')`,[request(112),owner,eligibleBooking]);
const cappedEligible = await as(owner,()=>status(eligibleBooking)); assert.equal(cappedEligible.status,'accepted'); assert.equal(cappedEligible.can_send,false); assert.match(cappedEligible.last_error,/free planner email limit/);
assert.equal(new Date(cappedEligible.cooldown_until).getTime(),new Date(nextUtcDay).getTime());
// Simulate crossing the UTC boundary by aging this day's queue cohort into the
// previous window; no fake clock or production date is changed.
await db.query("update four_u_private.planner_emails set created_at=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')-interval '1 day' where status='pending'");
const nextWindowNew=await as(owner,()=>status(b)); assert.equal(nextWindowNew.can_send,true); assert.equal(nextWindowNew.cooldown_until,null); assert.equal(nextWindowNew.last_error,undefined);
const nextWindowEligible=await as(owner,()=>status(eligibleBooking)); assert.equal(nextWindowEligible.can_send,true); assert.equal(nextWindowEligible.last_error,null);
await clearQueue();

// Run the actual patched worker with a local integer-overload test adapter. The
// production PostgreSQL bigint lock remains untouched. Successful acquisition
// delegates to the real advisory lock; a simulated 55P03 exercises the timeout
// exception path without pretending PGlite is a cross-session concurrency test.
await clearQueue();
await db.exec(`
 create function pg_catalog.pg_advisory_xact_lock(lock_id integer) returns void language plpgsql as $$
 begin
  if lock_id=492483717 then
   if current_setting('lock_timeout')<>'10s' then raise exception 'Expected bounded planner lock timeout'; end if;
   if current_setting('test.planner_lock',true)='timeout' then raise exception 'simulated bounded lock timeout' using errcode='55P03'; end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(lock_id::bigint);
 end; $$;
`);
await db.exec('DISCARD PLANS');
await as(owner,()=>send(b,request(150)));
await db.query("select set_config('lock_timeout','2750ms',false),set_config('test.planner_lock','timeout',false)");
await db.exec('BEGIN');
await db.query('select four_u_private.send_planner_emails()');
assert.equal((await rows())[0].status,'pending'); assert.equal((await rows())[0].attempts,0);
assert.equal((await providerCalls()).length,0,'A lock timeout does not call the provider or claim acceptance');
assert.equal((await db.query("select current_setting('lock_timeout') value")).rows[0].value,'2750ms','Timeout path restores caller setting before its transaction ends');
await db.exec('COMMIT');
await db.query("select set_config('test.planner_lock','available',false)");
await db.exec('BEGIN');
await db.query('select four_u_private.send_planner_emails()');
assert.equal((await rows())[0].status,'accepted'); assert.equal((await providerCalls()).length,1);
assert.equal((await db.query("select current_setting('lock_timeout') value")).rows[0].value,'2750ms','Acquired path restores caller setting before its transaction ends');
await db.exec('COMMIT');
await db.exec('drop function pg_catalog.pg_advisory_xact_lock(integer)');
await db.query("select set_config('lock_timeout','0',false)");

// Known provider refusals remain queued and retry only after the backoff expires.
for (const code of [429,401,403]) {
 await clearQueue(); await as(owner,()=>send(b,request(200+code))); await provider(code,'{"code":"provider_refusal"}');
 await db.query('select four_u_private.send_planner_emails()');
 const row=(await rows())[0]; assert.equal(row.status,'pending'); assert.equal(row.attempts,1); assert(new Date(row.next_attempt_at)>Date.now()+50*60000);
 await db.query('select four_u_private.send_planner_emails()'); assert.equal((await providerCalls()).length,1,'Backoff prevents immediate provider replays');
 await db.query("update four_u_private.planner_emails set next_attempt_at=now()-interval '1 minute'"); await provider();
 await db.query('select four_u_private.send_planner_emails()'); assert.equal((await rows())[0].status,'accepted'); assert.equal((await rows())[0].attempts,2);
}
// Timeouts/5xx/invalid successful bodies might already have been accepted. Stop
// automatically and do not allow a fresh client request ID to bypass that state.
for (const [code,body] of [['timeout','{}'],[500,'{}'],[201,'{}'],[201,'{"messageId":42}'],[201,'{"messageId":""}'],[201,'not-json'],[201,'{"messageId":"bad\\nheader"}']]) {
 await clearQueue(); await as(owner,()=>send(b,request(300))); await provider(code,body);
 await db.query('select four_u_private.send_planner_emails()'); assert.equal((await rows())[0].status,'uncertain');
 assert.equal((await rows())[0].attempts,1); assert(!((await rows())[0].last_error).includes('private test'));
 const calls=(await providerCalls()).length;
 await db.query('select four_u_private.send_planner_emails()'); assert.equal((await providerCalls()).length,calls);
 await db.query("update four_u_private.planner_emails set created_at=now()-interval '2 days'");
 await as(owner,()=>assert.rejects(()=>send(b,request(301)),/previous delivery is uncertain/));
 assert.equal((await as(owner,()=>status(b))).can_send,false);
}
await clearQueue(); await as(owner,()=>send(b,request(400))); await provider(400,'{"code":"invalid_parameter"}');
await db.query('select four_u_private.send_planner_emails()'); assert.equal((await rows())[0].status,'failed');
await as(owner,()=>assert.rejects(()=>send(b,request(401)),/Wait 24 hours/));
await db.query("update four_u_private.planner_emails set created_at=now()-interval '25 hours'");
assert.equal((await as(owner,()=>status(b))).can_send,true);
// Missing credentials never claim success, send from a fallback, or expose a key.
await clearQueue(); await as(owner,()=>send(b,request(500))); await db.exec('delete from vault.decrypted_secrets');
await db.query('select four_u_private.send_planner_emails()'); assert.equal((await rows())[0].status,'pending'); assert.equal((await providerCalls()).length,0);
await db.exec("insert into vault.decrypted_secrets values('briefbooth_brevo_api_key','test-only-never-a-real-key')");
// Shared budget accounting includes booking and project-brief notifications.
await db.exec("insert into briefbooth_private.booking_emails(accepted_at,status) select now(),'accepted' from generate_series(1,230); insert into four_u_private.project_briefs(accepted_at,status) select now(),'accepted' from generate_series(1,10)");
await db.query('select four_u_private.send_planner_emails()'); assert.equal((await providerCalls()).length,0); assert.equal((await rows())[0].status,'pending');
await db.exec('delete from four_u_private.project_briefs');
await provider(); await db.query('select four_u_private.send_planner_emails()'); assert.equal((await rows())[0].status,'accepted');
// Independent planner accepted cap also applies to yesterday's backlog.
await clearQueue();
const budgetBooking=await book('budget@example.test');
await db.query(`insert into four_u_private.planner_emails(id,owner_id,booking_id,recipient,status,created_at,accepted_at)
 select gen_random_uuid(),$1,$2,'budget-'||n||'@example.test','accepted',now()-interval '1 day',now() from generate_series(1,10)n`,[owner,budgetBooking]);
await db.query(`insert into four_u_private.planner_emails(id,owner_id,booking_id,recipient,created_at) values($1,$2,$3,'budget@example.test',now()-interval '1 day')`,[request(600),owner,budgetBooking]);
await db.query('select four_u_private.send_planner_emails()'); assert.equal((await providerCalls()).length,0); assert.equal((await rows()).find(r=>r.id===request(600)).status,'pending');
// Revoked verification/role cannot leave a delayed invitation able to send later.
await clearQueue(); await as(owner,()=>send(b,request(700))); await db.query("update briefbooth_private.account_roles set role='client' where user_id=$1",[owner]);
await db.query('select four_u_private.send_planner_emails()'); assert.equal((await rows())[0].status,'failed'); assert.equal((await providerCalls()).length,0);
await db.query("update briefbooth_private.account_roles set role='consultant' where user_id=$1",[owner]);
// Retention works independently of provider availability and deletes no booking.
await clearQueue(); await as(owner,()=>send(b,request(800))); await db.query("update four_u_private.planner_emails set created_at=now()-interval '8 days'");
await db.query('select four_u_private.purge_planner_emails()'); assert.equal((await rows())[0].status,'failed');
await db.query("update four_u_private.planner_emails set created_at=now()-interval '31 days'");
await db.query('select four_u_private.purge_planner_emails()'); assert.equal(await count(),0); assert((await db.query('select id from public.bookings where id=$1',[b])).rows.length);
assert.equal((await db.query("select relrowsecurity from pg_class where oid='four_u_private.planner_emails'::regclass")).rows[0].relrowsecurity,true);
assert(migration.includes('pg_try_advisory_xact_lock(492483717)'));
assert(!migration.match(/create (?:or replace )?function (?:briefbooth_private\.send_booking_emails|four_u_private\.send_project_briefs)/));
assert(!migration.includes('no-reply@briefbooth.com'),'No fallback sender is introduced');
await db.close();
console.log('Project planner email database checks passed: owner/verification/role/tenant guards, private RLS, queue-only RPC, exact sender/template, UUID replay, recipient cooldown, free quotas, safe provider outcomes and retention.');
