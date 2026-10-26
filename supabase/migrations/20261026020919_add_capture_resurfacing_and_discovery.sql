-- Persistent feedback, separate from generated relationships so reprocessing cannot erase it.
create table public.related_note_dismissals (
 note_a uuid not null, note_b uuid not null, user_id uuid not null references auth.users(id) on delete cascade,
 dismissed_at timestamptz not null default now(), primary key(note_a,note_b), check(note_a<note_b),
 foreign key(note_a,user_id) references public.notes(id,user_id) on delete cascade,
 foreign key(note_b,user_id) references public.notes(id,user_id) on delete cascade
);
create index related_dismissals_owner on public.related_note_dismissals(user_id);
create index related_dismissals_a_owner on public.related_note_dismissals(note_a,user_id);
create index related_dismissals_b_owner on public.related_note_dismissals(note_b,user_id);
alter table public.related_note_dismissals enable row level security;
revoke all on public.related_note_dismissals from public,anon,authenticated;
grant select,insert(note_a,note_b,user_id) on public.related_note_dismissals to authenticated;
grant all on public.related_note_dismissals to service_role;
create policy dismissal_read on public.related_note_dismissals for select to authenticated using(user_id=(select auth.uid()));
create policy dismissal_insert on public.related_note_dismissals for insert to authenticated with check(user_id=(select auth.uid()));
create function public.dismiss_note_connection(origin_id uuid,target_id uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 if origin_id=target_id or (select count(*) from public.notes where user_id=(select auth.uid()) and id in(origin_id,target_id))<>2 then raise insufficient_privilege using message='Connection not found.'; end if;
 insert into public.related_note_dismissals(note_a,note_b,user_id) values(least(origin_id,target_id),greatest(origin_id,target_id),auth.uid()) on conflict do nothing;
end $$;
revoke all on function public.dismiss_note_connection(uuid,uuid) from public,anon;
grant execute on function public.dismiss_note_connection(uuid,uuid) to authenticated;

-- Minimal discovery history: identifiers, version, feedback and time, never copies of note text.
create table public.note_discovery_history (
 request_id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 session_id uuid not null, note_id uuid not null, note_updated_at timestamptz not null,
 mode text not null check(mode in ('surprise','topic')), shown_at timestamptz not null default now(), dismissed boolean not null default false,
 unique(user_id,session_id,note_id), foreign key(note_id,user_id) references public.notes(id,user_id) on delete cascade
);
create index discovery_note_owner on public.note_discovery_history(note_id,user_id);
create index discovery_recent on public.note_discovery_history(user_id,note_id,shown_at desc);
alter table public.note_discovery_history enable row level security;
revoke all on public.note_discovery_history from public,anon,authenticated;
grant select,update(dismissed) on public.note_discovery_history to authenticated;
grant all on public.note_discovery_history to service_role;
create policy discovery_read on public.note_discovery_history for select to authenticated using(user_id=(select auth.uid()));
create policy discovery_feedback on public.note_discovery_history for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

-- Same conservative English sensitivity guard as isSensitiveRecall; tested for parity.
-- owner_id is derived by Edge auth for service calls; client calls remain RLS-bound.
create function public.rediscovery_eligible(target_id uuid,owner_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.notes n
 left join public.note_contexts c on c.note_id=n.id and c.user_id=n.user_id
 left join public.note_sources s on s.note_id=n.id and s.user_id=n.user_id
 where n.id=target_id and n.user_id=owner_id and (auth.uid() is null or auth.uid()=owner_id)
 and not exists(select 1 from public.flashback_exclusions e where e.note_id=n.id)
 and concat_ws(' ',n.content,c.user_context,c.answer,s.name,s.url,s.description) !~* '\m(grief|grieving|trauma|abuse|assault|suicid\w*|self[- ]harm|died|death|funeral|doctor|therapy|therapist|diagnos\w*|medical|health|medication|pregnan\w*|divorce|conflict|private|confidential|secret|debt|salary|bank|financial)\M'
 and n.content !~* '\m(ignore (all |prior |previous )?instructions|system:|api key)')
$$;
revoke all on function public.rediscovery_eligible(uuid,uuid) from public,anon;
grant execute on function public.rediscovery_eligible(uuid,uuid) to authenticated,service_role;

create or replace function public.read_related_notes(target_id uuid) returns table(id uuid,title text,explanation text,created_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select n.id,left(split_part(n.content,E'\n',1),100),r.explanation,n.created_at from public.note_relations r
 join public.notes n on n.id=r.related_id and n.user_id=r.user_id
 where r.note_id=target_id and r.user_id=(select auth.uid()) and not exists(
 select 1 from public.related_note_dismissals d where d.note_a=least(r.note_id,r.related_id) and d.note_b=greatest(r.note_id,r.related_id))
 order by r.score desc,n.id limit 3
$$;
create function public.read_resurfaced_notes(target_id uuid) returns table(id uuid,title text,explanation text,created_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select r.* from public.read_related_notes(target_id) r join public.notes origin on origin.id=target_id and origin.user_id=(select auth.uid())
 where public.rediscovery_eligible(target_id,auth.uid()) and public.rediscovery_eligible(r.id,auth.uid()) and r.created_at<origin.created_at
 and not exists(select 1 from public.note_discovery_history h where h.user_id=auth.uid() and h.note_id=r.id and h.shown_at>now()-case when h.dismissed then interval '30 days' else interval '7 days' end)
 and not exists(select 1 from public.flashbacks f where f.user_id=auth.uid() and f.note_id=r.id and f.created_at>now()-interval '7 days')
 limit 2
$$;
revoke all on function public.read_resurfaced_notes(uuid) from public,anon;
grant execute on function public.read_resurfaced_notes(uuid) to authenticated;

-- On-demand discovery reuses recall ranking in the Edge function, not its scheduler/cadence.
create function public.discovery_candidates(caller_id uuid,discovery_session uuid) returns jsonb
language sql stable security invoker set search_path='' set statement_timeout='5s' as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
 select n.id,left(n.content,10000) as content,n.created_at,n.updated_at,to_jsonb(c) as context
 from public.notes n join public.note_contexts c on c.note_id=n.id and c.user_id=n.user_id
 where n.user_id=caller_id and n.created_at<=now()-interval '1 day' and n.updated_at<=now()-interval '1 day'
 and length(btrim(n.content))>=60 and public.rediscovery_eligible(n.id,caller_id)
 and not exists(select 1 from public.note_discovery_history h where h.user_id=caller_id and h.note_id=n.id and (h.session_id=discovery_session or h.shown_at>now()-case when h.dismissed then interval '30 days' else interval '7 days' end))
 and not exists(select 1 from public.flashbacks f where f.user_id=caller_id and f.note_id=n.id and f.created_at>now()-interval '7 days')
 order by (c.status='completed' and jsonb_typeof(c.generated_context->'situation')='object') desc,n.updated_at,n.id limit 100
 ) x
$$;
revoke all on function public.discovery_candidates(uuid,uuid) from public,anon,authenticated;
grant execute on function public.discovery_candidates(uuid,uuid) to service_role;

create function public.discovery_card(discovery_request uuid,caller_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('request_id',h.request_id,'note_id',n.id,'title',left(split_part(btrim(n.content),E'\n',1),160),
 'preview',left(n.content,600),'created_at',n.created_at,'capture_method',n.capture_method,'mode',h.mode)
 from public.note_discovery_history h join public.notes n on n.id=h.note_id and n.user_id=h.user_id
 where h.request_id=discovery_request and h.user_id=caller_id and n.updated_at=h.note_updated_at and not h.dismissed and public.rediscovery_eligible(n.id,caller_id)
$$;
revoke all on function public.discovery_card(uuid,uuid) from public,anon,authenticated;
grant execute on function public.discovery_card(uuid,uuid) to service_role;

create function public.reserve_discovery(caller_id uuid,discovery_session uuid,discovery_request uuid,candidates jsonb,discovery_mode text) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='5s' as $$
declare candidate jsonb; n public.notes; c public.note_contexts; existing public.note_discovery_history;
begin
 if caller_id is null or discovery_session is null or discovery_request is null or discovery_mode not in ('surprise','topic') or jsonb_typeof(candidates)<>'array' or jsonb_array_length(candidates)>100 then raise exception 'INVALID_DISCOVERY'; end if;
 perform pg_advisory_xact_lock(hashtextextended(caller_id::text,1617));
 select * into existing from public.note_discovery_history where request_id=discovery_request;
 if found then
  if existing.user_id<>caller_id or existing.session_id<>discovery_session or existing.mode<>discovery_mode then raise exception 'INVALID_DISCOVERY'; end if;
  return public.discovery_card(discovery_request,caller_id);
 end if;
 for candidate in select * from jsonb_array_elements(candidates) loop
  select * into n from public.notes where id=(candidate->>'id')::uuid and user_id=caller_id for share;
  if n.id is null or n.updated_at<>(candidate->>'updated_at')::timestamptz or not public.rediscovery_eligible(n.id,caller_id) then continue; end if;
  if discovery_mode='surprise' then
   if n.created_at>now()-interval '1 day' or n.updated_at>now()-interval '1 day' then continue; end if;
   select * into c from public.note_contexts where note_id=n.id and user_id=caller_id;
   if c.source_hash is distinct from candidate->>'source_hash' or c.revision is distinct from (candidate->>'context_revision')::bigint or c.user_version is distinct from (candidate->>'user_version')::bigint then continue; end if;
  end if;
  if exists(select 1 from public.note_discovery_history h where h.user_id=caller_id and h.note_id=n.id and (h.session_id=discovery_session or h.shown_at>now()-case when h.dismissed then interval '30 days' when discovery_mode='surprise' then interval '7 days' else interval '1 day' end))
   or exists(select 1 from public.flashbacks f where f.user_id=caller_id and f.note_id=n.id and f.created_at>now()-interval '7 days') then continue; end if;
  insert into public.note_discovery_history(request_id,user_id,session_id,note_id,note_updated_at,mode) values(discovery_request,caller_id,discovery_session,n.id,n.updated_at,discovery_mode);
  return public.discovery_card(discovery_request,caller_id);
 end loop;
 return null;
end $$;
revoke all on function public.reserve_discovery(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.reserve_discovery(uuid,uuid,uuid,jsonb,text) to service_role;
