-- Optional Google Calendar + Meet, using each consultant's explicit OAuth consent.
create table briefbooth_private.google_connections (
 owner_id uuid primary key references public.profiles on delete cascade,
 token_secret uuid not null references vault.secrets,
 expires_at timestamptz not null,
 ready boolean not null default true,
 synced_at timestamptz,
 error text
);
create table briefbooth_private.google_states (
 state uuid primary key default gen_random_uuid(),owner_id uuid not null references public.profiles on delete cascade,
 expires_at timestamptz not null default now()+interval '10 minutes'
);
create table briefbooth_private.google_busy (
 owner_id uuid not null references public.profiles on delete cascade,
 starts_at timestamptz not null, ends_at timestamptz not null, check(ends_at>starts_at)
);
create index on briefbooth_private.google_busy(owner_id,starts_at);
create table briefbooth_private.google_meetings (
 booking_id uuid primary key references public.bookings on delete cascade,
 status text not null default 'pending' check(status in ('pending','ready','failed','cancelled')),
 join_url text,event_id text,error text,next_attempt_at timestamptz not null default now()
);
alter table briefbooth_private.google_connections enable row level security;
alter table briefbooth_private.google_states enable row level security;
alter table briefbooth_private.google_busy enable row level security;
alter table briefbooth_private.google_meetings enable row level security;
revoke all on briefbooth_private.google_connections,briefbooth_private.google_states,briefbooth_private.google_busy,briefbooth_private.google_meetings from public,anon,authenticated;
create function public.google_config() returns jsonb language sql security definer set search_path='' as $$
select coalesce(jsonb_object_agg(substr(name,19),decrypted_secret),'{}'::jsonb) from vault.decrypted_secrets where name like 'briefbooth_google_%'; $$;
create function public.google_status() returns jsonb language sql security definer set search_path='' as $$
select jsonb_build_object('configured',nullif(public.google_config()->>'client_secret','') is not null,'connected',coalesce(c.ready,false),'synced_at',c.synced_at,'error',c.error)
from (select 1) x left join briefbooth_private.google_connections c on c.owner_id=auth.uid(); $$;
create function public.google_begin() returns text language plpgsql security definer set search_path='' as $$
declare cfg jsonb; nonce uuid;
begin
if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Sign in and save your profile first.'; end if;
cfg:=public.google_config();
if nullif(cfg->>'client_secret','') is null or nullif(cfg->>'client_id','') is null then raise exception 'Google connection setup is not available yet.'; end if;
delete from briefbooth_private.google_states where owner_id=auth.uid() or expires_at<now();
insert into briefbooth_private.google_states(owner_id) values(auth.uid()) returning state into nonce;
return 'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&access_type=offline&prompt=consent&client_id='||(cfg->>'client_id')||'&redirect_uri=https%3A%2F%2Fbriefbooth.com%2Fapi%2Fgoogle%2Fcallback&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.events.owned%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.freebusy&state='||nonce;
end; $$;
create function public.google_consume_state(p_state uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare owner uuid; begin delete from briefbooth_private.google_states where state=p_state and expires_at>now() returning owner_id into owner; return owner; end; $$;
create function public.google_store(p_owner uuid,p_tokens jsonb,p_refresh boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare secret_id uuid; prior jsonb;
begin
perform pg_advisory_xact_lock(hashtextextended(p_owner::text,720));
select c.token_secret,v.decrypted_secret::jsonb into secret_id,prior from briefbooth_private.google_connections c join vault.decrypted_secrets v on v.id=c.token_secret where c.owner_id=p_owner;
if p_refresh and secret_id is null then raise exception 'Google was disconnected.'; end if;
p_tokens:=coalesce(prior,'{}'::jsonb)||p_tokens;
if nullif(p_tokens->>'access_token','') is null or nullif(p_tokens->>'refresh_token','') is null then raise exception 'Google offline access was not granted. Reconnect and approve access.'; end if;
if secret_id is null then secret_id:=vault.create_secret(p_tokens::text); else perform vault.update_secret(secret_id,p_tokens::text); end if;
insert into briefbooth_private.google_connections(owner_id,token_secret,expires_at) values(p_owner,secret_id,now()+make_interval(secs=>(p_tokens->>'expires_in')::int)) on conflict(owner_id) do update set expires_at=excluded.expires_at,ready=true,error=null;
end; $$;
create function public.google_disconnect() returns void language plpgsql security definer set search_path='' as $$
declare sid uuid; begin
if auth.uid() is null then raise exception 'Sign in first.'; end if;
perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,720));
delete from briefbooth_private.google_connections where owner_id=auth.uid() returning token_secret into sid;
delete from vault.secrets where id=sid;
delete from briefbooth_private.google_busy where owner_id=auth.uid();
delete from briefbooth_private.google_states where owner_id=auth.uid();
update public.services set active=false where owner_id=auth.uid() and 'google_meet'=any(meeting_modes);
end; $$;
revoke all on function public.google_config(),public.google_consume_state(uuid),public.google_store(uuid,jsonb,boolean),public.google_begin(),public.google_status(),public.google_disconnect() from public,anon,authenticated;
grant execute on function public.google_config(),public.google_consume_state(uuid),public.google_store(uuid,jsonb,boolean) to service_role;
grant execute on function public.google_begin(),public.google_status(),public.google_disconnect() to authenticated;
alter table public.services drop constraint services_meeting_modes_check;
alter table public.services add constraint services_meeting_modes_check check(cardinality(meeting_modes) between 1 and 3 and meeting_modes <@ array['zoom','google_meet','in_person']::text[]);
alter table public.bookings drop constraint bookings_meeting_mode_check;
alter table public.bookings add constraint bookings_meeting_mode_check check(meeting_mode in ('zoom','google_meet','in_person'));
create function briefbooth_private.guard_google_booking() returns trigger language plpgsql security definer set search_path='' as $$
begin
if new.status in ('confirmed','pending_approval','pending_payment','payment_processing') and (tg_op='INSERT' or old.status is distinct from new.status) then
 if new.meeting_mode='google_meet' and not exists(select 1 from briefbooth_private.google_connections where owner_id=new.owner_id and ready) then raise exception 'This consultant needs to connect Google before accepting Google Meet bookings.'; end if;
 if exists(select 1 from briefbooth_private.google_connections where owner_id=new.owner_id and (not ready or synced_at is null or synced_at<now()-interval '10 minutes')) then raise exception 'Calendar availability is updating. Please try again shortly.'; end if;
 if exists(select 1 from briefbooth_private.google_busy where owner_id=new.owner_id and tstzrange(starts_at,ends_at,'[)') && tstzrange(new.starts_at,new.ends_at,'[)')) then raise exception 'That time is busy on the consultant calendar. Please choose another time.'; end if;
