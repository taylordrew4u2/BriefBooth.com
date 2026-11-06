-- Payment state is written only by the trusted payments function.
alter table public.services add column amount_cents integer not null default 0 check(amount_cents between 0 and 9999999);
alter table public.bookings drop constraint bookings_status_check;
alter table public.bookings add constraint bookings_status_check check(status in ('confirmed','cancelled','pending_payment','payment_processing','expired'));
alter table public.bookings drop constraint bookings_owner_id_tstzrange_excl;
alter table public.bookings add constraint bookings_no_overlap exclude using gist(owner_id with =, tstzrange(starts_at,ends_at,'[)') with &&) where(status in ('confirmed','pending_payment','payment_processing'));
create table briefbooth_private.stripe_accounts (
 owner_id uuid primary key references public.profiles on delete cascade,
 account_id text unique not null,
 ready boolean not null default false,
 livemode boolean not null,
 updated_at timestamptz not null default now()
);
create table briefbooth_private.payments (
 booking_id uuid primary key references public.bookings on delete cascade,
 account_id text not null,
 livemode boolean not null,
 amount_cents integer not null check(amount_cents>0),
 total_cents integer not null check(total_cents>=amount_cents),
 title text not null,
 session_id text unique,
 payment_intent text,
 expires_at timestamptz not null default now()+interval '35 minutes',
 paid_at timestamptz,
 created_at timestamptz not null default now()
);
alter table briefbooth_private.stripe_accounts enable row level security;
alter table briefbooth_private.payments enable row level security;
revoke all on briefbooth_private.stripe_accounts,briefbooth_private.payments from public,anon,authenticated;
create function briefbooth_private.payment_total(amount integer) returns integer language plpgsql immutable set search_path='' as $$
declare total integer;
begin
 if amount=0 then return 0; end if;
 total:=ceil((amount+30)::numeric*1000/971);
 while total-1-floor(((total-1)*29::numeric+500)/1000)-30>=amount loop total:=total-1; end loop;
 return total;
end; $$;
create or replace function public.available_slots(p_service uuid, p_day date)
returns table(starts_at timestamptz) language sql stable security definer set search_path=public as $$
 select g.t from services s join profiles p on p.id=s.owner_id and p.published
 join availability a on a.owner_id=p.id and a.weekday=extract(dow from p_day)
 cross join lateral generate_series((p_day+a.start_time) at time zone p.timezone,
 ((p_day+a.end_time) at time zone p.timezone)-make_interval(mins=>s.duration), interval '15 minutes') as g(t)
 where s.id=p_service and s.active and p_day between (now() at time zone p.timezone)::date and (now() at time zone p.timezone)::date+60
 and g.t>=now()+interval '2 hours'
 and not exists(select 1 from bookings b where b.owner_id=p.id and b.status in ('confirmed','pending_payment','payment_processing')
 and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(g.t,g.t+make_interval(mins=>s.duration),'[)'))
 order by g.t;
$$;
create function briefbooth_private.reserve_booking(p_service uuid,p_start timestamptz,p_name text,p_email text,p_notes text default '',p_request uuid default null,p_meeting_mode text default 'zoom')
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
 insert into bookings(owner_id,service_id,client_name,client_email,notes,starts_at,ends_at,request_id,meeting_mode,status)
 values(prof.id,svc.id,trim(p_name),lower(trim(p_email)),p_notes,p_start,p_start+make_interval(mins=>svc.duration),coalesce(p_request,gen_random_uuid()),p_meeting_mode,case when svc.amount_cents>0 then 'pending_payment' else 'confirmed' end) returning manage_token into token;
 return token;
end; $$;
create or replace function public.create_booking(p_service uuid,p_start timestamptz,p_name text,p_email text,p_notes text default '',p_request uuid default null,p_meeting_mode text default 'zoom') returns uuid language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.services where id=p_service and amount_cents>0) then raise exception 'This consultation requires secure checkout.'; end if;
 return briefbooth_private.reserve_booking(p_service,p_start,p_name,p_email,p_notes,p_request,p_meeting_mode);
