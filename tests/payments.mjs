import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite({extensions:{btree_gist}});
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;`);
await db.exec(`create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);`);
for(const f of ['supabase/schema.sql','supabase/migrations/20261016160059_booking_confirmation_emails.sql','supabase/migrations/20261016162000_custom_intake.sql','supabase/migrations/20261016200000_consultation_payments.sql','supabase/migrations/20261016210000_payment_minimum.sql']) await db.exec(readFileSync(f,'utf8'));
const owner='00000000-0000-4000-8000-000000000001';
await db.query(`insert into auth.users values($1,'consultant@example.com');`,[owner]);
await db.query(`insert into profiles(id,slug,name,published) values($1,'payments-qa','Consultant',true)`,[owner]);
await db.query(`insert into availability(owner_id,weekday,start_time,end_time) select $1,n,'09:00','17:00' from generate_series(0,6)n`,[owner]);
await db.query(`select payments_account($1,'acct_qa',true,false)`,[owner]);
await assert.rejects(()=>db.query(`insert into services(owner_id,title,duration,amount_cents) values($1,'Too small',30,1)`,[owner]),/at least/);
const svc=(await db.query(`insert into services(owner_id,title,duration,amount_cents) values($1,'Paid consultation',30,500) returning id`,[owner])).rows[0].id;
await db.query(`select payments_account($1,'acct_qa',true,false)`,[owner]);
for(const [amount,total] of [[0,0],[500,546],[50000,51524]]) assert.equal((await db.query('select briefbooth_private.payment_total($1) total',[amount])).rows[0].total,total);
await db.exec('set role anon');
await assert.rejects(()=>db.query(`select payments_account($1)`,[owner]),/permission denied/);
const start=(await db.query(`select * from available_slots($1,current_date+3)`,[svc])).rows[0].starts_at;
await assert.rejects(()=>db.query(`select book_consultation($1,$2,'Client','client@example.com','{}',gen_random_uuid())`,[svc,start]),/secure checkout/);
await db.exec('reset role');
async function reserve(request='00000000-0000-4000-8000-000000000010',total=546){ return (await db.query(`select payments_reserve($1,$2,'Client','client@example.com','{}',$3,$4,false) p`,[svc,start,request,total])).rows[0].p; }
await assert.rejects(()=>reserve(undefined,500),/price changed/);
const p=await reserve();assert.equal(p.status,'pending_payment');assert.equal(p.total_cents,546);
assert.equal((await reserve()).booking_id,p.booking_id);
assert.equal((await db.query(`select count(*)::int n from briefbooth_private.booking_emails`)).rows[0].n,0,'No email before payment');
await assert.rejects(()=>reserve('00000000-0000-4000-8000-000000000011'),/no longer available/);
async function settle(state='paid',account='acct_qa',total=546,live=false){await db.query(`select payments_settle($1,$2,'cs_test_qa',$3,$4,$5,'pi_test_qa')`,[p.booking_id,account,total,live,state]);}
await assert.rejects(()=>settle('paid','acct_wrong'),/mismatch/);
await assert.rejects(()=>settle('paid','acct_qa',500),/mismatch/);
await assert.rejects(()=>settle('paid','acct_qa',546,true),/mismatch/);
await settle('processing');
assert.equal((await db.query('select status from bookings where id=$1',[p.booking_id])).rows[0].status,'payment_processing');
await settle('expired');assert.equal((await db.query('select status from bookings where id=$1',[p.booking_id])).rows[0].status,'payment_processing','Expiry cannot release processing payment');
await settle();await settle();await settle('expired');
assert.equal((await db.query('select status from bookings where id=$1',[p.booking_id])).rows[0].status,'confirmed');
assert.equal((await db.query('select count(*)::int n from briefbooth_private.booking_emails')).rows[0].n,2,'Exactly two emails despite replay');
await db.query('select cancel_booking($1)',[p.manage_token]);await settle();
assert.equal((await db.query('select status from bookings where id=$1',[p.booking_id])).rows[0].status,'cancelled','Replay does not restore cancelled paid booking');
const exp=await reserve('00000000-0000-4000-8000-000000000012');
await db.query(`select payments_settle($1,'acct_qa','cs_test_exp',546,false,'expired')`,[exp.booking_id]);
const retry=await reserve('00000000-0000-4000-8000-000000000013');assert.notEqual(retry.booking_id,exp.booking_id);
console.log('PASS payment prices, authorization, slot holds, duplicate requests, price/account/mode tampering, processing, payment replay, email gating, cancellation and expiry');
await db.close();
const {priceBreakdown}=await import('../lib/pricing.ts');
for (const amount of [0,1,50,99,500,50000,9999999]) {
 const p=priceBreakdown(amount);assert.equal(p.total,p.service+p.processing);
 if(amount) {assert(p.total-Math.round(p.total*.029)-30>=amount);assert(p.total-1-Math.round((p.total-1)*.029)-30<amount);}
}
assert.deepEqual(priceBreakdown(500),{service:500,processing:46,total:546});
assert.deepEqual(priceBreakdown(50000),{service:50000,processing:1524,total:51524});
for(const bad of [-1,Infinity,NaN,1.5,10000000]) assert.throws(()=>priceBreakdown(bad));
console.log('PASS frontend fee estimates, cent rounding, zero and invalid prices');
