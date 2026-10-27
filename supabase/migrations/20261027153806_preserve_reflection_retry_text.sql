-- Idempotent retries must never discard a subsequently edited response draft.
create or replace function private.answer_reflective_prompt(target uuid,body text) returns uuid language plpgsql security definer set search_path='' as $$
declare owner_id uuid=auth.uid();p private.reflective_prompts;existing uuid;response_id uuid=gen_random_uuid();heading text;
begin
 if owner_id is null then raise insufficient_privilege;end if;
 if body is null or btrim(body)='' or char_length(body)>100000 then raise exception 'INVALID_RESPONSE';end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,1415));
 select response_note_id into existing from public.note_reflections where prompt_id=target and user_id=owner_id;
 if existing is not null then
  if exists(select 1 from public.notes where id=existing and user_id=owner_id and content=body) then return existing;end if;
  raise exception 'RESPONSE_ALREADY_SAVED';
 end if;
 select * into p from private.reflective_prompts where id=target and user_id=owner_id for update;
 if p.status is distinct from 'ready' or p.input_hash is distinct from private.reflection_fingerprint(private.reflection_input(owner_id,'prompt',p.note_id)) then raise exception 'PROMPT_CHANGED';end if;
 select case when title='' then 'A reflection' else 'Revisiting: '||left(title,140) end into heading from public.notes where id=p.note_id and user_id=owner_id;
 insert into public.notes(id,user_id,title,content,capture_method) values(response_id,owner_id,heading,body,'text');
 insert into public.note_reflections(prompt_id,user_id,original_note_id,response_note_id,question) values(p.id,owner_id,p.note_id,response_id,p.question);
 update private.reflective_prompts set status='answered',question=null,quote=null where id=p.id;
 return response_id;
end $$;
