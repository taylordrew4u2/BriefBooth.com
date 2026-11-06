-- Restore optional payments without activating production credentials.
begin;
alter table public.services drop constraint booking_payments_paused;
alter table briefbooth_private.payments add column requires_approval boolean not null default false;
create function briefbooth_private.snapshot_payment_approval() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select p.booking_mode='approval' into new.requires_approval from public.profiles p join public.bookings b on b.owner_id=p.id where b.id=new.booking_id;
 return new;
end; $$;
revoke all on function briefbooth_private.snapshot_payment_approval() from public,anon,authenticated;
create trigger snapshot_payment_approval before insert on briefbooth_private.payments for each row execute function briefbooth_private.snapshot_payment_approval();
create or replace function public.payments_settle(p_booking uuid,p_account text,p_session text,p_total integer,p_live boolean,p_state text,p_intent text default null) returns void language plpgsql security definer set search_path='' as $$
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
 update public.bookings set status=case when payment.requires_approval then 'pending_approval' else 'confirmed' end where id=p_booking;
 elsif p_state='processing' and b.status='pending_payment' then
 update public.bookings set status='payment_processing' where id=p_booking;
 elsif p_state='expired' and b.status='pending_payment' then
 update public.bookings set status='expired' where id=p_booking;
 elsif p_state='failed' and b.status in ('pending_payment','payment_processing') then
 update public.bookings set status='expired' where id=p_booking;
 end if;
end; $$;
create or replace function public.payments_account(p_owner uuid,p_account text default null,p_ready boolean default false,p_live boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_account is not null then
 insert into briefbooth_private.stripe_accounts(owner_id,account_id,ready,livemode) values(p_owner,p_account,p_ready,p_live)
 on conflict(owner_id) do update set account_id=excluded.account_id,livemode=excluded.livemode,ready=excluded.ready,updated_at=now()
 where (briefbooth_private.stripe_accounts.account_id=excluded.account_id and briefbooth_private.stripe_accounts.livemode=excluded.livemode) or (not briefbooth_private.stripe_accounts.livemode and excluded.livemode);
 end if;
 return (select to_jsonb(a) from briefbooth_private.stripe_accounts a where owner_id=p_owner);
end; $$;
create or replace function briefbooth_private.validate_paid_service() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.amount_cents>0 and new.amount_cents<50 then raise exception 'Paid consultations must be at least $0.50.'; end if;
 if new.amount_cents>0 and new.active then
 if not exists(select 1 from briefbooth_private.stripe_accounts where owner_id=new.owner_id and ready and livemode)
 or not exists(select 1 from vault.decrypted_secrets where name='briefbooth_stripe_enabled' and decrypted_secret='true')
 then raise exception 'Connect an approved live Stripe account before offering paid consultations.'; end if;
 end if;
 return new;
end; $$;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'payments\_%' escape '\' loop
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
