-- Separate the cached-run record from response-link table aliases.
-- Qualify cooldown columns independently of the snapshot status variable.
create or replace function private.read_reflection_experience(kind text,target uuid) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare owner_id uuid=auth.uid();input jsonb;cached private.reflection_runs;p private.reflective_prompts;responses jsonb;status text;prompt jsonb=null;can_prompt boolean=false;
begin
 if owner_id is null or kind not in ('note','theme') then raise insufficient_privilege;end if;
 if kind='note' and not exists(select 1 from public.notes where id=target and user_id=owner_id) or kind='theme' and not exists(select 1 from public.note_themes where id=target and user_id=owner_id and not dismissed) then raise exception 'NOT_FOUND';end if;
 input=private.reflection_input(owner_id,kind,target);
 select * into cached from private.reflection_runs where user_id=owner_id and scope=kind and target_id=target;
 status=case when input is null then 'disabled' when jsonb_array_length(input)<2 then 'insufficient'
 when cached.input_hash=private.reflection_fingerprint(input) then case when cached.status='processing' and cached.started_at<now()-interval '2 minutes' then 'failed' else cached.status end else 'not_started' end;
 if kind='note' then
  select * into p from private.reflective_prompts where note_id=target and user_id=owner_id;
  if input is not null and p.status='ready' and p.input_hash=private.reflection_fingerprint(private.reflection_input(owner_id,'prompt',target)) then
   prompt=jsonb_build_object('id',p.id,'question',p.question,'quote',p.quote);
  end if;
  can_prompt=input is not null and (p.note_id is null or p.status='failed' and p.attempts<3) and exists(select 1 from jsonb_array_elements(input)n where n->>'id'=target::text and (n->>'captured_at')::timestamptz<=now()-interval '14 days')
  and not exists(select 1 from private.reflective_prompts history where history.user_id=owner_id and history.note_id<>target and (history.offered_at>now()-interval '7 days' or history.status='processing' and history.started_at>now()-interval '2 minutes'));
  select coalesce(jsonb_agg(jsonb_build_object('id',r.response_note_id,'question',r.question,'created_at',r.created_at,'title',n.title,'preview',left(n.content,320)) order by r.created_at desc),'[]') into responses
  from public.note_reflections r join public.notes n on n.id=r.response_note_id and n.user_id=r.user_id where r.original_note_id=target and r.user_id=owner_id;
 end if;
 return jsonb_build_object('status',status,'comparisons',case when status='completed' then cached.comparisons else '[]'::jsonb end,
 'notes',coalesce((select jsonb_agg(jsonb_build_object('id',n->>'id','title',n->>'title','captured_at',n->>'captured_at')) from jsonb_array_elements(input)n),'[]'),
 'prompt',prompt,'can_prompt',coalesce(can_prompt,false),'prompt_status',case when p.status='processing' and p.started_at<now()-interval '2 minutes' then 'failed' else p.status end,'responses',coalesce(responses,'[]'));
end $$;
