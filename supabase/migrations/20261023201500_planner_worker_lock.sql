-- The existing booking job usually starts first at the minute boundary. A try-lock
-- can therefore skip every planner run while booking mail is active. Wait up to
-- ten seconds for that SAME lock, then restore the caller's original lock timeout.
-- Only the separately introduced planner worker is changed; no other mailer is patched.
DO $$
declare
 fn text:=pg_get_functiondef('four_u_private.send_planner_emails()'::regprocedure);
 anchor text:='if not pg_try_advisory_xact_lock(492483717) then return; end if;';
 replacement text:=$patch$declare previous_lock_timeout text:=current_setting('lock_timeout');
 begin
  perform set_config('lock_timeout','10s',true);
  begin
   perform pg_advisory_xact_lock(492483717);
  exception when lock_not_available then
   perform set_config('lock_timeout',previous_lock_timeout,true);
   return;
  end;
  perform set_config('lock_timeout',previous_lock_timeout,true);
 end;$patch$;
begin
 if (length(fn)-length(replace(fn,anchor,'')))/length(anchor)<>1 then
  raise exception 'Planner worker lock guard changed; review before applying this migration';
 end if;
 execute replace(fn,anchor,replacement);
end $$;
