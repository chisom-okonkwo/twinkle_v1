-- Avoid paid work for insufficient collections and preserve FR-15 candidate ranking.
create or replace function public.claim_note_themes(caller_id uuid,activate boolean default false,retry boolean default false) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='8s' as $$
declare state private.theme_state; rev bigint; seeds jsonb; used integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(caller_id::text,1415));
 if not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then return jsonb_build_object('status','disabled'); end if;
 insert into private.theme_state(user_id,enabled) values(caller_id,activate) on conflict(user_id) do update set enabled=private.theme_state.enabled or activate returning * into state;
 if not state.enabled then return jsonb_build_object('status','not_started'); end if;
 if (select count(*) from public.notes n where n.user_id=caller_id and private.theme_eligible(n.id,caller_id))<3 then
  update private.theme_state set status='completed' where user_id=caller_id; return jsonb_build_object('status','ready');
 end if;
 if state.status='processing' and state.started_at>now()-interval '2 minutes' then return jsonb_build_object('status','processing'); end if;
 if state.status='failed' and (not retry or state.started_at>now()-interval '30 seconds') then return jsonb_build_object('status','failed'); end if;
 insert into private.related_library(user_id) values(caller_id) on conflict do nothing;
 select revision into rev from private.related_library where user_id=caller_id;
 select coalesce(jsonb_agg(public.related_note_input(x.id,caller_id) || jsonb_build_object('cached',
 (select count(*) from public.note_relations r where r.note_id=x.id and r.user_id=caller_id and r.score>=90 and private.theme_eligible(r.related_id,caller_id)))),'[]') into seeds from (
 select n.id from public.notes n join public.note_contexts c on c.note_id=n.id and c.user_id=n.user_id
 left join private.theme_checked done on done.note_id=n.id and done.user_id=n.user_id
 where n.user_id=caller_id and private.theme_eligible(n.id,caller_id) and (done.note_id is null or done.content_hash<>private.note_context_hash(n.content))
 and c.status<>'pending' and not(c.status='processing' and c.processing_started_at>now()-interval '2 minutes')
 order by (c.status='completed') desc,n.updated_at desc,n.id limit 2) x;
 if jsonb_array_length(seeds)=0 then update private.theme_state set status='completed' where user_id=caller_id; return jsonb_build_object('status','ready'); end if;
 update private.theme_state set window_start=date_trunc('hour',now()),attempts=case when window_start=date_trunc('hour',now()) then attempts+1 else 1 end where user_id=caller_id returning attempts into used;
 if used>4 then raise exception 'RATE_LIMIT'; end if;
 update private.theme_state set token=gen_random_uuid(),status='processing',revision=rev,started_at=now() where user_id=caller_id returning * into state;
 return jsonb_build_object('status','claimed','token',state.token,'revision',rev,'seeds',seeds);
end $$;

