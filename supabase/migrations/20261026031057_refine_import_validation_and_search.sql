create or replace function private.import_text_note(file_name text, body text, metadata jsonb) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='8s' set timezone='UTC' as $$
declare owner_id uuid=auth.uid(); original_hash text; existing_id uuid; new_id uuid;
 imported_at timestamptz=clock_timestamp(); original_date timestamptz; heading text; source_kind text;
begin
 if owner_id is null then raise insufficient_privilege using message='Sign in to import notes.'; end if;
 if file_name is null or char_length(file_name) not between 4 and 255 or file_name !~* '^.+\.(txt|md)$' or file_name ~ '[[:cntrl:]/\\]' then raise invalid_parameter_value using message='Choose a supported file name.'; end if;
 if body is null or btrim(body,E' \t\r\n')='' or char_length(body)>100000 or octet_length(body)>262144 or body ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' then raise invalid_parameter_value using message='Choose non-empty UTF-8 text under 256 KB and 100,000 characters.'; end if;
 if metadata is null or jsonb_typeof(metadata)<>'object' or octet_length(metadata::text)>7000 or exists(select 1 from jsonb_each(metadata) e where e.key not in ('title','created_at','source_type','source_name','source_url','source_context') or jsonb_typeof(e.value)<>'string') then raise invalid_parameter_value using message='Invalid import metadata.'; end if;
 if char_length(coalesce(metadata->>'title',''))>300 or char_length(coalesce(metadata->>'source_name',''))>300 or char_length(coalesce(metadata->>'source_url',''))>2000 or char_length(coalesce(metadata->>'source_context',''))>2000 then raise invalid_parameter_value using message='Import metadata is too long.'; end if;
 if metadata ? 'created_at' then
  if metadata->>'created_at' !~ '^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2}))?$' then raise invalid_parameter_value using message='Use an explicit ISO creation date.'; end if;
  original_date=(metadata->>'created_at')::timestamptz;
  if original_date>imported_at or original_date<'0001-01-01T00:00:00Z'::timestamptz then raise invalid_parameter_value using message='Invalid original creation date.'; end if;
 end if;
 source_kind=metadata->>'source_type';
 if source_kind is not null and (source_kind not in ('book','article','conversation','project','other') or (coalesce(metadata->>'source_name','')='' and coalesce(metadata->>'source_url','')='')) then raise invalid_parameter_value using message='Invalid source attribution.'; end if;
 if coalesce(metadata->>'source_url','')<>'' and (metadata->>'source_url' !~* '^https?://[^/@[:space:]]+[^[:space:]]*$' or metadata->>'source_url' ~* '^https?://[^/]*@') then raise invalid_parameter_value using message='Use a safe web source URL.'; end if;
 -- Serialize imports by owner. A lost response, simultaneous retry, or renamed
 -- copy cannot create another imported note with the same original content.
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,1818));
 original_hash=encode(extensions.digest(body,'sha256'),'hex');
 select n.id into existing_id from public.notes n where n.user_id=owner_id and n.import_metadata->>'original_hash'=original_hash limit 1;
 if existing_id is null then
  select n.id into existing_id from public.notes n where n.user_id=owner_id and encode(extensions.digest(n.content,'sha256'),'hex')=original_hash and n.content=body limit 1;
 end if;
 if existing_id is not null then return jsonb_build_object('status','skipped','id',existing_id); end if;
 heading=coalesce(nullif(btrim(metadata->>'title'),''),regexp_replace(file_name,'\.(txt|md)$','','i'));
 insert into public.notes(user_id,content,capture_method,created_at,updated_at,import_metadata)
 values(owner_id,body,'text',coalesce(original_date,imported_at),imported_at,
 jsonb_build_object('filename',file_name,'title',heading,'imported_at',imported_at,'original_created_at',metadata->>'created_at','date_basis',case when original_date is null then 'import' else 'file' end,'original_hash',original_hash)) returning id into new_id;
 -- New rows only, within the same transaction: nothing enters the background
 -- enrichment backlog. Existing manual Analyze context remains available.
 update public.note_contexts set status='disabled' where note_id=new_id and user_id=owner_id;
 if source_kind is not null then
  update public.note_sources set source_type=source_kind,name=coalesce(metadata->>'source_name',''),url=coalesce(metadata->>'source_url',''),description=coalesce(metadata->>'source_context','') where note_id=new_id and user_id=owner_id;
 end if;
 return jsonb_build_object('status','imported','id',new_id);
end $$;;

-- Imported titles are searchable, including exact phrases within the title.
CREATE OR REPLACE FUNCTION public.search_notes(search_text text, page_limit integer DEFAULT 21, page_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, title text, preview text, matched_context boolean, capture_method text, created_at timestamp with time zone, updated_at timestamp with time zone, rank real)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET statement_timeout TO '5s'
AS $function$
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
     case when literal_only then (to_tsvector('pg_catalog.simple',n.content) @@ query or to_tsvector('pg_catalog.simple',d.title) @@ query) else d.content_vector @@ query end as direct,
     (to_tsvector('pg_catalog.simple',n.content) @@ phrase or to_tsvector('pg_catalog.simple',d.title) @@ phrase) as in_phrase,
     ts_rank_cd(case when literal_only then d.literal_document else d.document end,query,32) as relevance
   from public.note_search_documents d join public.notes n on n.id=d.note_id and n.user_id=d.user_id
   left join public.note_contexts c on quoted and c.note_id=n.id and c.user_id=n.user_id
   left join public.note_sources s on quoted and s.note_id=n.id and s.user_id=n.user_id
   where d.user_id=owner_id and n.user_id=owner_id
     and ((not literal_only and d.document @@ query) or (literal_only and d.literal_document @@ query))
     and (not quoted or (to_tsvector('pg_catalog.simple',n.content) @@ phrase or to_tsvector('pg_catalog.simple',d.title) @@ phrase) or to_tsvector('pg_catalog.simple',coalesce(c.user_context,'')) @@ phrase or to_tsvector('pg_catalog.simple',coalesce(c.answer,'')) @@ phrase or to_tsvector('pg_catalog.simple',coalesce(s.name,'')) @@ phrase or to_tsvector('pg_catalog.simple',coalesce(s.url,'')) @@ phrase or to_tsvector('pg_catalog.simple',coalesce(s.description,'')) @@ phrase)
 ), page as (
   select m.* from matches m order by m.direct desc,m.in_phrase desc,m.relevance desc,m.updated_at desc,m.id desc limit page_limit offset page_offset
 )
 select p.id,p.title,left(ts_headline(case when literal_only then 'pg_catalog.simple'::regconfig else 'pg_catalog.english'::regconfig end,
     case when p.direct then p.content else p.context_text end,query,
     'StartSel="",StopSel="",MaxFragments=1,MaxWords=45,MinWords=15,ShortWord=1,FragmentDelimiter=" … "'),500),
   not p.direct,p.capture_method,p.created_at,p.updated_at,p.relevance from page p
 order by p.direct desc,p.in_phrase desc,p.relevance desc,p.updated_at desc,p.id desc;
end $function$;
