-- Edited older notes may connect to any note captured before the latest save.
-- Reuse the same detector while avoiding paid re-evaluation of dismissed pairs.
create or replace function public.read_resurfaced_notes(target_id uuid) returns table(id uuid,title text,explanation text,created_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select r.* from public.read_related_notes(target_id) r join public.notes origin on origin.id=target_id and origin.user_id=(select auth.uid())
 where public.rediscovery_eligible(target_id,auth.uid()) and public.rediscovery_eligible(r.id,auth.uid()) and r.created_at<origin.updated_at
 and not exists(select 1 from public.note_discovery_history h where h.user_id=auth.uid() and h.note_id=r.id and (h.mode<>'capture' or h.session_id<>target_id) and h.shown_at>now()-case when h.dismissed then interval '30 days' else interval '7 days' end)
 and not exists(select 1 from public.flashbacks f where f.user_id=auth.uid() and f.note_id=r.id and f.created_at>now()-interval '7 days') limit 2
$$;

create or replace function public.record_capture_rediscovery(caller_id uuid,origin_id uuid,target_ids uuid[]) returns void
language plpgsql security invoker set search_path='' as $$
declare target uuid;
begin
 if cardinality(target_ids)>2 then raise exception 'INVALID_DISCOVERY'; end if;
 perform pg_advisory_xact_lock(hashtextextended(caller_id::text,1617));
 if not public.rediscovery_eligible(origin_id,caller_id) then return; end if;
 for target in select distinct unnest(target_ids) loop
  if exists(select 1 from public.note_relations r join public.related_note_runs run on run.note_id=r.note_id and run.user_id=r.user_id and run.status='completed'
    join public.notes n on n.id=r.related_id and n.user_id=r.user_id join public.notes origin on origin.id=r.note_id and origin.user_id=r.user_id
    where r.user_id=caller_id and r.note_id=origin_id and r.related_id=target and n.created_at<origin.updated_at and run.completed_at>now()-interval '1 day'
    and public.rediscovery_eligible(target,caller_id) and not exists(select 1 from public.related_note_dismissals d where d.note_a=least(origin_id,target) and d.note_b=greatest(origin_id,target))) then
   insert into public.note_discovery_history(request_id,user_id,session_id,note_id,note_updated_at,mode)
    select gen_random_uuid(),caller_id,origin_id,n.id,n.updated_at,'capture' from public.notes n where n.id=target and n.user_id=caller_id
   on conflict(user_id,session_id,note_id) do update set shown_at=now(),note_updated_at=excluded.note_updated_at;
  end if;
 end loop;
end $$;

create or replace function public.related_note_candidates(target_id uuid,caller_id uuid,terms text[]) returns jsonb
language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
declare q tsquery; result jsonb;
begin
 if cardinality(terms)>12 or exists(select 1 from unnest(terms) t where char_length(t)>80) then raise exception 'INVALID_TERMS'; end if;
 if not exists(select 1 from public.notes where id=target_id and user_id=caller_id) then raise exception 'NOT_FOUND'; end if;
 select string_agg(quote_literal(word),' | ')::tsquery into q from (select distinct unnest(tsvector_to_array(to_tsvector('pg_catalog.english',t))) word from unnest(terms) t) words;
 with candidates as (
  select d.note_id,ts_rank(d.document,q,32) as relevance
  from public.note_search_documents d where d.user_id=caller_id and d.note_id<>target_id and d.document@@q and not exists(select 1 from public.related_note_dismissals dismissed where dismissed.note_a=least(target_id,d.note_id) and dismissed.note_b=greatest(target_id,d.note_id))
  order by relevance desc,d.note_id limit 16
 ) select coalesce(jsonb_agg((public.related_note_input(c.note_id,caller_id) || jsonb_build_object('content',left(n.content,3000),'context',left(d.context_text,1000))) order by c.relevance desc,c.note_id),'[]') into result from candidates c join public.notes n on n.id=c.note_id and n.user_id=caller_id join public.note_search_documents d on d.note_id=c.note_id and d.user_id=caller_id;
 return result;
end $$;
