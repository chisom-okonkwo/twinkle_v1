-- Provenance stays with ordinary notes. Clients cannot forge or overwrite it.
alter table public.notes add column import_metadata jsonb;
alter table public.notes add constraint notes_import_metadata_object check (import_metadata is null or (jsonb_typeof(import_metadata)='object' and octet_length(import_metadata::text)<8192));
create index notes_exact_content on public.notes(user_id,(encode(extensions.digest(content,'sha256'),'hex')));
create unique index notes_import_original on public.notes(user_id,(import_metadata->>'original_hash')) where import_metadata is not null;

-- Private implementation: fixed search path, no caller-supplied owner, bounded input.
-- The public invoker wrapper exposes only this operation, never arbitrary writes.
create function private.import_text_note(file_name text, body text, metadata jsonb) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='8s' set timezone='UTC' as $$
declare owner_id uuid=auth.uid(); original_hash text; existing_id uuid; new_id uuid;
 imported_at timestamptz=clock_timestamp(); original_date timestamptz; heading text; source_kind text;
begin
 if owner_id is null then raise insufficient_privilege using message='Sign in to import notes.'; end if;
 if file_name is null or char_length(file_name) not between 5 and 255 or file_name !~* '\.(txt|md)$' or file_name ~ '[[:cntrl:]/\\]' then raise invalid_parameter_value using message='Choose a supported file name.'; end if;
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
end $$;
revoke all on function private.import_text_note(text,text,jsonb) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.import_text_note(text,text,jsonb) to authenticated;
create function public.import_text_note(file_name text, body text, metadata jsonb default '{}') returns jsonb
language sql security invoker set search_path='' set statement_timeout='10s' as $$
 select private.import_text_note(file_name,body,metadata)
$$;
revoke all on function public.import_text_note(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.import_text_note(text,text,jsonb) to authenticated;

create or replace function private.refresh_note_search(target_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare n public.notes; c public.note_contexts; heading text; added text; excerpts text;
 words tsvector; literals tsvector;
begin
 select * into n from public.notes where id=target_id;
 if not found then return; end if;
 if auth.uid() is not null and auth.uid()<>n.user_id then raise exception 'Search owner mismatch'; end if;
 select * into c from public.note_contexts where note_id=n.id and user_id=n.user_id;
 heading=coalesce(nullif(n.import_metadata->>'title',''),left(split_part(btrim(n.content,E' \t\r\n'),E'\n',1),160));
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
revoke all on function private.refresh_note_search(uuid) from public,anon,authenticated;
