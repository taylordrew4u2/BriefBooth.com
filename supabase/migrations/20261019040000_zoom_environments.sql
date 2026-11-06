-- Keep existing development connections working while staging public production OAuth.
-- Production uses separate Vault names briefbooth_zoom_prod_client_id/client_secret.
alter table briefbooth_private.zoom_connections add column environment text not null default 'development' check(environment in ('development','production'));
alter table briefbooth_private.zoom_states add column environment text not null default 'development' check(environment in ('development','production'));

create function public.zoom_environment_config(p_environment text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg jsonb;
begin
 if p_environment not in ('development','production') or p_environment is null then raise exception 'Invalid Zoom environment'; end if;
 cfg:=public.zoom_config();
 if p_environment='production' then
 return jsonb_build_object('client_id',cfg->>'prod_client_id','client_secret',cfg->>'prod_client_secret');
 end if;
 return jsonb_build_object('client_id',cfg->>'client_id','client_secret',cfg->>'client_secret');
end; $$;

create or replace function public.zoom_begin() returns text language plpgsql security definer set search_path='' as $$
declare cfg jsonb; credentials jsonb; nonce uuid; env text;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Sign in and save your profile first.'; end if;
 cfg:=public.zoom_config();
 if cfg->>'public'='true' then env:='production';
 elsif cfg->>'allowed_owner'=auth.uid()::text then env:='development';
 else raise exception 'Zoom connection is awaiting approval for additional consultants.'; end if;
 credentials:=public.zoom_environment_config(env);
 if nullif(credentials->>'client_secret','') is null or nullif(credentials->>'client_id','') is null then raise exception 'Zoom setup is not complete yet.'; end if;
 delete from briefbooth_private.zoom_states where owner_id=auth.uid() or expires_at<now();
 insert into briefbooth_private.zoom_states(owner_id,environment) values(auth.uid(),env) returning state into nonce;
 return 'https://zoom.us/oauth/authorize?response_type=code&client_id='||(credentials->>'client_id')||'&redirect_uri=https%3A%2F%2Fkjjfpacypvdfdktkssst.supabase.co%2Ffunctions%2Fv1%2Fzoom%2Fcallback&state='||nonce;
end; $$;

create function public.zoom_consume_context(p_state uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 delete from briefbooth_private.zoom_states where state=p_state and expires_at>now()
 returning jsonb_build_object('owner_id',owner_id,'environment',environment) into result;
 return result;
end; $$;
create or replace function public.zoom_store(p_owner uuid,p_tokens jsonb) returns void language plpgsql security definer set search_path='' as $$
declare secret_id uuid;
begin
 if nullif(p_tokens->>'access_token','') is null or nullif(p_tokens->>'refresh_token','') is null then raise exception 'Invalid Zoom tokens'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,710));
 select token_secret into secret_id from briefbooth_private.zoom_connections where owner_id=p_owner;
 if secret_id is null then
 secret_id:=vault.create_secret(p_tokens::text);
 else perform vault.update_secret(secret_id,p_tokens::text); end if;
 insert into briefbooth_private.zoom_connections(owner_id,token_secret,expires_at,ready) values(p_owner,secret_id,now()+make_interval(secs=>(p_tokens->>'expires_in')::int),true)
 on conflict(owner_id) do update set expires_at=excluded.expires_at,ready=true;
end; $$;

