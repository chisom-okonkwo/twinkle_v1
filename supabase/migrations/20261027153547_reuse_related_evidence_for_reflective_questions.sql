-- Use the existing bounded relationships to avoid asking questions answered by newer notes.
create or replace function private.reflection_input(owner_id uuid,kind text,target uuid) returns jsonb language plpgsql stable set search_path='' set statement_timeout='5s' as $$
declare result jsonb;
begin
 if kind not in ('note','theme','prompt') then raise exception 'INVALID_SCOPE';end if;
 if not exists(select 1 from public.context_preferences where user_id=owner_id and enabled) then return null;end if;
 if kind='theme' then
  if not exists(select 1 from public.note_themes where id=target and user_id=owner_id and not dismissed) then return null;end if;
 else
  if private.reflection_note(target,owner_id) is null then return null;end if;
 end if;
 with candidates as materialized (
  select target id,100.0 weight where kind in ('note','prompt')
  union all
  select m.note_id,90.0 from public.note_theme_members m join public.note_themes t on t.id=m.theme_id and t.user_id=m.user_id
  join private.note_embeddings e on e.note_id=m.note_id and e.user_id=m.user_id and e.model='text-embedding-3-small' and e.input_version=1 and e.status='ready' and e.input_hash=m.input_hash
  where kind='theme' and m.user_id=owner_id and m.theme_id=target and not t.dismissed
  union all
  select case when r.note_id=target then r.related_id else r.note_id end,r.score::numeric
  from public.note_relations r where kind in ('note','prompt') and r.user_id=owner_id and (r.note_id=target or r.related_id=target)
  union all
  select case when r.original_note_id=target then r.response_note_id else r.original_note_id end,100.0
  from public.note_reflections r where kind in ('note','prompt') and r.user_id=owner_id and (r.original_note_id=target or r.response_note_id=target)
  union all
  select case when r.note_a=target then r.note_b else r.note_a end,70+r.similarity*10
  from private.semantic_relations r
  join private.note_embeddings a on a.note_id=r.note_a and a.user_id=r.user_id and a.model=r.model and a.input_version=r.input_version and a.input_hash=r.hash_a and a.status='ready'
  join private.note_embeddings b on b.note_id=r.note_b and b.user_id=r.user_id and b.model=r.model and b.input_version=r.input_version and b.input_hash=r.hash_b and b.status='ready'
  where kind in ('note','prompt') and r.user_id=owner_id and (r.note_a=target or r.note_b=target) and r.similarity>=0.42
  union all
  select b.note_id,80.0 from public.note_theme_members a join public.note_theme_members b on b.theme_id=a.theme_id and b.user_id=a.user_id
  join public.note_themes t on t.id=a.theme_id and t.user_id=a.user_id and not t.dismissed
  join private.note_embeddings ea on ea.note_id=a.note_id and ea.user_id=a.user_id and ea.model='text-embedding-3-small' and ea.input_version=1 and ea.status='ready' and ea.input_hash=a.input_hash
  join private.note_embeddings eb on eb.note_id=b.note_id and eb.user_id=b.user_id and eb.model='text-embedding-3-small' and eb.input_version=1 and eb.status='ready' and eb.input_hash=b.input_hash
  where kind in ('note','prompt') and a.note_id=target and a.user_id=owner_id
 ), bounded as materialized (
  select id,max(weight) weight from candidates group by id order by max(weight) desc,id limit 64
 ), dated as materialized (
  select b.id,b.weight,private.semantic_captured_at(n) captured from bounded b join public.notes n on n.id=b.id and n.user_id=owner_id
  where private.semantic_captured_at(n) is not null and private.semantic_captured_at(n)<=now()
  and private.reflection_allowed(n.id,owner_id)
 ), ranked as (
  select *,row_number() over(order by captured,id) early,row_number() over(order by captured desc,id) late from dated
 ), picked as materialized (
  select id from ranked order by (id=target) desc,least(early,late),weight desc,id limit 8
 ), documents as materialized (
  select private.reflection_note(id,owner_id) doc from picked
 ) select coalesce(jsonb_agg(doc order by doc->>'captured_at',doc->>'id') filter(where doc is not null),'[]') into result from documents;
 return result;
end $$;
