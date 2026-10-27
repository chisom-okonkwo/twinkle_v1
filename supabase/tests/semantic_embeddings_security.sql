begin;
select set_config('test.semantic_owner',gen_random_uuid()::text,true),set_config('test.semantic_other',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.semantic_owner')::uuid),(current_setting('test.semantic_other')::uuid);
insert into public.context_preferences(user_id,enabled) values(current_setting('test.semantic_owner')::uuid,false);
insert into public.notes(user_id,title,content) values(current_setting('test.semantic_owner')::uuid,'Dream journal','Same corridor.');
select set_config('test.semantic_note',(select id::text from public.notes where user_id=current_setting('test.semantic_owner')::uuid),true);
do $$ begin
 if (select status from private.note_embeddings where note_id=current_setting('test.semantic_note')::uuid)<>'deferred' then raise exception 'No consent processed a note';end if;
 if private.semantic_document(current_setting('test.semantic_note')::uuid,current_setting('test.semantic_owner')::uuid)->>'title'<>'Dream journal' then raise exception 'Title missing';end if;
end $$;
update public.context_preferences set enabled=true where user_id=current_setting('test.semantic_owner')::uuid;
set local role service_role;select set_config('request.jwt.claims','{}',true);
select public.activate_semantic_history(current_setting('test.semantic_owner')::uuid);
select set_config('test.semantic_run',public.claim_semantic_run(current_setting('test.semantic_owner')::uuid)::text,true);
select set_config('test.semantic_claims',public.claim_semantic_embeddings(current_setting('test.semantic_owner')::uuid,(current_setting('test.semantic_run')::jsonb->>'token')::uuid)::text,true);
do $$ declare claims jsonb=current_setting('test.semantic_claims')::jsonb;result jsonb;begin
 if jsonb_array_length(claims)<>1 or claims->0->>'input' not like '%Dream journal%' then raise exception 'Meaningful short titled note excluded';end if;
 if public.claim_semantic_run(current_setting('test.semantic_owner')::uuid)->>'status'<>'processing' then raise exception 'Duplicate owner run';end if;
 result=jsonb_build_array((claims->0)-'input'||jsonb_build_object('embedding',to_jsonb(array_prepend(1.0,array_fill(0.0,array[1535])))));
 if public.finish_semantic_embeddings(current_setting('test.semantic_owner')::uuid,result)<>1 then raise exception 'Embedding not saved';end if;
 if public.finish_semantic_embeddings(current_setting('test.semantic_owner')::uuid,result)<>0 then raise exception 'Claim replay overwritten';end if;
 if jsonb_array_length(public.claim_semantic_embeddings(current_setting('test.semantic_owner')::uuid,(current_setting('test.semantic_run')::jsonb->>'token')::uuid))<>0 then raise exception 'Unchanged input called provider';end if;
end $$;
select set_config('test.semantic_hash',(select input_hash from private.note_embeddings where note_id=current_setting('test.semantic_note')::uuid),true);
-- Operational dates, generated interpretations and date reads do not change representation.
update public.notes set created_at='2020-01-01' where id=current_setting('test.semantic_note')::uuid;
do $$begin if (select input_hash from private.note_embeddings where note_id=current_setting('test.semantic_note')::uuid)<>current_setting('test.semantic_hash') or (select status from private.note_embeddings where note_id=current_setting('test.semantic_note')::uuid)<>'ready' then raise exception 'Operational date forced embedding';end if;end $$;
update public.notes set title='Dream about my old school' where id=current_setting('test.semantic_note')::uuid;
select set_config('test.semantic_new_claims',public.claim_semantic_embeddings(current_setting('test.semantic_owner')::uuid,(current_setting('test.semantic_run')::jsonb->>'token')::uuid)::text,true);
update public.notes set content='A different hallway appeared.' where id=current_setting('test.semantic_note')::uuid;
do $$declare c jsonb=current_setting('test.semantic_new_claims')::jsonb;result jsonb;begin
 result=jsonb_build_array((c->0)-'input'||jsonb_build_object('embedding',to_jsonb(array_prepend(1.0,array_fill(0.0,array[1535])))));
 if public.finish_semantic_embeddings(current_setting('test.semantic_owner')::uuid,result)<>0 then raise exception 'Delayed vector overwrote newer body';end if;
end $$;
update public.note_contexts set user_context='I recognised the place from childhood.' where note_id=current_setting('test.semantic_note')::uuid;
do $$begin if (private.semantic_document(current_setting('test.semantic_note')::uuid,current_setting('test.semantic_owner')::uuid)->>'user_context')<>'I recognised the place from childhood.' then raise exception 'Added context omitted';end if;end $$;
select set_config('test.semantic_failed',public.claim_semantic_embeddings(current_setting('test.semantic_owner')::uuid,(current_setting('test.semantic_run')::jsonb->>'token')::uuid)::text,true);
select public.fail_semantic_embeddings(current_setting('test.semantic_owner')::uuid,current_setting('test.semantic_failed')::jsonb,'provider');
set local role authenticated;select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.semantic_owner'),'role','authenticated')::text,true);
insert into public.notes(title,content) values('A normal save','Still saves when another embedding fails.');
do $$begin
 if not exists(select 1 from public.notes where title='A normal save') then raise exception 'Failure blocked capture';end if;
 begin perform * from private.note_embeddings;raise exception 'Client read vectors';exception when insufficient_privilege then null;end;
 begin perform public.claim_semantic_run(auth.uid());raise exception 'Client controlled service lease';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.semantic_other'),'role','authenticated')::text,true);
do $$begin if (public.semantic_index_snapshot()->>'status')<>'disabled' then raise exception 'Foreign snapshot leaked work';end if;end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.semantic_owner'),'role','authenticated')::text,true);
update public.context_preferences set enabled=false where user_id=auth.uid();
set local role service_role;select set_config('request.jwt.claims','{}',true);
do $$begin if exists(select 1 from private.note_embeddings where user_id=current_setting('test.semantic_owner')::uuid and embedding is not null) then raise exception 'Revoked consent left active vector';end if;end $$;
delete from public.notes where user_id=current_setting('test.semantic_owner')::uuid;
do $$begin if exists(select 1 from private.note_embeddings where user_id=current_setting('test.semantic_owner')::uuid) then raise exception 'Deleted vectors remained';end if;end $$;
set local role anon;select set_config('request.jwt.claims','{}',true);
do $$begin begin perform public.semantic_index_snapshot();raise exception 'Anonymous index access';exception when insufficient_privilege then null;end;end $$;
set constraints all immediate;rollback;
