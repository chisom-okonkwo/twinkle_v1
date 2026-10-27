begin;
select set_config('test.sem_owner',gen_random_uuid()::text,true),set_config('test.sem_other',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.sem_owner')::uuid),(current_setting('test.sem_other')::uuid);
insert into public.context_preferences(user_id,enabled) values(current_setting('test.sem_owner')::uuid,true),(current_setting('test.sem_other')::uuid,true);
insert into public.notes(user_id,title,content) select current_setting('test.sem_owner')::uuid,'Synthetic thought '||i,'A useful original thought about making creative work with consistent practice number '||i from generate_series(1,4)i;
insert into public.notes(user_id,title,content) values(current_setting('test.sem_other')::uuid,'Foreign thought','An unrelated private account must not be searched.');
update private.note_embeddings set embedding=array_prepend(1.0,array_fill(0.0,array[1535]))::extensions.vector,status='ready' where user_id in(current_setting('test.sem_owner')::uuid,current_setting('test.sem_other')::uuid);
select set_config('test.sem_target',(select note_id::text from private.note_embeddings where user_id=current_setting('test.sem_owner')::uuid order by note_id limit 1),true);
set local role service_role;select set_config('request.jwt.claims','{}',true);
do $$declare neighbours jsonb;begin
 neighbours=public.semantic_neighbours(current_setting('test.sem_target')::uuid,current_setting('test.sem_owner')::uuid);
 if jsonb_array_length(neighbours)<>3 or exists(select 1 from jsonb_array_elements(neighbours)n where n->>'id'=current_setting('test.sem_target')) then raise exception 'Foreign/self neighbour or wrong count';end if;
 if jsonb_array_length(public.semantic_neighbours(current_setting('test.sem_target')::uuid,current_setting('test.sem_other')::uuid))<>0 then raise exception 'Foreign origin vector searched';end if;
 perform public.refresh_semantic_relations(current_setting('test.sem_target')::uuid,current_setting('test.sem_owner')::uuid);
 perform public.refresh_semantic_relations(current_setting('test.sem_target')::uuid,current_setting('test.sem_owner')::uuid);
 if (select count(*) from private.semantic_relations where user_id=current_setting('test.sem_owner')::uuid)<>3 then raise exception 'Repeated retrieval duplicated relations';end if;
 begin insert into private.semantic_relations(user_id,note_a,note_b,hash_a,hash_b,similarity) values(current_setting('test.sem_owner')::uuid,current_setting('test.sem_target')::uuid,current_setting('test.sem_target')::uuid,'a','a',1);raise exception 'Self relation accepted';exception when check_violation then null;end;
end $$;
update public.notes set title='An edited subject' where id=current_setting('test.sem_target')::uuid;
do $$begin if exists(select 1 from private.semantic_relations where user_id=current_setting('test.sem_owner')::uuid) or jsonb_array_length(public.semantic_neighbours(current_setting('test.sem_target')::uuid,current_setting('test.sem_owner')::uuid))<>0 then raise exception 'Stale vector relation remains';end if;end $$;
set local role authenticated;select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.sem_owner'),'role','authenticated')::text,true);
do $$begin
 begin perform * from private.semantic_relations;raise exception 'Client read private relation graph';exception when insufficient_privilege then null;end;
 begin perform public.semantic_neighbours(current_setting('test.sem_target')::uuid,auth.uid());raise exception 'Client invoked service retrieval';exception when insufficient_privilege then null;end;
end $$;
set local role postgres;select set_config('request.jwt.claims','{}',true);
delete from public.notes where user_id=current_setting('test.sem_owner')::uuid;
do $$begin if exists(select 1 from private.semantic_relations where user_id=current_setting('test.sem_owner')::uuid) then raise exception 'Deleted relations remain';end if;end $$;
set constraints all immediate;rollback;
