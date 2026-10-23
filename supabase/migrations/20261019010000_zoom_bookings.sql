-- Zoom OAuth tokens remain encrypted in Vault; only private worker code reads them.
create table briefbooth_private.zoom_connections (
 owner_id uuid primary key references public.profiles on delete cascade,
 token_secret uuid not null references vault.secrets(id),
 expires_at timestamptz not null,
 ready boolean not null default true
);
create table briefbooth_private.zoom_states (
 state uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles on delete cascade,
 expires_at timestamptz not null default now()+interval '10 minutes'
);
create table briefbooth_private.zoom_meetings (
 booking_id uuid primary key references public.bookings on delete cascade,
 status text not null default 'pending' check(status in ('pending','ready','failed','uncertain','skipped')),
 join_url text,
 meeting_id text,
 last_error text,
 next_attempt_at timestamptz not null default now()
);
alter table briefbooth_private.zoom_connections enable row level security;
alter table briefbooth_private.zoom_states enable row level security;
alter table briefbooth_private.zoom_meetings enable row level security;
revoke all on briefbooth_private.zoom_connections,briefbooth_private.zoom_states,briefbooth_private.zoom_meetings from public,anon,authenticated;
create function public.zoom_config() returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_object_agg(substr(name,17),decrypted_secret),'{}'::jsonb) from vault.decrypted_secrets where name like 'briefbooth_zoom_%';
$$;
create function public.zoom_status() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('connected',exists(select 1 from briefbooth_private.zoom_connections where owner_id=auth.uid() and ready));
$$;
create function public.zoom_begin() returns text language plpgsql security definer set search_path='' as $$
declare cfg jsonb; nonce uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Sign in and save your profile first.'; end if;
 cfg:=public.zoom_config();
 -- Development credentials are limited to the owner's Zoom account until Zoom approves distribution.
 if cfg->>'allowed_owner' is distinct from auth.uid()::text and cfg->>'public' is distinct from 'true' then raise exception 'Zoom connection is awaiting approval for additional consultants.'; end if;
 if nullif(cfg->>'client_secret','') is null then raise exception 'Zoom setup is not complete yet.'; end if;
 delete from briefbooth_private.zoom_states where owner_id=auth.uid() or expires_at<now();
 insert into briefbooth_private.zoom_states(owner_id) values(auth.uid()) returning state into nonce;
 return 'https://zoom.us/oauth/authorize?response_type=code&client_id='||(cfg->>'client_id')||'&redirect_uri=https%3A%2F%2Fkjjfpacypvdfdktkssst.supabase.co%2Ffunctions%2Fv1%2Fzoom%2Fcallback&state='||nonce;
end; $$;
create function public.zoom_consume_state(p_state uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare owner uuid;
begin
 delete from briefbooth_private.zoom_states where state=p_state and expires_at>now() returning owner_id into owner;
 return owner;
end; $$;
create function public.zoom_store(p_owner uuid,p_tokens jsonb) returns void language plpgsql security definer set search_path='' as $$
declare secret_id uuid;
begin
 if nullif(p_tokens->>'access_token','') is null or nullif(p_tokens->>'refresh_token','') is null then raise exception 'Invalid Zoom tokens'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,710));
 select token_secret into secret_id from briefbooth_private.zoom_connections where owner_id=p_owner;
 if secret_id is null then
 secret_id:=vault.create_secret(p_tokens::text);
 else perform vault.update_secret(secret_id,p_tokens::text); end if;
 insert into briefbooth_private.zoom_connections values(p_owner,secret_id,now()+make_interval(secs=>(p_tokens->>'expires_in')::int),true)
 on conflict(owner_id) do update set expires_at=excluded.expires_at,ready=true;
end; $$;
revoke all on function public.zoom_config(),public.zoom_consume_state(uuid),public.zoom_store(uuid,jsonb),public.zoom_begin(),public.zoom_status() from public,anon,authenticated;
grant execute on function public.zoom_config(),public.zoom_consume_state(uuid),public.zoom_store(uuid,jsonb) to service_role;
grant execute on function public.zoom_begin(),public.zoom_status() to authenticated;

-- Hold confirmation emails until a unique Zoom URL is ready.
create function briefbooth_private.prepare_zoom_booking() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='confirmed' and new.meeting_mode='zoom' and exists(select 1 from briefbooth_private.zoom_connections where owner_id=new.owner_id and ready) then
 insert into briefbooth_private.zoom_meetings(booking_id) values(new.id) on conflict do nothing;
 end if;
 return new;
end; $$;
create trigger a_prepare_zoom_booking after insert on public.bookings for each row execute function briefbooth_private.prepare_zoom_booking();
create or replace function briefbooth_private.queue_booking_emails() returns trigger
language plpgsql security definer set search_path='' as $$
declare prof public.profiles; svc public.services; settings public.consultant_settings;
 consultant_email text; details text; location text;
