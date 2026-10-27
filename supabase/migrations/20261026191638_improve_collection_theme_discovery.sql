-- Compare a collection window rather than requiring a theme around two origins.
-- Algorithm versions recheck old negative results without changing original notes.
alter table private.theme_checked add column analysis_version integer not null default 1;
update private.theme_state set status='idle',token=null where status='processing';

create or replace function public.claim_note_themes(caller_id uuid,activate boolean default false,retry boolean default false) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='8s' as $$
declare state private.theme_state; rev bigint; seeds uuid[]; pool jsonb; known jsonb; used integer; query tsquery;
begin
 perform pg_advisory_xact_lock(hashtextextended(caller_id::text,1415));
 if not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then return jsonb_build_object('status','disabled'); end if;
 insert into private.theme_state(user_id,enabled) values(caller_id,activate) on conflict(user_id) do update set enabled=private.theme_state.enabled or activate returning * into state;
 if not state.enabled then return jsonb_build_object('status','not_started'); end if;
 if (select count(*) from public.notes n where n.user_id=caller_id and private.theme_eligible(n.id,caller_id))<3 then
  update private.theme_state set status='completed' where user_id=caller_id; return jsonb_build_object('status','ready');
 end if;
 if state.status='processing' and state.started_at>now()-interval '2 minutes' then return jsonb_build_object('status','processing'); end if;
 if state.status='failed' and (not retry or state.started_at>now()-interval '30 seconds') then return jsonb_build_object('status','failed'); end if;
 insert into private.related_library(user_id) values(caller_id) on conflict do nothing;
 select revision into rev from private.related_library where user_id=caller_id;
 select array_agg(x.id) into seeds from (
 select n.id from public.notes n join public.note_contexts c on c.note_id=n.id and c.user_id=n.user_id
 left join private.theme_checked done on done.note_id=n.id and done.user_id=n.user_id
 where n.user_id=caller_id and private.theme_eligible(n.id,caller_id)
 and (done.note_id is null or done.analysis_version<2 or done.content_hash<>private.note_context_hash(n.content))
 and c.status<>'pending' and not(c.status='processing' and c.processing_started_at>now()-interval '2 minutes')
 order by n.updated_at desc,n.id limit 32) x;
 if coalesce(cardinality(seeds),0)=0 then update private.theme_state set status='completed' where user_id=caller_id; return jsonb_build_object('status','ready'); end if;
 -- Reuse FR-13's indexed English document and FR-15's strong relationships.
 -- The fresh window is always included even with NO lexical match or context.
 select to_tsquery('pg_catalog.english',string_agg(quote_literal(term),' | ')) into query from (
 select term,count(*) as frequency from public.note_search_documents d
 cross join lateral unnest(tsvector_to_array(d.document)) term
 where d.user_id=caller_id and d.note_id=any(seeds) group by term order by frequency desc,term limit 24) x;
 with fresh as(select n.id,0 as priority,0::real as score from public.notes n where n.user_id=caller_id and n.id=any(seeds)),
 neighbors as (
 select n.id,1 as priority,
 coalesce(ts_rank_cd(d.document,query),0)+
 case when exists(select 1 from public.note_relations r where r.user_id=caller_id and r.score>=90 and
 ((r.note_id=any(seeds) and r.related_id=n.id) or (r.related_id=any(seeds) and r.note_id=n.id))) then 2 else 0 end+
 case when exists(select 1 from public.note_theme_members m where m.note_id=n.id and m.user_id=caller_id) then 0.1 else 0 end as score
 from public.notes n join public.note_search_documents d on d.note_id=n.id and d.user_id=n.user_id
 join public.note_contexts c on c.note_id=n.id and c.user_id=n.user_id
 where n.user_id=caller_id and not(n.id=any(seeds)) and private.theme_eligible(n.id,caller_id)
 and c.status<>'pending' and not(c.status='processing' and c.processing_started_at>now()-interval '2 minutes')
 order by score desc,n.created_at,n.id limit 16
 ), collection_window as(select * from fresh union all select * from neighbors)
 select jsonb_agg((public.related_note_input(w.id,caller_id)||jsonb_build_object('content',left(n.content,4000),'context',left(d.context_text,1000))) order by w.priority,w.score desc,w.id)
 into pool from collection_window w join public.notes n on n.id=w.id and n.user_id=caller_id join public.note_search_documents d on d.note_id=w.id and d.user_id=caller_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'label',t.generated_label,'description',t.description,'dismissed',t.dismissed)),'[]') into known
 from(select t.* from public.note_themes t where t.user_id=caller_id order by t.dismissed desc,
 (select count(*) from public.note_theme_members m where m.theme_id=t.id and m.user_id=caller_id and m.note_id=any(seeds)) desc,t.created_at desc limit 24) t;
 update private.theme_state set window_start=date_trunc('hour',now()),attempts=case when window_start=date_trunc('hour',now()) then attempts+1 else 1 end where user_id=caller_id returning attempts into used;
 if used>4 then raise exception 'RATE_LIMIT'; end if;
 update private.theme_state set token=gen_random_uuid(),status='processing',revision=rev,started_at=now() where user_id=caller_id returning * into state;
 return jsonb_build_object('status','claimed','token',state.token,'revision',rev,'seeds',to_jsonb(seeds),'collection',pool,'known',known);
