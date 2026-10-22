create table briefbooth_private.calendar_feeds(owner_id uuid primary key references public.profiles on delete cascade,token uuid unique not null default gen_random_uuid());
alter table briefbooth_private.calendar_feeds enable row level security;
revoke all on briefbooth_private.calendar_feeds from public,anon,authenticated;
create function public.calendar_feed_link(p_reset boolean default false,p_disable boolean default false) returns text language plpgsql security definer set search_path='' as $$
declare t uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Sign in and save a profile first.'; end if;
 if p_disable then delete from briefbooth_private.calendar_feeds where owner_id=auth.uid(); return null; end if;
 if p_reset then delete from briefbooth_private.calendar_feeds where owner_id=auth.uid(); end if;
 insert into briefbooth_private.calendar_feeds(owner_id) values(auth.uid()) on conflict do nothing;
 select token into t from briefbooth_private.calendar_feeds where owner_id=auth.uid();
 return 'https://briefbooth.com/api/calendar/'||t||'.ics';
end; $$;
create function public.calendar_feed_events(p_token uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('events',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'title',b.title_snapshot,'start',b.starts_at,'end',b.ends_at,'revision',b.revision,'status',b.status)) from public.bookings b where b.owner_id=f.owner_id and b.status in ('confirmed','cancelled','declined') and b.starts_at between now()-interval '30 days' and now()+interval '90 days'),'[]'::jsonb)) from briefbooth_private.calendar_feeds f where f.token=p_token;
$$;
revoke all on function public.calendar_feed_link(boolean,boolean),public.calendar_feed_events(uuid) from public,anon,authenticated;
grant execute on function public.calendar_feed_link(boolean,boolean) to authenticated;
grant execute on function public.calendar_feed_events(uuid) to service_role;
-- Calendar subscribers need a higher sequence number when an appointment is cancelled.
create or replace function public.cancel_booking(p_token uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.bookings set status='cancelled',revision=revision+1 where manage_token=p_token and status in ('confirmed','pending_approval') and starts_at>now();
 return found;
end; $$;
