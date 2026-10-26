create index note_attachments_capture_owner on public.note_attachments(capture_id,user_id);
-- UI-only fallback titles for media-only notes; original content stays empty.
CREATE OR REPLACE FUNCTION private.refresh_note_search(target_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n public.notes; c public.note_contexts; heading text; added text; excerpts text;
 words tsvector; literals tsvector;
begin
 select * into n from public.notes where id=target_id;
 if not found then return; end if;
 if auth.uid() is not null and auth.uid()<>n.user_id then raise exception 'Search owner mismatch'; end if;
 select * into c from public.note_contexts where note_id=n.id and user_id=n.user_id;
 heading=coalesce(nullif(n.import_metadata->>'title',''),nullif(left(split_part(btrim(n.content,E' \t\r\n'),E'\n',1),160),''),case when n.capture_method='image' then 'Photo note' when n.capture_method='audio' then 'Audio note' else 'Note with attachments' end);
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
end $function$
;
