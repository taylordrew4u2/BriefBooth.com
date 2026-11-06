alter table public.profiles add column avatar_data text not null default '';
alter table public.profiles add constraint profile_avatar_small_webp check (
 avatar_data = '' or (
 octet_length(avatar_data)<=44000 and
 avatar_data ~ '^data:image/webp;base64,UklGR[A-Za-z0-9+/]*={0,2}$' and
 octet_length(decode(substr(avatar_data,24),'base64'))<=32768
 ));