create or replace function public.note_theme_candidates(caller_id uuid,target_id uuid,terms text[]) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='8s' as $$
declare pool jsonb; candidates jsonb; known jsonb;
begin
 if not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) or not private.theme_eligible(target_id,caller_id) then return jsonb_build_object('candidates','[]'::jsonb,'known','[]'::jsonb); end if;
 pool=public.related_note_candidates(target_id,caller_id,terms);
 with cached as (select (public.related_note_input(r.related_id,caller_id) || jsonb_build_object('content',left(b.content,3000),'context',left(coalesce((public.related_note_input(r.related_id,caller_id))->>'context',''),1000))) as input,0 as priority
 from public.note_relations r join public.notes a on a.id=r.note_id and a.user_id=r.user_id join public.notes b on b.id=r.related_id and b.user_id=r.user_id
 where r.note_id=target_id and r.user_id=caller_id and r.score>=90
 and strpos(private.theme_text(a.content),private.theme_text(r.origin_quote))>0
 and strpos(private.theme_text(b.content),private.theme_text(r.related_quote))>0), combined as (
 select * from cached union all select x,ordinal::integer from jsonb_array_elements(pool) with ordinality as p(x,ordinal)), unique_notes as (
 select distinct on(input->>'id') input,priority from combined where private.theme_eligible((input->>'id')::uuid,caller_id)
 and not exists(select 1 from public.related_note_dismissals d where d.user_id=caller_id and d.note_a=least(target_id,(input->>'id')::uuid) and d.note_b=greatest(target_id,(input->>'id')::uuid)) order by input->>'id',priority
 ) select coalesce(jsonb_agg(input order by priority,input->>'id'),'[]') into candidates from(select * from unique_notes order by priority,input->>'id' limit 16) x;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'label',t.generated_label,'description',t.description,'dismissed',t.dismissed)),'[]') into known from (
 select t.* from public.note_themes t where t.user_id=caller_id order by
 (exists(select 1 from public.note_theme_members m where m.theme_id=t.id and m.user_id=caller_id and (m.note_id=target_id or m.note_id in(select (x->>'id')::uuid from jsonb_array_elements(candidates) x)))) desc,
 t.dismissed desc,t.created_at desc limit 12) t;
 return jsonb_build_object('candidates',candidates,'known',known);
end $$;

create or replace function private.note_theme_snapshot(period text) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare owner_id uuid=auth.uid(); state private.theme_state; total integer; checked integer; pending integer; groups jsonb;
begin
 if owner_id is null then raise insufficient_privilege using message='Sign in to explore themes.'; end if;
 if period is null or period not in ('all','recent') then raise invalid_parameter_value using message='Choose all time or the past 90 days.'; end if;
 if not exists(select 1 from public.context_preferences where user_id=owner_id and enabled) then return jsonb_build_object('status','disabled','total',0,'checked',0,'pending',0,'themes','[]'::jsonb); end if;
 select * into state from private.theme_state where user_id=owner_id;
 select count(*),count(*) filter(where done.note_id is not null and done.content_hash=private.note_context_hash(n.content)),
 count(*) filter(where c.status='pending' or c.status='processing' and c.processing_started_at>now()-interval '2 minutes')
 into total,checked,pending from public.notes n left join public.note_contexts c on c.note_id=n.id and c.user_id=n.user_id
 left join private.theme_checked done on done.note_id=n.id and done.user_id=n.user_id where n.user_id=owner_id and private.theme_eligible(n.id,owner_id);
 with members as materialized(select * from private.visible_theme_members(owner_id,period)), summary as (
  select m.theme_id,count(distinct m.note_id)::integer as note_count,min(m.created_at) as first_at,max(m.created_at) as last_at from members m group by m.theme_id having count(distinct m.note_id)>=3
 ), selected as(select * from summary order by note_count desc,last_at desc,theme_id limit 8)
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'label',coalesce(t.user_label,t.generated_label),'generated_label',t.generated_label,'description',t.description,
 'note_count',s.note_count,'first_at',s.first_at,'last_at',s.last_at,'months',
 (select jsonb_agg(to_jsonb(b) order by b.month) from (select to_char(m.created_at at time zone 'UTC','YYYY-MM') as month,count(distinct m.note_id)::integer as note_count from members m where m.theme_id=t.id group by 1) b)) order by s.note_count desc,s.last_at desc,t.id),'[]') into groups
 from selected s join public.note_themes t on t.id=s.theme_id and t.user_id=owner_id;
 return jsonb_build_object('status',case when not coalesce(state.enabled,false) then 'not_started'
 when state.status='processing' and state.started_at>now()-interval '2 minutes' then 'processing'
 when state.status='failed' then 'failed' when total<3 then 'ready' when total>checked and total-checked<=pending then 'waiting_context'
 when total>checked then 'pending' else 'ready' end,'total',total,'checked',checked,'pending',pending,'themes',groups);
end $$;
