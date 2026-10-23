create index flashbacks_note_fk on public.flashbacks(note_id);
create index push_deliveries_device_fk on private.push_deliveries(installation_id);
create index push_deliveries_owner_fk on private.push_deliveries(user_id);
