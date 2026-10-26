-- Optional user-confirmed attribution. Empty rows preserve optimistic edit versions.
alter table public.notes add constraint notes_id_owner_unique unique(id,user_id);
create table public.note_sources (
 note_id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 source_type text check(source_type in ('book','article','conversation','project','other')),
 name text not null default '' check(char_length(name)<=300),
 url text not null default '' check(char_length(url)<=2000 and (url='' or url ~ '^https?://[^/@[:space:]]+([/:?#][^[:space:]]*)?$') and url !~ '^https?://[^/]*@'),
 description text not null default '' check(char_length(description)<=2000),
 version bigint not null default 1,
 foreign key(note_id,user_id) references public.notes(id,user_id) on delete cascade,
 check((source_type is null and name='' and url='' and description='') or (source_type is not null and (btrim(name)<>'' or url<>'')))
);
create index note_sources_owner on public.note_sources(user_id);
alter table public.note_sources enable row level security;
revoke all on public.note_sources from public,anon,authenticated;
grant select,update(source_type,name,url,description) on public.note_sources to authenticated;
grant all on public.note_sources to service_role;
create policy source_read on public.note_sources for select to authenticated using(user_id=(select auth.uid()));
create policy source_update on public.note_sources for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create function private.prepare_note_source() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='notes' then insert into public.note_sources(note_id,user_id) values(new.id,new.user_id); return null; end if;
 new.version=old.version+1; return new;
end $$;
revoke all on function private.prepare_note_source() from public,anon,authenticated;
create trigger note_source_created after insert on public.notes for each row execute function private.prepare_note_source();
create trigger source_version before update on public.note_sources for each row execute function private.prepare_note_source();
insert into public.note_sources(note_id,user_id) select id,user_id from public.notes;

-- One bounded, cached analysis per opened saved note. Clients never write generated links.
create table private.related_library (
 user_id uuid primary key references auth.users(id) on delete cascade,
 revision bigint not null default 1,
 window_start timestamptz not null default now(), attempts integer not null default 0
);
alter table private.related_library enable row level security;
revoke all on private.related_library from public,anon,authenticated;
grant all on private.related_library to service_role;
create table public.related_note_runs (
 note_id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 status text not null check(status in ('processing','completed','failed')),
 token uuid not null default gen_random_uuid(), library_revision bigint not null,
 started_at timestamptz not null default now(), completed_at timestamptz, model text,
 foreign key(note_id,user_id) references public.notes(id,user_id) on delete cascade
);
create index related_runs_owner on public.related_note_runs(user_id);
alter table public.related_note_runs enable row level security;
revoke all on public.related_note_runs from public,anon,authenticated;
grant select on public.related_note_runs to authenticated;
grant all on public.related_note_runs to service_role;
create policy related_run_read on public.related_note_runs for select to authenticated using(user_id=(select auth.uid()));
create table public.note_relations (
 note_id uuid not null, related_id uuid not null, user_id uuid not null references auth.users(id) on delete cascade,
 explanation text not null check(char_length(explanation) between 1 and 240),
 origin_quote text not null check(char_length(origin_quote) between 1 and 400),
 related_quote text not null check(char_length(related_quote) between 1 and 400),
 score integer not null check(score between 85 and 100),
 primary key(note_id,related_id), check(note_id<>related_id),
 foreign key(note_id,user_id) references public.notes(id,user_id) on delete cascade,
 foreign key(related_id,user_id) references public.notes(id,user_id) on delete cascade
);
create index note_relations_target on public.note_relations(related_id,user_id);
create index note_relations_owner on public.note_relations(user_id);
alter table public.note_relations enable row level security;
revoke all on public.note_relations from public,anon,authenticated;
grant select on public.note_relations to authenticated;
grant all on public.note_relations to service_role;
create policy related_read on public.note_relations for select to authenticated using(user_id=(select auth.uid()) and exists(
 select 1 from public.related_note_runs r where r.note_id=note_relations.note_id and r.status='completed' and r.completed_at>now()-interval '1 day'));

