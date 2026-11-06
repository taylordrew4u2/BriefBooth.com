create or replace function briefbooth_private.validate_intake_questions() returns trigger language plpgsql set search_path='' as $$
declare q jsonb;
begin
 if jsonb_typeof(new.intake_questions)<>'array' or jsonb_array_length(new.intake_questions)>10 then raise exception 'Use up to 10 intake questions.'; end if;
 for q in select value from jsonb_array_elements(new.intake_questions) loop
 if jsonb_typeof(q)<>'object' or coalesce(q->>'id','') !~ '^[a-zA-Z0-9_-]{1,50}$'
 or jsonb_typeof(q->'label') is distinct from 'string' or length(trim(q->>'label')) not between 1 and 200
 or coalesce(q->>'type','') not in ('short','long','multiple') or jsonb_typeof(q->'required') is distinct from 'boolean' then raise exception 'Invalid intake question.'; end if;
 if q->>'type'='multiple' then
  if jsonb_typeof(q->'options') is distinct from 'array' then raise exception 'Provide checkbox choices.'; end if;
  if jsonb_array_length(q->'options') not between 1 and 12 then raise exception 'Use 1 to 12 choices.'; end if;
  if exists(select 1 from jsonb_array_elements(q->'options') o where jsonb_typeof(o)<>'string' or length(trim(o#>>'{}')) not between 1 and 100 or (o#>>'{}') ~ E'[\\n\\r]') then raise exception 'Invalid checkbox choice.'; end if;
  if (select count(*)<>count(distinct value) from jsonb_array_elements(q->'options')) then raise exception 'Choices must be unique.'; end if;
 end if;
 end loop;
 if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(new.intake_questions)) then raise exception 'Question IDs must be unique.'; end if;
 return new;
end; $$;
revoke all on function briefbooth_private.validate_intake_questions() from public,anon,authenticated;

create function briefbooth_private.validate_checkbox_answer(q jsonb,answer text) returns void language plpgsql immutable set search_path='' as $$
begin
 if q->>'type'='multiple' and answer<>'' then
  if exists(select 1 from unnest(string_to_array(answer,E'\n')) a where not (q->'options' ? a)) then raise exception 'Choose from the available options.'; end if;
  if (select count(*)<>count(distinct a) from unnest(string_to_array(answer,E'\n')) a) then raise exception 'Choose each option only once.'; end if;
 end if;
end; $$;
revoke all on function briefbooth_private.validate_checkbox_answer(jsonb,text) from public,anon,authenticated;
DO $$ declare fn text; anchor text := 'if length(answer)>1500 then'; begin
 fn:=pg_get_functiondef('briefbooth_private.reserve_consultation(uuid,timestamptz,text,text,jsonb,uuid,text)'::regprocedure);
 if strpos(fn,anchor)=0 then raise exception 'Intake validation changed; inspect before migrating.'; end if;
 execute replace(fn,anchor,'perform briefbooth_private.validate_checkbox_answer(q,answer); '||anchor);
end $$;
