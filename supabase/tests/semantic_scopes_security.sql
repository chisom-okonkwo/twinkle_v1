begin;
select set_config('test.scope_owner',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.scope_owner')::uuid);
insert into public.context_preferences(user_id,enabled) values(current_setting('test.scope_owner')::uuid,true);
insert into public.notes(user_id,title,content,created_at,import_metadata) values
(current_setting('test.scope_owner')::uuid,'Dream one','A familiar school.','2026-10-19T00:00:00-05:00',null),
(current_setting('test.scope_owner')::uuid,'Dream two','A familiar street.','2026-10-25T23:59:59-05:00',null),
(current_setting('test.scope_owner')::uuid,'Dream three','A familiar station.','2026-10-26T00:00:00-05:00',null),
(current_setting('test.scope_owner')::uuid,'Historical dream','A boat above clouds.',now(),jsonb_build_object('version',1,'format','txt','file_name','dream.txt','imported_at',now(),'date_basis','import'));
update private.note_embeddings set embedding=array_prepend(1.0,array_fill(0.0,array[1535]))::extensions.vector,status='ready' where user_id=current_setting('test.scope_owner')::uuid;
select set_config('test.scope_hashes',(select jsonb_object_agg(note_id,input_hash)::text from private.note_embeddings where user_id=current_setting('test.scope_owner')::uuid),true);
do $$declare owner_id uuid=current_setting('test.scope_owner')::uuid;b jsonb;b2 jsonb;ids jsonb;begin
 b=public.prepare_semantic_scope(owner_id,'custom','2026-10-19T00:00:00-05:00','2026-10-26T00:00:00-05:00','America/Chicago');
 perform set_config('TimeZone','Asia/Tokyo',true);b2=public.prepare_semantic_scope(owner_id,'custom','2026-10-19T00:00:00-05:00','2026-10-26T00:00:00-05:00','America/Chicago');
 if b->>'key'<>b2->>'key' then raise exception 'Scope identity depends on SQL session timezone';end if;
 ids=public.semantic_scope_anchors(owner_id,b->>'key');if jsonb_array_length(ids)<>2 then raise exception 'Weekly half-open boundary or unknown imported date failed';end if;
 if(select count(*) from private.note_embeddings where user_id=owner_id and status='ready')<>4 then raise exception 'Date scope changed embeddings';end if;
 b=private.semantic_time_bounds(owner_id,'custom','2026-11-01T00:00:00-05:00','2026-11-02T00:00:00-06:00','America/Chicago');
 if extract(epoch from ((b->>'end')::timestamptz-(b->>'start')::timestamptz))<>90000 then raise exception 'DST day boundaries lost';end if;
 b=private.semantic_time_bounds(owner_id,'recent',null,null,'America/Chicago');
 if ((b->>'end')::timestamptz at time zone 'America/Chicago')::date-((b->>'start')::timestamptz at time zone 'America/Chicago')::date<>90 then raise exception 'Recent local calendar range failed';end if;
 begin perform private.semantic_time_bounds(owner_id,'custom',now(),now()-interval '1 day');raise exception 'Invalid range accepted';exception when raise_exception then if sqlerrm='Invalid range accepted' then raise;end if;end;
 begin perform private.semantic_time_bounds(owner_id,'all',null,null,'Invalid/Zone');raise exception 'Invalid timezone accepted';exception when raise_exception then if sqlerrm='Invalid timezone accepted' then raise;end if;end;
end $$;
-- Date-only edits invalidate scoped evidence while retaining the paid vector.
update public.notes set created_at=created_at-interval '2 days' where user_id=current_setting('test.scope_owner')::uuid and title='Dream two';
do $$begin
 if (select jsonb_object_agg(note_id,input_hash) from private.note_embeddings where user_id=current_setting('test.scope_owner')::uuid)<>current_setting('test.scope_hashes')::jsonb then raise exception 'Date-only edit re-embedded notes';end if;
end $$;
-- An all-time run failure must not claim that an untouched recent scope failed.
insert into private.semantic_runs(user_id,status,current_scope,error_code) values(current_setting('test.scope_owner')::uuid,'failed','all','provider') on conflict(user_id) do update set status='failed',current_scope='all',error_code='provider';
do $$declare u uuid=current_setting('test.scope_owner')::uuid;s jsonb;begin
 s=private.semantic_progress(u,private.semantic_time_bounds(u,'recent'));
 if s->>'status'='failed' or s->>'scheduled'<>'false' then raise exception 'Progress leaked between different scopes';end if;
end $$;
set local role authenticated;select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.scope_owner'),'role','authenticated')::text,true);
do $$declare s jsonb;begin s=public.note_theme_snapshot('all');if s->>'indexed'<>'4' or s->>'status'='ready' then raise exception 'Indexed incorrectly implies evaluated';end if;end $$;
set constraints all immediate;rollback;