-- Serialize material edits/consent and analysis completion. No AI is triggered by edits.
create function private.invalidate_note_relations() returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid; target uuid;
begin
 if tg_table_name='context_preferences' then
  if tg_op='UPDATE' and new.enabled=old.enabled then return null; end if;
  owner_id=new.user_id;
 else
  if tg_op='UPDATE' then
   if tg_table_name='notes' then
    if private.note_context_hash(new.content)=private.note_context_hash(old.content) then return null; end if;
   end if;
   if tg_table_name='note_contexts' and (to_jsonb(new)-array['status','processing_token','processing_started_at','attempts','last_completed_at','model','error_code'])=(to_jsonb(old)-array['status','processing_token','processing_started_at','attempts','last_completed_at','model','error_code']) then return null; end if;
  end if;
  if tg_op='DELETE' then owner_id=old.user_id; target=old.id;
  else owner_id=new.user_id; if tg_table_name='notes' then target=new.id; else target=new.note_id; end if; end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,1415));
 insert into private.related_library(user_id) values(owner_id) on conflict(user_id) do update set revision=private.related_library.revision+1;
 delete from public.related_note_runs where user_id=owner_id;
 if target is null then delete from public.note_relations where user_id=owner_id;
 else delete from public.note_relations where user_id=owner_id and (note_id=target or related_id=target); end if;
 return null;
end $$;
revoke all on function private.invalidate_note_relations() from public,anon,authenticated;
create trigger related_notes_changed after insert or update of content or delete on public.notes for each row execute function private.invalidate_note_relations();
create trigger related_context_changed after update of generated_context,user_context,answer on public.note_contexts for each row execute function private.invalidate_note_relations();
create trigger related_source_changed after update on public.note_sources for each row execute function private.invalidate_note_relations();
create trigger related_consent_changed after insert or update of enabled on public.context_preferences for each row execute function private.invalidate_note_relations();

