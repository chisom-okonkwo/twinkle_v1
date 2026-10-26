-- Retain readable imported titles in existing relationship/discovery cards.
-- Eligibility, ranking, history, permissions, and processing are unchanged.
create or replace function public.read_related_notes(target_id uuid) returns table(id uuid,title text,explanation text,created_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select n.id,left(coalesce(nullif(n.import_metadata->>'title',''),split_part(n.content,E'\n',1)),100),r.explanation,n.created_at from public.note_relations r
 join public.notes n on n.id=r.related_id and n.user_id=r.user_id
 where r.note_id=target_id and r.user_id=(select auth.uid()) and not exists(
 select 1 from public.related_note_dismissals d where d.note_a=least(r.note_id,r.related_id) and d.note_b=greatest(r.note_id,r.related_id))
 order by r.score desc,n.id limit 3
$$;
create or replace function public.discovery_card(discovery_request uuid,caller_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('request_id',h.request_id,'note_id',n.id,'title',left(coalesce(nullif(n.import_metadata->>'title',''),split_part(btrim(n.content),E'\n',1)),160),
 'preview',left(n.content,600),'created_at',n.created_at,'capture_method',n.capture_method,'mode',h.mode)
 from public.note_discovery_history h join public.notes n on n.id=h.note_id and n.user_id=h.user_id
 where h.request_id=discovery_request and h.user_id=caller_id and n.updated_at=h.note_updated_at and not h.dismissed and public.rediscovery_eligible(n.id,caller_id)
$$;
