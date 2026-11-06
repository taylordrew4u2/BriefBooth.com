-- Let signed-in consultants start production OAuth; Zoom remains the authority
-- for unpublished-app access and consent. Preserve the owner development connection.
create or replace function public.zoom_begin() returns text language plpgsql security definer set search_path='' as $$
declare cfg jsonb; credentials jsonb; nonce uuid; env text;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Sign in and save your profile first.'; end if;
 cfg:=public.zoom_config();
 if cfg->>'public'='true' then env:='production';
 elsif cfg->>'allowed_owner'=auth.uid()::text then env:='development';
 else env:='production'; end if;
 credentials:=public.zoom_environment_config(env);
 if nullif(credentials->>'client_secret','') is null or nullif(credentials->>'client_id','') is null then raise exception 'Zoom setup is not complete yet.'; end if;
 delete from briefbooth_private.zoom_states where owner_id=auth.uid() or expires_at<now();
 insert into briefbooth_private.zoom_states(owner_id,environment) values(auth.uid(),env) returning state into nonce;
 return 'https://zoom.us/oauth/authorize?response_type=code&client_id='||(credentials->>'client_id')||'&redirect_uri='||case when env='production' then 'https%3A%2F%2Fbriefbooth.com%2Fapi%2Fzoom%2Fcallback' else 'https%3A%2F%2Fkjjfpacypvdfdktkssst.supabase.co%2Ffunctions%2Fv1%2Fzoom%2Fcallback' end||'&state='||nonce;
end; $$;

