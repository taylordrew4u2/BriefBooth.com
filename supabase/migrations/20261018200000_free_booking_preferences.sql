-- Stripe is paused. Booking never collects payment; preferences are public.
begin;
alter table public.profiles add column payment_methods text[] not null default '{}', add column payment_notes text not null default '';
alter table public.profiles add constraint payment_methods_allowed check (payment_methods <@ array['Cash App','Venmo','PayPal','Zelle','Bank transfer','Cash','Other']::text[] and cardinality(payment_methods)<=7), add constraint payment_notes_length check (length(payment_notes)<=500);
update public.services set amount_cents=0 where amount_cents<>0;
alter table public.services add constraint booking_payments_paused check(amount_cents=0);
-- Revoke the edge function's payment-only RPC access, including warm instances.
-- Free booking and confirmation email RPCs retain their existing grants.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'payments\_%' escape '\' loop
  execute format('revoke execute on function %s from service_role',f.signature);
 end loop;
end $$;
commit;
