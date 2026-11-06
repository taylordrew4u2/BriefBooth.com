-- Private, transactional outbox. No credentials or intake data are exposed by RPC.
create schema if not exists briefbooth_private;
revoke all on schema briefbooth_private from public, anon, authenticated;
create table briefbooth_private.booking_emails (
 id uuid primary key default gen_random_uuid(),
 booking_id uuid not null references public.bookings on delete cascade,
 recipient_kind text not null check(recipient_kind in ('client','consultant')),
 recipient text not null,
 subject text not null,
 body text not null,
 status text not null default 'pending' check(status in ('pending','accepted','failed','uncertain','skipped')),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 accepted_at timestamptz,
 last_error text,
 unique(booking_id,recipient_kind)
);
alter table briefbooth_private.booking_emails enable row level security;
revoke all on briefbooth_private.booking_emails from public, anon, authenticated;
create index booking_emails_pending on briefbooth_private.booking_emails(next_attempt_at) where status='pending';
create function briefbooth_private.queue_booking_emails() returns trigger
language plpgsql security definer set search_path='' as $$
declare prof public.profiles; svc public.services; settings public.consultant_settings;
 consultant_email text; details text; location text;
begin
 if new.status <> 'confirmed' then return new; end if;
 select * into strict prof from public.profiles where id=new.owner_id;
 select * into strict svc from public.services where id=new.service_id;
 select * into settings from public.consultant_settings where owner_id=new.owner_id;
 select email into consultant_email from auth.users where id=new.owner_id;
 location := case when new.meeting_mode='zoom' then 'Zoom link: '||coalesce(nullif(settings.meeting_url,''),'Your consultant will provide the link.')
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
revoke all on function briefbooth_private.queue_booking_emails() from public,anon,authenticated;
create trigger booking_confirmation_emails after insert on public.bookings for each row execute function briefbooth_private.queue_booking_emails();
