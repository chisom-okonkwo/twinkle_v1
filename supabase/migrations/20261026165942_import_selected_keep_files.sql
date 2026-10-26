-- Extend the existing owner-scoped text import, preserving its atomic dedupe,
-- deferred AI processing, search triggers and unchanged invoker API.
create or replace function private.import_text_note(file_name text, body text, metadata jsonb) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='8s' set timezone='UTC' as $$
declare owner_id uuid=auth.uid(); original_hash text; existing_id uuid; new_id uuid;
 imported_at timestamptz=clock_timestamp(); original_date timestamptz; original_modified timestamptz; heading text; source_kind text;
begin
 if owner_id is null then raise insufficient_privilege using message='Sign in to import notes.'; end if;
 if file_name is null or char_length(file_name) not between 4 and 255 or file_name !~* '^.+\.(txt|md|json|html)$' or file_name ~ '[[:cntrl:]/\\]' then raise invalid_parameter_value using message='Choose a supported file name.'; end if;
 if body is null or btrim(body,E' \t\r\n')='' or char_length(body)>100000 or octet_length(body)>262144 or body ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' then raise invalid_parameter_value using message='Choose non-empty UTF-8 text under 256 KB and 100,000 characters.'; end if;
 if metadata is null or jsonb_typeof(metadata)<>'object' or octet_length(metadata::text)>7000 or exists(select 1 from jsonb_each(metadata) e where e.key not in ('title','created_at','source_type','source_name','source_url','source_context','provider','original_updated_at') or jsonb_typeof(e.value)<>'string') then raise invalid_parameter_value using message='Invalid import metadata.'; end if;
 if char_length(coalesce(metadata->>'title',''))>300 or char_length(coalesce(metadata->>'source_name',''))>300 or char_length(coalesce(metadata->>'source_url',''))>2000 or char_length(coalesce(metadata->>'source_context',''))>2000 then raise invalid_parameter_value using message='Import metadata is too long.'; end if;
 if metadata ? 'created_at' then
  if metadata->>'created_at' !~ '^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2}))?$' then raise invalid_parameter_value using message='Use an explicit ISO creation date.'; end if;
  original_date=(metadata->>'created_at')::timestamptz;
  if original_date>imported_at or original_date<'0001-01-01T00:00:00Z'::timestamptz then raise invalid_parameter_value using message='Invalid original creation date.'; end if;
 end if;
 if metadata ? 'provider' and metadata->>'provider'<>'google_keep' then raise invalid_parameter_value using message='Invalid import provider.'; end if;
 if file_name ~* '\.(json|html)$' and coalesce(metadata->>'provider','')<>'google_keep' then raise invalid_parameter_value using message='Use a parsed Google Keep note.'; end if;
 if metadata ? 'original_updated_at' then
  if coalesce(metadata->>'provider','')<>'google_keep' or metadata->>'original_updated_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$' then raise invalid_parameter_value using message='Use an explicit original modification timestamp.'; end if;
  original_modified=(metadata->>'original_updated_at')::timestamptz;
  if original_modified>imported_at or original_modified<'0001-01-01T00:00:00Z'::timestamptz or original_modified<original_date then raise invalid_parameter_value using message='Invalid original modification date.'; end if;
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
 heading=coalesce(nullif(btrim(metadata->>'title'),''),regexp_replace(file_name,'\.(txt|md|json|html)$','','i'));
 insert into public.notes(user_id,content,capture_method,created_at,updated_at,import_metadata)
 values(owner_id,body,'text',coalesce(original_date,imported_at),imported_at,
 jsonb_build_object('filename',file_name,'title',heading,'imported_at',imported_at,'original_created_at',metadata->>'created_at','date_basis',case when original_date is null then 'import' else 'file' end,'original_hash',original_hash,'provider',metadata->>'provider','original_updated_at',metadata->>'original_updated_at')) returning id into new_id;
 -- New rows only, within the same transaction: nothing enters the background
 -- enrichment backlog. Existing manual Analyze context remains available.
 update public.note_contexts set status='disabled' where note_id=new_id and user_id=owner_id;
 if source_kind is not null then
  update public.note_sources set source_type=source_kind,name=coalesce(metadata->>'source_name',''),url=coalesce(metadata->>'source_url',''),description=coalesce(metadata->>'source_context','') where note_id=new_id and user_id=owner_id;
 end if;
 return jsonb_build_object('status','imported','id',new_id);
end $$;
revoke all on function private.import_text_note(text,text,jsonb) from public,anon;
grant execute on function private.import_text_note(text,text,jsonb) to authenticated;
