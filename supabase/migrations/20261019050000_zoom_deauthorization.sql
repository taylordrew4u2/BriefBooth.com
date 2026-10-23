-- Identity is private and used only to match signed production revocations.
alter table briefbooth_private.zoom_connections add column zoom_user_id text;
alter table briefbooth_private.zoom_connections add column authorized_at timestamptz not null default now();
create index zoom_connection_identity on briefbooth_private.zoom_connections(environment,zoom_user_id);

create function public.zoom_store_identity(p_owner uuid,p_tokens jsonb,p_environment text,p_zoom_user_id text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_environment='production' and (nullif(p_zoom_user_id,'') is null or length(p_zoom_user_id)>128) then raise exception 'Zoom identity required'; end if;
 perform public.zoom_store_connection(p_owner,p_tokens,p_environment);
 update briefbooth_private.zoom_connections set zoom_user_id=p_zoom_user_id,authorized_at=clock_timestamp() where owner_id=p_owner;
end; $$;

create function public.zoom_revoke_identity(p_zoom_user_id text,p_revoked_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare conn record; secret_id uuid;
begin
 if nullif(p_zoom_user_id,'') is null or p_revoked_at is null or p_revoked_at>now()+interval '5 minutes' then raise exception 'Invalid revocation'; end if;
 for conn in select owner_id from briefbooth_private.zoom_connections where environment='production' and zoom_user_id=p_zoom_user_id order by owner_id loop
 perform pg_advisory_xact_lock(hashtextextended(conn.owner_id::text,710));
 -- A delayed event must not remove a newer connection or a different account.
 delete from briefbooth_private.zoom_connections where owner_id=conn.owner_id and environment='production' and zoom_user_id=p_zoom_user_id and authorized_at<=p_revoked_at returning token_secret into secret_id;
 if secret_id is null then continue; end if;
 delete from vault.secrets where id=secret_id;
 delete from briefbooth_private.zoom_states where owner_id=conn.owner_id and environment='production';
 update briefbooth_private.zoom_meetings z set join_url=null,meeting_id=null,status='failed',last_error='Zoom disconnected. Contact your consultant for meeting details.' from public.bookings b where b.id=z.booking_id and b.owner_id=conn.owner_id;
 -- Retain booking notification history without retaining generated Zoom URLs.
 update briefbooth_private.booking_emails e set body=regexp_replace(e.body,'https://([a-zA-Z0-9-]+\.)*zoom\.(us|com)/[^[:space:]]+','[Zoom connection removed]','g') from public.bookings b where b.id=e.booking_id and b.owner_id=conn.owner_id;
 end loop;
end; $$;
revoke all on function public.zoom_store_identity(uuid,jsonb,text,text),public.zoom_revoke_identity(text,timestamptz) from public,anon,authenticated;
grant execute on function public.zoom_store_identity(uuid,jsonb,text,text),public.zoom_revoke_identity(text,timestamptz) to service_role;
