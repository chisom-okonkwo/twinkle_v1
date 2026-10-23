-- Keep existing media, ownership policies, and the five-minute recording limit.
alter table public.note_captures drop constraint note_captures_byte_size_check;
alter table public.note_captures add constraint note_captures_byte_size_check
  check (byte_size between 1 and case when kind='image' then 20971520 else 5242880 end);
update storage.buckets set file_size_limit=20971520 where id='note-media';
