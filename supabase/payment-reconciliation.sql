-- Free cron: reconcile missed webhook delivery and abandoned checkouts every five minutes.
create or replace function briefbooth_private.reconcile_payments() returns void language plpgsql security definer set search_path='' as $$
declare secret text; result extensions.http_response;
begin
 select decrypted_secret into secret from vault.decrypted_secrets where name='briefbooth_stripe_cron_secret';
 if secret is null then return; end if;
 perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','30000');
 select * into result from extensions.http(('POST','https://kjjfpacypvdfdktkssst.supabase.co/functions/v1/payments',array[extensions.http_header('Authorization','Bearer '||secret)],'application/json','{"action":"reconcile"}')::extensions.http_request);
 if result.status<>200 then raise warning 'Payment reconciliation returned status %',result.status; end if;
end; $$;
revoke all on function briefbooth_private.reconcile_payments() from public,anon,authenticated;
select cron.schedule('briefbooth-payment-reconciliation','*/5 * * * *','select briefbooth_private.reconcile_payments()');
