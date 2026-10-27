-- A note's editable heading is separate from its unchanged original body.
alter table public.notes add column title text not null default '';
alter table public.notes add constraint notes_title_check check(char_length(title)<=300 and title !~ '[[:cntrl:]]');
grant insert(title),update(title) on public.notes to authenticated;

-- Preserve import provenance and note chronology during the one-time backfill.
alter table public.notes disable trigger notes_updated_at;
update public.notes set title=btrim(regexp_replace(coalesce(import_metadata->>'title',''),'[[:space:]]+',' ','g')) where import_metadata is not null;
set constraints all immediate;
alter table public.notes enable trigger notes_updated_at;
set constraints all deferred;

-- Older import clients still supply their validated heading in import metadata.
-- This runs only on INSERT; clearing a saved title never resurrects provenance.
create function private.prepare_note_title() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' and new.title='' and new.import_metadata is not null then new.title=coalesce(new.import_metadata->>'title',''); end if;
 if new.title is null then raise invalid_parameter_value using message='Use an empty title to leave it blank.'; end if;
 new.title=btrim(regexp_replace(new.title,'[[:space:]]+',' ','g'));
 if char_length(new.title)>300 or new.title ~ '[[:cntrl:]]' then raise invalid_parameter_value using message='Keep the title to 300 characters on one line.'; end if;
 return new;
end $$;
revoke all on function private.prepare_note_title() from public,anon,authenticated;
create trigger notes_prepare_title before insert or update of title on public.notes for each row execute function private.prepare_note_title();

-- Replace the earlier signature; existing callers may omit the new optional argument.
drop function public.save_note_with_attachments(uuid,text,timestamptz,uuid[],uuid);
drop function private.save_note_with_attachments(uuid,text,timestamptz,uuid[],uuid);
create or replace function private.save_note_with_attachments(target_id uuid,body text,expected_updated_at timestamptz default null,capture_ids uuid[] default '{}',initial_capture_id uuid default null,note_title text default null)
returns public.notes language plpgsql security definer set search_path='' as $$
declare owner_id uuid=auth.uid(); n public.notes; selected_ids uuid[]; current_ids uuid[]; c public.note_captures; initial_kind text; heading text=case when note_title is null then null else btrim(regexp_replace(note_title,'[[:space:]]+',' ','g')) end;
begin
 if owner_id is null then raise insufficient_privilege using message='Sign in to save your note.'; end if;
 if target_id is null or body is null or (btrim(body,E' \t\r\n')='' and cardinality(capture_ids)=0) or char_length(body)>100000 or capture_ids is null or cardinality(capture_ids)>10 or array_position(capture_ids,null) is not null then raise invalid_parameter_value using message='Add text or an attachment, with up to 10 photos or recordings.'; end if;
 select coalesce(array_agg(distinct x order by x),'{}') into selected_ids from unnest(capture_ids) x;
 if cardinality(selected_ids)<>cardinality(capture_ids) then raise invalid_parameter_value using message='A source can be attached only once.'; end if;
 select * into n from public.notes where id=target_id and user_id=owner_id for update;
 if found then
  select coalesce(array_agg(a.capture_id order by a.capture_id),'{}') into current_ids from public.note_attachments a where a.note_id=n.id and a.user_id=owner_id;
  if n.content=body and selected_ids=current_ids and (heading is null or n.title=heading) then return n; end if;
  if expected_updated_at is null or n.updated_at<>expected_updated_at then raise exception 'NOTE_CONFLICT'; end if;
  -- Take normal update/derived-data locks before locking any new captures.
  update public.notes set content=body,title=coalesce(heading,title),has_attachments=cardinality(selected_ids)>0,
   source_capture_id=case when source_capture_id=any(selected_ids) then source_capture_id else null end,
   capture_method=case when source_capture_id is not null and not(source_capture_id=any(selected_ids)) then 'text' else capture_method end
   where id=n.id and user_id=owner_id returning * into n;
 else
  if expected_updated_at is not null or exists(select 1 from public.notes where id=target_id) then raise exception 'NOTE_CONFLICT'; end if;
  if initial_capture_id is not null then
   if not(initial_capture_id=any(selected_ids)) then raise invalid_parameter_value using message='The original source must belong to this note.'; end if;
   select kind into initial_kind from public.note_captures where id=initial_capture_id and user_id=owner_id;
   if initial_kind is null then raise insufficient_privilege using message='Source unavailable.'; end if;
  end if;
  insert into public.notes(id,user_id,content,title,has_attachments,capture_method,source_capture_id)
   values(target_id,owner_id,body,coalesce(heading,''),cardinality(selected_ids)>0,coalesce(initial_kind,'text'),initial_capture_id) returning * into n;
 end if;
 -- Locks and the unique capture key prevent concurrent reuse in another note.
 for c in select * from public.note_captures where id=any(selected_ids) order by id for update loop
  if c.user_id is distinct from owner_id then raise insufficient_privilege using message='Source unavailable.'; end if;
  if exists(select 1 from public.note_attachments a where a.capture_id=c.id and a.note_id=n.id and a.user_id=owner_id) then
   if c.status<>'saved' then raise exception 'Source unavailable.'; end if;
  elsif not(c.status='ready' or (c.status in ('pending','failed') and c.verified_at is not null)) or c.expires_at<now() or not exists(select 1 from storage.objects where bucket_id='note-media' and name=c.storage_path) then raise exception 'Process and review this source before attaching it.';
  end if;
 end loop;
 if (select count(*) from public.note_captures where id=any(selected_ids) and user_id=owner_id)<>cardinality(selected_ids) then raise insufficient_privilege using message='Source unavailable.'; end if;
 delete from public.note_attachments where note_id=n.id and user_id=owner_id and not(capture_id=any(selected_ids));
 insert into public.note_attachments(note_id,capture_id,user_id)
  select n.id,x,owner_id from unnest(selected_ids) x on conflict(capture_id) do nothing;
 if (select count(*) from public.note_attachments where note_id=n.id and user_id=owner_id)<>cardinality(selected_ids) then raise exception 'This source is already attached to a different note.'; end if;
 update public.note_captures set status='saved',result=null where id=any(selected_ids) and user_id=owner_id;
 return n;
