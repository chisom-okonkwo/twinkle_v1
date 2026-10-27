-- One shared, incremental theme/group analysis. Counts are always derived from
-- live owner-scoped membership, never from language-model statistics.
create table public.note_themes (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 theme_key text not null, generated_label text not null check(char_length(generated_label) between 3 and 80),
 description text not null check(char_length(description) between 1 and 240),
 user_label text check(user_label is null or (char_length(btrim(user_label)) between 1 and 80 and user_label !~ '[[:cntrl:]]')),
 dismissed boolean not null default false, created_at timestamptz not null default now(),
 unique(user_id,theme_key), unique(id,user_id)
);
alter table public.note_themes enable row level security;
revoke all on public.note_themes from public,anon,authenticated;
grant select,update(user_label,dismissed) on public.note_themes to authenticated;
grant all on public.note_themes to service_role;
create policy theme_read on public.note_themes for select to authenticated using(user_id=(select auth.uid()));
create policy theme_feedback on public.note_themes for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create table public.note_theme_members (
 theme_id uuid not null, note_id uuid not null, user_id uuid not null references auth.users(id) on delete cascade,
 quote text not null check(char_length(quote) between 1 and 400), content_hash text not null,
 primary key(theme_id,note_id), unique(theme_id,content_hash),
 foreign key(theme_id,user_id) references public.note_themes(id,user_id) on delete cascade,
 foreign key(note_id,user_id) references public.notes(id,user_id) on delete cascade
);
create index theme_members_note_owner on public.note_theme_members(note_id,user_id);
create index theme_members_theme_owner on public.note_theme_members(theme_id,user_id);
create index theme_members_owner on public.note_theme_members(user_id);
alter table public.note_theme_members enable row level security;
revoke all on public.note_theme_members from public,anon,authenticated;
grant select on public.note_theme_members to authenticated;
grant all on public.note_theme_members to service_role;
create policy theme_member_read on public.note_theme_members for select to authenticated using(user_id=(select auth.uid()));
create table private.theme_state (
 user_id uuid primary key references auth.users(id) on delete cascade, enabled boolean not null default false,
 status text not null default 'idle' check(status in ('idle','processing','completed','failed')),
 token uuid, revision bigint, started_at timestamptz, completed_at timestamptz,
 window_start timestamptz not null default now(), attempts integer not null default 0
);
create table private.theme_checked (
 note_id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 content_hash text not null, checked_at timestamptz not null default now(),
 foreign key(note_id,user_id) references public.notes(id,user_id) on delete cascade
);
create index theme_checked_note_owner on private.theme_checked(note_id,user_id);
create index theme_checked_owner on private.theme_checked(user_id);
alter table private.theme_state enable row level security;
alter table private.theme_checked enable row level security;
revoke all on private.theme_state,private.theme_checked from public,anon,authenticated;
grant all on private.theme_state,private.theme_checked to service_role;

create function private.theme_text(value text) returns text language sql immutable set search_path='' as $$ select btrim(regexp_replace(value,'[[:space:]]+',' ','g')) $$;
revoke all on function private.theme_text(text) from public,anon,authenticated;
grant execute on function private.theme_text(text) to service_role;

create function private.theme_eligible(target_id uuid,owner_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.notes n where n.id=target_id and n.user_id=owner_id
 and char_length(btrim(n.content))>=40 and cardinality(regexp_split_to_array(btrim(n.content),'[[:space:]]+'))>=6
 and public.rediscovery_eligible(n.id,owner_id)
 and not exists(select 1 from public.note_discovery_history h where h.note_id=n.id and h.user_id=owner_id and h.dismissed and h.shown_at>now()-interval '30 days'))
$$;
revoke all on function private.theme_eligible(uuid,uuid) from public,anon,authenticated;
grant execute on function private.theme_eligible(uuid,uuid) to service_role;

