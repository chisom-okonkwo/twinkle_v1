-- A derived index keeps search data out of ordinary notes/select(*) responses.
create table public.note_search_documents (
 note_id uuid primary key references public.notes(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 title text not null,
 context_text text not null,
 content_vector tsvector not null,
 document tsvector not null,
 literal_document tsvector not null
);
create index note_search_owner on public.note_search_documents(user_id);
create index note_search_words on public.note_search_documents using gin(document);
create index note_search_phrases on public.note_search_documents using gin(literal_document);
alter table public.note_search_documents enable row level security;
revoke all on public.note_search_documents from public,anon,authenticated;
grant select on public.note_search_documents to authenticated;
grant all on public.note_search_documents to service_role;
create policy search_owner_read on public.note_search_documents for select to authenticated
 using ((select auth.uid())=user_id and exists(select 1 from public.notes n where n.id=note_id and n.user_id=(select auth.uid())));

-- Only an already-authorized note/context trigger may refresh the derived index.
create function private.refresh_note_search(target_id uuid) returns void
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
 added=concat_ws(E'\n',nullif(added,''),excerpts);
 words=setweight(to_tsvector('pg_catalog.english',heading),'A') || setweight(to_tsvector('pg_catalog.english',n.content),'B');
 literals=setweight(to_tsvector('pg_catalog.simple',heading),'A') || setweight(to_tsvector('pg_catalog.simple',n.content),'B');
 insert into public.note_search_documents(note_id,user_id,title,context_text,content_vector,document,literal_document)
 values(n.id,n.user_id,heading,added,words,words || setweight(to_tsvector('pg_catalog.english',added),'C'),literals || setweight(to_tsvector('pg_catalog.simple',added),'C'))
 on conflict(note_id) do update set user_id=excluded.user_id,title=excluded.title,context_text=excluded.context_text,
 content_vector=excluded.content_vector,document=excluded.document,literal_document=excluded.literal_document;
end $$;
revoke all on function private.refresh_note_search(uuid) from public,anon,authenticated;

create function private.sync_note_search() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='notes' then perform private.refresh_note_search(new.id);
 elsif tg_op='DELETE' then perform private.refresh_note_search(old.note_id);
 else perform private.refresh_note_search(new.note_id);
 end if;
 return null;
end $$;
revoke all on function private.sync_note_search() from public,anon,authenticated;
create trigger zz_notes_search after insert or update of content,user_id on public.notes
 for each row execute function private.sync_note_search();
create trigger context_search after insert or update of source_hash,status,generated_context,user_context,answer or delete on public.note_contexts
 for each row execute function private.sync_note_search();

-- Backfill derived data only: no original-note writes, timestamps, or AI calls.
select private.refresh_note_search(id) from public.notes;

create function public.search_notes(search_text text, page_limit integer default 21, page_offset integer default 0)
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
   where d.user_id=owner_id and n.user_id=owner_id
     and ((not literal_only and d.document @@ query) or (literal_only and d.literal_document @@ query))
     and (not quoted or to_tsvector('pg_catalog.simple',n.content) @@ phrase or to_tsvector('pg_catalog.simple',d.context_text) @@ phrase)
 ), page as (
   select m.* from matches m order by m.direct desc,m.in_phrase desc,m.relevance desc,m.updated_at desc,m.id desc limit page_limit offset page_offset
 )
 select p.id,p.title,left(ts_headline(case when literal_only then 'pg_catalog.simple'::regconfig else 'pg_catalog.english'::regconfig end,
     case when p.direct then p.content else p.context_text end,query,
     'StartSel="",StopSel="",MaxFragments=1,MaxWords=45,MinWords=15,ShortWord=1,FragmentDelimiter=" … "'),500),
   not p.direct,p.capture_method,p.created_at,p.updated_at,p.relevance from page p
 order by p.direct desc,p.in_phrase desc,p.relevance desc,p.updated_at desc,p.id desc;
end $$;
revoke all on function public.search_notes(text,integer,integer) from public,anon;
grant execute on function public.search_notes(text,integer,integer) to authenticated;
