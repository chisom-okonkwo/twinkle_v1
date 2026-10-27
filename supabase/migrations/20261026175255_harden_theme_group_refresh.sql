-- Retain feedback when a group grows/shrinks slightly under a synonymous label.
create or replace function public.finish_note_themes(caller_id uuid,claim_token uuid,expected_revision bigint,seeds uuid[],groups jsonb) returns boolean
language plpgsql security invoker set search_path='' set statement_timeout='8s' as $$
declare g jsonb; member jsonb; ids uuid[]; chosen uuid; candidate public.note_themes; key text; original text; hash text;
begin
 if cardinality(seeds) not between 1 and 2 or jsonb_typeof(groups)<>'array' or jsonb_array_length(groups)>4 then raise exception 'INVALID_THEMES'; end if;
 -- Lock referenced rows before the owner analysis lock, matching deletion order.
 perform 1 from public.notes n where n.user_id=caller_id and n.id in(select unnest(seeds) union select (m->>'id')::uuid from jsonb_array_elements(groups) x cross join lateral jsonb_array_elements(x->'members') m) order by n.id for key share;
 perform pg_advisory_xact_lock(hashtextextended(caller_id::text,1415));
 if not exists(select 1 from private.theme_state where user_id=caller_id and token=claim_token and status='processing')
 or not exists(select 1 from private.related_library where user_id=caller_id and revision=expected_revision)
 or not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then return false; end if;
 if exists(select 1 from unnest(seeds) id where not private.theme_eligible(id,caller_id)) then return false; end if;
 for g in select * from jsonb_array_elements(groups) loop
  if jsonb_typeof(g->'members')<>'array' or jsonb_array_length(g->'members') not between 3 and 8 or char_length(g->>'label') not between 3 and 80 or char_length(g->>'description') not between 1 and 240 then raise exception 'INVALID_THEMES'; end if;
  select array_agg((m->>'id')::uuid) into ids from jsonb_array_elements(g->'members') m;
  if (select count(distinct x) from unnest(ids) x)<>cardinality(ids) or not ids && seeds or exists(select 1 from unnest(ids) id where not private.theme_eligible(id,caller_id)) then raise exception 'INVALID_THEME_MEMBERS'; end if;
  if exists(select 1 from public.related_note_dismissals d where d.user_id=caller_id and d.note_a=any(ids) and d.note_b=any(ids)) then continue; end if;
  if (select count(distinct private.note_context_hash(n.content)) from public.notes n where n.user_id=caller_id and n.id=any(ids))<>cardinality(ids) then raise exception 'DUPLICATE_THEME_CONTENT'; end if;
  for member in select * from jsonb_array_elements(g->'members') loop
   select content into original from public.notes where id=(member->>'id')::uuid and user_id=caller_id;
   if char_length(member->>'quote') not between 1 and 400 or strpos(private.theme_text(original),private.theme_text(member->>'quote'))=0 then raise exception 'INVALID_THEME_EVIDENCE'; end if;
  end loop;
  key=encode(extensions.digest(lower(btrim(regexp_replace(g->>'label','[[:space:]]+',' ','g'))),'sha256'),'hex');
  chosen=null;
  if nullif(g->>'existing_id','') is not null then
   select id into chosen from public.note_themes where id=(g->>'existing_id')::uuid and user_id=caller_id;
   if chosen is null then raise exception 'FOREIGN_THEME'; end if;
  else
   select id into chosen from public.note_themes where user_id=caller_id and theme_key=key;
   if chosen is null then
    -- Conservatively merge near-identical memberships rather than show a feed
    -- of synonymous groups. Feedback survives generated label variations.
    select t.id into chosen from public.note_themes t join public.note_theme_members m on m.theme_id=t.id and m.user_id=t.user_id
    where t.user_id=caller_id group by t.id having count(*) filter(where m.note_id=any(ids))>=3
    and count(*) filter(where m.note_id=any(ids))::numeric/least(count(*),cardinality(ids))>=0.8
    and count(*) filter(where m.note_id=any(ids))::numeric/greatest(count(*),cardinality(ids))>=0.6 order by count(*) filter(where m.note_id=any(ids)) desc,t.id limit 1;
   end if;
  end if;
  if chosen is null then
   if (select count(*) from public.note_themes where user_id=caller_id)>=200 then continue; end if;
   insert into public.note_themes(user_id,theme_key,generated_label,description) values(caller_id,key,g->>'label',g->>'description') returning id into chosen;
  end if;
  select * into candidate from public.note_themes where id=chosen and user_id=caller_id;
  if candidate.dismissed then continue; end if;
  for member in select * from jsonb_array_elements(g->'members') loop
   select private.note_context_hash(content) into hash from public.notes where id=(member->>'id')::uuid and user_id=caller_id;
   if exists(select 1 from public.note_theme_members where theme_id=chosen and content_hash=hash and note_id<>(member->>'id')::uuid) then continue; end if;
   insert into public.note_theme_members(theme_id,note_id,user_id,quote,content_hash) values(chosen,(member->>'id')::uuid,caller_id,member->>'quote',hash)
   on conflict(theme_id,note_id) do update set quote=excluded.quote,content_hash=excluded.content_hash;
  end loop;
 end loop;
 insert into private.theme_checked(note_id,user_id,content_hash) select n.id,caller_id,private.note_context_hash(n.content) from public.notes n where n.user_id=caller_id and n.id=any(seeds)
 on conflict(note_id) do update set content_hash=excluded.content_hash,checked_at=now();
 update private.theme_state set status='completed',completed_at=now() where user_id=caller_id and token=claim_token;
 return true;
end $$;
