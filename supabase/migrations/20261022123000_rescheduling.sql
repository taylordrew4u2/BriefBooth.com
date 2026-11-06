create table briefbooth_private.booking_changes (
 id uuid primary key default gen_random_uuid(),booking_id uuid not null references public.bookings on delete cascade,
 old_start timestamptz not null,new_start timestamptz not null,changed_at timestamptz not null default now(),
 old_zoom_meeting text,old_zoom_url text
);
alter table briefbooth_private.booking_changes enable row level security;
revoke all on briefbooth_private.booking_changes from public,anon,authenticated;
create function public.reschedule_slots(p_token uuid,p_day date) returns table(starts_at timestamptz) language sql stable security definer set search_path='' as $$
 select a.starts_at from public.bookings b cross join lateral public.available_slots(b.service_id,p_day) a
 where b.manage_token=p_token and b.starts_at>now() and b.status in ('confirmed','pending_approval')
 and (select duration from public.services where id=b.service_id)=extract(epoch from b.ends_at-b.starts_at)::int/60;
$$;
create function public.reschedule_booking(p_token uuid,p_start timestamptz,p_expected timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare b public.bookings; tz text;
begin
 -- Same lock ordering as Zoom creation protects meeting creation from a concurrent move.
 perform pg_advisory_xact_lock(492483718);
 select * into b from public.bookings where manage_token=p_token for update;
 if b.id is null or b.status not in ('confirmed','pending_approval') or b.starts_at<=now() then raise exception 'This appointment cannot be moved.'; end if;
 if b.starts_at=p_start then return; end if;
 if b.starts_at is distinct from p_expected then raise exception 'This booking changed. Refresh before moving it.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(b.owner_id::text,0));
 select timezone into tz from public.profiles where id=b.owner_id;
 if not exists(select 1 from public.reschedule_slots(p_token,(p_start at time zone tz)::date) s where s.starts_at=p_start) then raise exception 'That time is unavailable, or the consultation duration has changed. Contact your consultant.'; end if;
 if (select count(*) from briefbooth_private.booking_changes where booking_id=b.id and changed_at>now()-interval '1 day')>=5 then raise exception 'Too many changes. Please contact your consultant.'; end if;
 insert into briefbooth_private.booking_changes(booking_id,old_start,new_start,old_zoom_meeting,old_zoom_url) values(b.id,b.starts_at,p_start,(select meeting_id from briefbooth_private.zoom_meetings where booking_id=b.id),(select join_url from briefbooth_private.zoom_meetings where booking_id=b.id));
 delete from briefbooth_private.zoom_meetings where booking_id=b.id;
 update briefbooth_private.google_meetings set status='pending',join_url=null,error=null,next_attempt_at=now() where booking_id=b.id;
 update public.bookings set starts_at=p_start,ends_at=p_start+(b.ends_at-b.starts_at),status='pending_approval',revision=revision+1 where id=b.id;
 -- A move from an already pending request needs a fresh notification as well.
 if b.status='pending_approval' then
  update public.bookings set status='pending_approval' where id=b.id;
 end if;
end; $$;
revoke all on function public.reschedule_slots(uuid,date),public.reschedule_booking(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.reschedule_slots(uuid,date),public.reschedule_booking(uuid,timestamptz,timestamptz) to anon,authenticated;
DO $$ declare fn text; begin
 fn:=pg_get_functiondef('briefbooth_private.queue_request_emails()'::regprocedure);
 fn:=replace(fn,'old.status=new.status','old.status=new.status and old.revision=new.revision');execute fn;
 fn:=pg_get_functiondef('briefbooth_private.guard_google_booking()'::regprocedure);
 fn:=replace(fn,'old.status is distinct from new.status','old.status is distinct from new.status or old.starts_at is distinct from new.starts_at');execute fn;
end $$;
-- Worker snapshots include revision so an older HTTP response cannot confirm a moved booking.
create or replace function public.google_jobs(p_owner uuid) returns jsonb language sql security definer set search_path='' as $$
select coalesce(jsonb_agg(to_jsonb(j)),'[]'::jsonb) from (
select g.booking_id,g.event_id,g.status,b.starts_at,b.ends_at,b.status booking_status,b.revision,coalesce(b.title_snapshot,s.title) title
from briefbooth_private.google_meetings g join public.bookings b on b.id=g.booking_id join public.services s on s.id=b.service_id
where b.owner_id=p_owner and g.next_attempt_at<=now() and ((b.status='confirmed' and b.starts_at>now() and g.status='pending') or (b.status in ('cancelled','declined') and g.status<>'cancelled')) order by b.created_at limit 5) j; $$;
create function public.google_job_result_v2(p_booking uuid,p_revision integer,p_url text,p_event text,p_cancelled boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare v integer; begin
 select revision into v from public.bookings where id=p_booking for update;
 if v is distinct from p_revision then return; end if;
 perform public.google_job_result(p_booking,p_url,p_event,p_cancelled);
end; $$;
revoke all on function public.google_job_result_v2(uuid,integer,text,text,boolean) from public,anon,authenticated;
grant execute on function public.google_job_result_v2(uuid,integer,text,text,boolean) to service_role;
-- Make old Zoom links visible only to their consultant for manual removal until deletion scope is approved.
create function public.zoom_cleanup_items(p_booking uuid) returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('url',c.old_zoom_url,'time',c.old_start)),'[]'::jsonb) from briefbooth_private.booking_changes c join public.bookings b on b.id=c.booking_id where b.owner_id=auth.uid() and b.id=p_booking and c.old_zoom_url is not null;
$$;
revoke all on function public.zoom_cleanup_items(uuid) from public,anon,authenticated;
grant execute on function public.zoom_cleanup_items(uuid) to authenticated;
