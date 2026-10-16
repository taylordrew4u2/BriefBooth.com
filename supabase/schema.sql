-- Run once in a new Supabase project's SQL editor.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create table public.profiles (
 id uuid primary key references auth.users on delete cascade,
 slug text unique not null check(slug ~ '^[a-z0-9][a-z0-9-]{2,39}$' and slug <> 'demo'),
 name text not null check(length(name) between 1 and 80),
 headline text not null default 'Independent consultant' check(length(headline)<=140),
 bio text not null default '' check(length(bio)<=2000),
 timezone text not null default 'America/New_York',
 published boolean not null default false
);
create table public.consultant_settings (
 owner_id uuid primary key references public.profiles on delete cascade,
 meeting_url text not null default '' check(meeting_url='' or meeting_url ~ '^https://'),
 in_person_address text not null default '' check(length(in_person_address)<=500)
);
create table public.services (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles on delete cascade,
 title text not null check(length(title) between 1 and 100),
 description text not null default '' check(length(description)<=500),
 duration integer not null check(duration in (15,30,45,60,90)),
 meeting_modes text[] not null default array['zoom']::text[] check(cardinality(meeting_modes) between 1 and 2 and meeting_modes <@ array['zoom','in_person']::text[]),
 active boolean not null default true
);
create table public.availability (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles on delete cascade,
 weekday integer not null check(weekday between 0 and 6),
 start_time time not null,
 end_time time not null check(end_time>start_time),
 unique(owner_id,weekday)
);
create table public.bookings (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles on delete cascade,
 service_id uuid not null references public.services,
 client_name text not null check(length(client_name) between 1 and 100),
 client_email text not null check(length(client_email)<=254),
 notes text not null default '' check(length(notes)<=2000),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 meeting_mode text not null default 'zoom' check(meeting_mode in ('zoom','in_person')),
 status text not null default 'confirmed' check(status in ('confirmed','cancelled')),
 manage_token uuid unique not null default gen_random_uuid(),
 request_id uuid unique not null default gen_random_uuid(),
 created_at timestamptz not null default now(),
 check(ends_at>starts_at),
 exclude using gist(owner_id with =, tstzrange(starts_at,ends_at,'[)') with &&) where(status='confirmed')
);
alter table public.consultant_settings enable row level security;
create policy "Own settings" on public.consultant_settings for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.availability enable row level security;
alter table public.bookings enable row level security;
create policy "Own profile" on public.profiles for all to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy "Public profile" on public.profiles for select using(published);
create policy "Own services" on public.services for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy "Public services" on public.services for select using(active and exists(select 1 from public.profiles p where p.id=owner_id and p.published));
create policy "Own availability" on public.availability for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy "Public availability" on public.availability for select using(exists(select 1 from public.profiles p where p.id=owner_id and p.published));
create policy "Read own bookings" on public.bookings for select to authenticated using(owner_id=auth.uid());
-- No public table access to bookings. RPCs reveal only available times and capability-scoped details.
create function public.available_slots(p_service uuid, p_day date)
returns table(starts_at timestamptz) language sql stable security definer set search_path=public as $$
 select g.t from services s join profiles p on p.id=s.owner_id and p.published
 join availability a on a.owner_id=p.id and a.weekday=extract(dow from p_day)
 cross join lateral generate_series((p_day+a.start_time) at time zone p.timezone,
 ((p_day+a.end_time) at time zone p.timezone)-make_interval(mins=>s.duration), interval '15 minutes') as g(t)
 where s.id=p_service and s.active and p_day between (now() at time zone p.timezone)::date and (now() at time zone p.timezone)::date+60
 and g.t>=now()+interval '2 hours'
 and not exists(select 1 from bookings b where b.owner_id=p.id and b.status='confirmed'
 and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(g.t,g.t+make_interval(mins=>s.duration),'[)'))
 order by g.t;