create function public.zoom_store_connection(p_owner uuid,p_tokens jsonb,p_environment text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_environment not in ('development','production') or p_environment is null then raise exception 'Invalid Zoom environment'; end if;
 perform public.zoom_store(p_owner,p_tokens);
 update briefbooth_private.zoom_connections set environment=p_environment where owner_id=p_owner;
end; $$;
revoke all on function public.zoom_environment_config(text),public.zoom_consume_context(uuid),public.zoom_store_connection(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.zoom_environment_config(text),public.zoom_consume_context(uuid),public.zoom_store_connection(uuid,jsonb,text) to service_role;
create or replace function briefbooth_private.create_zoom_meetings() returns void language plpgsql security definer set search_path='' as $$
declare job record; conn briefbooth_private.zoom_connections; cfg jsonb; tokens jsonb; response extensions.http_response; result jsonb; basic text;
begin
 if not pg_try_advisory_xact_lock(492483718) then return; end if;
 perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','8000');
 perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS','3000');
 for job in select z.booking_id,b.owner_id,b.starts_at,b.ends_at,b.status from briefbooth_private.zoom_meetings z join public.bookings b on b.id=z.booking_id where z.status='pending' and z.next_attempt_at<=now() order by b.created_at limit 3 for update of z skip locked loop
 if job.status<>'confirmed' or job.starts_at<=now() then update briefbooth_private.zoom_meetings set status='skipped' where booking_id=job.booking_id; continue; end if;
 perform pg_advisory_xact_lock(hashtextextended(job.owner_id::text,710));
 select * into conn from briefbooth_private.zoom_connections where owner_id=job.owner_id;
 if not coalesce(conn.ready,false) then update briefbooth_private.zoom_meetings set status='failed',last_error='Reconnect Zoom in your studio.' where booking_id=job.booking_id; continue; end if;
 cfg:=public.zoom_environment_config(conn.environment);
 if nullif(cfg->>'client_secret','') is null then
 update briefbooth_private.zoom_meetings set status='failed',last_error='Zoom configuration is not ready. Contact support.' where booking_id=job.booking_id;
 continue;
 end if;
 basic:='Basic '||replace(encode(convert_to((cfg->>'client_id')||':'||(cfg->>'client_secret'),'UTF8'),'base64'),E'\n','');
 select decrypted_secret::jsonb into tokens from vault.decrypted_secrets where id=conn.token_secret;
 if conn.expires_at<now()+interval '2 minutes' then
 begin
 select * into response from extensions.http(('POST','https://zoom.us/oauth/token',array[extensions.http_header('Authorization',basic)],'application/x-www-form-urlencoded','grant_type=refresh_token&refresh_token='||extensions.urlencode(tokens->>'refresh_token'))::extensions.http_request);
 if response.status<>200 then
 update briefbooth_private.zoom_connections set ready=false where owner_id=job.owner_id;
 update briefbooth_private.zoom_meetings set status='failed',last_error='Reconnect Zoom in your studio.' where booking_id=job.booking_id;
 continue;
 end if;
 tokens:=response.content::jsonb;
 perform public.zoom_store(job.owner_id,tokens);
 exception when others then
 update briefbooth_private.zoom_connections set ready=false where owner_id=job.owner_id;
 update briefbooth_private.zoom_meetings set status='failed',last_error='Reconnect Zoom after token refresh failed.' where booking_id=job.booking_id;
 continue;
 end;
 end if;
 -- Unknown outcomes are never blindly retried: Zoom creation has no idempotency key.
 begin
 select * into response from extensions.http(('POST','https://api.zoom.us/v2/users/me/meetings',array[extensions.http_header('Authorization','Bearer '||(tokens->>'access_token'))],'application/json',jsonb_build_object('topic','BriefBooth consultation','type',2,'start_time',to_char(job.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'duration',extract(epoch from job.ends_at-job.starts_at)::int/60,'timezone','UTC','settings',jsonb_build_object('use_pmi',false,'waiting_room',true,'join_before_host',false,'auto_recording','none'))::text)::extensions.http_request);
 if response.status=201 then
 result:=response.content::jsonb;
 if coalesce(result->>'join_url','') !~ '^https://([a-zA-Z0-9-]+\.)*zoom\.(us|com)/' then raise exception 'Invalid meeting URL'; end if;
 update briefbooth_private.zoom_meetings set status='ready',join_url=result->>'join_url',meeting_id=result->>'id',last_error=null where booking_id=job.booking_id;
 update public.bookings set status=status where id=job.booking_id;
 elsif response.status=429 then
 update briefbooth_private.zoom_meetings set next_attempt_at=now()+interval '1 hour',last_error='Zoom limit reached; waiting without paid upgrade.' where booking_id=job.booking_id;
 else
 update briefbooth_private.zoom_meetings set status=case when response.status>=500 then 'uncertain' else 'failed' end,last_error='Zoom HTTP '||response.status where booking_id=job.booking_id;
 end if;
 exception when others then
 update briefbooth_private.zoom_meetings set status='uncertain',last_error='Meeting outcome unknown. Review Zoom before retrying.' where booking_id=job.booking_id;
 end;
 end loop;
end; $$;
