-- Add meeting format without changing existing appointments (they retain Zoom).
alter table public.consultant_settings add column in_person_address text not null default '' check(length(in_person_address)<=500);
alter table public.services add column meeting_modes text[] not null default array['zoom']::text[] check(cardinality(meeting_modes) between 1 and 2 and meeting_modes <@ array['zoom','in_person']::text[]);
alter table public.bookings add column meeting_mode text not null default 'zoom' check(meeting_mode in ('zoom','in_person'));
drop function public.create_booking(uuid,timestamptz,text,text,text,uuid);
drop function public.booking_details(uuid);
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
revoke all on function public.create_booking(uuid,timestamptz,text,text,text,uuid,text),public.booking_details(uuid) from public,anon,authenticated;
grant execute on function public.create_booking(uuid,timestamptz,text,text,text,uuid,text),public.booking_details(uuid) to anon,authenticated;
notify pgrst,'reload schema';
