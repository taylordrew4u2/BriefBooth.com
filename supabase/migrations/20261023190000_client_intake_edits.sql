alter table public.bookings add column intake_questions_snapshot jsonb, add column intake_answers_snapshot jsonb, add column intake_revision integer not null default 0;
-- Preserve the exact questionnaire used for each new booking.
do $$ declare fn text; anchor text := 'return briefbooth_private.reserve_booking(p_service,p_start,p_name,p_email,trim(notes),p_request,p_meeting_mode);'; begin
 fn:=pg_get_functiondef('briefbooth_private.reserve_consultation(uuid,timestamptz,text,text,jsonb,uuid,text)'::regprocedure);
 if strpos(fn,anchor)=0 then raise exception 'Reservation function changed'; end if;
 execute replace(fn,anchor,'prior.manage_token:=briefbooth_private.reserve_booking(p_service,p_start,p_name,p_email,trim(notes),p_request,p_meeting_mode); update public.bookings set intake_questions_snapshot=questions,intake_answers_snapshot=p_answers where manage_token=prior.manage_token; return prior.manage_token;');
end $$;
create function public.client_intake(p_booking uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b public.bookings; begin
 select x.* into b from public.bookings x join auth.users u on u.id=auth.uid() and u.email_confirmed_at is not null and lower(trim(u.email))=x.client_email where x.id=p_booking;
 if b.id is null then raise exception 'Booking unavailable.'; end if;
 return jsonb_build_object('questions',b.intake_questions_snapshot,'answers',b.intake_answers_snapshot,'notes',b.notes,'revision',b.intake_revision);
end $$;
create function public.client_update_intake(p_booking uuid,p_revision integer,p_answers jsonb,p_notes text) returns void language plpgsql security definer set search_path='' as $$
declare b public.bookings; q jsonb; answer text; answer_notes text:=''; begin
 select x.* into b from public.bookings x join auth.users u on u.id=auth.uid() and u.email_confirmed_at is not null and lower(trim(u.email))=x.client_email where x.id=p_booking for update of x;
 if b.id is null then raise exception 'Booking unavailable.'; end if;
 if p_revision is distinct from b.intake_revision then raise exception 'Answers changed in another tab. Close and reopen the editor before saving.'; end if;
 if b.intake_questions_snapshot is null then
  if p_notes is null or length(p_notes)>20000 then raise exception 'Keep answers within 20000 characters.'; end if;
  answer_notes:=p_notes;
 else
  if p_answers is null or jsonb_typeof(p_answers)<>'object' or octet_length(p_answers::text)>80000 then raise exception 'Invalid intake answers.'; end if;
  if exists(select 1 from jsonb_object_keys(p_answers) k where not exists(select 1 from jsonb_array_elements(b.intake_questions_snapshot) v where v->>'id'=k)) then raise exception 'Unknown question.'; end if;
  for q in select value from jsonb_array_elements(b.intake_questions_snapshot) loop
   if p_answers ? (q->>'id') and jsonb_typeof(p_answers->(q->>'id'))<>'string' then raise exception 'Answers must be text.'; end if;
   answer:=trim(coalesce(p_answers->>(q->>'id'),''));
   if (q->>'required')::boolean and answer='' then raise exception 'Please answer: %',q->>'label'; end if;
   if length(answer)>1500 then raise exception 'Keep each answer within 1500 characters.'; end if;
   perform briefbooth_private.validate_checkbox_answer(q,answer);
   answer_notes:=answer_notes||(q->>'label')||E'\n'||coalesce(nullif(answer,''),'Not provided')||E'\n\n';
  end loop;
 end if;
 update public.bookings set notes=trim(answer_notes),intake_answers_snapshot=case when intake_questions_snapshot is null then null else p_answers end,intake_revision=intake_revision+1 where id=b.id;
end $$;
revoke all on function public.client_intake(uuid),public.client_update_intake(uuid,integer,jsonb,text) from public,anon;
grant execute on function public.client_intake(uuid),public.client_update_intake(uuid,integer,jsonb,text) to authenticated;