end if;
return new; end; $$;
create trigger google_booking_guard before insert or update on public.bookings for each row execute function briefbooth_private.guard_google_booking();
create function briefbooth_private.prepare_google_booking() returns trigger language plpgsql security definer set search_path='' as $$
begin
if new.status='confirmed' and new.meeting_mode='google_meet' then insert into briefbooth_private.google_meetings(booking_id) values(new.id) on conflict do nothing; end if;
return new; end; $$;
create trigger a_prepare_google_booking after insert or update on public.bookings for each row execute function briefbooth_private.prepare_google_booking();
create or replace function public.available_slots(p_service uuid, p_day date)
returns table(starts_at timestamptz) language sql stable security definer set search_path=public as $$
 select g.t from services s join profiles p on p.id=s.owner_id and p.published
 join availability a on a.owner_id=p.id and a.weekday=extract(dow from p_day)
 cross join lateral generate_series((p_day+a.start_time) at time zone p.timezone,
 ((p_day+a.end_time) at time zone p.timezone)-make_interval(mins=>s.duration), interval '15 minutes') as g(t)
 where s.id=p_service and s.active and p_day between (now() at time zone p.timezone)::date and (now() at time zone p.timezone)::date+60
 and g.t>=now()+interval '2 hours'
 and not exists(select 1 from bookings b where b.owner_id=p.id and b.status in ('confirmed','pending_payment','payment_processing','pending_approval')
 and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(g.t,g.t+make_interval(mins=>s.duration),'[)'))
 and not exists(select 1 from briefbooth_private.google_connections c where c.owner_id=p.id and (not c.ready or c.synced_at is null or c.synced_at<now()-interval '10 minutes'))
 and not exists(select 1 from briefbooth_private.google_busy c where c.owner_id=p.id and tstzrange(c.starts_at,c.ends_at,'[)') && tstzrange(g.t,g.t+make_interval(mins=>s.duration),'[)'))
 order by g.t;