create function private.invalidate_note_themes() returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid; target uuid; second_target uuid; row_data jsonb;
begin
 row_data=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 owner_id=(row_data->>'user_id')::uuid;
 if not exists(select 1 from auth.users where id=owner_id) then return null; end if;
 if tg_table_name='notes' then
  target=(row_data->>'id')::uuid;
  if tg_op='UPDATE' and private.note_context_hash(new.content)=private.note_context_hash(old.content) then return null; end if;
 elsif tg_table_name='context_preferences' then
  if tg_op='UPDATE' and new.enabled=old.enabled then return null; end if;
 elsif tg_table_name='note_contexts' then
  if (to_jsonb(new)->'generated_context',new.user_context,new.answer) is not distinct from (to_jsonb(old)->'generated_context',old.user_context,old.answer) then return null; end if;
  target=new.note_id;
 elsif tg_table_name='related_note_dismissals' then
  target=(row_data->>'note_a')::uuid; second_target=(row_data->>'note_b')::uuid;
 elsif tg_table_name='note_discovery_history' then
  if tg_op='UPDATE' and new.dismissed=old.dismissed then return null; end if;
  if not coalesce((row_data->>'dismissed')::boolean,false) and tg_op<>'UPDATE' then return null; end if;
  target=(row_data->>'note_id')::uuid;
 else target=(row_data->>'note_id')::uuid;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,1415));
 -- Existing FR-15 invalidation already increments this revision for note,
 -- context, source and consent changes. Feedback/exclusions need it too.
 if tg_table_name in ('flashback_exclusions','related_note_dismissals','note_discovery_history') then
  insert into private.related_library(user_id) values(owner_id) on conflict(user_id) do update set revision=private.related_library.revision+1;
 end if;
 update private.theme_state set status='idle',token=null where user_id=owner_id;
 if target is null then
  delete from private.theme_checked where user_id=owner_id;
  delete from public.note_theme_members where user_id=owner_id;
 else
  delete from private.theme_checked where user_id=owner_id and note_id in(target,second_target);
  delete from public.note_theme_members where user_id=owner_id and note_id in(target,second_target);
 end if;
 return null;
end $$;
revoke all on function private.invalidate_note_themes() from public,anon,authenticated;
create trigger theme_notes_changed after insert or update of content or delete on public.notes for each row execute function private.invalidate_note_themes();
create trigger theme_context_changed after update of generated_context,user_context,answer on public.note_contexts for each row execute function private.invalidate_note_themes();
create trigger theme_sources_changed after update on public.note_sources for each row execute function private.invalidate_note_themes();
create trigger theme_consent_changed after insert or update of enabled on public.context_preferences for each row execute function private.invalidate_note_themes();
create trigger theme_exclusion_changed after insert or delete on public.flashback_exclusions for each row execute function private.invalidate_note_themes();
create trigger theme_pair_feedback after insert or delete on public.related_note_dismissals for each row execute function private.invalidate_note_themes();
create trigger theme_discovery_feedback after update of dismissed on public.note_discovery_history for each row execute function private.invalidate_note_themes();

-- Internal reusable live view. Authorization comes from its narrow wrappers;
-- service calls cannot be reached by the mobile client.
create function private.visible_theme_members(owner_id uuid,period text) returns table(theme_id uuid,note_id uuid,quote text,created_at timestamptz,title text,preview text,capture_method text)
language sql stable security invoker set search_path='' as $$
 select m.theme_id,n.id,m.quote,n.created_at,coalesce(nullif(n.import_metadata->>'title',''),left(split_part(btrim(n.content),E'\n',1),160)),left(n.content,600),n.capture_method
 from public.note_theme_members m join public.note_themes t on t.id=m.theme_id and t.user_id=m.user_id
 join public.notes n on n.id=m.note_id and n.user_id=m.user_id
 where m.user_id=owner_id and not t.dismissed and m.content_hash=private.note_context_hash(n.content)
 and exists(select 1 from public.context_preferences where user_id=owner_id and enabled)
 and private.theme_eligible(n.id,owner_id) and (period='all' or n.created_at>=now()-interval '90 days')
 and not exists(select 1 from public.related_note_dismissals d
 join public.note_theme_members a on a.theme_id=m.theme_id and a.note_id=d.note_a and a.user_id=owner_id
 join public.note_theme_members b on b.theme_id=m.theme_id and b.note_id=d.note_b and b.user_id=owner_id where d.user_id=owner_id)
$$;
revoke all on function private.visible_theme_members(uuid,text) from public,anon,authenticated;
grant execute on function private.visible_theme_members(uuid,text) to service_role;

create function private.note_theme_snapshot(period text) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
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
 when state.status='failed' then 'failed' when total>checked and total-checked<=pending then 'waiting_context'
 when total>checked then 'pending' else 'ready' end,'total',total,'checked',checked,'pending',pending,'themes',groups);
end $$;
revoke all on function private.note_theme_snapshot(text) from public,anon;
grant execute on function private.note_theme_snapshot(text) to authenticated;
create function public.note_theme_snapshot(period text default 'all') returns jsonb language sql security invoker set search_path='' as $$ select private.note_theme_snapshot(period) $$;
revoke all on function public.note_theme_snapshot(text) from public,anon;
grant execute on function public.note_theme_snapshot(text) to authenticated;

