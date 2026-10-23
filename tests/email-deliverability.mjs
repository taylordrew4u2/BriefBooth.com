import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

// An actual PostgreSQL worker and trigger chain with a recording HTTP stub.
// No provider API key, real address, or network email is used by this test.
const db = new PGlite({ extensions: { btree_gist } });
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema public,auth to anon,authenticated,service_role;
create schema vault; create table vault.secrets(id uuid primary key default gen_random_uuid(),name text,decrypted_secret text);
create view vault.decrypted_secrets as select * from vault.secrets;
create function vault.create_secret(text) returns uuid language sql as $$insert into vault.secrets(decrypted_secret) values($1) returning id$$;
create function vault.update_secret(uuid,text) returns void language sql as $$update vault.secrets set decrypted_secret=$2 where id=$1$$;
create schema extensions;
create type extensions.http_header as (field text,value text);
create function extensions.http_header(text,text) returns extensions.http_header language sql as $$select row($1,$2)::extensions.http_header$$;
create type extensions.http_request as (method text,uri text,headers extensions.http_header[],content_type text,content text);
create type extensions.http_response as (status int,content_type text,headers extensions.http_header[],content text);
create function extensions.http_set_curlopt(text,text) returns boolean language sql as $$select true$$;
create table public.test_email_requests(payload jsonb);
create function extensions.http(req extensions.http_request) returns extensions.http_response language plpgsql as $$
begin
 insert into public.test_email_requests values(req.content::jsonb);
 if current_setting('test.http',true)='timeout' then raise exception 'timeout'; end if;
 return row(coalesce(nullif(current_setting('test.http',true),'')::int,201),'application/json',null,'{}')::extensions.http_response;
