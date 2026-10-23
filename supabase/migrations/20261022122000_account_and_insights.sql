create table public.account_requests (
 owner_id uuid primary key references public.profiles on delete cascade,
 requested_at timestamptz not null default now(),
 status text not null default 'pending' check(status in ('pending','completed'))
);
alter table public.account_requests enable row level security;
create policy "Read own account request" on public.account_requests for select to authenticated using(owner_id=auth.uid());
revoke all on public.account_requests from anon,authenticated;
grant select on public.account_requests to authenticated;
create function public.request_account_removal() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Sign in and save a profile first.'; end if;
 insert into public.account_requests(owner_id) values(auth.uid()) on conflict(owner_id) do nothing;
 update public.profiles set published=false where id=auth.uid();
end; $$;
create function public.export_my_data() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in first.'; end if;
 return jsonb_build_object('exported_at',now(),'profile',(select to_jsonb(p) from public.profiles p where id=auth.uid()),
 'services',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from public.services s where owner_id=auth.uid()),
 'availability',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.availability a where owner_id=auth.uid()),
 'booking_rules',(select to_jsonb(r) from public.schedule_preferences r where owner_id=auth.uid()),
 'date_overrides',(select coalesce(jsonb_agg(to_jsonb(o)),'[]') from public.schedule_overrides o where owner_id=auth.uid()),
 'bookings',(select coalesce(jsonb_agg(to_jsonb(b)-'manage_token'-'request_id'),'[]') from public.bookings b where owner_id=auth.uid()));
end; $$;
create table briefbooth_private.funnel_events (
 owner_id uuid not null references public.profiles on delete cascade,visit uuid not null,
 stage text not null check(stage in ('view','intake','schedule','submitted')),created_at timestamptz not null default now(),
 primary key(owner_id,visit,stage)
);
alter table briefbooth_private.funnel_events enable row level security;
revoke all on briefbooth_private.funnel_events from public,anon,authenticated;
create function public.record_funnel(p_owner uuid,p_visit uuid,p_stage text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=p_owner and published) or p_visit is null then return; end if;
 if p_stage not in ('view','intake','schedule','submitted') then return; end if;
 -- Anonymous, bounded best-effort counts; no email, IP, answers or browser fingerprint.
 if (select count(*) from briefbooth_private.funnel_events where owner_id=p_owner and created_at>now()-interval '1 day')>=5000 then return; end if;
 insert into briefbooth_private.funnel_events(owner_id,visit,stage) values(p_owner,p_visit,p_stage) on conflict do nothing;
end; $$;
create function public.my_insights() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in first.'; end if;
 return jsonb_build_object('funnel',(select coalesce(jsonb_object_agg(stage,n),'{}') from (select stage,count(*) n from briefbooth_private.funnel_events where owner_id=auth.uid() and created_at>=now()-interval '30 days' group by stage) x),
 'bookings',(select count(*) from public.bookings where owner_id=auth.uid() and created_at>=now()-interval '30 days'),
 'completed',(select count(*) from public.bookings where owner_id=auth.uid() and starts_at>=now()-interval '30 days' and outcome='completed'),
 'no_shows',(select count(*) from public.bookings where owner_id=auth.uid() and starts_at>=now()-interval '30 days' and outcome='no_show'));
end; $$;
revoke all on function public.request_account_removal(),public.export_my_data(),public.my_insights(),public.record_funnel(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.request_account_removal(),public.export_my_data(),public.my_insights() to authenticated;
grant execute on function public.record_funnel(uuid,uuid,text) to anon,authenticated;
select cron.schedule('briefbooth-funnel-retention','17 3 * * *',$job$delete from briefbooth_private.funnel_events where created_at<now()-interval '30 days'$job$);
