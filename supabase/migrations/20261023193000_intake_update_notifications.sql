alter table briefbooth_private.booking_emails drop constraint booking_emails_recipient_kind_check;
alter table briefbooth_private.booking_emails add constraint booking_emails_recipient_kind_check check(recipient_kind in ('client','consultant','request_client','request_consultant','declined_client','reminder_client','reminder_consultant','cancelled_client','cancelled_consultant','intake_consultant'));
-- Intake edits have their own revision; they never invalidate meeting confirmations.
create or replace function briefbooth_private.email_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select case when new.recipient_kind='intake_consultant' then intake_revision else revision end into new.revision from public.bookings where id=new.booking_id;
 return new;
end $$;
create function briefbooth_private.queue_intake_update_email() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient_email text;
begin
 if new.notes is not distinct from old.notes or new.intake_revision=old.intake_revision then return new; end if;
 select email into recipient_email from auth.users where id=new.owner_id;
 insert into briefbooth_private.booking_emails(booking_id,recipient_kind,recipient,subject,body)
 values(new.id,'intake_consultant',recipient_email,'A client updated their BriefBooth intake',
 'Your client has updated their intake answers. Please review the latest answers in your studio before the consultation.'||E'\n\nClient: '||new.client_name||E'\nConsultation: '||coalesce(new.title_snapshot,'Consultation')||E'\nBooking status: '||new.status||E'\nTime (UTC): '||to_char(new.starts_at at time zone 'UTC','YYYY-MM-DD HH24:MI')||E'\n\nOpen Bookings in your studio, find this client, and expand Client intake. The booking time and approval status have not changed.') on conflict do nothing;
 return new;
end $$;
create trigger intake_update_email after update of notes,intake_revision on public.bookings for each row execute function briefbooth_private.queue_intake_update_email();
revoke all on function briefbooth_private.queue_intake_update_email() from public,anon,authenticated;
-- Preserve the existing free budget, retry policy and provider payload.
do $$ declare fn text; anchor text; begin
 fn:=pg_get_functiondef('briefbooth_private.send_booking_emails()'::regprocedure);
 anchor:='where id=mail.booking_id and revision=mail.revision and (';
 if strpos(fn,anchor)=0 then raise exception 'Worker eligibility changed'; end if;
 fn:=replace(fn,anchor,'where id=mail.booking_id and ((mail.recipient_kind=''intake_consultant'' and mail.revision<=intake_revision) or (revision=mail.revision and (');
 anchor:='(''cancelled_client'',''cancelled_consultant'')))) then';
 if strpos(fn,anchor)=0 then raise exception 'Worker closing guard changed'; end if;
 execute replace(fn,anchor,'(''cancelled_client'',''cancelled_consultant'')))))) then');
 fn:=pg_get_functiondef('briefbooth_private.skip_obsolete_booking_emails()'::regprocedure);
 anchor:='where e.status=''pending'' and not (';
 if strpos(fn,anchor)=0 then raise exception 'Cleanup guard changed'; end if;
 execute replace(fn,anchor,'where e.status=''pending'' and e.recipient_kind<>''intake_consultant'' and not (');
 fn:=pg_get_functiondef('briefbooth_private.booking_email_payload(briefbooth_private.booking_emails)'::regprocedure);
 fn:=replace(fn,'when ''request_client'' then ''Request received', 'when ''intake_consultant'' then ''Your client updated their intake answers'' when ''request_client'' then ''Request received');
 fn:=replace(fn,'(''consultant'',''request_consultant'',''reminder_consultant'',''cancelled_consultant'')','(''consultant'',''request_consultant'',''reminder_consultant'',''cancelled_consultant'',''intake_consultant'')');
 execute fn;
end $$;