end $$;

-- Retain feedback when a group grows/shrinks slightly under a synonymous label.
create or replace function public.finish_note_themes(caller_id uuid,claim_token uuid,expected_revision bigint,seeds uuid[],groups jsonb) returns boolean
language plpgsql security invoker set search_path='' set statement_timeout='8s' as $$
declare g jsonb; member jsonb; ids uuid[]; chosen uuid; candidate public.note_themes; key text; original text; hash text;
begin
 if cardinality(seeds) not between 1 and 32 or jsonb_typeof(groups)<>'array' or jsonb_array_length(groups)>6 then raise exception 'INVALID_THEMES'; end if;
 -- Lock referenced rows before the owner analysis lock, matching deletion order.
 perform 1 from public.notes n where n.user_id=caller_id and n.id in(select unnest(seeds) union select (m->>'id')::uuid from jsonb_array_elements(groups) x cross join lateral jsonb_array_elements(x->'members') m) order by n.id for key share;
 perform pg_advisory_xact_lock(hashtextextended(caller_id::text,1415));
 if not exists(select 1 from private.theme_state where user_id=caller_id and token=claim_token and status='processing')
 or not exists(select 1 from private.related_library where user_id=caller_id and revision=expected_revision)
 or not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then return false; end if;
 if exists(select 1 from unnest(seeds) id where not private.theme_eligible(id,caller_id)) then return false; end if;
 for g in select * from jsonb_array_elements(groups) loop
  if jsonb_typeof(g->'members')<>'array' or jsonb_array_length(g->'members') not between 3 and 12 or char_length(g->>'label') not between 3 and 120 or char_length(g->>'description') not between 1 and 3240 then raise exception 'INVALID_THEMES'; end if;
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
 insert into private.theme_checked(note_id,user_id,content_hash,analysis_version) select n.id,caller_id,private.note_context_hash(n.content),2 from public.notes n where n.user_id=caller_id and n.id=any(seeds)
 on conflict(note_id) do update set content_hash=excluded.content_hash,analysis_version=excluded.analysis_version,checked_at=now();
 update private.theme_state set status='completed',completed_at=now() where user_id=caller_id and token=claim_token;
 return true;
end $$;

create or replace function private.note_theme_snapshot(period text) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare owner_id uuid=auth.uid(); state private.theme_state; total integer; checked integer; pending integer; groups jsonb;
begin
 if owner_id is null then raise insufficient_privilege using message='Sign in to explore themes.'; end if;
 if period is null or period not in ('all','recent') then raise invalid_parameter_value using message='Choose all time or the past 90 days.'; end if;
 if not exists(select 1 from public.context_preferences where user_id=owner_id and enabled) then return jsonb_build_object('status','disabled','total',0,'checked',0,'pending',0,'themes','[]'::jsonb); end if;
 select * into state from private.theme_state where user_id=owner_id;
 select count(*),count(*) filter(where done.note_id is not null and done.analysis_version>=2 and done.content_hash=private.note_context_hash(n.content)),
 count(*) filter(where c.status='pending' or c.status='processing' and c.processing_started_at>now()-interval '2 minutes')
 into total,checked,pending from public.notes n left join public.note_contexts c on c.note_id=n.id and c.user_id=n.user_id
 left join private.theme_checked done on done.note_id=n.id and done.user_id=n.user_id where n.user_id=owner_id and private.theme_eligible(n.id,owner_id);
 with members as materialized(select * from private.visible_theme_members(owner_id,period)), summary as (
  select m.theme_id,count(distinct m.note_id)::integer as note_count,min(m.created_at) as first_at,max(m.created_at) as last_at from members m group by m.theme_id having count(distinct m.note_id)>=3
 ), selected as(select * from summary order by note_count desc,last_at desc,theme_id limit 8)
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'label',coalesce(t.user_label,t.generated_label),'generated_label',t.generated_label,'description',t.description,
 'note_count',s.note_count,'first_at',s.first_at,'last_at',s.last_at,'months',
 (select jsonb_agg(to_jsonb(b) order by b.month) from (select to_char(m.created_at at time zone 'UTC','YYYY-MM') as month,count(distinct m.note_id)::integer as note_count from members m where m.theme_id=t.id group by 1) b)) order by s.note_count desc,s.last_at desc,t.id),'[]') into groups
 from selected s join public.note_themes t on t.id=s.theme_id and t.user_id=owner_id;
 return jsonb_build_object('status',case when not coalesce(state.enabled,false) then 'not_started'
 when state.status='processing' and state.started_at>now()-interval '2 minutes' then 'processing'
 when state.status='failed' then 'failed' when total<3 then 'ready' when total>checked and total-checked<=pending then 'waiting_context'
 when total>checked then 'pending' else 'ready' end,'total',total,'checked',checked,'pending',pending,'themes',groups);
end $$;
