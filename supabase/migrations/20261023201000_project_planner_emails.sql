-- Owner-triggered 4u Digital project-planner invitations. Existing Free resources only.
-- Public operations only queue/status; the provider worker runs after that transaction commits.
-- No booking, authentication, or project-brief worker is replaced or patched here.
create schema if not exists four_u_private;
revoke all on schema four_u_private from public,anon,authenticated;
create table four_u_private.planner_emails (
 id uuid primary key,
 owner_id uuid not null references public.profiles(id) on delete cascade,
 booking_id uuid not null references public.bookings(id) on delete cascade,
 recipient text not null check(length(recipient) between 3 and 254 and recipient !~ '[[:cntrl:]]'),
 status text not null default 'pending' check(status in ('pending','accepted','uncertain','failed')),
 created_at timestamptz not null default now(),
 next_attempt_at timestamptz not null default now(),
 accepted_at timestamptz,
 attempts integer not null default 0 check(attempts>=0),
 provider_message_id text,
 last_error text
);
alter table four_u_private.planner_emails enable row level security;
revoke all on four_u_private.planner_emails from public,anon,authenticated;
create index planner_emails_client_idx on four_u_private.planner_emails(owner_id,recipient,created_at desc);
create index planner_emails_pending_idx on four_u_private.planner_emails(next_attempt_at) where status='pending';
create index planner_emails_accepted_idx on four_u_private.planner_emails(accepted_at) where accepted_at is not null;

create function four_u_private.require_planner_owner() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare planner_owner_id constant uuid:='adc53778-f007-4c58-bd47-ba7a675abb29';
begin
 if auth.uid() is distinct from planner_owner_id or not exists (
  select 1 from auth.users u
  join briefbooth_private.account_roles r on r.user_id=u.id and r.role='consultant'
  join public.profiles p on p.id=u.id
  where u.id=planner_owner_id and u.email_confirmed_at is not null
 ) then raise exception 'Only the verified 4u Digital consultant can send project planners.' using errcode='42501'; end if;
 return planner_owner_id;
end; $$;
revoke all on function four_u_private.require_planner_owner() from public,anon,authenticated;

create function four_u_private.planner_email_status(mail four_u_private.planner_emails) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object(
  'request_id',mail.id,'booking_id',mail.booking_id,'recipient',mail.recipient,
  'status',mail.status,'created_at',mail.created_at,'accepted_at',mail.accepted_at,
  'next_attempt_at',mail.next_attempt_at,
  'cooldown_until',coalesce(mail.accepted_at,mail.created_at)+interval '24 hours',
  'can_send',mail.status not in ('pending','uncertain') and coalesce(mail.accepted_at,mail.created_at)+interval '24 hours'<=now(),
  'last_error',mail.last_error
 );
$$;
revoke all on function four_u_private.planner_email_status(four_u_private.planner_emails) from public,anon,authenticated;