end; $$;
create schema cron; create function cron.schedule(text,text,text) returns int language sql as $$select 1$$;
`);
for (const file of [
  'schema.sql',
  'migrations/20261016160059_booking_confirmation_emails.sql',
  'migrations/20261016162000_custom_intake.sql',
  'migrations/20261016200000_consultation_payments.sql',
  'migrations/20261016210000_payment_minimum.sql',
  'migrations/20261018200000_free_booking_preferences.sql',
  'migrations/20261019010000_zoom_bookings.sql',
  'migrations/20261019020000_booking_approval.sql',
  'migrations/20261020170000_google_calendar_meet.sql',
  'migrations/20261022120000_schedule_controls.sql',
  'migrations/20261022121000_booking_lifecycle.sql',
]) await db.exec(readFileSync(`supabase/${file}`, 'utf8'));

const migrationFile = readdirSync('supabase/migrations').find(file => file.endsWith('_booking_email_deliverability.sql'));
assert(migrationFile, 'Delivery migration exists');
const migration = readFileSync(`supabase/migrations/${migrationFile}`, 'utf8');
const before = (await db.query("select pg_get_functiondef('briefbooth_private.send_booking_emails()'::regprocedure) fn")).rows[0].fn;
await db.exec(migration);
const after = (await db.query("select pg_get_functiondef('briefbooth_private.send_booking_emails()'::regprocedure) fn")).rows[0].fn;
const anchor = `payload:=jsonb_build_object('sender',jsonb_build_object('name','BriefBooth','email','no-reply@briefbooth.com'),
   'to',jsonb_build_array(jsonb_build_object('email',mail.recipient)), 'subject',mail.subject,'textContent',mail.body,
   'headers',jsonb_build_object('idempotencyKey',mail.id::text));`;
assert.equal(after, before.replace(anchor, 'payload:=briefbooth_private.booking_email_payload(mail);'), 'Only the payload statement changes');
assert.match(after, />=240/);
assert.match(after, /limit 1 for update/);
assert.match(after, /revision=mail.revision/);
await assert.rejects(() => db.exec(migration.replace('create function briefbooth_private.booking_email_payload', 'create or replace function briefbooth_private.booking_email_payload')), /worker payload changed/, 'Unexpected/repeated worker modification fails closed');

const owner = '00000000-0000-4000-8000-000000000001';
await db.query("insert into auth.users values($1,'consultant@example.com')", [owner]);
await db.query("insert into profiles(id,slug,name,published) values($1,'email-qa','QA consultant',true)", [owner]);
const service = (await db.query("insert into services(owner_id,title,duration,meeting_modes) values($1,'Website & app planning',30,array['in_person']) returning id", [owner])).rows[0].id;
const notes = '<script>alert("test")</script> & "quote"\nhttps://evil.example/claim\nOptional question: Not provided';
const makeBooking = async (status, days) => (await db.query(`insert into bookings(owner_id,service_id,client_name,client_email,starts_at,ends_at,meeting_mode,status,notes)
 values($1,$2,$3,'client@example.com',now()+make_interval(days=>$4),now()+make_interval(days=>$4,mins=>30),'in_person',$5,$6) returning id,manage_token`, [owner,service,'Client <img src=x onerror="alert(1)">',days,status,notes])).rows[0];
const pending = await makeBooking('pending_approval', 10);
const confirmed = await makeBooking('confirmed', 11);
const payloadFor = async (bookingId, kind) => (await db.query('select briefbooth_private.booking_email_payload(e) p from briefbooth_private.booking_emails e where booking_id=$1 and recipient_kind=$2', [bookingId,kind])).rows[0].p;
const receipt = await payloadFor(pending.id, 'request_client');
assert.match(receipt.textContent, /awaiting consultant approval/);
assert.match(receipt.textContent, /not a confirmed meeting/);
assert.match(receipt.textContent, /separate confirmation/);
assert.match(receipt.textContent, /Website & app planning/);
assert.match(receipt.textContent, /Requested time:.*America\/New_York/);
assert.match(receipt.textContent, /Format: In person/);
assert(!receipt.textContent.includes('Intake details:'));
assert(!receipt.textContent.includes('Not provided'));
assert(!receipt.textContent.includes('evil.example'));
assert(!receipt.htmlContent.includes('<img'));
assert(receipt.htmlContent.includes('&lt;img'));
assert(receipt.htmlContent.includes('Website &amp; app planning'));
assert(receipt.htmlContent.includes(`href="https://briefbooth.com/manage/${pending.manage_token}/"`));
assert.equal(receipt.replyTo.email, 'admin@customtechbuilt4u.com');
assert.equal(receipt.replyTo.name, 'BriefBooth support');
assert.equal(receipt.sender.email, 'no-reply@briefbooth.com');
assert.deepEqual(receipt.tags, ['booking','request_client']);

const consultant = await payloadFor(pending.id, 'request_consultant');
assert(consultant.textContent.includes(notes), 'Consultant retains the submitted intake snapshot');
assert(consultant.htmlContent.includes('&lt;script&gt;'));
assert(!consultant.htmlContent.includes('<script>'));
assert(!consultant.htmlContent.includes('href="https://evil.example'));
assert(consultant.htmlContent.includes('href="https://briefbooth.com/studio/"'));
const confirmation = await payloadFor(confirmed.id, 'client');
assert(confirmation.textContent.includes('Your consultation is booked.'));
assert(confirmation.htmlContent.includes('Your consultation is confirmed'));
assert(!confirmation.textContent.includes('not a confirmed meeting'));
assert(confirmation.textContent.includes(notes));

// Every original paragraph is present identically in HTML and plain text.
const decode = text => text.replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&amp;','&');
for (const payload of [receipt, consultant, confirmation]) {
  const paragraphs = payload.htmlContent.split('</h1>')[1].split('<p style="margin:26px')[0];
  const htmlMessage = [...paragraphs.matchAll(/<p [^>]*>([\s\S]*?)<\/p>/g)].map(match => decode(match[1].replaceAll('<br>','\n'))).join('\n\n');
  assert(payload.textContent.startsWith(`${htmlMessage}\n\n`));
  assert(!payload.htmlContent.includes('<img'));
}

// Changes to profile/settings after queueing must not alter the time/title snapshot.
await db.query("update profiles set name='Changed consultant',timezone='Europe/London' where id=$1", [owner]);
await db.query("update services set title='Changed service' where id=$1", [service]);
assert.deepEqual(await payloadFor(pending.id, 'request_client'), receipt);
await db.query("update briefbooth_private.booking_emails set subject=E'Test\\r\\nBcc: other@example.com' where booking_id=$1 and recipient_kind='request_consultant'", [pending.id]);
const cleanSubject = (await payloadFor(pending.id, 'request_consultant')).subject;
assert(!/[\r\n]/.test(cleanSubject));

// Verify all nine lifecycle kinds use the appropriate trusted action link.
for (const kind of ['client','consultant','request_client','request_consultant','declined_client','reminder_client','reminder_consultant','cancelled_client','cancelled_consultant']) {
  const payload = (await db.query(`select briefbooth_private.booking_email_payload(jsonb_populate_record(null::briefbooth_private.booking_emails,jsonb_build_object(
    'id',gen_random_uuid(),'booking_id',$1::uuid,'recipient_kind',$2::text,'recipient','client@example.com','subject','Booking update','body','Snapshot details'))) p`, [confirmed.id,kind])).rows[0].p;
  const expected = kind.endsWith('consultant') ? 'https://briefbooth.com/studio/' : `https://briefbooth.com/manage/${confirmed.manage_token}/`;
  assert(payload.textContent.includes(expected));
  assert(payload.htmlContent.includes(`href="${expected}"`));
  assert.equal(payload.tags[1], kind);
}
for (const role of ['anon','authenticated']) {
  assert.equal((await db.query("select has_function_privilege($1,'briefbooth_private.booking_email_payload(briefbooth_private.booking_emails)','EXECUTE') allowed", [role])).rows[0].allowed, false);
  await db.exec(`set role ${role}`);
  await assert.rejects(() => db.query('select briefbooth_private.booking_email_payload(null)'), /permission denied/);
  await db.exec('reset role');
}

