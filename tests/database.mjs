import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const db = new PGlite({ extensions: { btree_gist } });
await db.exec(
  `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated;alter default privileges in schema public grant execute on functions to anon,authenticated;`,
);
await db.exec(readFileSync("supabase/schema.sql", "utf8"));
await db.exec(
  "grant select,insert,update,delete on all tables in schema public to anon,authenticated;",
);
const owner = "00000000-0000-0000-0000-000000000001",
  other = "00000000-0000-0000-0000-000000000002";
await db.query("insert into auth.users values ($1),($2)", [owner, other]);
await db.query(
  `insert into profiles(id,slug,name,timezone,published) values ($1,'test-consultant','Test Consultant','America/New_York',true),($2,'other-consultant','Other Consultant','UTC',false)`,
  [owner, other],
);
await db.query(
  "insert into consultant_settings(owner_id,meeting_url,in_person_address) values ($1,'https://zoom.us/j/private','123 Test Street, Suite 4')",
  [owner],
);
const service = (
  await db.query(
    "insert into services(owner_id,title,duration) values ($1,'Strategy',60) returning id",
    [owner],
  )
).rows[0].id;
await db.query(
  "insert into availability(owner_id,weekday,start_time,end_time) select $1,n,'09:00','17:00' from generate_series(0,6)n",
  [owner],
);
const day = (
  await db.query(
    "select ((now() at time zone 'America/New_York')::date+2)::text as d",
  )
).rows[0].d;
await db.exec("set role anon");
await assert.rejects(
  () => db.query("select save_availability('[]'::jsonb)"),
  /permission denied/,
);

