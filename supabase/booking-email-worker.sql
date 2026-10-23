-- Apply after the booking-confirmation migration. Uses only existing Supabase/Brevo Free resources.
-- Store the Brevo REST API key in Vault as briefbooth_brevo_api_key; never put it in this file.
create extension if not exists http with schema extensions;
create extension if not exists pg_cron;
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
  if not exists(select 1 from public.bookings where id=mail.booking_id and status='confirmed' and starts_at>now()) then
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
select cron.schedule('briefbooth-booking-confirmations','* * * * *','select briefbooth_private.send_booking_emails()');