create function private.read_note_theme_members(target_id uuid,period text,page_offset integer) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare owner_id uuid=auth.uid(); result jsonb;
begin
 if owner_id is null then raise insufficient_privilege using message='Sign in to explore themes.'; end if;
 if period is null or period not in ('all','recent') or page_offset is null or page_offset not between 0 and 5000 then raise invalid_parameter_value using message='Invalid theme page.'; end if;
 with members as materialized(select * from private.visible_theme_members(owner_id,period) where theme_id=target_id)
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.note_id),'[]') into result from (
 select * from members where (select count(distinct note_id) from members)>=3 order by created_at desc,note_id limit 21 offset page_offset) x;
 return result;
end $$;
revoke all on function private.read_note_theme_members(uuid,text,integer) from public,anon;
grant execute on function private.read_note_theme_members(uuid,text,integer) to authenticated;
create function public.read_note_theme_members(target_id uuid,period text default 'all',page_offset integer default 0) returns jsonb language sql security invoker set search_path='' as $$ select private.read_note_theme_members(target_id,period,page_offset) $$;
revoke all on function public.read_note_theme_members(uuid,text,integer) from public,anon;
grant execute on function public.read_note_theme_members(uuid,text,integer) to authenticated;

create function public.claim_note_themes(caller_id uuid,activate boolean default false,retry boolean default false) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='8s' as $$
declare state private.theme_state; rev bigint; seeds jsonb; used integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(caller_id::text,1415));
 if not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then return jsonb_build_object('status','disabled'); end if;
 insert into private.theme_state(user_id,enabled) values(caller_id,activate) on conflict(user_id) do update set enabled=private.theme_state.enabled or activate returning * into state;
 if not state.enabled then return jsonb_build_object('status','not_started'); end if;
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
revoke all on function public.claim_note_themes(uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.claim_note_themes(uuid,boolean,boolean) to service_role;

create function public.note_theme_candidates(caller_id uuid,target_id uuid,terms text[]) returns jsonb
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
 select * from cached union all select x,1 from jsonb_array_elements(pool) x), unique_notes as (
 select distinct on(input->>'id') input,priority from combined where private.theme_eligible((input->>'id')::uuid,caller_id)
 and not exists(select 1 from public.related_note_dismissals d where d.user_id=caller_id and d.note_a=least(target_id,(input->>'id')::uuid) and d.note_b=greatest(target_id,(input->>'id')::uuid)) order by input->>'id',priority
 ) select coalesce(jsonb_agg(input order by priority,input->>'id'),'[]') into candidates from(select * from unique_notes order by priority,input->>'id' limit 16) x;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'label',t.generated_label,'description',t.description,'dismissed',t.dismissed)),'[]') into known from (
 select t.* from public.note_themes t where t.user_id=caller_id order by
 (exists(select 1 from public.note_theme_members m where m.theme_id=t.id and m.user_id=caller_id and (m.note_id=target_id or m.note_id in(select (x->>'id')::uuid from jsonb_array_elements(candidates) x)))) desc,
 t.dismissed desc,t.created_at desc limit 12) t;
 return jsonb_build_object('candidates',candidates,'known',known);
end $$;
revoke all on function public.note_theme_candidates(uuid,uuid,text[]) from public,anon,authenticated;
grant execute on function public.note_theme_candidates(uuid,uuid,text[]) to service_role;

