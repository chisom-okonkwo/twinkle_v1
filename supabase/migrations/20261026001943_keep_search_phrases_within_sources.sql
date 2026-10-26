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
   where d.user_id=owner_id and n.user_id=owner_id
     and ((not literal_only and d.document @@ query) or (literal_only and d.literal_document @@ query))
     and (not quoted or to_tsvector('pg_catalog.simple',n.content) @@ phrase or to_tsvector('pg_catalog.simple',coalesce(c.user_context,'')) @@ phrase or to_tsvector('pg_catalog.simple',coalesce(c.answer,'')) @@ phrase)
 ), page as (
   select m.* from matches m order by m.direct desc,m.in_phrase desc,m.relevance desc,m.updated_at desc,m.id desc limit page_limit offset page_offset
 )
 select p.id,p.title,left(ts_headline(case when literal_only then 'pg_catalog.simple'::regconfig else 'pg_catalog.english'::regconfig end,
     case when p.direct then p.content else p.context_text end,query,
     'StartSel="",StopSel="",MaxFragments=1,MaxWords=45,MinWords=15,ShortWord=1,FragmentDelimiter=" … "'),500),
   not p.direct,p.capture_method,p.created_at,p.updated_at,p.relevance from page p
 order by p.direct desc,p.in_phrase desc,p.relevance desc,p.updated_at desc,p.id desc;
end $$;
