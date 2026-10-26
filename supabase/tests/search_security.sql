-- Run as database owner. Synthetic data only; all changes roll back, no AI or pushes.
begin;
select set_config('test.owner_a',gen_random_uuid()::text,true);
select set_config('test.owner_b',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.owner_a')::uuid),(current_setting('test.owner_b')::uuid);
select set_config('test.photo',gen_random_uuid()::text,true);
select set_config('test.audio',gen_random_uuid()::text,true);
insert into public.note_captures(id,user_id,kind,mime_type,byte_size,storage_path,status)
 select current_setting('test.photo')::uuid,current_setting('test.owner_a')::uuid,'image','image/jpeg',10,'search-test/'||current_setting('test.photo'),'ready'
 union all select current_setting('test.audio')::uuid,current_setting('test.owner_a')::uuid,'audio','audio/mp4',10,'search-test/'||current_setting('test.audio'),'ready';
insert into storage.objects(bucket_id,name) select 'note-media',storage_path from public.note_captures where id in(current_setting('test.photo')::uuid,current_setting('test.audio')::uuid);
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner_a'),'role','authenticated')::text,true);
insert into public.notes(id,capture_method,source_capture_id,content) values
 (current_setting('test.photo')::uuid,'image',current_setting('test.photo')::uuid,E'Celestial artwork\nPaint stars and dreams in a midnight sketchbook.'),
 (current_setting('test.audio')::uuid,'audio',current_setting('test.audio')::uuid,E'Conversation with Priya\nWe discussed project Atlas and mentorship on Friday.');
with n as(insert into public.notes(content) values(E'Software engineering internship\nI am considering Northstar but want more portfolio experience.') returning id)
 select set_config('test.direct',id::text,true) from n;
with n as(insert into public.notes(content) values(E'A conversation to remember\nWe discussed an opportunity over coffee.') returning id)
 select set_config('test.context',id::text,true) from n;
update public.note_contexts set user_context='Software engineering internship at Northstar; Hawthorn workshop follow-up.' where note_id=current_setting('test.context')::uuid;
insert into public.notes(content) values('red blue'),('red bright blue'),('Buy milk tomorrow'),('Discipline from Deep Work: Daniel wants to practice consistently.'),('I am running along the riverside.'),('Café résumé ideas');
with n as(insert into public.notes(content) values(E'Observatory visit\n'||repeat('A quiet evening among trees. ',120)||'The meridian observatory opens on Saturday.') returning id)
 select set_config('test.deep',id::text,true) from n;

do $$
declare q text;
begin
 if (select count(*) from public.search_notes('stars'))<>1 then raise exception 'Photo text not searchable'; end if;
 if (select count(*) from public.search_notes('Priya Atlas'))<>1 then raise exception 'Audio text not searchable'; end if;
 if (select id from public.search_notes('software internship') limit 1)<>current_setting('test.direct')::uuid then raise exception 'Context outranked direct content'; end if;
 if not exists(select 1 from public.search_notes('Hawthorn') where matched_context and id=current_setting('test.context')::uuid and preview ilike '%Hawthorn%') then raise exception 'User context/preview missing'; end if;
 if (select count(*) from public.search_notes('"red blue"'))<>1 then raise exception 'Exact phrase was not exact'; end if;
 if (select title from public.search_notes('red blue') limit 1)<>'red blue' then raise exception 'Phrase not ranked first'; end if;
 if not exists(select 1 from public.search_notes('intern') where id=current_setting('test.direct')::uuid) then raise exception 'Last-word prefix failed'; end if;
 if not exists(select 1 from public.search_notes('run') where title like 'I am running%') then raise exception 'Stemming failed'; end if;
 if not exists(select 1 from public.search_notes('café') where title='Café résumé ideas') then raise exception 'Unicode failed'; end if;
 if not exists(select 1 from public.search_notes('meridian') where id=current_setting('test.deep')::uuid and preview ilike '%meridian%') then raise exception 'Deep match missing from preview'; end if;
 foreach q in array array['',E' \t\n','!!! % _','"','unmatchedwordxyz','quote explicit certainty'] loop
   if exists(select 1 from public.search_notes(q)) then raise exception 'Empty/noise/JSON keys produced matches: %',q; end if;
 end loop;
 perform * from public.search_notes($q$'); drop table public.notes; --$q$);
 if not exists(select 1 from public.notes) then raise exception 'Special characters damaged notes'; end if;
 begin perform * from public.search_notes(repeat('x',201)); raise exception 'Oversized search accepted'; exception when invalid_parameter_value then null; end;
 begin perform * from public.search_notes('Atlas',10000,-1); raise exception 'Unbounded page accepted'; exception when invalid_parameter_value then null; end;
 begin update public.note_search_documents set title='Forged'; raise exception 'Client forged index'; exception when insufficient_privilege then null; end;
 begin perform private.refresh_note_search(current_setting('test.context')::uuid); raise exception 'Private helper callable'; exception when insufficient_privilege then null; end;
end $$;

-- User context is independent of note timestamps; removals and whitespace edits refresh search.
select set_config('test.old_timestamp',(select updated_at::text from public.notes where id=current_setting('test.context')::uuid),true);
update public.note_contexts set user_context='Juniper workshop follow-up.' where note_id=current_setting('test.context')::uuid;
do $$ begin
 if exists(select 1 from public.search_notes('Hawthorn')) or not exists(select 1 from public.search_notes('Juniper')) then raise exception 'Stale user context searchable'; end if;
 if (select updated_at from public.notes where id=current_setting('test.context')::uuid)<>current_setting('test.old_timestamp')::timestamptz then raise exception 'Index changed note timestamp'; end if;
end $$;
update public.note_contexts set user_context='Amber',answer='meadow' where note_id=current_setting('test.context')::uuid;
do $$ begin
 if exists(select 1 from public.search_notes('"Amber meadow"')) then raise exception 'A phrase crossed separate context fields'; end if;
 if not exists(select 1 from public.search_notes('Amber meadow')) then raise exception 'Keywords cannot combine context fields'; end if;
end $$;
update public.note_contexts set user_context='Juniper workshop follow-up.',answer='' where note_id=current_setting('test.context')::uuid;
update public.notes set content=E'Software\nengineering internship reconsidered with a mentor.' where id=current_setting('test.direct')::uuid;
do $$ begin
 if exists(select 1 from public.search_notes('portfolio')) then raise exception 'Old content remained searchable'; end if;
 if not exists(select 1 from public.search_notes('reconsidered')) then raise exception 'Edited note not searchable'; end if;
end $$;

-- A privileged synthetic AI result cannot inject unsupported text into the index.
set local role service_role;
update public.note_contexts set status='completed',generated_context='{"topics":[{"quote":"fabricatedunicorn","certainty":"explicit"}],"emotions":[{"quote":"fictionalfear","certainty":"interpretation"}]}' where note_id=current_setting('test.context')::uuid;
set local role authenticated;
do $$ begin
 if exists(select 1 from public.search_notes('fabricatedunicorn')) or exists(select 1 from public.search_notes('fictionalfear')) then raise exception 'Unsupported AI metadata indexed'; end if;
end $$;

select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner_b'),'role','authenticated')::text,true);
do $$ begin
 if exists(select 1 from public.search_notes('Atlas')) or exists(select 1 from public.note_search_documents) then raise exception 'Other owner leaked through search/index'; end if;
end $$;
insert into public.notes(content) values('Owner B alone keeps a cobalt telescope.');
do $$ begin
 if (select count(*) from public.search_notes('cobalt'))<>1 then raise exception 'Second owner cannot search own note'; end if;
end $$;
set local role anon;
select set_config('request.jwt.claims','{}',true);
do $$ begin
 begin perform * from public.search_notes('Atlas'); raise exception 'Anonymous search allowed'; exception when insufficient_privilege then null; end;
 begin perform * from public.note_search_documents; raise exception 'Anonymous index access allowed'; exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner_a'),'role','authenticated')::text,true);
delete from public.notes where id=current_setting('test.audio')::uuid;
do $$ begin
 if exists(select 1 from public.search_notes('Priya Atlas')) or exists(select 1 from public.note_search_documents where note_id=current_setting('test.audio')::uuid) then raise exception 'Deleted note/index remained searchable'; end if;
end $$;

-- Realistic collection and stable bounded pagination, with no remote model/storage requests.
insert into public.notes(content) select 'Collection fixture '||i||E'\nA creative fragment about a lantern, astronomy and a project.' from generate_series(1,1000) i;
do $$ declare a uuid[]; b uuid[]; started timestamptz=clock_timestamp(); begin
 select array_agg(id) into a from public.search_notes('lantern',20,0);
 select array_agg(id) into b from public.search_notes('lantern',20,20);
 if cardinality(a)<>20 or cardinality(b)<>20 or a&&b then raise exception 'Pagination failed'; end if;
 if clock_timestamp()-started>interval '2 seconds' then raise exception 'Two 1000-note searches exceeded 2 seconds'; end if;
end $$;
rollback;
select 'PASS: all capture methods, phrase/prefix/stemming, contextual ranking, previews, edits/deletes, RLS, bounded 1000-note search and pagination' as result;
