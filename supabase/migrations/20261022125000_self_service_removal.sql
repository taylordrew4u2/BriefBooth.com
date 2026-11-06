-- Self-service deletion is limited to accounts with no active future appointments or paid records.
-- Financial record removal requires support review; this function never issues a refund.
create function public.delete_my_account(p_confirmation text) returns void language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); z uuid; g uuid;
begin
 if owner is null or p_confirmation is distinct from 'DELETE' then raise exception 'Type DELETE to confirm account removal.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner::text,0));
 if exists(select 1 from public.bookings where owner_id=owner and ends_at>now() and status in ('confirmed','pending_approval','pending_payment','payment_processing')) then raise exception 'Cancel or finish your upcoming appointments before deleting your account.'; end if;
 if exists(select 1 from briefbooth_private.payments p join public.bookings b on b.id=p.booking_id where b.owner_id=owner and p.paid_at is not null) then raise exception 'This account has paid bookings. Use Request account removal so support can review required financial records.'; end if;
 -- Serialize with provider token writes. Only the caller's credential records are removed.
 perform pg_advisory_xact_lock(hashtextextended(owner::text,710));
 perform pg_advisory_xact_lock(hashtextextended(owner::text,720));
 delete from briefbooth_private.zoom_connections where owner_id=owner returning token_secret into z;
 delete from briefbooth_private.google_connections where owner_id=owner returning token_secret into g;
 delete from vault.secrets where id in (z,g);
 delete from auth.users where id=owner;
end; $$;
revoke all on function public.delete_my_account(text) from public,anon,authenticated;
grant execute on function public.delete_my_account(text) to authenticated;
-- Prevent bypassing the guarded removal workflow with a direct profile DELETE.
revoke delete on public.profiles from anon,authenticated;