$$;
create function public.create_booking(p_service uuid,p_start timestamptz,p_name text,p_email text,p_notes text default '',p_request uuid default null,p_meeting_mode text default 'zoom')
returns uuid language plpgsql security definer set search_path=public as $$
declare svc services; prof profiles; token uuid; prior bookings;
begin
 if p_request is not null then
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,1));
 select * into prior from bookings where request_id=p_request;
 if prior.id is not null then
 if prior.service_id=p_service and prior.starts_at=p_start and prior.client_email=lower(trim(p_email)) and prior.meeting_mode=p_meeting_mode then return prior.manage_token; end if;
 raise exception 'This booking request has already been used.';
 end if;
 end if;
 select * into svc from services where id=p_service and active;
 select * into prof from profiles where id=svc.owner_id and published;
 if prof.id is null then raise exception 'This consultation is unavailable.'; end if;
 if p_meeting_mode is null or not(p_meeting_mode=any(svc.meeting_modes)) then raise exception 'Choose an available meeting option.'; end if;
 -- Serialize bookings per consultant. Exclusion constraint is an additional concurrency guarantee.
 perform pg_advisory_xact_lock(hashtextextended(prof.id::text,0));
 if p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(trim(p_name))=0 then raise exception 'Enter a valid name and email.'; end if;
 if not exists(select 1 from available_slots(p_service,(p_start at time zone prof.timezone)::date) a where a.starts_at=p_start) then raise exception 'That time is no longer available. Please choose another.'; end if;
 -- Bound automated/repeated reservations per address without disclosing client records.
 if (select count(*) from bookings where lower(client_email)=lower(trim(p_email)) and owner_id=prof.id and created_at>now()-interval '1 hour')>=5 then raise exception 'Too many bookings. Please try again later.'; end if;
 insert into bookings(owner_id,service_id,client_name,client_email,notes,starts_at,ends_at,request_id,meeting_mode)
 values(prof.id,svc.id,trim(p_name),lower(trim(p_email)),p_notes,p_start,p_start+make_interval(mins=>svc.duration),coalesce(p_request,gen_random_uuid()),p_meeting_mode) returning manage_token into token;
 return token;
end; $$;
create function public.booking_details(p_token uuid)
returns table(client_name text,title text,consultant text,starts_at timestamptz,ends_at timestamptz,status text,meeting_url text,meeting_mode text,in_person_address text)
language sql stable security definer set search_path=public as $$
 select b.client_name,s.title,p.name,b.starts_at,b.ends_at,b.status,case when b.meeting_mode='zoom' then coalesce(cs.meeting_url,'') else '' end,b.meeting_mode,case when b.meeting_mode='in_person' then coalesce(cs.in_person_address,'') else '' end
 from bookings b join services s on s.id=b.service_id join profiles p on p.id=b.owner_id left join consultant_settings cs on cs.owner_id=p.id where b.manage_token=p_token;
$$;
create function public.cancel_booking(p_token uuid) returns boolean language plpgsql security definer set search_path=public as $$
begin
 update bookings set status='cancelled' where manage_token=p_token and status='confirmed' and starts_at>now();
 return found;
end; $$;
revoke all on function public.available_slots(uuid,date),public.create_booking(uuid,timestamptz,text,text,text,uuid,text),public.booking_details(uuid),public.cancel_booking(uuid) from public, anon, authenticated;
grant execute on function public.available_slots(uuid,date),public.create_booking(uuid,timestamptz,text,text,text,uuid,text),public.booking_details(uuid),public.cancel_booking(uuid) to anon,authenticated;
-- Replace weekly hours in one transaction so clients never see a half-saved schedule.
create function public.save_availability(p_hours jsonb) returns void language plpgsql security invoker set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Sign in first.'; end if;
 if jsonb_array_length(p_hours)>7 then raise exception 'One window per weekday is supported.'; end if;
 delete from availability where owner_id=auth.uid();
 insert into availability(owner_id,weekday,start_time,end_time)
 select auth.uid(),(x->>'weekday')::int,(x->>'start_time')::time,(x->>'end_time')::time from jsonb_array_elements(p_hours) x;
end; $$;
revoke all on function public.save_availability(jsonb) from public, anon, authenticated;
grant execute on function public.save_availability(jsonb) to authenticated;

create function public.validate_timezone() returns trigger language plpgsql set search_path=public as $$
begin
 if not exists(select 1 from pg_timezone_names where name=new.timezone) then raise exception 'Invalid timezone.'; end if;
 return new;
end; $$;
create trigger profile_timezone before insert or update on profiles for each row execute function validate_timezone();

-- Explicit privileges; RLS remains the authorization boundary.
grant usage on schema public to anon,authenticated;
grant select on profiles,services,availability to anon;
grant select,insert,update,delete on profiles,services,availability,consultant_settings to authenticated;
grant select on bookings to authenticated;

revoke execute on function public.validate_timezone() from public, anon, authenticated;
create index if not exists bookings_email_rate_limit on public.bookings(owner_id,lower(client_email),created_at desc);
create index if not exists services_owner_id on public.services(owner_id);
