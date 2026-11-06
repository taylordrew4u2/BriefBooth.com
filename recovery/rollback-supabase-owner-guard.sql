-- PREPARED ONLY. Re-enable the old insert/reschedule/reactivation paths only after disabling NEW recovery
-- requests and reconciling its active reservations into the restored system.
-- This changes only a flag. It does not delete recovery data, history or schema.
begin;
set local lock_timeout='5s';
do $$
begin
 update briefbooth_private.recovery_booking_guards
 set enabled=false,updated_at=now()
 where owner_id='adc53778-f007-4c58-bd47-ba7a675abb29'::uuid;
 if not found then
  raise exception 'Recovery guard row is missing. Nothing was rolled back.';
 end if;
end;
$$;
commit;
select owner_id,enabled,updated_at from briefbooth_private.recovery_booking_guards
where owner_id='adc53778-f007-4c58-bd47-ba7a675abb29'::uuid;
