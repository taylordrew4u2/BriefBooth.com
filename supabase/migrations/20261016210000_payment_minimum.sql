-- Keep paid consultations above Stripe's USD minimum charge.
create or replace function briefbooth_private.validate_paid_service() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.amount_cents > 0 and new.amount_cents < 50 then raise exception 'Choose free or a consultation amount of at least $0.50.'; end if;
 if new.amount_cents>0 and new.active and not exists(select 1 from briefbooth_private.stripe_accounts where owner_id=new.owner_id and ready) then raise exception 'Connect Stripe before offering paid consultations.'; end if;
 return new;
end; $$;