end; $$;
create function briefbooth_private.reserve_consultation(p_service uuid,p_start timestamptz,p_name text,p_email text,p_answers jsonb,p_request uuid,p_meeting_mode text default 'zoom') returns uuid
language plpgsql security definer set search_path='' as $$
declare questions jsonb; q jsonb; answer text; notes text:=''; prior public.bookings;
begin
 if p_request is not null then
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,1));
 select * into prior from public.bookings where request_id=p_request;
 if prior.id is not null then
 if prior.service_id=p_service and prior.starts_at=p_start and prior.client_email=lower(trim(p_email)) and prior.meeting_mode=p_meeting_mode then return prior.manage_token; end if;
 raise exception 'This booking request has already been used.';
 end if;
 end if;
 select p.intake_questions into questions from public.profiles p join public.services s on s.owner_id=p.id where s.id=p_service and p.published and s.active;
 if questions is null then raise exception 'This consultation is unavailable.'; end if;
 if p_answers is null or jsonb_typeof(p_answers)<>'object' or octet_length(p_answers::text)>80000 then raise exception 'Invalid intake answers.'; end if;
 if exists(select 1 from jsonb_object_keys(p_answers) k where not exists(select 1 from jsonb_array_elements(questions) v where v.value->>'id'=k)) then raise exception 'The questionnaire changed. Refresh the page and try again.'; end if;
 for q in select value from jsonb_array_elements(questions) loop
 if p_answers ? (q->>'id') and jsonb_typeof(p_answers->(q->>'id'))<>'string' then raise exception 'Intake answers must be text.'; end if;
 answer:=trim(coalesce(p_answers->>(q->>'id'),''));
 if (q->>'required')::boolean and answer='' then raise exception 'Please answer: %',q->>'label'; end if;
 if length(answer)>1500 then raise exception 'Keep each answer within 1500 characters.'; end if;
 notes:=notes||(q->>'label')||E'\n'||coalesce(nullif(answer,''),'Not provided')||E'\n\n';
 end loop;
 return briefbooth_private.reserve_booking(p_service,p_start,p_name,p_email,trim(notes),p_request,p_meeting_mode);
end; $$;
create or replace function public.book_consultation(p_service uuid,p_start timestamptz,p_name text,p_email text,p_answers jsonb,p_request uuid,p_meeting_mode text default 'zoom') returns uuid language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.services where id=p_service and amount_cents>0) then raise exception 'This consultation requires secure checkout.'; end if;
 return briefbooth_private.reserve_consultation(p_service,p_start,p_name,p_email,p_answers,p_request,p_meeting_mode);
