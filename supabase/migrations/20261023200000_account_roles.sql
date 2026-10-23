-- Assign the role once at account creation; editable user metadata cannot promote it.
create table briefbooth_private.account_roles(user_id uuid primary key references auth.users on delete cascade,role text not null check(role in ('client','consultant')));
alter table briefbooth_private.account_roles enable row level security;
revoke all on briefbooth_private.account_roles from public,anon,authenticated;
insert into briefbooth_private.account_roles(user_id,role)
select u.id,case when exists(select 1 from public.profiles p where p.id=u.id) then 'consultant' when u.raw_user_meta_data->>'account_type'='client' then 'client' else 'consultant' end from auth.users u;
create function briefbooth_private.assign_account_role() returns trigger language plpgsql security definer set search_path='' as $$ begin
 insert into briefbooth_private.account_roles(user_id,role) values(new.id,case when new.raw_user_meta_data->>'account_type'='client' then 'client' else 'consultant' end);
 return new; end $$;
create trigger assign_briefbooth_account_role after insert on auth.users for each row execute function briefbooth_private.assign_account_role();
revoke all on function briefbooth_private.assign_account_role() from public,anon,authenticated;
create function public.account_role() returns text language sql stable security definer set search_path='' as $$ select role from briefbooth_private.account_roles where user_id=auth.uid(); $$;
revoke all on function public.account_role() from public,anon;
grant execute on function public.account_role() to authenticated;
create function briefbooth_private.require_consultant_profile() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if not exists(select 1 from briefbooth_private.account_roles where user_id=new.id and role='consultant') then raise exception 'Client accounts cannot create or edit consultant profiles.'; end if;
 return new; end $$;
create trigger require_consultant_profile before insert or update on public.profiles for each row execute function briefbooth_private.require_consultant_profile();
revoke all on function briefbooth_private.require_consultant_profile() from public,anon,authenticated;
