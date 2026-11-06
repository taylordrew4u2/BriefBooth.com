alter table public.profiles add column booking_mode text not null default 'instant' check(booking_mode in ('instant','approval'));
alter table public.bookings drop constraint bookings_status_check;
alter table public.bookings add constraint bookings_status_check check(status in ('confirmed','cancelled','pending_payment','payment_processing','expired','pending_approval','declined'));
alter table public.bookings drop constraint bookings_no_overlap;
alter table public.bookings add constraint bookings_no_overlap exclude using gist(owner_id with =, tstzrange(starts_at,ends_at,'[)') with &&) where(status in ('confirmed','pending_payment','payment_processing','pending_approval'));
create function briefbooth_private.apply_booking_mode() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='confirmed' and exists(select 1 from public.profiles where id=new.owner_id and booking_mode='approval') then new.status:='pending_approval'; end if;
 return new;
end; $$;
create trigger apply_booking_mode before insert on public.bookings for each row execute function briefbooth_private.apply_booking_mode();
create function public.review_booking(p_booking uuid,p_approve boolean) returns text language plpgsql security definer set search_path='' as $$
declare b public.bookings;
begin
 select * into b from public.bookings where id=p_booking and owner_id=auth.uid() for update;
 if b.id is null then raise exception 'Booking not found.'; end if;
 if b.status<>'pending_approval' then raise exception 'This request has already been reviewed or cancelled.'; end if;
 if b.starts_at<=now() then raise exception 'This requested time has passed. Ask the client to request another time.'; end if;
 update public.bookings set status=case when p_approve then 'confirmed' else 'declined' end where id=b.id;
 return case when p_approve then 'confirmed' else 'declined' end;
