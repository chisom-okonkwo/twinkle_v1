-- Retain public identities/feedback and the small whitespace helper; retire the old processing API.
drop function public.claim_note_themes(uuid,boolean,boolean);
drop function public.finish_note_themes(uuid,uuid,bigint,uuid[],jsonb);
drop function public.fail_note_themes(uuid,uuid);
drop function public.note_theme_candidates(uuid,uuid,text[]);
drop function private.invalidate_note_themes();
drop function private.theme_eligible(uuid,uuid);
drop table private.theme_checked;
notify pgrst,'reload schema';
