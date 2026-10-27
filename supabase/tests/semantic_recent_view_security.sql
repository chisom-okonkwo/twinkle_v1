-- Display/persistence regression, with synthetic fixtures and no provider calls.
begin;
select set_config('test.recent_owner',gen_random_uuid()::text,true),set_config('test.recent_other',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.recent_owner')::uuid),(current_setting('test.recent_other')::uuid);
insert into public.context_preferences(user_id,enabled) values(current_setting('test.recent_owner')::uuid,true),(current_setting('test.recent_other')::uuid,true);
insert into public.notes(user_id,title,content,created_at,import_metadata) values
(current_setting('test.recent_owner')::uuid,'Dream school','A familiar school in a dream.',now()-interval '5 days',null),
(current_setting('test.recent_owner')::uuid,'Dream station','A familiar station in a dream.',now()-interval '4 days',null),
(current_setting('test.recent_owner')::uuid,'Dream childhood','An older remembered dream.',now()-interval '120 days',null),
(current_setting('test.recent_owner')::uuid,'Dream boat','A boat above clouds in a dream.',now(),jsonb_build_object('version',1,'format','txt','file_name','dream.txt','imported_at',now(),'date_basis','import')),
(current_setting('test.recent_owner')::uuid,'Bicycle brakes','A cable replacement for the bicycle.',now()-interval '3 days',null),
(current_setting('test.recent_owner')::uuid,'Bicycle wheels','Replacing the old bicycle wheel.',now()-interval '121 days',null);
update private.note_embeddings set embedding=array_prepend(1.0,array_fill(0.0,array[1535]))::extensions.vector,status='ready' where user_id=current_setting('test.recent_owner')::uuid;
select set_config('test.recent_hashes',(select jsonb_object_agg(note_id,input_hash)::text from private.note_embeddings where user_id=current_setting('test.recent_owner')::uuid),true);
select public.prepare_semantic_scope(current_setting('test.recent_owner')::uuid);
select set_config('test.recent_run',public.claim_semantic_run(current_setting('test.recent_owner')::uuid)::text,true);
select public.enqueue_semantic_group(current_setting('test.recent_owner')::uuid,'all',(select jsonb_build_array(jsonb_agg(id)) from public.notes where user_id=current_setting('test.recent_owner')::uuid),'test-no-provider');
select set_config('test.recent_job',public.claim_semantic_group(current_setting('test.recent_owner')::uuid,'all',(current_setting('test.recent_run')::jsonb->>'token')::uuid)::text,true);
do $$declare owner_id uuid=current_setting('test.recent_owner')::uuid;j jsonb=current_setting('test.recent_job')::jsonb;groups jsonb;begin
 select jsonb_build_object('groups',jsonb_agg(g)) into groups from(
 select jsonb_build_object('existing_id',null,'label',case when title like 'Dream%' then 'Dreams' else 'Bicycle repairs' end,'description','Synthetic source-backed group for date-view verification.','members',jsonb_agg(jsonb_build_object('id',id,'field','title','quote',title))) g
 from public.notes where user_id=owner_id group by title like 'Dream%')x;
 if not public.cache_semantic_validation(owner_id,(j->>'id')::uuid,(j->>'token')::uuid,groups) then raise exception 'Fixture validation failed';end if;
 perform public.persist_semantic_validation(owner_id,(j->>'id')::uuid,(j->>'token')::uuid);
end $$;
set local role authenticated;select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.recent_owner'),'role','authenticated')::text,true);
do $$declare s jsonb;g jsonb;begin
 s=public.note_theme_snapshot('recent');
 if jsonb_array_length(s->'themes')<>1 or s->>'hidden_groups'<>'1' then raise exception 'Date-supported group not displayed, or singleton displayed';end if;
 g=s->'themes'->0;
 if g->>'note_count'<>'2' or g->>'recurring'<>'false' then raise exception 'Recent distinct counts or recurrence incorrect';end if;
 if jsonb_array_length(public.read_note_theme_members((g->>'id')::uuid,'recent',0))<>2 then raise exception 'Recent supporting-note reader differs from card count';end if;
 if s->>'all_time_group_count'<>'2' or s->'date_coverage'<>jsonb_build_object('in_period',3,'outside_period',2,'unknown_date',1) then raise exception 'Date coverage inaccurate';end if;
 s=public.note_theme_snapshot('all');
 if jsonb_array_length(s->'themes')<>2 then raise exception 'All-time groups lost';end if;
 if not exists(select 1 from jsonb_array_elements(s->'themes') as item where item->>'note_count'='4' and item->>'unknown_dates'='1' and item->>'recurring'='true') then raise exception 'Unknown original date inflated/removed all-time support';end if;
end $$;
reset role;
update public.notes set created_at=now()-interval '140 days' where user_id=current_setting('test.recent_owner')::uuid and title='Dream station';
set local role authenticated;select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.recent_owner'),'role','authenticated')::text,true);
do $$declare s jsonb;begin
 s=public.note_theme_snapshot('recent');if jsonb_array_length(s->'themes')<>0 or s->>'all_time_group_count'<>'2' or s->>'hidden_groups'<>'2' then raise exception 'Single recent member became a group';end if;
 if s->'date_coverage'<>jsonb_build_object('in_period',2,'outside_period',3,'unknown_date',1) then raise exception 'Date edit left stale coverage';end if;
end $$;
set local role authenticated;select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.recent_other'),'role','authenticated')::text,true);
do $$declare s jsonb;begin
 s=public.note_theme_snapshot('recent');if jsonb_array_length(s->'themes')<>0 or s->>'all_time_group_count'<>'0' or s->'date_coverage'<>jsonb_build_object('in_period',0,'outside_period',0,'unknown_date',0) then raise exception 'Another owner can see date coverage or groups';end if;
end $$;
reset role;
do $$begin
 if (select jsonb_object_agg(note_id,input_hash) from private.note_embeddings where user_id=current_setting('test.recent_owner')::uuid)<>current_setting('test.recent_hashes')::jsonb then raise exception 'Date-view reads or date edit changed embedding inputs';end if;
 if exists(select 1 from private.semantic_usage where user_id=current_setting('test.recent_owner')::uuid) then raise exception 'Read or filter caused a paid request';end if;
end $$;
set constraints all immediate;rollback;