end; $$;
revoke all on function briefbooth_private.apply_booking_mode(),public.review_booking(uuid,boolean) from public,anon,authenticated;
grant execute on function public.review_booking(uuid,boolean) to authenticated;
create or replace function public.cancel_booking(p_token uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.bookings set status='cancelled' where manage_token=p_token and status in ('confirmed','pending_approval') and starts_at>now();
 return found;
end; $$;
drop trigger a_prepare_zoom_booking on public.bookings;
create trigger a_prepare_zoom_booking after insert or update of status on public.bookings for each row execute function briefbooth_private.prepare_zoom_booking();
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
 order by g.t;
$$;
create or replace function briefbooth_private.queue_booking_emails() returns trigger
language plpgsql security definer set search_path='' as $$
declare prof public.profiles; svc public.services; settings public.consultant_settings;
 consultant_email text; details text; location text;
begin
 if new.status <> 'confirmed' then return new; end if;
 if exists(select 1 from briefbooth_private.zoom_meetings where booking_id=new.id and status<>'ready') then return new; end if;
 if exists(select 1 from briefbooth_private.booking_emails where booking_id=new.id and recipient_kind in ('client','consultant')) then return new; end if;
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


alter table briefbooth_private.booking_emails drop constraint booking_emails_recipient_kind_check;
alter table briefbooth_private.booking_emails add constraint booking_emails_recipient_kind_check check(recipient_kind in ('client','consultant','request_client','request_consultant','declined_client'));
create function briefbooth_private.queue_request_emails() returns trigger language plpgsql security definer set search_path='' as $$
declare prof public.profiles; svc public.services; owner_email text; details text;
begin
 if new.status not in ('pending_approval','declined') then return new; end if;
 if tg_op='UPDATE' and old.status=new.status then return new; end if;
 select * into prof from public.profiles where id=new.owner_id;
 select * into svc from public.services where id=new.service_id;
 select email into owner_email from auth.users where id=new.owner_id;
 details:='Consultation: '||svc.title||E'
Consultant: '||prof.name||E'
Client: '||new.client_name||E'
Client email: '||new.client_email||E'
Requested time: '||to_char(new.starts_at at time zone prof.timezone,'YYYY-MM-DD HH24:MI')||' ('||prof.timezone||')'||E'

Intake details:
'||new.notes;
 if new.status='pending_approval' then
 insert into briefbooth_private.booking_emails(booking_id,recipient_kind,recipient,subject,body) values
 (new.id,'request_client',new.client_email,'Consultation request received — awaiting approval',E'Your request is awaiting consultant approval. This is not a confirmed meeting. You will receive meeting details after approval.

'||details||E'

View or cancel your request: https://briefbooth.com/manage/'||new.manage_token||'/'),
 (new.id,'request_consultant',owner_email,'New consultation request — approval needed',E'Review this request and approve or decline in your studio: https://briefbooth.com/studio/

'||details) on conflict do nothing;
 else
 insert into briefbooth_private.booking_emails(booking_id,recipient_kind,recipient,subject,body) values(new.id,'declined_client',new.client_email,'Consultation request declined',E'The consultant could not accept this request. You can contact them or request another time.

'||details||E'

https://briefbooth.com/book/'||prof.slug) on conflict do nothing;
 end if;
 return new;
end; $$;
revoke all on function briefbooth_private.queue_request_emails() from public,anon,authenticated;
create trigger request_notifications after insert or update of status on public.bookings for each row execute function briefbooth_private.queue_request_emails();
create or replace function briefbooth_private.send_booking_emails() returns void
language plpgsql security definer set search_path='' as $$
declare mail briefbooth_private.booking_emails; api_key text; response extensions.http_response; payload jsonb;
begin
 if not pg_try_advisory_xact_lock(492483717) then return; end if;
 select decrypted_secret into api_key from vault.decrypted_secrets where name='briefbooth_brevo_api_key';
 if nullif(api_key,'') is null then return; end if;
 perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','5000');
 perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS','3000');
 for mail in select * from briefbooth_private.booking_emails where status='pending' and next_attempt_at<=now() order by created_at limit 3 for update skip locked loop
  if not exists(select 1 from public.bookings where id=mail.booking_id and starts_at>now() and ((status='confirmed' and mail.recipient_kind in ('client','consultant')) or (status='pending_approval' and mail.recipient_kind in ('request_client','request_consultant')) or (status='declined' and mail.recipient_kind='declined_client'))) then
   update briefbooth_private.booking_emails set status='skipped',last_error='Booking cancelled or already started' where id=mail.id;
   continue;
  end if;
  payload:=jsonb_build_object('sender',jsonb_build_object('name','BriefBooth','email','no-reply@briefbooth.com'),
   'to',jsonb_build_array(jsonb_build_object('email',mail.recipient)), 'subject',mail.subject,'textContent',mail.body,
   'headers',jsonb_build_object('idempotencyKey',mail.id::text));
  begin
   select * into response from extensions.http((
    'POST','https://api.brevo.com/v3/smtp/email',
    array[extensions.http_header('api-key',api_key)],'application/json',payload::text
   )::extensions.http_request);
   if response.status between 200 and 299 then
    update briefbooth_private.booking_emails set status='accepted',accepted_at=now(),attempts=attempts+1,last_error=null where id=mail.id;
   elsif response.status=429 then
    update briefbooth_private.booking_emails set next_attempt_at=now()+interval '1 hour',attempts=attempts+1,last_error='Provider rate limit; waiting without paid fallback' where id=mail.id;
   elsif response.status in (401,403) then
    update briefbooth_private.booking_emails set next_attempt_at=now()+interval '1 hour',attempts=attempts+1,last_error='Email credential or sender needs attention' where id=mail.id;
    exit;
   elsif response.status=400 and response.content::jsonb->>'code'='duplicate_parameter' then
    update briefbooth_private.booking_emails set status='accepted',accepted_at=now(),attempts=attempts+1,last_error=null where id=mail.id;
   else
    update briefbooth_private.booking_emails set status=case when response.status>=500 then 'uncertain' else 'failed' end,
     attempts=attempts+1,last_error='Provider HTTP '||response.status where id=mail.id;
   end if;
  exception when others then
   -- A timeout may happen after acceptance. Do not resend automatically and risk duplicate mail.
   update briefbooth_private.booking_emails set status='uncertain',attempts=attempts+1,last_error='Delivery outcome unknown; review provider logs before retrying' where id=mail.id;
  end;
 end loop;
 -- Retain only recent delivery records, which include private intake snapshots.
 delete from briefbooth_private.booking_emails where status<>'pending' and created_at<now()-interval '30 days';
end; $$;
revoke all on function briefbooth_private.send_booking_emails() from public,anon,authenticated;