create function public.claim_related_notes(target_id uuid,caller_id uuid,retry boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare revision bigint; used integer; r public.related_note_runs;
begin
 perform pg_advisory_xact_lock(hashtextextended(caller_id::text,1415));
 if not exists(select 1 from public.notes where id=target_id and user_id=caller_id) then raise exception 'NOT_FOUND'; end if;
 if not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then return jsonb_build_object('status','disabled'); end if;
 insert into private.related_library(user_id) values(caller_id) on conflict do nothing;
 select l.revision into revision from private.related_library l where user_id=caller_id;
 select * into r from public.related_note_runs where note_id=target_id and user_id=caller_id;
 if r.library_revision=revision then
  if r.status='completed' and r.completed_at>now()-interval '1 day' then return jsonb_build_object('status','completed'); end if;
  if r.status='processing' and r.started_at>now()-interval '2 minutes' then return jsonb_build_object('status','processing'); end if;
  if r.status='failed' and (not retry or r.started_at>now()-interval '30 seconds') then return jsonb_build_object('status','failed'); end if;
 end if;
 update private.related_library l set window_start=date_trunc('hour',now()),attempts=case when l.window_start=date_trunc('hour',now()) then l.attempts+1 else 1 end where user_id=caller_id returning attempts into used;
 if used>12 then raise exception 'RATE_LIMIT'; end if;
 insert into public.related_note_runs(note_id,user_id,status,library_revision) values(target_id,caller_id,'processing',revision)
 on conflict(note_id) do update set status='processing',token=gen_random_uuid(),library_revision=excluded.library_revision,started_at=now(),completed_at=null,model=null returning * into r;
 return jsonb_build_object('status','claimed','token',r.token,'revision',revision);
end $$;
revoke all on function public.claim_related_notes(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_related_notes(uuid,uuid,boolean) to service_role;

-- Bounded excerpts + explicit/user context, not a whole collection sent to AI.
create function public.related_note_input(target_id uuid,caller_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',n.id,'content',left(n.content,8000),'context',left(d.context_text,2000),
 'source',case when s.source_type is not null then jsonb_build_object('type',s.source_type,'name',s.name,'url',s.url,'description',s.description) else null end)
 from public.notes n join public.note_search_documents d on d.note_id=n.id and d.user_id=n.user_id
 left join public.note_sources s on s.note_id=n.id and s.user_id=n.user_id
 where n.id=target_id and n.user_id=caller_id
$$;
revoke all on function public.related_note_input(uuid,uuid) from public,anon,authenticated;
grant execute on function public.related_note_input(uuid,uuid) to service_role;

create function public.related_note_candidates(target_id uuid,caller_id uuid,terms text[]) returns jsonb
language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
declare q tsquery; result jsonb;
begin
 if cardinality(terms)>12 or exists(select 1 from unnest(terms) t where char_length(t)>80) then raise exception 'INVALID_TERMS'; end if;
 if not exists(select 1 from public.notes where id=target_id and user_id=caller_id) then raise exception 'NOT_FOUND'; end if;
 select string_agg('('||plainto_tsquery('pg_catalog.english',t)::text||')',' | ')::tsquery into q from unnest(terms) t where numnode(plainto_tsquery('pg_catalog.english',t))>0;
 with candidates as (
  select d.note_id,ts_rank(d.document,q,32) as relevance
  from public.note_search_documents d where d.user_id=caller_id and d.note_id<>target_id and d.document@@q
  order by relevance desc,d.note_id limit 16
 ) select coalesce(jsonb_agg((public.related_note_input(c.note_id,caller_id) || jsonb_build_object('content',left(n.content,3000),'context',left(d.context_text,1000))) order by c.relevance desc,c.note_id),'[]') into result from candidates c join public.notes n on n.id=c.note_id and n.user_id=caller_id join public.note_search_documents d on d.note_id=c.note_id and d.user_id=caller_id;
 return result;
end $$;
revoke all on function public.related_note_candidates(uuid,uuid,text[]) from public,anon,authenticated;
grant execute on function public.related_note_candidates(uuid,uuid,text[]) to service_role;

create function public.finish_related_notes(target_id uuid,caller_id uuid,claim_token uuid,expected_revision bigint,links jsonb,model_name text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare link jsonb; original text; other text;
begin
 perform pg_advisory_xact_lock(hashtextextended(caller_id::text,1415));
 if not exists(select 1 from private.related_library where user_id=caller_id and revision=expected_revision)
 or not exists(select 1 from public.related_note_runs where note_id=target_id and user_id=caller_id and token=claim_token and status='processing')
 or not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then return false; end if;
 if jsonb_typeof(links)<>'array' or jsonb_array_length(links)>3 then raise exception 'INVALID_LINKS'; end if;
 select n.content into original from public.notes n where n.id=target_id and n.user_id=caller_id;
 delete from public.note_relations where note_id=target_id and user_id=caller_id;
 for link in select * from jsonb_array_elements(links) loop
  select n.content into other from public.notes n where n.id=(link->>'id')::uuid and n.user_id=caller_id and n.id<>target_id;
  if other is null or strpos(btrim(regexp_replace(original,'[[:space:]]+',' ','g')),btrim(regexp_replace(link->>'origin_quote','[[:space:]]+',' ','g')))=0 or strpos(btrim(regexp_replace(other,'[[:space:]]+',' ','g')),btrim(regexp_replace(link->>'related_quote','[[:space:]]+',' ','g')))=0 then raise exception 'INVALID_EVIDENCE'; end if;
  insert into public.note_relations(note_id,related_id,user_id,explanation,origin_quote,related_quote,score)
  values(target_id,(link->>'id')::uuid,caller_id,link->>'explanation',link->>'origin_quote',link->>'related_quote',(link->>'score')::integer);
 end loop;
 update public.related_note_runs set status='completed',completed_at=now(),model=left(model_name,100) where note_id=target_id and token=claim_token;
 return true;
end $$;
revoke all on function public.finish_related_notes(uuid,uuid,uuid,bigint,jsonb,text) from public,anon,authenticated;
grant execute on function public.finish_related_notes(uuid,uuid,uuid,bigint,jsonb,text) to service_role;

create function public.read_related_notes(target_id uuid) returns table(id uuid,title text,explanation text,created_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select n.id,left(split_part(n.content,E'\n',1),100),r.explanation,n.created_at from public.note_relations r
 join public.notes n on n.id=r.related_id and n.user_id=r.user_id
 where r.note_id=target_id and r.user_id=(select auth.uid())
 order by r.score desc,n.id limit 3
$$;
revoke all on function public.read_related_notes(uuid) from public,anon;
grant execute on function public.read_related_notes(uuid) to authenticated;

create or replace function private.refresh_note_search(target_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare n public.notes; c public.note_contexts; heading text; added text; excerpts text;
 words tsvector; literals tsvector;
begin
 select * into n from public.notes where id=target_id;
 if not found then return; end if;
 if auth.uid() is not null and auth.uid()<>n.user_id then raise exception 'Search owner mismatch'; end if;
 select * into c from public.note_contexts where note_id=n.id and user_id=n.user_id;
 heading=left(split_part(btrim(n.content,E' \t\r\n'),E'\n',1),160);
 added=concat_ws(E'\n',nullif(c.user_context,''),nullif(c.answer,''));
 -- Index values, never JSON keys, prompt text or unsupported emotional interpretations.
 -- Completed excerpts must still belong to the current original content.
 if c.status='completed' and c.source_hash=private.note_context_hash(n.content) then
   select string_agg(distinct item->>'quote',E'\n') into excerpts
   from jsonb_each(coalesce(c.generated_context,'{}')) field
   cross join lateral jsonb_array_elements(case
     when field.key='situation' and jsonb_typeof(field.value)='object' then jsonb_build_array(field.value)
     when field.key in ('topics','details','intentions','concerns','open_questions') and jsonb_typeof(field.value)='array' then field.value
     else '[]'::jsonb end) item
   where item->>'certainty'='explicit' and length(item->>'quote') between 1 and 400
     and strpos(regexp_replace(n.content,'[[:space:]]+',' ','g'),regexp_replace(item->>'quote','[[:space:]]+',' ','g'))>0;
 end if;
 added=concat_ws(E'\n',nullif(added,''),excerpts,(select concat_ws(E'\n',nullif(s.name,''),nullif(s.url,''),nullif(s.description,'')) from public.note_sources s where s.note_id=n.id and s.user_id=n.user_id));
 words=setweight(to_tsvector('pg_catalog.english',heading),'A') || setweight(to_tsvector('pg_catalog.english',n.content),'B');
 literals=setweight(to_tsvector('pg_catalog.simple',heading),'A') || setweight(to_tsvector('pg_catalog.simple',n.content),'B');
 insert into public.note_search_documents(note_id,user_id,title,context_text,content_vector,document,literal_document)
 values(n.id,n.user_id,heading,added,words,words || setweight(to_tsvector('pg_catalog.english',added),'C'),literals || setweight(to_tsvector('pg_catalog.simple',added),'C'))
 on conflict(note_id) do update set user_id=excluded.user_id,title=excluded.title,context_text=excluded.context_text,
 content_vector=excluded.content_vector,document=excluded.document,literal_document=excluded.literal_document;
end $$;

create trigger source_search after update on public.note_sources for each row execute function private.sync_note_search();
select private.refresh_note_search(id) from public.notes;

-- Exact phrases stay inside one original or user-provided source.
-- Unquoted keywords may still combine content and contextual information.
create or replace function public.search_notes(search_text text, page_limit integer default 21, page_offset integer default 0)
returns table(id uuid,title text,preview text,matched_context boolean,capture_method text,created_at timestamptz,updated_at timestamptz,rank real)
language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
declare clean text; quoted boolean; query tsquery; phrase tsquery; lexemes text[];
 last_word text; last_lexeme text; literal_only boolean=false; owner_id uuid=(select auth.uid());
begin
 if owner_id is null then raise insufficient_privilege using message='Sign in to search your notes.'; end if;
 if page_limit is null or page_limit not between 1 and 31 or page_offset is null or page_offset not between 0 and 1000 then
   raise invalid_parameter_value using message='Choose a valid search page.';
 end if;
 if char_length(coalesce(search_text,''))>200 then raise invalid_parameter_value using message='Keep searches under 200 characters.'; end if;
 clean=btrim(regexp_replace(coalesce(search_text,''),'[[:space:]]+',' ','g'));
 quoted=left(clean,1)='"' and right(clean,1)='"' and char_length(clean)>=2;
 clean=btrim(replace(clean,'"',' '));
 if clean='' then return; end if;
 phrase=phraseto_tsquery('pg_catalog.simple',clean);
 if numnode(phrase)=0 then return; end if;
 lexemes=tsvector_to_array(to_tsvector('pg_catalog.english',clean));
 literal_only=quoted or cardinality(lexemes)=0;
 if literal_only then query=case when quoted then phrase else plainto_tsquery('pg_catalog.simple',clean) end;
 else
   -- Prefix only the last word (three or more characters). Raw user input is never tsquery syntax.
   last_word=(regexp_match(clean,'([[:alnum:]]+)$'))[1];
   last_lexeme=(tsvector_to_array(to_tsvector('pg_catalog.english',coalesce(last_word,''))))[1];
   select string_agg(quote_literal(word) || case when word=last_lexeme and length(last_word)>=3 then ':*' else '' end,' & ')
     into clean from unnest(lexemes) word;
   query=clean::tsquery;
 end if;
 return query
 with matches as materialized (
   select n.id,d.title,n.content,d.context_text,n.capture_method,n.created_at,n.updated_at,
     case when literal_only then to_tsvector('pg_catalog.simple',n.content) @@ query else d.content_vector @@ query end as direct,
     to_tsvector('pg_catalog.simple',n.content) @@ phrase as in_phrase,
     ts_rank_cd(case when literal_only then d.literal_document else d.document end,query,32) as relevance
   from public.note_search_documents d join public.notes n on n.id=d.note_id and n.user_id=d.user_id
   left join public.note_contexts c on quoted and c.note_id=n.id and c.user_id=n.user_id
   left join public.note_sources s on quoted and s.note_id=n.id and s.user_id=n.user_id
   where d.user_id=owner_id and n.user_id=owner_id
     and ((not literal_only and d.document @@ query) or (literal_only and d.literal_document @@ query))
     and (not quoted or to_tsvector('pg_catalog.simple',n.content) @@ phrase or to_tsvector('pg_catalog.simple',coalesce(c.user_context,'')) @@ phrase or to_tsvector('pg_catalog.simple',coalesce(c.answer,'')) @@ phrase or to_tsvector('pg_catalog.simple',coalesce(s.name,'')) @@ phrase or to_tsvector('pg_catalog.simple',coalesce(s.url,'')) @@ phrase or to_tsvector('pg_catalog.simple',coalesce(s.description,'')) @@ phrase)
 ), page as (
   select m.* from matches m order by m.direct desc,m.in_phrase desc,m.relevance desc,m.updated_at desc,m.id desc limit page_limit offset page_offset
 )
 select p.id,p.title,left(ts_headline(case when literal_only then 'pg_catalog.simple'::regconfig else 'pg_catalog.english'::regconfig end,
     case when p.direct then p.content else p.context_text end,query,
     'StartSel="",StopSel="",MaxFragments=1,MaxWords=45,MinWords=15,ShortWord=1,FragmentDelimiter=" … "'),500),
   not p.direct,p.capture_method,p.created_at,p.updated_at,p.relevance from page p
 order by p.direct desc,p.in_phrase desc,p.relevance desc,p.updated_at desc,p.id desc;
end $$;