create function public.get_4u_project_planner_status(p_booking uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare planner_owner_id uuid; booking public.bookings; mail four_u_private.planner_emails; result jsonb; day_start timestamptz;
begin
 planner_owner_id:=four_u_private.require_planner_owner();
 if p_booking is null then raise exception 'Choose a client booking first.' using errcode='22023'; end if;
 select b.* into booking from public.bookings b where b.id=p_booking and b.owner_id=planner_owner_id;
 if not found then raise exception 'Booking not found or you do not have access.' using errcode='42501'; end if;
 select e.* into mail from four_u_private.planner_emails e where e.owner_id=planner_owner_id and e.recipient=lower(trim(booking.client_email)) order by e.created_at desc,e.id limit 1;
 if found then result:=four_u_private.planner_email_status(mail);
 else result:=jsonb_build_object('status','not_sent','recipient',lower(trim(booking.client_email)),
  'booking_id',booking.id,'can_send',true,'cooldown_until',null); end if;
 day_start:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 if (result->>'can_send')::boolean and (select count(*) from four_u_private.planner_emails e where e.created_at>=day_start)>=10 then
  result:=result||jsonb_build_object('can_send',false,'cooldown_until',day_start+interval '1 day',
   'last_error','The free planner email limit has been reached for today. Try again tomorrow or copy the planner link.');
 end if;
 return result;
end; $$;
revoke all on function public.get_4u_project_planner_status(uuid) from public,anon;
grant execute on function public.get_4u_project_planner_status(uuid) to authenticated;

create function public.send_4u_project_planner(p_booking uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare planner_owner_id uuid; booking public.bookings; mail four_u_private.planner_emails; previous four_u_private.planner_emails; address text; day_start timestamptz;
begin
 planner_owner_id:=four_u_private.require_planner_owner();
 if p_booking is null or p_request is null then raise exception 'Choose a client booking and a request reference first.' using errcode='22023'; end if;
 if p_request::text !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 then raise exception 'Please start a new send request with a valid reference.' using errcode='22023'; end if;
 select b.* into booking from public.bookings b where b.id=p_booking and b.owner_id=planner_owner_id;
 if not found then raise exception 'Booking not found or you do not have access.' using errcode='42501'; end if;
 address:=lower(trim(booking.client_email));
 if length(address)>254 or address ~ '[[:cntrl:]]' or address !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  or length(split_part(address,'@',1))>64 or split_part(address,'@',1) like '.%' or split_part(address,'@',1) like '%.' or split_part(address,'@',1) like '%..%'
 then raise exception 'This booking does not have a valid client email address.' using errcode='22023'; end if;
 -- One narrow lock protects UUID deduplication, recipient cooldown and daily volume.
 perform pg_advisory_xact_lock(492483719);
 select e.* into mail from four_u_private.planner_emails e where e.id=p_request for update;
 if found then
  if mail.owner_id<>planner_owner_id or mail.booking_id<>p_booking or mail.recipient<>address
  then raise exception 'This request reference belongs to a different client or booking.' using errcode='22023'; end if;
  return four_u_private.planner_email_status(mail);
 end if;
 select e.* into previous from four_u_private.planner_emails e where e.owner_id=planner_owner_id and e.recipient=address order by e.created_at desc,e.id limit 1;
 if found then
  if previous.status='uncertain' then raise exception 'The previous delivery is uncertain. Review provider logs before sending another planner.'; end if;
  if previous.status='pending' then raise exception 'A planner is already queued for this client. Check its status rather than sending it again.'; end if;
  if coalesce(previous.accepted_at,previous.created_at)+interval '24 hours'>now()
  then raise exception 'A planner was already requested for this client. Wait 24 hours before sending another.'; end if;
 end if;
 day_start:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 if (select count(*) from four_u_private.planner_emails e where e.created_at>=day_start)>=10
 then raise exception 'The free planner email limit has been reached for today. Try again tomorrow or copy the planner link.'; end if;
 insert into four_u_private.planner_emails(id,owner_id,booking_id,recipient)
 values(p_request,planner_owner_id,p_booking,address) returning * into mail;
 -- There is intentionally no provider HTTP call inside this user transaction.
 return four_u_private.planner_email_status(mail);
end; $$;
revoke all on function public.send_4u_project_planner(uuid,uuid) from public,anon;
grant execute on function public.send_4u_project_planner(uuid,uuid) to authenticated;

create function four_u_private.planner_email_payload(mail four_u_private.planner_emails) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object(
  'sender',jsonb_build_object('name','4u Digital','email','admin@customtechbuilt4u.com'),
  'replyTo',jsonb_build_object('name','4u Digital','email','admin@customtechbuilt4u.com'),
  'to',jsonb_build_array(jsonb_build_object('email',mail.recipient)),
  'subject','Your 4u Digital project planner',
  'textContent',E'Hi,\n\nYou can share your website, app or software ideas with 4u Digital here:\n\nhttps://customtechbuilt4u.com/project-brief/\n\nStart with what you know and skip anything you haven’t decided. You can explore styles, make your own color palette, add references and files, then review everything before sending it to me.\n\nThere’s no need for a finished plan. Your answers are a starting point for our conversation.\n\n4u Digital',
  'htmlContent','<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your 4u Digital project planner</title></head><body style="margin:0;background:#fff;color:#171717;font-family:Arial,Helvetica,sans-serif"><main style="max-width:600px;margin:0 auto;padding:28px 20px"><h1 style="font-size:25px;line-height:1.3;margin:0 0 24px">Your 4u Digital project planner</h1><p style="font-size:16px;line-height:1.7">Hi,</p><p style="font-size:16px;line-height:1.7">You can share your website, app or software ideas with 4u Digital here:</p><p style="font-size:16px;line-height:1.7"><a href="https://customtechbuilt4u.com/project-brief/" style="color:#171717;font-weight:700;overflow-wrap:anywhere">https://customtechbuilt4u.com/project-brief/</a></p><p style="font-size:16px;line-height:1.7">Start with what you know and skip anything you haven’t decided. You can explore styles, make your own color palette, add references and files, then review everything before sending it to me.</p><p style="font-size:16px;line-height:1.7">There’s no need for a finished plan. Your answers are a starting point for our conversation.</p><p style="font-size:16px;line-height:1.7;font-weight:700">4u Digital</p></main></body></html>',
  'tags',jsonb_build_array('4u-digital','project-planner'),
  'headers',jsonb_build_object('idempotencyKey',mail.id::text)
 );
$$;
revoke all on function four_u_private.planner_email_payload(four_u_private.planner_emails) from public,anon,authenticated;

create function four_u_private.purge_planner_emails() returns void
language plpgsql security definer set search_path='' as $$
begin
 update four_u_private.planner_emails set status='failed',last_error='Delivery window expired. Review before sending another planner.'
 where status='pending' and created_at<now()-interval '7 days';
 delete from four_u_private.planner_emails where created_at<now()-interval '30 days';
end; $$;
revoke all on function four_u_private.purge_planner_emails() from public,anon,authenticated;

create function four_u_private.send_planner_emails() returns void
language plpgsql security definer set search_path='' as $$
declare mail four_u_private.planner_emails; api_key text; response extensions.http_response; parsed jsonb; day_start timestamptz; brief_sent bigint:=0; planner_sent bigint; booking_sent bigint;
begin
 -- Share provider exclusion with existing booking/project-brief workers, without modifying either.
 if not pg_try_advisory_xact_lock(492483717) then return; end if;
 perform four_u_private.purge_planner_emails();
 day_start:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 select count(*) into planner_sent from four_u_private.planner_emails where accepted_at>=day_start;
 select count(*) into booking_sent from briefbooth_private.booking_emails where accepted_at>=day_start;
 if to_regclass('four_u_private.project_briefs') is not null then
  execute 'select count(*) from four_u_private.project_briefs where accepted_at >= $1' into brief_sent using day_start;
 end if;
 -- Independently capped at ten accepted planner emails/day. Pause conservatively
 -- when combined observed sends reach the booking budget; the provider's Free cap
 -- remains the final account-level limit. Never configure a paid fallback.
 if planner_sent>=10 or booking_sent+brief_sent+planner_sent>=240 then return; end if;
 select decrypted_secret into api_key from vault.decrypted_secrets where name='briefbooth_brevo_api_key';
 if nullif(api_key,'') is null then return; end if;
 perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','8000');
 perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS','3000');
 for mail in select e.* from four_u_private.planner_emails e
  where e.status='pending' and e.next_attempt_at<=now() order by e.created_at,e.id limit 1 for update skip locked
 loop
  if not exists (
   select 1 from public.bookings b
   join public.profiles p on p.id=b.owner_id
   join auth.users u on u.id=p.id and u.email_confirmed_at is not null
   join briefbooth_private.account_roles r on r.user_id=u.id and r.role='consultant'
   where b.id=mail.booking_id and b.owner_id=mail.owner_id
    and b.owner_id='adc53778-f007-4c58-bd47-ba7a675abb29'::uuid
    and lower(trim(b.client_email))=mail.recipient
  ) then
   update four_u_private.planner_emails set status='failed',last_error='Booking recipient or consultant access changed; planner was not sent.' where id=mail.id;
   continue;
  end if;
  begin
   select * into response from extensions.http((
    'POST','https://api.brevo.com/v3/smtp/email',array[extensions.http_header('api-key',api_key)],
    'application/json',four_u_private.planner_email_payload(mail)::text
   )::extensions.http_request);
   begin parsed:=response.content::jsonb; exception when others then parsed:='{}'::jsonb; end;
   if response.status between 200 and 299 and jsonb_typeof(parsed->'messageId')='string'
    and length(parsed->>'messageId') between 1 and 300 and parsed->>'messageId' !~ '[[:cntrl:]]'
   then
    update four_u_private.planner_emails set status='accepted',accepted_at=now(),attempts=attempts+1,
     provider_message_id=parsed->>'messageId',last_error=null where id=mail.id;
   elsif response.status in (429,401,403) then
    update four_u_private.planner_emails set next_attempt_at=now()+interval '1 hour',attempts=attempts+1,
     last_error=case when response.status=429 then 'Provider free limit; queued for a later retry.' else 'Verified sender or credentials need attention; queued for a later retry.' end where id=mail.id;
   else
    update four_u_private.planner_emails set status=case when response.status>=500 or response.status between 200 and 299 then 'uncertain' else 'failed' end,
     attempts=attempts+1,last_error='Provider HTTP '||response.status||'; review provider logs before sending again.' where id=mail.id;
   end if;
  exception when others then
   -- Provider acceptance may precede a timeout. No blind automatic resend.
   update four_u_private.planner_emails set status='uncertain',attempts=attempts+1,
    last_error='Delivery outcome unknown; review provider logs before sending again.' where id=mail.id;
  end;
 end loop;
end; $$;
revoke all on function four_u_private.send_planner_emails() from public,anon,authenticated;
select cron.schedule('4u-digital-planner-emails','* * * * *','select four_u_private.send_planner_emails()');
select cron.schedule('4u-digital-planner-email-retention','23 * * * *','select four_u_private.purge_planner_emails()');