end; $$;
-- Trigger runs exactly once when a paid booking becomes confirmed.
drop trigger booking_confirmation_emails on public.bookings;
create trigger booking_confirmation_emails after insert or update of status on public.bookings for each row when(new.status='confirmed') execute function briefbooth_private.queue_booking_emails();
create function public.payments_account(p_owner uuid,p_account text default null,p_ready boolean default false,p_live boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_account is not null then
 insert into briefbooth_private.stripe_accounts(owner_id,account_id,ready,livemode) values(p_owner,p_account,p_ready,p_live)
 on conflict(owner_id) do update set ready=excluded.ready,updated_at=now()
 where briefbooth_private.stripe_accounts.account_id=excluded.account_id and briefbooth_private.stripe_accounts.livemode=excluded.livemode;
 end if;
 return (select to_jsonb(a) from briefbooth_private.stripe_accounts a where owner_id=p_owner);
end; $$;
create function public.payments_reserve(p_service uuid,p_start timestamptz,p_name text,p_email text,p_answers jsonb,p_request uuid,p_expected_total integer,p_live boolean,p_meeting_mode text default 'zoom') returns jsonb language plpgsql security definer set search_path='' as $$
declare svc public.services; acct briefbooth_private.stripe_accounts; token uuid; booking public.bookings; payment briefbooth_private.payments;
begin
 if p_request is null then raise exception 'A request ID is required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,1));
 select * into booking from public.bookings where request_id=p_request;
 if booking.id is not null then
 if booking.service_id<>p_service or booking.starts_at<>p_start or booking.client_email<>lower(trim(p_email)) or booking.meeting_mode<>p_meeting_mode then raise exception 'This request was already used.'; end if;
 select * into payment from briefbooth_private.payments where booking_id=booking.id;
 if payment.booking_id is null or payment.livemode is distinct from p_live or payment.total_cents<>p_expected_total then raise exception 'This request was already used.'; end if;
 else
 select * into svc from public.services where id=p_service for share;
 select * into acct from briefbooth_private.stripe_accounts where owner_id=svc.owner_id;
 if svc.amount_cents is null or svc.amount_cents<=0 then raise exception 'Choose a paid consultation.'; end if;
 if not coalesce(acct.ready,false) or acct.livemode<>p_live then raise exception 'This consultant has not enabled payments yet.'; end if;
 if p_expected_total is distinct from briefbooth_private.payment_total(svc.amount_cents) then raise exception 'The price changed. Refresh and review the new total.'; end if;
 token:=briefbooth_private.reserve_consultation(p_service,p_start,p_name,p_email,p_answers,p_request,p_meeting_mode);
 select * into booking from public.bookings where manage_token=token;
 insert into briefbooth_private.payments(booking_id,account_id,livemode,amount_cents,total_cents,title)
 values(booking.id,acct.account_id,p_live,svc.amount_cents,p_expected_total,svc.title) returning * into payment;
 end if;
 if booking.status not in ('pending_payment','payment_processing','confirmed') then raise exception 'This checkout expired. Choose a time again.'; end if;
 return to_jsonb(payment)||jsonb_build_object('manage_token',booking.manage_token,'email',booking.client_email,'request_id',booking.request_id,'status',booking.status);
end; $$;
create function public.payments_attach(p_booking uuid,p_account text,p_session text) returns void language plpgsql security definer set search_path='' as $$
begin
 update briefbooth_private.payments set session_id=p_session where booking_id=p_booking and account_id=p_account and (session_id is null or session_id=p_session);
 if not found then raise exception 'Checkout mismatch.'; end if;
end; $$;
-- Only a server-verified Stripe session may settle a reservation. Replay is idempotent.
create function public.payments_settle(p_booking uuid,p_account text,p_session text,p_total integer,p_live boolean,p_state text,p_intent text default null) returns void language plpgsql security definer set search_path='' as $$
declare payment briefbooth_private.payments; b public.bookings;
begin
 select * into payment from briefbooth_private.payments where booking_id=p_booking for update;
 if payment.booking_id is null or payment.account_id is distinct from p_account or payment.livemode is distinct from p_live or payment.total_cents is distinct from p_total or (payment.session_id is not null and payment.session_id<>p_session) then raise exception 'Payment mismatch.'; end if;
 select * into b from public.bookings where id=p_booking for update;
 update briefbooth_private.payments set session_id=p_session where booking_id=p_booking;
 if payment.paid_at is not null then return; end if;
 if p_state='paid' then
 if b.status not in ('pending_payment','payment_processing') then raise exception 'Booking requires payment review.'; end if;
 update briefbooth_private.payments set paid_at=now(),payment_intent=p_intent where booking_id=p_booking;
 update public.bookings set status='confirmed' where id=p_booking;
 elsif p_state='processing' and b.status='pending_payment' then
 update public.bookings set status='payment_processing' where id=p_booking;
 elsif p_state='expired' and b.status='pending_payment' then
 update public.bookings set status='expired' where id=p_booking;
 elsif p_state='failed' and b.status in ('pending_payment','payment_processing') then
 update public.bookings set status='expired' where id=p_booking;
 end if;
end; $$;
create function public.payments_pending() returns setof jsonb language sql security definer set search_path='' as $$
 select to_jsonb(p) from briefbooth_private.payments p join public.bookings b on b.id=p.booking_id
 where p.paid_at is null and p.session_id is not null and b.status in ('pending_payment','payment_processing') order by p.created_at limit 50;
$$;
create function public.payments_lookup(p_token uuid) returns jsonb language sql security definer set search_path='' as $$
 select to_jsonb(p)||jsonb_build_object('status',b.status) from briefbooth_private.payments p join public.bookings b on b.id=p.booking_id where b.manage_token=p_token;
$$;
revoke all on all functions in schema briefbooth_private from public,anon,authenticated;
revoke all on function public.payments_account(uuid,text,boolean,boolean),public.payments_reserve(uuid,timestamptz,text,text,jsonb,uuid,integer,boolean,text),public.payments_attach(uuid,text,text),public.payments_settle(uuid,text,text,integer,boolean,text,text),public.payments_pending(),public.payments_lookup(uuid) from public,anon,authenticated;
grant execute on function public.payments_account(uuid,text,boolean,boolean),public.payments_reserve(uuid,timestamptz,text,text,jsonb,uuid,integer,boolean,text),public.payments_attach(uuid,text,text),public.payments_settle(uuid,text,text,integer,boolean,text,text),public.payments_pending(),public.payments_lookup(uuid) to service_role;

-- Meeting locations stay private until payment succeeds.
create or replace function public.booking_details(p_token uuid)
returns table(client_name text,title text,consultant text,starts_at timestamptz,ends_at timestamptz,status text,meeting_url text,meeting_mode text,in_person_address text)
language sql stable security definer set search_path='' as $$
 select b.client_name,s.title,p.name,b.starts_at,b.ends_at,b.status,
 case when b.status='confirmed' and b.meeting_mode='zoom' then coalesce(cs.meeting_url,'') else '' end,
 b.meeting_mode,case when b.status='confirmed' and b.meeting_mode='in_person' then coalesce(cs.in_person_address,'') else '' end
 from public.bookings b join public.services s on s.id=b.service_id join public.profiles p on p.id=b.owner_id left join public.consultant_settings cs on cs.owner_id=p.id where b.manage_token=p_token;
$$;
create function briefbooth_private.validate_paid_service() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.amount_cents>0 and new.active and not exists(select 1 from briefbooth_private.stripe_accounts where owner_id=new.owner_id and ready) then raise exception 'Connect Stripe before offering paid consultations.'; end if;
 return new;
end; $$;
revoke all on function briefbooth_private.validate_paid_service() from public,anon,authenticated;
create trigger validate_paid_service before insert or update of amount_cents,active on public.services for each row execute function briefbooth_private.validate_paid_service();
-- Only the service credential can read these Vault entries. Never exposed to clients.
create function public.payments_config() returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_object_agg(substr(name,19),decrypted_secret),'{}'::jsonb)
 from vault.decrypted_secrets where name like 'briefbooth_stripe_%';
