-- Candidate retrieval favors recall; strict AI evaluation, not keyword overlap, decides whether to display a link.
create or replace function public.related_note_candidates(target_id uuid,caller_id uuid,terms text[]) returns jsonb
language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
declare q tsquery; result jsonb;
begin
 if cardinality(terms)>12 or exists(select 1 from unnest(terms) t where char_length(t)>80) then raise exception 'INVALID_TERMS'; end if;
 if not exists(select 1 from public.notes where id=target_id and user_id=caller_id) then raise exception 'NOT_FOUND'; end if;
 select string_agg(quote_literal(word),' | ')::tsquery into q from (select distinct unnest(tsvector_to_array(to_tsvector('pg_catalog.english',t))) word from unnest(terms) t) words;
 with candidates as (
  select d.note_id,ts_rank(d.document,q,32) as relevance
  from public.note_search_documents d where d.user_id=caller_id and d.note_id<>target_id and d.document@@q
  order by relevance desc,d.note_id limit 16
 ) select coalesce(jsonb_agg((public.related_note_input(c.note_id,caller_id) || jsonb_build_object('content',left(n.content,3000),'context',left(d.context_text,1000))) order by c.relevance desc,c.note_id),'[]') into result from candidates c join public.notes n on n.id=c.note_id and n.user_id=caller_id join public.note_search_documents d on d.note_id=c.note_id and d.user_id=caller_id;
 return result;
end $$;
