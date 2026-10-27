-- Candidate similarities are private numerical evidence, never FR-15 scores.
create table private.semantic_relations (
 user_id uuid not null references auth.users(id) on delete cascade,note_a uuid not null,note_b uuid not null,
 hash_a text not null,hash_b text not null,model text not null default 'text-embedding-3-small',input_version integer not null default 1,
 similarity double precision not null check(similarity between -1 and 1),updated_at timestamptz not null default now(),
 primary key(user_id,note_a,note_b,model,input_version),check(note_a<note_b),
 foreign key(note_a,user_id) references public.notes(id,user_id) on delete cascade,
 foreign key(note_b,user_id) references public.notes(id,user_id) on delete cascade
);
create index semantic_relation_a_owner on private.semantic_relations(note_a,user_id);
create index semantic_relation_b_owner on private.semantic_relations(note_b,user_id);
alter table private.semantic_relations enable row level security;
revoke all on private.semantic_relations from public,anon,authenticated;
grant all on private.semantic_relations to service_role;
alter table private.note_embeddings add column relations_current boolean not null default false;
create function private.semantic_embedding_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin if (new.input_hash,new.status,new.embedding) is distinct from (old.input_hash,old.status,old.embedding) then new.relations_current=false;end if;return new;end $$;
create trigger semantic_embedding_changed before update of input_hash,status,embedding on private.note_embeddings for each row execute function private.semantic_embedding_changed();
create or replace function private.clear_semantic_derived(target_id uuid,owner_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 delete from private.semantic_relations where user_id=owner_id and (note_a=target_id or note_b=target_id);
 delete from public.note_theme_members where note_id=target_id and user_id=owner_id;
end $$;
create function private.semantic_captured_at(note public.notes) returns timestamptz language sql immutable security invoker set search_path='' as $$
 select case when note.import_metadata is null or note.import_metadata->>'date_basis'='file' then note.created_at else null end
$$;
create function public.semantic_neighbours(target_id uuid,caller_id uuid,max_count integer default 12,range_start timestamptz default null,range_end timestamptz default null)
returns jsonb language plpgsql stable security invoker set search_path='' set statement_timeout='8s' as $$
declare result jsonb;
begin
 if max_count not between 1 and 24 or (range_start is null)<>(range_end is null) or range_start>=range_end then raise exception 'INVALID_RANGE';end if;
 if not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then return '[]'::jsonb;end if;
 with origin as materialized(select e.* from private.note_embeddings e where e.note_id=target_id and e.user_id=caller_id and e.status='ready' and e.model='text-embedding-3-small' and e.input_version=1 and private.semantic_eligible(e.note_id,caller_id)),
 owned as materialized(select e.* from private.note_embeddings e join public.notes n on n.id=e.note_id and n.user_id=e.user_id
 where e.user_id=caller_id and e.status='ready' and e.model='text-embedding-3-small' and e.input_version=1 and e.note_id<>target_id
 and private.semantic_eligible(e.note_id,caller_id)
 and (range_start is null or private.semantic_captured_at(n)>=range_start and private.semantic_captured_at(n)<range_end)
 and not exists(select 1 from public.related_note_dismissals d where d.user_id=caller_id and d.note_a=least(target_id,e.note_id) and d.note_b=greatest(target_id,e.note_id))),
 selected as(select o.note_id,o.input_hash,greatest(-1,least(1,1-(o.embedding operator(extensions.<=>) a.embedding))) as similarity
 from origin a cross join owned o order by o.embedding operator(extensions.<=>) a.embedding,o.note_id limit max_count)
 select coalesce(jsonb_agg(jsonb_build_object('id',note_id,'hash',input_hash,'similarity',similarity) order by similarity desc,note_id),'[]') into result from selected;
 return result;
end $$;
create function public.refresh_semantic_relations(target_id uuid,caller_id uuid) returns integer language plpgsql security invoker set search_path='' as $$
declare origin private.note_embeddings; neighbour jsonb; target private.note_embeddings; count_links integer=0;
begin
 select * into origin from private.note_embeddings where note_id=target_id and user_id=caller_id and model='text-embedding-3-small' and input_version=1 for update;
 delete from private.semantic_relations where user_id=caller_id and (note_a=target_id or note_b=target_id);
 if origin.status is distinct from 'ready' or not private.semantic_eligible(target_id,caller_id) then return 0;end if;
 for neighbour in select * from jsonb_array_elements(public.semantic_neighbours(target_id,caller_id)) loop
  select * into target from private.note_embeddings where note_id=(neighbour->>'id')::uuid and user_id=caller_id and model=origin.model and input_version=origin.input_version and status='ready';
  if target.note_id is null then continue;end if;
  insert into private.semantic_relations(user_id,note_a,note_b,hash_a,hash_b,similarity)
  values(caller_id,least(target_id,target.note_id),greatest(target_id,target.note_id),case when target_id<target.note_id then origin.input_hash else target.input_hash end,case when target_id<target.note_id then target.input_hash else origin.input_hash end,(neighbour->>'similarity')::double precision)
  on conflict(user_id,note_a,note_b,model,input_version) do update set hash_a=excluded.hash_a,hash_b=excluded.hash_b,similarity=excluded.similarity,updated_at=now();
  count_links=count_links+1;
 end loop;
 update private.note_embeddings set relations_current=true where note_id=target_id and user_id=caller_id and model=origin.model and input_version=origin.input_version and input_hash=origin.input_hash;
 return count_links;
end $$;
-- FR-15 consumes the same vectors where present, retaining lexical fallback for
-- unindexed notes. Its existing validated explanations and score scale stay intact.
create or replace function public.related_note_input(target_id uuid,caller_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',n.id,'title',n.title,'content',left(n.content,8000),'context',left(d.context_text,2000),
 'source',case when s.source_type is not null then jsonb_build_object('type',s.source_type,'name',s.name,'url',s.url,'description',s.description) else null end)
 from public.notes n join public.note_search_documents d on d.note_id=n.id and d.user_id=n.user_id
 left join public.note_sources s on s.note_id=n.id and s.user_id=n.user_id where n.id=target_id and n.user_id=caller_id
$$;
create or replace function public.related_note_candidates(target_id uuid,caller_id uuid,terms text[]) returns jsonb
language plpgsql stable security invoker set search_path='' set statement_timeout='8s' as $$
declare q tsquery;result jsonb;semantic jsonb;
begin
 if cardinality(terms)>12 or exists(select 1 from unnest(terms) t where char_length(t)>80) then raise exception 'INVALID_TERMS';end if;
 if not exists(select 1 from public.notes where id=target_id and user_id=caller_id) then raise exception 'NOT_FOUND';end if;
 select string_agg(quote_literal(word),' | ')::tsquery into q from(select distinct unnest(tsvector_to_array(to_tsvector('pg_catalog.english',t))) word from unnest(terms)t) words;
 semantic=public.semantic_neighbours(target_id,caller_id,12);
 with semantic_candidates as(select (n->>'id')::uuid as note_id,0 as priority,ordinal::integer as position from jsonb_array_elements(semantic) with ordinality p(n,ordinal)),
 lexical as(select d.note_id,1 as priority,row_number() over(order by ts_rank(d.document,q,32) desc,d.note_id)::integer as position from public.note_search_documents d where d.user_id=caller_id and d.note_id<>target_id and d.document@@q order by ts_rank(d.document,q,32) desc,d.note_id limit 16),
 combined as(select * from semantic_candidates union all select * from lexical),unique_candidates as(select distinct on(note_id)* from combined order by note_id,priority,position),selected as(select * from unique_candidates order by priority,position,note_id limit 16)
 select coalesce(jsonb_agg((public.related_note_input(n.id,caller_id)||jsonb_build_object('content',left(n.content,3000),'context',left(d.context_text,1000))) order by c.priority,c.position,c.note_id),'[]') into result
 from selected c join public.notes n on n.id=c.note_id and n.user_id=caller_id join public.note_search_documents d on d.note_id=n.id and d.user_id=caller_id;
 return result;
end $$;
revoke all on function private.semantic_embedding_changed(),private.semantic_captured_at(public.notes),public.semantic_neighbours(uuid,uuid,integer,timestamptz,timestamptz),public.refresh_semantic_relations(uuid,uuid) from public,anon,authenticated;
grant execute on function private.semantic_captured_at(public.notes),public.semantic_neighbours(uuid,uuid,integer,timestamptz,timestamptz),public.refresh_semantic_relations(uuid,uuid) to service_role;
notify pgrst,'reload schema';
