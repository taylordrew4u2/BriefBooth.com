-- Dedicated secret never leaves server-side Vault; only invokes this worker.
do $$ begin
if not exists(select 1 from vault.secrets where name='briefbooth_google_cron_secret') then
perform vault.create_secret(replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),'briefbooth_google_cron_secret');
end if; end $$;
create function briefbooth_private.sync_google_calendar() returns void language plpgsql security definer set search_path='' as $$
declare secret text;
begin
if not exists(select 1 from briefbooth_private.google_connections where ready) then return; end if;
select decrypted_secret into secret from vault.decrypted_secrets where name='briefbooth_google_cron_secret';
perform net.http_post(url:='https://kjjfpacypvdfdktkssst.supabase.co/functions/v1/google/sync',headers:=jsonb_build_object('Content-Type','application/json','X-Calendar-Job',secret),body:='{}'::jsonb,timeout_milliseconds:=60000);
end; $$;
revoke all on function briefbooth_private.sync_google_calendar() from public,anon,authenticated;
select cron.schedule('briefbooth-google-calendar','*/5 * * * *','select briefbooth_private.sync_google_calendar()');