const slots = (
  await db.query("select * from available_slots($1,$2)", [service, day])
).rows;
assert.equal(slots.length, 29, "15-minute starts respect a 60-minute duration");
assert.equal((await db.query("select * from bookings")).rows.length, 0);
assert.equal(
  (await db.query("select * from consultant_settings")).rows.length,
  0,
  "Meeting URL stays private",
);
assert.equal(
  (await db.query("select * from profiles")).rows.length,
  1,
  "Unpublished profiles stay private",
);
const token = (
  await db.query("select create_booking($1,$2,$3,$4,$5) as token", [
    service,
    slots[0].starts_at,
    "Client",
    "client@example.com",
    "A goal",
  ])
).rows[0].token;
assert(token);
await assert.rejects(
  () =>
    db.query("select create_booking($1,$2,$3,$4,$5)", [
      service,
      slots[1].starts_at,
      "Other",
      "other@example.com",
      "",
    ]),
  /no longer available/,
);
await assert.rejects(
  () =>
    db.query("select create_booking($1,$2,$3,$4,$5)", [
      service,
      slots[8].starts_at,
      "Other",
      "invalid",
      "",
    ]),
  /valid name and email/,
);
await assert.rejects(
  () =>
    db.query(
      "insert into bookings(owner_id,service_id,client_name,client_email,starts_at,ends_at) values($1,$2,$3,$4,$5,$6)",
      [
        owner,
        service,
        "bad",
        "bad@example.com",
        slots[8].starts_at,
        slots[12].starts_at,
      ],
    ),
  /row-level security/,
);
assert.equal(
  (await db.query("select * from booking_details($1)", [token])).rows[0]
    .meeting_url,
  "https://zoom.us/j/private",
);
assert.equal(
  (
    await db.query("select * from booking_details($1)", [
      "99999999-0000-0000-0000-000000000000",
    ])
  ).rows.length,
  0,
);
assert.equal(
  (await db.query("select * from bookings")).rows.length,
  0,
  "Anon cannot read private client data",
);
assert.equal(
  (await db.query("select cancel_booking($1) as ok", [token])).rows[0].ok,
  true,
);
assert.equal(
  (await db.query("select * from available_slots($1,$2)", [service, day])).rows
    .length,
  29,
  "Cancellation reopens the time",
);
await db.exec("reset role");
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
await db.exec("set role authenticated");
assert.equal(
  (await db.query("select * from bookings")).rows.length,
  0,
  "Different consultant cannot read booking",
);
await db.exec("reset role");
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
await db.exec("set role authenticated");
assert.equal(
  (await db.query("select * from bookings")).rows.length,
  1,
  "Owner can read bookings",
);
await db.query("select save_availability($1)", [
  JSON.stringify([{ weekday: 1, start_time: "10:00", end_time: "15:00" }]),
]);
assert.equal((await db.query("select * from availability")).rows.length, 1);
await assert.rejects(
  () =>
    db.query("select save_availability($1)", [
      JSON.stringify([{ weekday: 1, start_time: "17:00", end_time: "09:00" }]),
    ]),
  /check constraint/,
);
assert.equal(
  (await db.query("select * from availability")).rows.length,
  1,
  "Invalid schedule rolls back atomically",
);
await assert.rejects(
  () =>
    db.query("update profiles set timezone='Invalid/Timezone' where id=$1", [
      owner,
    ]),
  /Invalid timezone/,
);
await db.exec("reset role");
// Check DST transition dates within the supported booking window when applicable.
const dst = "2026-11-02";
const delta = (
  await db.query(
    "select $1::date-(now() at time zone 'America/New_York')::date as d",
    [dst],
  )
).rows[0].d;
if (delta > 0 && delta <= 60) {
  await db.query(
    "insert into availability(owner_id,weekday,start_time,end_time) values($1,1,'09:00','17:00') on conflict(owner_id,weekday) do update set start_time='09:00',end_time='17:00'",
    [owner],
  );
  const winter = (
    await db.query("select * from available_slots($1,$2)", [service, dst])
  ).rows;
  assert.equal(
    new Date(winter[0].starts_at).getUTCHours(),
    14,
    "9am New York follows winter UTC offset",
  );
}
const retryId = "00000000-aaaa-0000-0000-000000000001";
await db.query(
  "insert into availability(owner_id,weekday,start_time,end_time) select $1,extract(dow from $2::date)::int,'09:00','17:00' on conflict(owner_id,weekday) do update set start_time='09:00',end_time='17:00'",
  [owner, day],
);
const retrySlots = (
  await db.query("select * from available_slots($1,$2)", [service, day])
).rows;
assert(retrySlots.length > 0);
{
  const args = [
    service,
    retrySlots[0].starts_at,
    "Retry Client",
    "retry@example.com",
    "",
    retryId,
  ];
  const first = (
    await db.query("select create_booking($1,$2,$3,$4,$5,$6) as token", args)
  ).rows[0].token;
  const second = (
    await db.query("select create_booking($1,$2,$3,$4,$5,$6) as token", args)
  ).rows[0].token;
  assert.equal(first, second, "Retried request returns the same private link");
}
// Meeting format is validated on the server and private details are format-specific.
await db.query(
  "update services set meeting_modes=array['zoom','in_person'] where id=$1",
  [service],
);
await assert.rejects(
  () =>
    db.query("update services set meeting_modes=array['phone'] where id=$1", [
      service,
    ]),
  /check constraint/,
);
const free = (
  await db.query("select * from available_slots($1,$2)", [service, day])
).rows;
await db.exec("set role anon");
await assert.rejects(
  () =>
    db.query(
      "select create_booking($1,$2,'Client','mode@example.com','',null,'phone')",
      [service, free[0].starts_at],
    ),
  /available meeting option/,
);
const inPerson = (
  await db.query(
    "select create_booking($1,$2,'Client','person@example.com','Intake answer',null,'in_person') as token",
    [service, free[0].starts_at],
  )
).rows[0].token;
const detail = (await db.query("select * from booking_details($1)", [inPerson]))
  .rows[0];
assert.equal(detail.meeting_mode, "in_person");
assert.equal(detail.in_person_address, "123 Test Street, Suite 4");
assert.equal(
  detail.meeting_url,
  "",
  "In-person confirmation never exposes Zoom URL",
);
const zoom = (await db.query("select * from booking_details($1)", [token]))
  .rows[0];
assert.equal(zoom.meeting_mode, "zoom");
assert.equal(
  zoom.in_person_address,
  "",
  "Zoom confirmation never exposes street address",
);
await assert.rejects(
  () =>
    db.query(
      "select create_booking($1,$2,'Client','mode2@example.com','',null,'zoom')",
      [service, free[0].starts_at],
    ),
  /no longer available/,
);
assert.equal(
  (await db.query("select * from consultant_settings")).rows.length,
  0,
);
await db.query("select cancel_booking($1)", [inPerson]);
await db.exec("reset role");
console.log(
  "Database checks passed: slots, overlap prevention, validation, cancellation, privacy, tenant isolation, atomic hours, timezone validation, DST, meeting modes and private locations.",
);
await db.close();
