-- Obsolete notifications must not consume the one-email-per-run free-plan budget.
create function briefbooth_private.skip_obsolete_booking_emails() returns void
language sql security definer set search_path='' as $$
 with obsolete as (
  select e.id,
   case when e.revision<>b.revision then 'Superseded by a rescheduled booking'
    when b.status='confirmed' and e.recipient_kind in ('request_client','request_consultant') then 'Request already approved; confirmation replaces this notification'
    when b.status in ('cancelled','declined') then 'Booking '||b.status||'; this notification is no longer applicable'
    when b.starts_at<=now() then 'Appointment has already started'
    else 'Booking status changed; this notification is no longer applicable' end reason
  from briefbooth_private.booking_emails e join public.bookings b on b.id=e.booking_id
  where e.status='pending' and not (
   e.revision=b.revision and (
    (b.status='confirmed' and b.starts_at>now() and e.recipient_kind in ('client','consultant','reminder_client','reminder_consultant')) or
    (b.status='pending_approval' and b.starts_at>now() and e.recipient_kind in ('request_client','request_consultant')) or
    (b.status='declined' and e.recipient_kind='declined_client') or
    (b.status='cancelled' and e.recipient_kind in ('cancelled_client','cancelled_consultant'))))
  order by e.created_at limit 500 for update of e skip locked
 ) update briefbooth_private.booking_emails e set status='skipped',last_error=o.reason from obsolete o where e.id=o.id;
$$;
revoke all on function briefbooth_private.skip_obsolete_booking_emails() from public,anon,authenticated;
DO $$ declare fn text; anchor text:='if not pg_try_advisory_xact_lock(492483717) then return; end if;'; begin
 fn:=pg_get_functiondef('briefbooth_private.send_booking_emails()'::regprocedure);
 if position(anchor in fn)=0 then raise exception 'Expected email worker guard not found'; end if;
 fn:=replace(fn,anchor,anchor||' perform briefbooth_private.skip_obsolete_booking_emails();');
 fn:=replace(fn,'''Booking cancelled or already started''','''Booking changed or appointment started; notification no longer applicable''');
 execute fn;
end $$;
