-- Bound retained scope state without blocking daily Recent use after a month.
create or replace function public.prepare_semantic_scope(caller_id uuid,period text default 'all',range_start timestamptz default null,range_end timestamptz default null,zone text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare bounds jsonb;key text;
begin
 if not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then raise exception 'CONTEXT_DISABLED';end if;
 bounds=private.semantic_time_bounds(caller_id,period,range_start,range_end,zone);key=bounds->>'key';
 if not exists(select 1 from private.semantic_scopes where user_id=caller_id and scope_key=key) and (select count(*) from private.semantic_scopes where user_id=caller_id)>31 then
  delete from private.semantic_scopes where user_id=caller_id and scope_key<>'all' and created_at<now()-interval '7 days';
  if (select count(*) from private.semantic_scopes where user_id=caller_id)>31 then raise exception 'SCOPE_LIMIT';end if;
 end if;
 insert into private.semantic_scopes(user_id,scope_key,range_start,range_end,timezone) values(caller_id,key,(bounds->>'start')::timestamptz,(bounds->>'end')::timestamptz,bounds->>'timezone') on conflict(user_id,scope_key) do nothing;
 return bounds;
end $$;
notify pgrst,'reload schema';
