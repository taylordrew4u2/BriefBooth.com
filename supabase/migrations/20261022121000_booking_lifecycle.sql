alter table public.bookings add column revision integer not null default 0;
alter table briefbooth_private.booking_emails add column revision integer not null default 0;
alter table briefbooth_private.booking_emails drop constraint booking_emails_booking_id_recipient_kind_key;
alter table briefbooth_private.booking_emails add unique(booking_id,recipient_kind,revision);
alter table briefbooth_private.booking_emails drop constraint booking_emails_recipient_kind_check;
alter table briefbooth_private.booking_emails add constraint booking_emails_recipient_kind_check check(recipient_kind in ('client','consultant','request_client','request_consultant','declined_client','reminder_client','reminder_consultant','cancelled_client','cancelled_consultant'));
create function briefbooth_private.email_revision() returns trigger language plpgsql security definer set search_path='' as $$ begin select revision into new.revision from public.bookings where id=new.booking_id; return new; end; $$;
create trigger email_revision before insert on briefbooth_private.booking_emails for each row execute function briefbooth_private.email_revision();
revoke all on function briefbooth_private.email_revision() from public,anon,authenticated;
DO $$ declare fn text; begin
 fn:=pg_get_functiondef('briefbooth_private.queue_booking_emails()'::regprocedure);
 fn:=replace(fn,$lit$where booking_id=new.id and recipient_kind in ('client','consultant')$lit$,$lit$where booking_id=new.id and revision=new.revision and recipient_kind in ('client','consultant')$lit$);
 fn:=replace(fn,$lit$'Consultation: '||svc.title$lit$,$lit$'Consultation: '||coalesce(new.title_snapshot,svc.title)$lit$);
 fn:=replace(fn,$lit$||svc.duration||E' minutes$lit$, $lit$||(extract(epoch from new.ends_at-new.starts_at)::int/60)||E' minutes$lit$);execute fn;
end $$;
create function briefbooth_private.queue_cancellation_emails() returns trigger language plpgsql security definer set search_path='' as $$
declare owner_email text; body text;
begin
 if new.status<>'cancelled' or old.status='cancelled' then return new; end if;
 select email into owner_email from auth.users where id=new.owner_id;
 body:='This consultation has been cancelled: '||new.title_snapshot||E'\nTime (UTC): '||to_char(new.starts_at at time zone 'UTC','YYYY-MM-DD HH24:MI')||E'\n\nView booking: https://briefbooth.com/manage/'||new.manage_token||E'/\n\nIf payment was collected, cancellation does not automatically issue a refund. Contact the consultant to arrange it.';
 insert into briefbooth_private.booking_emails(booking_id,recipient_kind,recipient,subject,body) values(new.id,'cancelled_client',new.client_email,'BriefBooth consultation cancelled',body),(new.id,'cancelled_consultant',owner_email,'BriefBooth consultation cancelled',body) on conflict do nothing;
 return new; end; $$;
create trigger cancellation_emails after update of status on public.bookings for each row execute function briefbooth_private.queue_cancellation_emails();
revoke all on function briefbooth_private.queue_cancellation_emails() from public,anon,authenticated;
create function briefbooth_private.queue_reminders() returns void language sql security definer set search_path='' as $$
insert into briefbooth_private.booking_emails(booking_id,recipient_kind,recipient,subject,body)
select e.booking_id,'reminder_'||e.recipient_kind,e.recipient,'Reminder: your BriefBooth consultation',E'Your consultation is coming up.\n\n'||e.body
from briefbooth_private.booking_emails e join public.bookings b on b.id=e.booking_id
left join public.schedule_preferences r on r.owner_id=b.owner_id
where b.status='confirmed' and b.starts_at between now()+interval '1 hour' and now()+interval '24 hours'
and e.revision=b.revision and e.recipient_kind in ('client','consultant') and e.status='accepted'
and e.accepted_at<now()-interval '1 hour' and coalesce(r.reminders,true)
on conflict do nothing; $$;
revoke all on function briefbooth_private.queue_reminders() from public,anon,authenticated;
-- Preserve existing provider retry behavior, add revision guards and a shared booking-mail budget.
DO $$ declare fn text; begin
 fn:=pg_get_functiondef('briefbooth_private.send_booking_emails()'::regprocedure);
 fn:=replace(fn,$lit$if not pg_try_advisory_xact_lock(492483717) then return; end if;$lit$, $lit$if not pg_try_advisory_xact_lock(492483717) then return; end if; perform briefbooth_private.queue_reminders(); if (select count(*) from briefbooth_private.booking_emails where accepted_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=240 then return; end if;$lit$);
 fn:=replace(fn,'limit 3 for update','limit 1 for update');
 fn:=replace(fn,$lit$where id=mail.booking_id and starts_at>now() and ((status='confirmed' and mail.recipient_kind in ('client','consultant')) or (status='pending_approval' and mail.recipient_kind in ('request_client','request_consultant')) or (status='declined' and mail.recipient_kind='declined_client'))$lit$, $lit$where id=mail.booking_id and revision=mail.revision and ((status='confirmed' and starts_at>now() and mail.recipient_kind in ('client','consultant','reminder_client','reminder_consultant')) or (status='pending_approval' and starts_at>now() and mail.recipient_kind in ('request_client','request_consultant')) or (status='declined' and mail.recipient_kind='declined_client') or (status='cancelled' and mail.recipient_kind in ('cancelled_client','cancelled_consultant')))$lit$);
 execute fn;
end $$;
create function public.booking_health(p_booking uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bookings; result jsonb;
begin
 select * into b from public.bookings where id=p_booking and owner_id=auth.uid();
 if b.id is null then raise exception 'Booking not found.'; end if;
 select jsonb_build_object('emails',coalesce((select jsonb_agg(jsonb_build_object('kind',recipient_kind,'status',status,'error',last_error)) from briefbooth_private.booking_emails where booking_id=b.id and revision=b.revision),'[]'::jsonb),
 'meeting',case when b.meeting_mode='google_meet' then (select jsonb_build_object('status',status,'error',error) from briefbooth_private.google_meetings where booking_id=b.id) else (select jsonb_build_object('status',status,'error',last_error) from briefbooth_private.zoom_meetings where booking_id=b.id) end,
 'refund_review',exists(select 1 from briefbooth_private.payments where booking_id=b.id and paid_at is not null and b.status in ('cancelled','declined'))) into result;return result;
end; $$;
create function public.retry_booking_delivery(p_booking uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.bookings where id=p_booking and owner_id=auth.uid()) then raise exception 'Booking not found.'; end if;
 update briefbooth_private.booking_emails e set status='pending',next_attempt_at=now(),last_error=null from public.bookings b where e.booking_id=p_booking and b.id=e.booking_id and e.revision=b.revision and e.status='failed' and e.attempts<5;
 -- Unknown outcomes intentionally require provider-log review to prevent duplicate sends/meetings.
 update briefbooth_private.zoom_meetings z set status='pending',next_attempt_at=now(),last_error=null from public.bookings b where b.id=z.booking_id and b.id=p_booking and b.status='confirmed' and z.status='failed' and exists(select 1 from briefbooth_private.zoom_connections c where c.owner_id=b.owner_id and c.ready);
end; $$;
revoke all on function public.booking_health(uuid),public.retry_booking_delivery(uuid) from public,anon,authenticated;
grant execute on function public.booking_health(uuid),public.retry_booking_delivery(uuid) to authenticated;
