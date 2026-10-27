-- Use the same current index states as progress rather than re-running the
-- expensive eligibility/context joins for every saved note on every UI poll.
-- Deferred history has not been opted in and is reported separately as waiting.
-- Group membership still uses the full live privacy/evidence checks.
create function private.semantic_date_coverage(owner_id uuid,bounds jsonb) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'in_period',count(*) filter(where private.semantic_captured_at(n) is not null and(bounds->>'start' is null or private.semantic_captured_at(n)>=(bounds->>'start')::timestamptz and private.semantic_captured_at(n)<(bounds->>'end')::timestamptz)),
 'outside_period',count(*) filter(where bounds->>'start' is not null and(private.semantic_captured_at(n)<(bounds->>'start')::timestamptz or private.semantic_captured_at(n)>=(bounds->>'end')::timestamptz)),
 'unknown_date',count(*) filter(where private.semantic_captured_at(n) is null))
 from private.note_embeddings e join public.notes n on n.id=e.note_id and n.user_id=e.user_id
 where e.user_id=owner_id and e.model='text-embedding-3-small' and e.input_version=1 and e.status not in('excluded','deferred')
$$;
revoke all on function private.semantic_date_coverage(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.semantic_date_coverage(uuid,jsonb) to service_role;
create or replace function private.note_theme_snapshot(period text) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='8s' as $$
declare owner_id uuid=auth.uid();bounds jsonb;progress jsonb;groups jsonb;hidden integer;coverage jsonb;all_group_count integer;
begin
 if owner_id is null then raise insufficient_privilege;end if;
 if period is null or period not in('all','recent') then raise invalid_parameter_value;end if;
 bounds=private.semantic_time_bounds(owner_id,period);progress=private.semantic_progress(owner_id,bounds);
 if progress->>'status'='disabled' then return progress||jsonb_build_object('themes','[]'::jsonb);end if;
 coverage=private.semantic_date_coverage(owner_id,bounds);
 with all_members as materialized(select * from private.visible_theme_members(owner_id,'all')),
 members as materialized(select * from all_members where period='all' or created_at>=(bounds->>'start')::timestamptz and created_at<(bounds->>'end')::timestamptz),summary as(
 select m.theme_id,count(distinct m.note_id)::integer note_count,min(m.created_at) first_at,max(m.created_at) last_at,
 count(distinct m.note_id) filter(where m.created_at is null)::integer unknown_dates,
 count(distinct m.note_id) filter(where m.created_at is not null)>=3 and count(distinct (m.created_at at time zone (bounds->>'timezone'))::date)>=2 recurring
 from members m group by m.theme_id having count(distinct m.note_id)>=2),selected as(select * from summary order by note_count desc,last_at desc nulls last,theme_id limit 8)
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'label',coalesce(t.user_label,t.generated_label),'generated_label',t.generated_label,'description',t.description,'note_count',s.note_count,'first_at',s.first_at,'last_at',s.last_at,'unknown_dates',s.unknown_dates,'recurring',s.recurring,'months',
 coalesce((select jsonb_agg(to_jsonb(b) order by b.month) from(select to_char(m.created_at at time zone (bounds->>'timezone'),'YYYY-MM') as month,count(distinct m.note_id)::integer note_count from members m where m.theme_id=t.id and m.created_at is not null group by 1)b),'[]'::jsonb)) order by s.note_count desc,s.last_at desc nulls last,t.id),'[]') , (select count(*) from(select theme_id from all_members group by theme_id having count(distinct note_id)>=2)valid_groups) , (select count(*) from public.note_themes h where h.user_id=owner_id and(h.dismissed or not exists(select 1 from summary visible where visible.theme_id=h.id))) into groups,all_group_count,hidden from selected s join public.note_themes t on t.id=s.theme_id and t.user_id=owner_id;
 return progress||jsonb_build_object('themes',groups,'hidden_groups',hidden,'all_time_group_count',all_group_count,'date_coverage',coverage);
end $$;
notify pgrst,'reload schema';
