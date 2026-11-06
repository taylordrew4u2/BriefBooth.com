-- Preparation only: this migration does NOT activate recovery or stop bookings.
-- The private flag is changed separately at the controlled recovery cutover.
begin;

create schema if not exists briefbooth_private;
create table if not exists briefbooth_private.recovery_booking_guards (
 owner_id uuid primary key references public.profiles(id) on delete cascade,
 enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table briefbooth_private.recovery_booking_guards enable row level security;
revoke all on briefbooth_private.recovery_booking_guards from public, anon, authenticated, service_role;

-- Create the disabled row before cutover. A stable row lets activation serialize
-- with booking changes, including transactions that began before the flag was changed.
insert into briefbooth_private.recovery_booking_guards(owner_id)
select id from public.profiles
where id='adc53778-f007-4c58-bd47-ba7a675abb29'::uuid
on conflict(owner_id) do nothing;

create or replace function briefbooth_private.guard_recovery_booking_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare flag record; blocked boolean:=false; owners uuid[]:=array[new.owner_id];
begin
 if tg_op='UPDATE' then
  -- Existing cancellation, decline, expiry, notes and history remain available.
  -- A move or reactivation must not reserve time behind the recovery calendar.
  if not (new.owner_id is distinct from old.owner_id
   or new.service_id is distinct from old.service_id
   or new.starts_at is distinct from old.starts_at
   or new.ends_at is distinct from old.ends_at
   or new.meeting_mode is distinct from old.meeting_mode
   or (new.status is distinct from old.status and new.status in ('confirmed','pending_approval','pending_payment','payment_processing'))) then
   return new;
  end if;
  owners:=array[new.owner_id,old.owner_id];
 end if;
 -- Stable ordering prevents opposite-owner transfers taking locks in reverse.
 for flag in select enabled from briefbooth_private.recovery_booking_guards
  where owner_id=any(owners) order by owner_id for share
 loop
  blocked:=blocked or flag.enabled;
 end loop;
 if blocked then
  raise exception using errcode='P0001',
   message='This consultation now uses the updated BriefBooth booking page. Refresh the page to request a time.';
 end if;
 return new;
end;
$$;
revoke all on function briefbooth_private.guard_recovery_booking_write() from public, anon, authenticated, service_role;

drop trigger if exists a_recovery_booking_guard on public.bookings;
create trigger a_recovery_booking_guard before insert or update on public.bookings
for each row execute function briefbooth_private.guard_recovery_booking_write();

commit;
