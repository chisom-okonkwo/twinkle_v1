begin;
select set_config('test.group_owner',gen_random_uuid()::text,true),set_config('test.group_other',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.group_owner')::uuid),(current_setting('test.group_other')::uuid);
insert into public.context_preferences(user_id,enabled) values(current_setting('test.group_owner')::uuid,true);
insert into public.notes(user_id,title,content) values
(current_setting('test.group_owner')::uuid,'Dream — school','Same familiar corridor.'),
(current_setting('test.group_owner')::uuid,'Dream — street','The familiar street appeared again.'),
(current_setting('test.group_owner')::uuid,'Dream — a boat','A boat drifted above the clouds.');
update private.note_embeddings set embedding=array_prepend(1.0,array_fill(0.0,array[1535]))::extensions.vector,status='ready' where user_id=current_setting('test.group_owner')::uuid;
select set_config('test.group_ids',(select to_jsonb(array_agg(id order by id))::text from public.notes where user_id=current_setting('test.group_owner')::uuid),true);
set local role service_role;select set_config('request.jwt.claims','{}',true);
select public.prepare_semantic_scope(current_setting('test.group_owner')::uuid);
select set_config('test.group_run',public.claim_semantic_run(current_setting('test.group_owner')::uuid)::text,true);
select public.enqueue_semantic_group(current_setting('test.group_owner')::uuid,'all',jsonb_build_array(current_setting('test.group_ids')::jsonb),'gpt-6-luna');
select set_config('test.group_claim',public.claim_semantic_group(current_setting('test.group_owner')::uuid,'all',(current_setting('test.group_run')::jsonb->>'token')::uuid)::text,true);
do $$declare c jsonb=current_setting('test.group_claim')::jsonb;result jsonb;begin
 select jsonb_build_object('groups',jsonb_build_array(jsonb_build_object('existing_id',null,'label','Dreams','description','These notes record dream scenes.','members',jsonb_agg(jsonb_build_object('id',n.id,'field','title','quote',n.title))))) into result from(select * from public.notes where user_id=current_setting('test.group_owner')::uuid order by id limit 2)n;
 if not public.cache_semantic_validation(current_setting('test.group_owner')::uuid,(c->>'id')::uuid,(c->>'token')::uuid,result) then raise exception 'Paid validation not cached';end if;
 if not public.cache_semantic_validation(current_setting('test.group_owner')::uuid,(c->>'id')::uuid,(c->>'token')::uuid,result) then raise exception 'Paid validation cache not idempotent';end if;
 perform public.persist_semantic_validation(current_setting('test.group_owner')::uuid,(c->>'id')::uuid,(c->>'token')::uuid);
 perform public.persist_semantic_validation(current_setting('test.group_owner')::uuid,(c->>'id')::uuid,(c->>'token')::uuid);
 if(select count(*) from public.note_theme_members where user_id=current_setting('test.group_owner')::uuid)<>2 then raise exception 'Two-note group missing or duplicated';end if;
end $$;
set local role authenticated;select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.group_owner'),'role','authenticated')::text,true);
do $$declare s jsonb;begin
 s=public.note_theme_snapshot('all');
 if jsonb_array_length(s->'themes')<>1 or s#>>'{themes,0,note_count}'<>'2' or s#>>'{themes,0,recurring}'<>'false' then raise exception 'Two-note coherent group misrepresented as recurrence';end if;
 if jsonb_array_length(public.read_note_theme_members((s#>>'{themes,0,id}')::uuid,'all',0))<>2 then raise exception 'Group counts and supporting notes differ';end if;
end $$;
set local role service_role;select set_config('request.jwt.claims','{}',true);
select set_config('test.group_id',(select id::text from public.note_themes where user_id=current_setting('test.group_owner')::uuid),true);
set local role authenticated;select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.group_owner'),'role','authenticated')::text,true);
update public.note_themes set user_label='My dream notes' where id=current_setting('test.group_id')::uuid;
update public.note_themes set dismissed=true where id=current_setting('test.group_id')::uuid;
set local role service_role;select set_config('request.jwt.claims','{}',true);
-- Regenerating a separate unused AI context must not erase faithful membership.
update public.note_contexts set generated_context='{}' where user_id=current_setting('test.group_owner')::uuid;
do $$begin if(select count(*) from public.note_theme_members where user_id=current_setting('test.group_owner')::uuid)<>2 then raise exception 'Unchanged generated context erased valid group';end if;end $$;
-- A cached replay uses no new validation budget and preserves dismissal/name.
select public.enqueue_semantic_group(current_setting('test.group_owner')::uuid,'all',jsonb_build_array(current_setting('test.group_ids')::jsonb),'gpt-6-luna');
select set_config('test.group_cached',public.claim_semantic_group(current_setting('test.group_owner')::uuid,'all',(current_setting('test.group_run')::jsonb->>'token')::uuid)::text,true);
do $$declare c jsonb=current_setting('test.group_cached')::jsonb;begin
 if c->>'status'<>'validated' then raise exception 'Completed validation not reused';end if;
 if(select validation_attempts from private.semantic_runs where user_id=current_setting('test.group_owner')::uuid)<>2 then raise exception 'Cached replay charged generative budget';end if;
 perform public.persist_semantic_validation(current_setting('test.group_owner')::uuid,(c->>'id')::uuid,(c->>'token')::uuid);
 if(select count(*) from public.note_themes where user_id=current_setting('test.group_owner')::uuid)<>1 or(select user_label from public.note_themes where id=current_setting('test.group_id')::uuid)<>'My dream notes' then raise exception 'Feedback lost or dismissed group recreated';end if;
end $$;
-- A material title edit cancels all affected cached results immediately.
update public.notes set title='A changed dream subject' where id=(current_setting('test.group_ids')::jsonb->>0)::uuid;
do $$begin
 if exists(select 1 from public.note_theme_members where user_id=current_setting('test.group_owner')::uuid) then raise exception 'Stale memberships retained after title edit';end if;
 if exists(select 1 from private.semantic_group_jobs where user_id=current_setting('test.group_owner')::uuid and status='completed') then raise exception 'Edited job remained current';end if;
end $$;
set local role authenticated;select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.group_other'),'role','authenticated')::text,true);
do $$begin
 if exists(select 1 from public.note_themes) or exists(select 1 from public.note_theme_members) then raise exception 'Cross-user group data';end if;
 begin perform public.claim_semantic_group(auth.uid(),'all',gen_random_uuid());raise exception 'Client claimed internal validation';exception when insufficient_privilege then null;end;
 begin update public.note_theme_members set quote='Made up';raise exception 'Client forged evidence';exception when insufficient_privilege then null;end;
end $$;
set constraints all immediate;rollback;