begin
 if new.status <> 'confirmed' then return new; end if;
 if exists(select 1 from briefbooth_private.zoom_meetings where booking_id=new.id and status<>'ready') then return new; end if;
 if exists(select 1 from briefbooth_private.booking_emails where booking_id=new.id) then return new; end if;
 select * into strict prof from public.profiles where id=new.owner_id;
 select * into strict svc from public.services where id=new.service_id;
 select * into settings from public.consultant_settings where owner_id=new.owner_id;
 select email into consultant_email from auth.users where id=new.owner_id;
 location := case when new.meeting_mode='zoom' then 'Zoom link: '||coalesce(nullif((select join_url from briefbooth_private.zoom_meetings where booking_id=new.id),'') ,nullif(settings.meeting_url,''),'Your consultant will provide the link.')
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
 case when b.status='confirmed' and b.meeting_mode='zoom' then
 case when z.booking_id is not null then coalesce(z.join_url,'') else coalesce(cs.meeting_url,'') end else '' end,
 b.meeting_mode,case when b.status='confirmed' and b.meeting_mode='in_person' then coalesce(cs.in_person_address,'') else '' end
 from public.bookings b join public.services s on s.id=b.service_id join public.profiles p on p.id=b.owner_id left join public.consultant_settings cs on cs.owner_id=p.id left join briefbooth_private.zoom_meetings z on z.booking_id=b.id where b.manage_token=p_token;
$$;
create function briefbooth_private.create_zoom_meetings() returns void language plpgsql security definer set search_path='' as $$
declare job record; conn briefbooth_private.zoom_connections; cfg jsonb; tokens jsonb; response extensions.http_response; result jsonb; basic text;
begin
 if not pg_try_advisory_xact_lock(492483718) then return; end if;
 cfg:=public.zoom_config();
 if nullif(cfg->>'client_secret','') is null then return; end if;
 basic:='Basic '||replace(encode(convert_to((cfg->>'client_id')||':'||(cfg->>'client_secret'),'UTF8'),'base64'),E'\n','');
 perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','8000');
 perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS','3000');
 for job in select z.booking_id,b.owner_id,b.starts_at,b.ends_at,b.status from briefbooth_private.zoom_meetings z join public.bookings b on b.id=z.booking_id where z.status='pending' and z.next_attempt_at<=now() order by b.created_at limit 3 for update of z skip locked loop
 if job.status<>'confirmed' or job.starts_at<=now() then update briefbooth_private.zoom_meetings set status='skipped' where booking_id=job.booking_id; continue; end if;
 perform pg_advisory_xact_lock(hashtextextended(job.owner_id::text,710));
 select * into conn from briefbooth_private.zoom_connections where owner_id=job.owner_id;
 if not coalesce(conn.ready,false) then update briefbooth_private.zoom_meetings set status='failed',last_error='Reconnect Zoom in your studio.' where booking_id=job.booking_id; continue; end if;
 select decrypted_secret::jsonb into tokens from vault.decrypted_secrets where id=conn.token_secret;
 if conn.expires_at<now()+interval '2 minutes' then
 begin
 select * into response from extensions.http(('POST','https://zoom.us/oauth/token',array[extensions.http_header('Authorization',basic)],'application/x-www-form-urlencoded','grant_type=refresh_token&refresh_token='||extensions.urlencode(tokens->>'refresh_token'))::extensions.http_request);
 if response.status<>200 then
 update briefbooth_private.zoom_connections set ready=false where owner_id=job.owner_id;
 update briefbooth_private.zoom_meetings set status='failed',last_error='Reconnect Zoom in your studio.' where booking_id=job.booking_id;
 continue;
 end if;
 tokens:=response.content::jsonb;
 perform public.zoom_store(job.owner_id,tokens);
 exception when others then
 update briefbooth_private.zoom_connections set ready=false where owner_id=job.owner_id;
 update briefbooth_private.zoom_meetings set status='failed',last_error='Reconnect Zoom after token refresh failed.' where booking_id=job.booking_id;
 continue;
 end;
 end if;
 -- Unknown outcomes are never blindly retried: Zoom creation has no idempotency key.
 begin
 select * into response from extensions.http(('POST','https://api.zoom.us/v2/users/me/meetings',array[extensions.http_header('Authorization','Bearer '||(tokens->>'access_token'))],'application/json',jsonb_build_object('topic','BriefBooth consultation','type',2,'start_time',to_char(job.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'duration',extract(epoch from job.ends_at-job.starts_at)::int/60,'timezone','UTC','settings',jsonb_build_object('use_pmi',false,'waiting_room',true,'join_before_host',false,'auto_recording','none'))::text)::extensions.http_request);
 if response.status=201 then
 result:=response.content::jsonb;
 if coalesce(result->>'join_url','') !~ '^https://([a-zA-Z0-9-]+\.)*zoom\.(us|com)/' then raise exception 'Invalid meeting URL'; end if;
 update briefbooth_private.zoom_meetings set status='ready',join_url=result->>'join_url',meeting_id=result->>'id',last_error=null where booking_id=job.booking_id;
 update public.bookings set status=status where id=job.booking_id;
 elsif response.status=429 then
 update briefbooth_private.zoom_meetings set next_attempt_at=now()+interval '1 hour',last_error='Zoom limit reached; waiting without paid upgrade.' where booking_id=job.booking_id;
 else
 update briefbooth_private.zoom_meetings set status=case when response.status>=500 then 'uncertain' else 'failed' end,last_error='Zoom HTTP '||response.status where booking_id=job.booking_id;
 end if;
 exception when others then
 update briefbooth_private.zoom_meetings set status='uncertain',last_error='Meeting outcome unknown. Review Zoom before retrying.' where booking_id=job.booking_id;
 end;
 end loop;
end; $$;
revoke all on function briefbooth_private.prepare_zoom_booking(),briefbooth_private.create_zoom_meetings() from public,anon,authenticated;
select cron.schedule('briefbooth-zoom-meetings','* * * * *','select briefbooth_private.create_zoom_meetings()');