// A provider acceptance records exactly one send; a second worker pass cannot resend.
await db.query("insert into vault.secrets(name,decrypted_secret) values('briefbooth_brevo_api_key','test-only')");
await db.query('select briefbooth_private.send_booking_emails()');
const first = (await db.query('select payload from public.test_email_requests')).rows[0].payload;
assert(first.textContent && first.htmlContent);
assert.equal((await db.query("select count(*)::int n from briefbooth_private.booking_emails where status='accepted'")).rows[0].n, 1);
const sentId = first.headers.idempotencyKey;
await db.query('select briefbooth_private.send_booking_emails()');
assert.equal((await db.query('select count(*)::int n from public.test_email_requests where payload->\'headers\'->>\'idempotencyKey\'=$1', [sentId])).rows[0].n, 1);

// Rate limits wait without a paid fallback; timeouts remain uncertain, never auto-resend.
await db.query("select set_config('test.http','429',false)");
await db.query('select briefbooth_private.send_booking_emails()');
assert.equal((await db.query("select count(*)::int n from briefbooth_private.booking_emails where status='pending' and next_attempt_at>now()+interval '50 minutes'")).rows[0].n, 1);
await db.query("select set_config('test.http','timeout',false)");
await db.query('select briefbooth_private.send_booking_emails()');
assert.equal((await db.query("select count(*)::int n from briefbooth_private.booking_emails where status='uncertain'")).rows[0].n, 1);
await db.query('select briefbooth_private.send_booking_emails()');
assert.equal((await db.query("select count(*)::int n from briefbooth_private.booking_emails where status='uncertain'")).rows[0].n, 1);

// Intake edits notify only the consultant and do not alter booking lifecycle revisions.
await db.exec("alter table auth.users add column email_confirmed_at timestamptz");
await db.exec(readFileSync('supabase/migrations/20261023180000_multiple_choice_intake.sql','utf8'));
await db.exec(readFileSync('supabase/migrations/20261023190000_client_intake_edits.sql','utf8'));
await db.exec(readFileSync('supabase/migrations/20261023173000_email_queue_cleanup.sql','utf8'));
await db.exec(readFileSync('supabase/migrations/20261023193000_intake_update_notifications.sql','utf8'));
await db.query("update bookings set notes='Updated answers',intake_revision=1 where id=$1",[pending.id]);
const intakeMail=(await db.query("select * from briefbooth_private.booking_emails where booking_id=$1 and recipient_kind='intake_consultant'",[pending.id])).rows[0];
assert.equal(intakeMail.recipient,'consultant@example.com');assert.equal(intakeMail.revision,1);
await db.query("update bookings set notes='Updated answers',intake_revision=2 where id=$1",[pending.id]);
assert.equal((await db.query("select count(*)::int n from briefbooth_private.booking_emails where recipient_kind='intake_consultant'")).rows[0].n,1,'Unchanged answers do not send another email');
const editPayload=await payloadFor(pending.id,'intake_consultant');
assert.match(editPayload.htmlContent,/Your client updated their intake answers/);
assert.match(editPayload.htmlContent,/href="https:\/\/briefbooth.com\/studio\/"/);
assert(!editPayload.textContent.includes('Updated answers'),'Notification does not disclose answers');
await db.query("select set_config('test.http','201',false)");
await db.query('select briefbooth_private.skip_obsolete_booking_emails()');
assert.equal((await db.query('select status from briefbooth_private.booking_emails where id=$1',[intakeMail.id])).rows[0].status,'pending');
await db.query('select briefbooth_private.send_booking_emails()');
assert.equal((await db.query('select status from briefbooth_private.booking_emails where id=$1',[intakeMail.id])).rows[0].status,'accepted');
console.log('PASS intake notification: consultant recipient, unchanged-save suppression, trusted studio link, worker delivery');

// The shared daily cap is still enforced before HTTP, including the new format.
await db.query("update briefbooth_private.booking_emails set status='pending',next_attempt_at=now() where status='pending'");
// Fixture-only historical revisions represent the other emails accepted today.
// Disable the snapshot trigger only while seeding this synthetic prior history.
await db.exec('alter table briefbooth_private.booking_emails disable trigger email_revision');
await db.query(`insert into briefbooth_private.booking_emails(booking_id,recipient_kind,recipient,subject,body,status,accepted_at,revision)
 select $1,'reminder_client','fixture@example.com','Old accepted fixture','Fixture','accepted',now(),n from generate_series(100,339)n`, [confirmed.id]);
await db.exec('alter table briefbooth_private.booking_emails enable trigger email_revision');
const countBefore = (await db.query('select count(*)::int n from public.test_email_requests')).rows[0].n;
await db.query('select briefbooth_private.send_booking_emails()');
assert.equal((await db.query('select count(*)::int n from public.test_email_requests')).rows[0].n, countBefore);
console.log('PASS booking mail: matching HTML/plain text, pending-vs-confirmed status, trusted actions, escaped intake, private helper, immutable snapshots, narrow worker patch, idempotency, free quota and safe retries');
await db.close();
