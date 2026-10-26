-- Share recent-view history without changing Cron, notification windows, cadence or delivery.
do $migration$
declare definition text; original text; scan_guard text; reserve_guard text;
begin
 select pg_get_functiondef('public.recall_service(text,uuid,jsonb)'::regprocedure) into definition;
 original=definition;
 scan_guard='and not exists(select 1 from public.flashbacks h where h.user_id=owner_id and h.note_id=candidate_note.id and h.created_at>now()-interval ''90 days'')';
 if strpos(definition,scan_guard)=0 then raise exception 'Recall scan changed; review history integration.'; end if;
 definition=replace(definition,scan_guard,scan_guard||E'\n       and not exists(select 1 from public.note_discovery_history seen where seen.user_id=owner_id and seen.note_id=candidate_note.id and seen.shown_at>now()-case when seen.dismissed then interval ''30 days'' else interval ''7 days'' end)');
 reserve_guard='or exists(select 1 from public.flashbacks where user_id=owner_id and note_id=n.id and created_at>now()-interval ''90 days'') then return ''null''; end if;';
 if strpos(definition,reserve_guard)=0 then raise exception 'Recall reservation changed; review history integration.'; end if;
 definition=replace(definition,reserve_guard,'or exists(select 1 from public.flashbacks where user_id=owner_id and note_id=n.id and created_at>now()-interval ''90 days'') or exists(select 1 from public.note_discovery_history seen where seen.user_id=owner_id and seen.note_id=n.id and seen.shown_at>now()-case when seen.dismissed then interval ''30 days'' else interval ''7 days'' end) then return ''null''; end if;');
 -- Coordinate selections with discovery's short owner lock, before recall's row locks.
 definition=replace(definition,E'begin\n if action=',E'begin\n if action in (''scan'',''reserve'') then perform pg_advisory_xact_lock(hashtextextended(owner_id::text,1617)); end if;\n if action=');
 if definition=original then raise exception 'No history integration applied.'; end if;
 execute definition;
end
$migration$;
