-- Client identity comes only from Supabase's verified auth email, never editable metadata.
create function public.client_bookings() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
 select b.id,coalesce(b.title_snapshot,s.title) title,p.name consultant,b.starts_at,b.status,b.manage_token
 from public.bookings b join public.profiles p on p.id=b.owner_id join public.services s on s.id=b.service_id
 join auth.users u on u.id=auth.uid() and u.email_confirmed_at is not null and lower(trim(u.email))=b.client_email
 order by b.starts_at desc,b.id limit 100
 ) x;
$$;
revoke all on function public.client_bookings() from public,anon;
grant execute on function public.client_bookings() to authenticated;
