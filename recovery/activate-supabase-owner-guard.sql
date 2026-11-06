-- PREPARED ONLY. Run as the existing database administrator only at cutover.
-- Prerequisites: apply 20261106230000_recovery_booking_guard.sql, verify the
-- free recovery backend, and obtain any outstanding activation authorization.
-- This lock waits for earlier guarded writes for this owner to commit. After it commits,
-- read/import the final upcoming reservations BEFORE enabling recovery bookings.
-- Other owners, existing cancellations, notes and historical reads remain available.
-- Rescheduling or reactivating this owner's old bookings is blocked during recovery.
begin;
set local lock_timeout='5s';
do $$
begin
 if not exists(select 1 from public.profiles where id='adc53778-f007-4c58-bd47-ba7a675abb29'::uuid and slug='4u-digital') then
  raise exception 'Expected 4u Digital profile is missing. No guard activated.';
 end if;
 update briefbooth_private.recovery_booking_guards
 set enabled=true,updated_at=now()
 where owner_id='adc53778-f007-4c58-bd47-ba7a675abb29'::uuid;
 if not found then
  raise exception 'Apply the disabled recovery guard migration first. No guard activated.';
 end if;
end;
$$;
commit;
select owner_id,enabled,updated_at from briefbooth_private.recovery_booking_guards
where owner_id='adc53778-f007-4c58-bd47-ba7a675abb29'::uuid;
