alter table public.profiles add column intake_questions jsonb not null default '[{"id":"goals","label":"What would you like to discuss?","type":"long","required":false}]'::jsonb;
create function briefbooth_private.validate_intake_questions() returns trigger language plpgsql set search_path='' as $$
declare q jsonb;
begin
 if jsonb_typeof(new.intake_questions)<>'array' or jsonb_array_length(new.intake_questions)>10 then raise exception 'Use up to 10 intake questions.'; end if;
 for q in select value from jsonb_array_elements(new.intake_questions) loop
 if jsonb_typeof(q)<>'object' or coalesce(q->>'id','') !~ '^[a-zA-Z0-9_-]{1,50}$'
 or jsonb_typeof(q->'label') is distinct from 'string' or length(trim(q->>'label')) not between 1 and 200
 or coalesce(q->>'type','') not in ('short','long') or jsonb_typeof(q->'required') is distinct from 'boolean' then raise exception 'Invalid intake question.'; end if;
 end loop;
 if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(new.intake_questions)) then raise exception 'Question IDs must be unique.'; end if;
 return new;
end; $$;
revoke all on function briefbooth_private.validate_intake_questions() from public,anon,authenticated;
create trigger validate_intake_questions before insert or update of intake_questions on public.profiles for each row execute function briefbooth_private.validate_intake_questions();
alter table public.bookings drop constraint bookings_notes_check;
alter table public.bookings add constraint bookings_notes_check check(length(notes)<=20000);
create function public.book_consultation(p_service uuid,p_start timestamptz,p_name text,p_email text,p_answers jsonb,p_request uuid,p_meeting_mode text default 'zoom') returns uuid
language plpgsql security definer set search_path='' as $$
declare questions jsonb; q jsonb; answer text; notes text:=''; prior public.bookings;
begin
 if p_request is not null then
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,1));
 select * into prior from public.bookings where request_id=p_request;
 if prior.id is not null then
 if prior.service_id=p_service and prior.starts_at=p_start and prior.client_email=lower(trim(p_email)) and prior.meeting_mode=p_meeting_mode then return prior.manage_token; end if;
 raise exception 'This booking request has already been used.';
 end if;
 end if;
 select p.intake_questions into questions from public.profiles p join public.services s on s.owner_id=p.id where s.id=p_service and p.published and s.active;
 if questions is null then raise exception 'This consultation is unavailable.'; end if;
 if p_answers is null or jsonb_typeof(p_answers)<>'object' or octet_length(p_answers::text)>80000 then raise exception 'Invalid intake answers.'; end if;
 if exists(select 1 from jsonb_object_keys(p_answers) k where not exists(select 1 from jsonb_array_elements(questions) v where v.value->>'id'=k)) then raise exception 'The questionnaire changed. Refresh the page and try again.'; end if;
 for q in select value from jsonb_array_elements(questions) loop
 if p_answers ? (q->>'id') and jsonb_typeof(p_answers->(q->>'id'))<>'string' then raise exception 'Intake answers must be text.'; end if;
 answer:=trim(coalesce(p_answers->>(q->>'id'),''));
 if (q->>'required')::boolean and answer='' then raise exception 'Please answer: %',q->>'label'; end if;
 if length(answer)>1500 then raise exception 'Keep each answer within 1500 characters.'; end if;
 notes:=notes||(q->>'label')||E'\n'||coalesce(nullif(answer,''),'Not provided')||E'\n\n';
 end loop;
 return public.create_booking(p_service,p_start,p_name,p_email,trim(notes),p_request,p_meeting_mode);
end; $$;
revoke all on function public.book_consultation(uuid,timestamptz,text,text,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.book_consultation(uuid,timestamptz,text,text,jsonb,uuid,text) to anon,authenticated;
-- Required answers cannot be bypassed using the legacy endpoint.
revoke execute on function public.create_booking(uuid,timestamptz,text,text,text,uuid,text) from public,anon,authenticated;
