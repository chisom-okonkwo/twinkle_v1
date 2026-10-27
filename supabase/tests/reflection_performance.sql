-- 1,000 synthetic notes, bounded theme and related-note retrieval. No AI calls.
begin;
select set_config('test.rp_owner',gen_random_uuid()::text,true),set_config('test.rp_theme',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.rp_owner')::uuid);
insert into public.context_preferences(user_id,enabled) values(current_setting('test.rp_owner')::uuid,false);
insert into public.notes(user_id,title,content,created_at)
select current_setting('test.rp_owner')::uuid,'Drawing thought '||i,'I believe drawing a little every day is worth exploring. Synthetic variation '||i||'.',now()-make_interval(days=>i) from generate_series(1,1000)i;
update public.context_preferences set enabled=true where user_id=current_setting('test.rp_owner')::uuid;
update private.note_embeddings set embedding=array_prepend(1.0,array_fill(0.0,array[1535]))::extensions.vector,status='ready' where user_id=current_setting('test.rp_owner')::uuid;
insert into public.note_themes(id,user_id,theme_key,generated_label,description) values(current_setting('test.rp_theme')::uuid,current_setting('test.rp_owner')::uuid,'synthetic-drawing','Daily drawing','Synthetic group for bounded retrieval testing.');
insert into public.note_theme_members(theme_id,note_id,user_id,quote,content_hash,input_hash,evidence_field,scope_key)
select current_setting('test.rp_theme')::uuid,n.id,n.user_id,left(n.content,120),private.note_context_hash(n.content),e.input_hash,'content','all' from public.notes n join private.note_embeddings e on e.note_id=n.id and e.user_id=n.user_id where n.user_id=current_setting('test.rp_owner')::uuid;
select set_config('test.rp_target',(select id::text from public.notes where user_id=current_setting('test.rp_owner')::uuid order by created_at limit 1),true);
set local role authenticated;select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.rp_owner'),'role','authenticated')::text,true);
do $$declare start_at timestamptz;duration numeric;s jsonb;begin
 start_at=clock_timestamp();s=public.read_reflection_experience('theme',current_setting('test.rp_theme')::uuid);duration=extract(epoch from clock_timestamp()-start_at)*1000;
 if jsonb_array_length(s->'notes')>8 or jsonb_array_length(s->'notes')<2 then raise exception 'Theme candidate bound invalid';end if;
 if duration>5000 then raise exception 'Theme reflection retrieval too slow: % ms',duration;end if;
 perform set_config('test.rp_theme_ms',round(duration,3)::text,true);
 start_at=clock_timestamp();s=public.read_reflection_experience('note',current_setting('test.rp_target')::uuid);duration=extract(epoch from clock_timestamp()-start_at)*1000;
 if jsonb_array_length(s->'notes')>8 or jsonb_array_length(s->'notes')<2 then raise exception 'Related candidate bound invalid';end if;
 if duration>5000 then raise exception 'Note reflection retrieval too slow: % ms',duration;end if;
 perform set_config('test.rp_note_ms',round(duration,3)::text,true);
end $$;
reset role;select jsonb_build_object('theme_snapshot_ms',current_setting('test.rp_theme_ms')::numeric,'note_snapshot_ms',current_setting('test.rp_note_ms')::numeric,'collection_size',1000) as performance;set constraints all immediate;rollback;