end $$;

create or replace function public.save_note_with_attachments(target_id uuid,body text,expected_updated_at timestamptz default null,capture_ids uuid[] default '{}',initial_capture_id uuid default null,note_title text default null)
returns setof public.notes language sql security invoker set search_path='' as $$
 select * from private.save_note_with_attachments(target_id,body,expected_updated_at,capture_ids,initial_capture_id,note_title)
$$;


revoke all on function private.save_note_with_attachments(uuid,text,timestamptz,uuid[],uuid,text) from public,anon,authenticated;
grant execute on function private.save_note_with_attachments(uuid,text,timestamptz,uuid[],uuid,text) to authenticated;
revoke all on function public.save_note_with_attachments(uuid,text,timestamptz,uuid[],uuid,text) from public,anon,authenticated;
grant execute on function public.save_note_with_attachments(uuid,text,timestamptz,uuid[],uuid,text) to authenticated;


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
 heading=coalesce(nullif(n.title,''),nullif(left(split_part(btrim(n.content,E' \t\r\n'),E'\n',1),160),''),case when n.capture_method='image' then 'Photo note' when n.capture_method='audio' then 'Audio note' else 'Note with attachments' end);
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

drop trigger zz_notes_search on public.notes;
create trigger zz_notes_search after insert or update of content,title,user_id on public.notes for each row execute function private.sync_note_search();
select private.refresh_note_search(id) from public.notes;
-- Present the current editable title wherever a saved note is linked.
CREATE OR REPLACE FUNCTION public.read_related_notes(target_id uuid)
 RETURNS TABLE(id uuid, title text, explanation text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select n.id,left(coalesce(nullif(n.title,''),split_part(n.content,E'\n',1)),100),r.explanation,n.created_at from public.note_relations r
 join public.notes n on n.id=r.related_id and n.user_id=r.user_id
 where r.note_id=target_id and r.user_id=(select auth.uid()) and not exists(
 select 1 from public.related_note_dismissals d where d.note_a=least(r.note_id,r.related_id) and d.note_b=greatest(r.note_id,r.related_id))
 order by r.score desc,n.id limit 3
$function$
;
CREATE OR REPLACE FUNCTION public.discovery_card(discovery_request uuid, caller_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object('request_id',h.request_id,'note_id',n.id,'title',left(coalesce(nullif(n.title,''),split_part(btrim(n.content),E'\n',1)),160),
 'preview',left(n.content,600),'created_at',n.created_at,'capture_method',n.capture_method,'mode',h.mode)
 from public.note_discovery_history h join public.notes n on n.id=h.note_id and n.user_id=h.user_id
 where h.request_id=discovery_request and h.user_id=caller_id and n.updated_at=h.note_updated_at and not h.dismissed and public.rediscovery_eligible(n.id,caller_id)
$function$
;
-- Themes are optional on checkouts that have not introduced FR-19/20 yet.
do $compat$ begin
 if to_regprocedure('private.visible_theme_members(uuid,text)') is not null then
 execute $theme_definition$CREATE OR REPLACE FUNCTION private.visible_theme_members(owner_id uuid, period text)
 RETURNS TABLE(theme_id uuid, note_id uuid, quote text, created_at timestamp with time zone, title text, preview text, capture_method text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select m.theme_id,n.id,m.quote,n.created_at,coalesce(nullif(n.title,''),left(split_part(btrim(n.content),E'\n',1),160)),left(n.content,600),n.capture_method
 from public.note_theme_members m join public.note_themes t on t.id=m.theme_id and t.user_id=m.user_id
 join public.notes n on n.id=m.note_id and n.user_id=m.user_id
 where m.user_id=owner_id and not t.dismissed and m.content_hash=private.note_context_hash(n.content)
 and exists(select 1 from public.context_preferences where user_id=owner_id and enabled)
 and private.theme_eligible(n.id,owner_id) and (period='all' or n.created_at>=now()-interval '90 days')
 and not exists(select 1 from public.related_note_dismissals d
 join public.note_theme_members a on a.theme_id=m.theme_id and a.note_id=d.note_a and a.user_id=owner_id
 join public.note_theme_members b on b.theme_id=m.theme_id and b.note_id=d.note_b and b.user_id=owner_id where d.user_id=owner_id)
$function$
$theme_definition$;
 end if;
end $compat$;
notify pgrst,'reload schema';