$$;
create or replace function briefbooth_private.queue_booking_emails() returns trigger
language plpgsql security definer set search_path='' as $$
declare prof public.profiles; svc public.services; settings public.consultant_settings;
 consultant_email text; details text; location text;
begin
 if new.status <> 'confirmed' then return new; end if;
 if new.meeting_mode='google_meet' and not exists(select 1 from briefbooth_private.google_meetings where booking_id=new.id and status='ready') then return new; end if;
 if exists(select 1 from briefbooth_private.zoom_meetings where booking_id=new.id and status<>'ready') then return new; end if;
 if exists(select 1 from briefbooth_private.booking_emails where booking_id=new.id and recipient_kind in ('client','consultant')) then return new; end if;
 select * into strict prof from public.profiles where id=new.owner_id;
 select * into strict svc from public.services where id=new.service_id;
 select * into settings from public.consultant_settings where owner_id=new.owner_id;
 select email into consultant_email from auth.users where id=new.owner_id;
 location := case when new.meeting_mode='google_meet' then 'Google Meet link: '||(select join_url from briefbooth_private.google_meetings where booking_id=new.id) when new.meeting_mode='zoom' then 'Zoom link: '||coalesce(nullif((select join_url from briefbooth_private.zoom_meetings where booking_id=new.id),'') ,nullif(settings.meeting_url,''),'Your consultant will provide the link.')
 else 'In-person address: '||coalesce(nullif(settings.in_person_address,''),'Your consultant will provide the address.') end;
 details := 'Consultation: '||svc.title||E'\nConsultant: '||prof.name||E'\nClient: '||new.client_name||E'\nClient email: '||new.client_email
 ||E'\nWhen: '||to_char(new.starts_at at time zone prof.timezone,'FMDay, FMMonth DD, YYYY HH24:MI')||' – '||to_char(new.ends_at at time zone prof.timezone,'HH24:MI')||' ('||prof.timezone||')'
 ||E'\nUTC start: '||to_char(new.starts_at at time zone 'UTC','YYYY-MM-DD HH24:MI')||E'\nDuration: '||svc.duration||E' minutes\n'||location
 ||E'\n\nIntake details:\n'||coalesce(nullif(new.notes,''),'No additional intake details provided.');
 insert into briefbooth_private.booking_emails(booking_id,recipient_kind,recipient,subject,body)
 values(new.id,'client',new.client_email,'Your BriefBooth consultation is confirmed',
 E'Your consultation is booked.\n\n'||details||E'\n\nView or cancel your booking (keep this link private):\nhttps://briefbooth.com/manage/'||new.manage_token||E'/\n\nThis is an automated confirmation.');
 if consultant_email is not null then
 insert into briefbooth_private.booking_emails(booking_id,recipient_kind,recipient,subject,body)
 values(new.id,'consultant',consultant_email,'New BriefBooth consultation booked',
 E'A client booked a consultation.\n\n'||details||E'\n\nView your bookings:\nhttps://briefbooth.com/studio/\n\nThis is an automated confirmation.');
 end if;
 return new;
end; $$;