create function public.finish_note_themes(caller_id uuid,claim_token uuid,expected_revision bigint,seeds uuid[],groups jsonb) returns boolean
language plpgsql security invoker set search_path='' set statement_timeout='8s' as $$
declare g jsonb; member jsonb; ids uuid[]; chosen uuid; candidate public.note_themes; key text; original text; hash text;
begin
 if cardinality(seeds) not between 1 and 2 or jsonb_typeof(groups)<>'array' or jsonb_array_length(groups)>4 then raise exception 'INVALID_THEMES'; end if;
 -- Lock referenced rows before the owner analysis lock, matching deletion order.
 perform 1 from public.notes n where n.user_id=caller_id and n.id in(select unnest(seeds) union select (m->>'id')::uuid from jsonb_array_elements(groups) x cross join lateral jsonb_array_elements(x->'members') m) order by n.id for key share;
 perform pg_advisory_xact_lock(hashtextextended(caller_id::text,1415));
 if not exists(select 1 from private.theme_state where user_id=caller_id and token=claim_token and status='processing')
 or not exists(select 1 from private.related_library where user_id=caller_id and revision=expected_revision)
 or not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then return false; end if;
 if exists(select 1 from unnest(seeds) id where not private.theme_eligible(id,caller_id)) then return false; end if;
 for g in select * from jsonb_array_elements(groups) loop
  if jsonb_typeof(g->'members')<>'array' or jsonb_array_length(g->'members') not between 3 and 8 or char_length(g->>'label') not between 3 and 80 or char_length(g->>'description') not between 1 and 240 then raise exception 'INVALID_THEMES'; end if;
  select array_agg((m->>'id')::uuid) into ids from jsonb_array_elements(g->'members') m;
  if (select count(distinct x) from unnest(ids) x)<>cardinality(ids) or not ids && seeds or exists(select 1 from unnest(ids) id where not private.theme_eligible(id,caller_id)) then raise exception 'INVALID_THEME_MEMBERS'; end if;
  if exists(select 1 from public.related_note_dismissals d where d.user_id=caller_id and d.note_a=any(ids) and d.note_b=any(ids)) then continue; end if;
  if (select count(distinct private.note_context_hash(n.content)) from public.notes n where n.user_id=caller_id and n.id=any(ids))<>cardinality(ids) then raise exception 'DUPLICATE_THEME_CONTENT'; end if;
  for member in select * from jsonb_array_elements(g->'members') loop
   select content into original from public.notes where id=(member->>'id')::uuid and user_id=caller_id;
   if char_length(member->>'quote') not between 1 and 400 or strpos(private.theme_text(original),private.theme_text(member->>'quote'))=0 then raise exception 'INVALID_THEME_EVIDENCE'; end if;
  end loop;
  key=encode(extensions.digest(lower(btrim(regexp_replace(g->>'label','[[:space:]]+',' ','g'))),'sha256'),'hex');
  chosen=null;
  if nullif(g->>'existing_id','') is not null then
   select id into chosen from public.note_themes where id=(g->>'existing_id')::uuid and user_id=caller_id;
   if chosen is null then raise exception 'FOREIGN_THEME'; end if;
  else
   select id into chosen from public.note_themes where user_id=caller_id and theme_key=key;
   if chosen is null then
    -- Conservatively merge near-identical memberships rather than show a feed
    -- of synonymous groups. Feedback survives generated label variations.
    select t.id into chosen from public.note_themes t join public.note_theme_members m on m.theme_id=t.id and m.user_id=t.user_id
    where t.user_id=caller_id group by t.id having count(*) filter(where m.note_id=any(ids))>=3
    and count(*) filter(where m.note_id=any(ids))::numeric/greatest(count(*),cardinality(ids))>=0.8 order by count(*) filter(where m.note_id=any(ids)) desc,t.id limit 1;
   end if;
  end if;
  if chosen is null then
   if (select count(*) from public.note_themes where user_id=caller_id)>=200 then continue; end if;
   insert into public.note_themes(user_id,theme_key,generated_label,description) values(caller_id,key,g->>'label',g->>'description') returning id into chosen;
  end if;
  select * into candidate from public.note_themes where id=chosen and user_id=caller_id;
  if candidate.dismissed then continue; end if;
  for member in select * from jsonb_array_elements(g->'members') loop
   select private.note_context_hash(content) into hash from public.notes where id=(member->>'id')::uuid and user_id=caller_id;
   if exists(select 1 from public.note_theme_members where theme_id=chosen and content_hash=hash and note_id<>(member->>'id')::uuid) then continue; end if;
   insert into public.note_theme_members(theme_id,note_id,user_id,quote,content_hash) values(chosen,(member->>'id')::uuid,caller_id,member->>'quote',hash)
   on conflict(theme_id,note_id) do update set quote=excluded.quote,content_hash=excluded.content_hash;
  end loop;
 end loop;
 insert into private.theme_checked(note_id,user_id,content_hash) select n.id,caller_id,private.note_context_hash(n.content) from public.notes n where n.user_id=caller_id and n.id=any(seeds)
 on conflict(note_id) do update set content_hash=excluded.content_hash,checked_at=now();
 update private.theme_state set status='completed',completed_at=now() where user_id=caller_id and token=claim_token;
 return true;
end $$;
revoke all on function public.finish_note_themes(uuid,uuid,bigint,uuid[],jsonb) from public,anon,authenticated;
grant execute on function public.finish_note_themes(uuid,uuid,bigint,uuid[],jsonb) to service_role;

create function public.fail_note_themes(caller_id uuid,claim_token uuid) returns void language sql security invoker set search_path='' as $$
 update private.theme_state set status='failed' where user_id=caller_id and token=claim_token and status='processing'
$$;
revoke all on function public.fail_note_themes(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fail_note_themes(uuid,uuid) to service_role;