$$;
revoke all on function public.payments_config() from public,anon,authenticated;
grant execute on function public.payments_config() to service_role;

create or replace function briefbooth_private.queue_booking_emails() returns trigger
language plpgsql security definer set search_path='' as $$
declare prof public.profiles; svc public.services; settings public.consultant_settings;
 consultant_email text; details text; location text;
begin
 if new.status <> 'confirmed' then return new; end if;
 if tg_op='UPDATE' and old.status='confirmed' then return new; end if;
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
alter table briefbooth_private.payments add column checked_at timestamptz not null default now();
create or replace function public.payments_pending() returns setof jsonb language sql security definer set search_path='' as $$
 select to_jsonb(p)||jsonb_build_object('manage_token',b.manage_token,'email',b.client_email)
 from briefbooth_private.payments p join public.bookings b on b.id=p.booking_id
 where p.paid_at is null and b.status in ('pending_payment','payment_processing')
 order by p.checked_at limit 10;
$$;
create function public.payments_checked(p_booking uuid,p_abandon boolean default false) returns void language plpgsql security definer set search_path='' as $$
begin
 update briefbooth_private.payments set checked_at=now() where booking_id=p_booking;
 if p_abandon then
 update public.bookings b set status='expired' where b.id=p_booking and b.status='pending_payment'
 and exists(select 1 from briefbooth_private.payments p where p.booking_id=b.id and p.session_id is null and p.expires_at<now()-interval '1 minute');
 end if;
end; $$;
revoke all on function public.payments_checked(uuid,boolean) from public,anon,authenticated;
grant execute on function public.payments_checked(uuid,boolean) to service_role;
