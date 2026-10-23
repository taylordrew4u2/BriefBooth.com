-- Transactional mail stays on the existing authenticated sender and free provider.
-- Both MIME alternatives contain the same appointment/status information. No remote
-- images, marketing content, client-controlled HTML, or tracking headers are added.
create function briefbooth_private.booking_email_payload(mail briefbooth_private.booking_emails)
returns jsonb language plpgsql stable set search_path='' as $$
declare
 booking public.bookings;
 message text := replace(replace(mail.body,E'\r\n',E'\n'),E'\r',E'\n');
 details text; prefix text; paragraph text; escaped text; html text;
 action_url text; action_label text; heading text; subject text;
begin
 select * into strict booking from public.bookings where id=mail.booking_id;
 subject:=trim(regexp_replace(mail.subject,'[[:cntrl:]]+',' ','g'));
 if subject='' or mail.recipient ~ '[[:cntrl:]]' then
  raise exception 'Invalid booking email address or subject';
 end if;

 -- The outbox body is an immutable snapshot. Never re-read mutable consultant
 -- settings or service names when formatting a queued appointment notification.
 if mail.recipient_kind='request_client' then
  prefix:=split_part(message,E'\n\nIntake details:\n',1);
  if strpos(message,E'\n\nIntake details:\n')>0 and strpos(prefix,'Consultation: ')>0 then
   details:=substring(prefix from strpos(prefix,'Consultation: '));
  else
   -- Fail closed if an older/different body has no recognizable intake delimiter:
   -- do not accidentally echo a full questionnaire into a short request receipt.
   details:='Consultation: '||coalesce(booking.title_snapshot,'Consultation')
    ||E'\nClient: '||booking.client_name
    ||E'\nRequested time (UTC): '||to_char(booking.starts_at at time zone 'UTC','YYYY-MM-DD HH24:MI');
  end if;
  message:=E'Your request is awaiting consultant approval. This is not a confirmed meeting.\n\n'
   ||details||E'\nFormat: '||case booking.meeting_mode when 'zoom' then 'Zoom' when 'google_meet' then 'Google Meet' else 'In person' end
   ||E'\n\nIf approved, you will receive a separate confirmation with the meeting details. You can check the status or cancel your request using the private link below.';
 end if;

 heading:=case mail.recipient_kind
  when 'request_client' then 'Request received — awaiting approval'
  when 'request_consultant' then 'A consultation request needs your review'
  when 'client' then 'Your consultation is confirmed'
  when 'consultant' then 'A consultation is confirmed'
  when 'declined_client' then 'Your consultation request was declined'
  when 'cancelled_client' then 'Your consultation was cancelled'
  when 'cancelled_consultant' then 'A consultation was cancelled'
  else 'Your consultation is coming up' end;
 if mail.recipient_kind in ('consultant','request_consultant','reminder_consultant','cancelled_consultant') then
  action_url:='https://briefbooth.com/studio/';
  action_label:='Open your BriefBooth studio';
 else
  action_url:='https://briefbooth.com/manage/'||booking.manage_token::text||'/';
  action_label:=case when mail.recipient_kind='request_client' then 'View your request' else 'View your booking' end;
 end if;

 -- Only the fixed first-party action becomes an HTML link. User-supplied intake,
 -- names, addresses and URLs are displayed as escaped text, never HTML attributes.
 html:='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>BriefBooth booking update</title></head><body style="margin:0;background:#ffffff;color:#171717;font-family:Arial,Helvetica,sans-serif"><main style="max-width:600px;margin:0 auto;padding:28px 20px"><p style="font-size:15px;font-weight:700;margin:0 0 24px">BriefBooth</p><h1 style="font-size:25px;line-height:1.3;margin:0 0 22px">'||heading||'</h1>';
 foreach paragraph in array regexp_split_to_array(trim(message),E'\n\n+') loop
  escaped:=replace(replace(replace(replace(replace(paragraph,'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;'),'''','&#39;');
  html:=html||'<p style="font-size:16px;line-height:1.6;margin:0 0 18px;overflow-wrap:anywhere">'||replace(escaped,E'\n','<br>')||'</p>';
 end loop;
 html:=html||'<p style="margin:26px 0"><a href="'||action_url||'" style="display:inline-block;padding:14px 20px;background:#171717;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;border-radius:6px">'||action_label||'</a></p><p style="font-size:13px;line-height:1.6;color:#525252">Keep booking links private. For questions about your appointment, contact your consultant. For BriefBooth delivery or account help, reply to this email.</p></main></body></html>';
 message:=trim(message)||E'\n\n'||action_label||E':\n'||action_url
  ||E'\n\nKeep booking links private. For questions about your appointment, contact your consultant. For BriefBooth delivery or account help, reply to this email.';
 return jsonb_build_object(
  'sender',jsonb_build_object('name','BriefBooth','email','no-reply@briefbooth.com'),
  'replyTo',jsonb_build_object('name','BriefBooth support','email','admin@customtechbuilt4u.com'),
  'to',jsonb_build_array(jsonb_build_object('email',mail.recipient)),
  'subject',subject,'textContent',message,'htmlContent',html,
  'tags',jsonb_build_array('booking',mail.recipient_kind),
  'headers',jsonb_build_object('idempotencyKey',mail.id::text));
end; $$;
revoke all on function briefbooth_private.booking_email_payload(briefbooth_private.booking_emails) from public,anon,authenticated;

-- Patch only the provider payload. Preserve the independently maintained worker's
-- obsolete-mail cleanup, free-plan budget, locking, lifecycle and retry behavior.
DO $$
declare
 fn text := pg_get_functiondef('briefbooth_private.send_booking_emails()'::regprocedure);
 anchor text := $anchor$payload:=jsonb_build_object('sender',jsonb_build_object('name','BriefBooth','email','no-reply@briefbooth.com'),
   'to',jsonb_build_array(jsonb_build_object('email',mail.recipient)), 'subject',mail.subject,'textContent',mail.body,
   'headers',jsonb_build_object('idempotencyKey',mail.id::text));$anchor$;
begin
 if (length(fn)-length(replace(fn,anchor,'')))/length(anchor)<>1 then
  raise exception 'Booking worker payload changed; review before applying the email-format migration';
 end if;
 execute replace(fn,anchor,'payload:=briefbooth_private.booking_email_payload(mail);');
end $$;
