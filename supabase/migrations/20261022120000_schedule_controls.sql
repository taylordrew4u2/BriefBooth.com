-- Private schedule rules, per-date overrides and immutable appointment titles.
create table public.schedule_preferences (
 owner_id uuid primary key references public.profiles on delete cascade,
 notice_hours integer not null default 2 check(notice_hours between 0 and 168),
 horizon_days integer not null default 60 check(horizon_days between 1 and 60),
 buffer_minutes integer not null default 0 check(buffer_minutes between 0 and 120),
 reminders boolean not null default true
);
create table public.schedule_overrides (
 owner_id uuid not null references public.profiles on delete cascade,
 day date not null,
 enabled boolean not null default false,
 start_time time not null default '09:00',end_time time not null default '17:00',
 primary key(owner_id,day),check(end_time>start_time)
);
alter table public.schedule_preferences enable row level security;
alter table public.schedule_overrides enable row level security;
create policy "Own schedule preferences" on public.schedule_preferences for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy "Own schedule overrides" on public.schedule_overrides for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
revoke all on public.schedule_preferences,public.schedule_overrides from anon;
grant select,insert,update,delete on public.schedule_preferences,public.schedule_overrides to authenticated;
alter table public.bookings add column title_snapshot text;
alter table public.bookings add column outcome text check(outcome in ('completed','no_show'));
alter table public.bookings add column consultant_notes text not null default '' check(length(consultant_notes)<=4000);
update public.bookings b set title_snapshot=s.title from public.services s where s.id=b.service_id;
create function briefbooth_private.snapshot_booking_title() returns trigger language plpgsql security definer set search_path='' as $$
begin select title into new.title_snapshot from public.services where id=new.service_id; return new; end; $$;
create trigger snapshot_booking_title before insert on public.bookings for each row execute function briefbooth_private.snapshot_booking_title();
revoke all on function briefbooth_private.snapshot_booking_title() from public,anon,authenticated;
create or replace function public.available_slots(p_service uuid,p_day date) returns table(starts_at timestamptz)
language sql stable security definer set search_path='' as $$
select g.t from public.services s join public.profiles p on p.id=s.owner_id and p.published
left join public.schedule_preferences r on r.owner_id=p.id
left join public.schedule_overrides o on o.owner_id=p.id and o.day=p_day
left join public.availability a on a.owner_id=p.id and a.weekday=extract(dow from p_day)
cross join lateral generate_series((p_day+case when o.day is not null then o.start_time else a.start_time end) at time zone p.timezone,
 ((p_day+case when o.day is not null then o.end_time else a.end_time end) at time zone p.timezone)-make_interval(mins=>s.duration),interval '15 minutes') g(t)
where s.id=p_service and s.active and (case when o.day is not null then o.enabled else a.id is not null end)
and p_day between (now() at time zone p.timezone)::date and (now() at time zone p.timezone)::date+coalesce(r.horizon_days,60)
and g.t>=now()+make_interval(hours=>coalesce(r.notice_hours,2))
and not exists(select 1 from public.bookings b where b.owner_id=p.id and b.status in ('confirmed','pending_approval','pending_payment','payment_processing') and
 tstzrange(b.starts_at-make_interval(mins=>coalesce(r.buffer_minutes,0)),b.ends_at+make_interval(mins=>coalesce(r.buffer_minutes,0)),'[)') && tstzrange(g.t,g.t+make_interval(mins=>s.duration),'[)'))
and not exists(select 1 from briefbooth_private.google_connections c where c.owner_id=p.id and (not c.ready or c.synced_at is null or c.synced_at<now()-interval '10 minutes'))
and not exists(select 1 from briefbooth_private.google_busy c where c.owner_id=p.id and tstzrange(c.starts_at-make_interval(mins=>coalesce(r.buffer_minutes,0)),c.ends_at+make_interval(mins=>coalesce(r.buffer_minutes,0)),'[)') && tstzrange(g.t,g.t+make_interval(mins=>s.duration),'[)'))
order by g.t; $$;
create function public.record_booking_outcome(p_booking uuid,p_outcome text,p_notes text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in first.'; end if;
 if p_outcome is not null and p_outcome not in ('completed','no_show') then raise exception 'Choose a valid outcome.'; end if;
 update public.bookings set outcome=p_outcome,consultant_notes=coalesce(p_notes,'') where id=p_booking and owner_id=auth.uid() and ends_at<=now() and status='confirmed';
 if not found then raise exception 'Only your past confirmed appointments can be updated.'; end if;
end; $$;
revoke all on function public.record_booking_outcome(uuid,text,text) from public,anon,authenticated;
grant execute on function public.record_booking_outcome(uuid,text,text) to authenticated;
-- Keep previously booked consultation names stable when a service is edited.
DO $$ declare fn text; begin
 fn:=pg_get_functiondef('public.booking_details(uuid)'::regprocedure);
 fn:=replace(fn,'b.client_name,s.title,p.name','b.client_name,coalesce(b.title_snapshot,s.title),p.name'); execute fn;
end $$;