create or replace function public.booking_details(p_token uuid)
returns table(client_name text,title text,consultant text,starts_at timestamptz,ends_at timestamptz,status text,meeting_url text,meeting_mode text,in_person_address text)
language sql stable security definer set search_path='' as $$
select b.client_name,s.title,p.name,b.starts_at,b.ends_at,b.status,
case when b.status='confirmed' and b.meeting_mode='google_meet' then coalesce(g.join_url,'') when b.status='confirmed' and b.meeting_mode='zoom' then case when z.booking_id is not null then coalesce(z.join_url,'') else coalesce(cs.meeting_url,'') end else '' end,
b.meeting_mode,case when b.status='confirmed' and b.meeting_mode='in_person' then coalesce(cs.in_person_address,'') else '' end
from public.bookings b join public.services s on s.id=b.service_id join public.profiles p on p.id=b.owner_id left join public.consultant_settings cs on cs.owner_id=p.id left join briefbooth_private.zoom_meetings z on z.booking_id=b.id left join briefbooth_private.google_meetings g on g.booking_id=b.id where b.manage_token=p_token;
$$;
-- Service-only worker interfaces. No calendar titles or descriptions are stored.
create function public.google_worker_context() returns jsonb language sql security definer set search_path='' as $$
select coalesce(jsonb_agg(jsonb_build_object('owner_id',c.owner_id,'tokens',v.decrypted_secret::jsonb,'expires_at',c.expires_at)),'[]'::jsonb)
from (select * from briefbooth_private.google_connections where ready order by synced_at nulls first limit 10) c join vault.decrypted_secrets v on v.id=c.token_secret; $$;
create function public.google_sync_busy(p_owner uuid,p_busy jsonb,p_at timestamptz) returns void language plpgsql security definer set search_path='' as $$
begin
perform pg_advisory_xact_lock(hashtextextended(p_owner::text,720));
if not exists(select 1 from briefbooth_private.google_connections where owner_id=p_owner and ready and (synced_at is null or synced_at<=p_at)) then return; end if;
if jsonb_typeof(p_busy)<>'array' or jsonb_array_length(p_busy)>10000 then raise exception 'Invalid availability response'; end if;
delete from briefbooth_private.google_busy where owner_id=p_owner;
insert into briefbooth_private.google_busy select p_owner,(x->>'start')::timestamptz,(x->>'end')::timestamptz from jsonb_array_elements(p_busy) x;
update briefbooth_private.google_connections set synced_at=p_at,error=null where owner_id=p_owner;
end; $$;
create function public.google_worker_error(p_owner uuid,p_revoked boolean) returns void language sql security definer set search_path='' as $$
update briefbooth_private.google_connections set ready=not p_revoked,error=case when p_revoked then 'Reconnect Google to restore calendar access.' else 'Calendar sync is delayed. Please try again shortly.' end where owner_id=p_owner; $$;
create function public.google_jobs(p_owner uuid) returns jsonb language sql security definer set search_path='' as $$
select coalesce(jsonb_agg(to_jsonb(j)),'[]'::jsonb) from (
select g.booking_id,g.event_id,g.status,b.starts_at,b.ends_at,b.status booking_status,s.title
from briefbooth_private.google_meetings g join public.bookings b on b.id=g.booking_id join public.services s on s.id=b.service_id
where b.owner_id=p_owner and g.next_attempt_at<=now() and b.starts_at>now() and (g.status='pending' or (b.status in ('cancelled','declined') and g.status='ready')) order by b.created_at limit 5) j; $$;
create function public.google_job_result(p_booking uuid,p_url text,p_event text,p_cancelled boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare b public.bookings;
begin
select * into b from public.bookings where id=p_booking for update;
if not p_cancelled and (p_url !~ '^https://meet[.]google[.]com/[a-z]{3}-[a-z]{4}-[a-z]{3}$' or p_url is null) then raise exception 'Invalid meeting link'; end if;
update briefbooth_private.google_meetings set status=case when p_cancelled then 'cancelled' else 'ready' end,join_url=case when p_cancelled then null else p_url end,event_id=p_event,error=null where booking_id=p_booking;
-- A cancellation racing with Google creation is retained for deletion on the next run.
if b.status='confirmed' and not p_cancelled then update public.bookings set status=status where id=b.id; end if;
end; $$;
create function public.google_job_delay(p_booking uuid) returns void language sql security definer set search_path='' as $$
update briefbooth_private.google_meetings set next_attempt_at=now()+interval '5 minutes',error='Google meeting creation is delayed; retry scheduled.' where booking_id=p_booking; $$;
revoke all on function public.google_worker_context(),public.google_sync_busy(uuid,jsonb,timestamptz),public.google_worker_error(uuid,boolean),public.google_jobs(uuid),public.google_job_result(uuid,text,text,boolean),public.google_job_delay(uuid) from public,anon,authenticated;
grant execute on function public.google_worker_context(),public.google_sync_busy(uuid,jsonb,timestamptz),public.google_worker_error(uuid,boolean),public.google_jobs(uuid),public.google_job_result(uuid,text,text,boolean),public.google_job_delay(uuid) to service_role;

create function briefbooth_private.guard_google_service() returns trigger language plpgsql security definer set search_path='' as $$
begin
if new.active and 'google_meet'=any(new.meeting_modes) and not exists(select 1 from briefbooth_private.google_connections where owner_id=new.owner_id and ready) then raise exception 'Connect Google in your profile before offering Google Meet.'; end if;
return new; end; $$;
create trigger google_service_guard before insert or update on public.services for each row execute function briefbooth_private.guard_google_service();
revoke all on function briefbooth_private.guard_google_service(),briefbooth_private.guard_google_booking(),briefbooth_private.prepare_google_booking() from public,anon,authenticated;
