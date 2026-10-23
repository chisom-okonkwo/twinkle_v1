import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { createRecallRepository } from '../src/lib/recall-repository.ts';
const enabled = !!process.env.TWINKLE_TEST_FIXTURES && !!process.env.TWINKLE_RECALL_NOTE_ID;
test(
  'live recall: concurrent selection, cached wording, privacy, preferences, feedback and stale links',
  { skip: !enabled, timeout: 90000 },
  async () => {
    const users = JSON.parse(await readFile(process.env.TWINKLE_TEST_FIXTURES, 'utf8'));
    const client = () =>
      createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    const a = client(),
      b = client(),
      fresh = client();
    for (const [api, user] of [
      [a, users[0]],
      [b, users[1]],
      [fresh, users[0]],
    ])
      assert.ifError(
        (await api.auth.signInWithPassword({ email: user.email, password: user.password })).error,
      );
    const repo = createRecallRepository(a),
      noteId = process.env.TWINKLE_RECALL_NOTE_ID;
    try {
      // Test fixture is synthetic and old enough; generated context is supplied by the operator.
      assert.ifError(
        (await a.from('context_preferences').insert({ user_id: users[0].id, enabled: true })).error,
      );
      await repo.savePreferences(users[0].id, {
        frequency: 'off',
        timezone: 'America/Chicago',
        window_start: 9,
        window_end: 20,
        detailed_previews: false,
      });
      const calls = await Promise.all([
        a.functions.invoke('flashbacks', { body: {} }),
        a.functions.invoke('flashbacks', { body: { ownerId: users[1].id } }),
      ]);
      for (const result of calls) assert.ifError(result.error);
      const list = await a.from('flashbacks').select('*').eq('note_id', noteId);
      assert.ifError(list.error);
      assert.equal(list.data.length, 1);
      const item = list.data[0];
      assert.equal(item.status, 'ready');
      assert.match(item.message, /Northstar|Atlas|learning opportunities/);
      assert.match(item.message, /You wrote:/);
      const source = (await a.from('notes').select('content').eq('id', noteId).single()).data.content;
      assert.ok(source.includes(item.quote));
      assert.equal((await b.from('flashbacks').select('*').eq('id', item.id)).data.length, 0);
      assert.ok((await b.rpc('respond_flashback', { target_id: item.id, feedback: 'irrelevant' })).error);
      assert.ok((await a.rpc('recall_service', { action: 'users' })).error);
      assert.ok((await a.from('flashbacks').update({ message: 'Forged' }).eq('id', item.id)).error);
      const cached = await a.functions.invoke('flashbacks', { body: {} });
      assert.ifError(cached.error);
      assert.equal(cached.data.id, item.id);
      assert.equal((await repo.get(users[0].id, item.id)).message, item.message);
      await repo.savePreferences(users[0].id, {
        frequency: 'few',
        timezone: 'America/Chicago',
        window_start: 12,
        window_end: 17,
        detailed_previews: true,
      });
      const restored = await createRecallRepository(fresh).preferences(users[0].id);
      assert.equal(restored.frequency, 'few');
      assert.equal(restored.window_start, 12);
      assert.equal(restored.detailed_previews, true);
      await repo.savePreferences(users[0].id, {
        frequency: 'off',
        timezone: 'America/Chicago',
        window_start: 9,
        window_end: 20,
        detailed_previews: false,
      });
      assert.equal((await a.functions.invoke('flashbacks', { body: {} })).data.id, item.id);
      await repo.feedback(item.id, 'irrelevant');
      assert.equal(await repo.get(users[0].id, item.id), null);
      assert.equal(await repo.excluded(users[0].id, noteId), true);
      const after = await a.functions.invoke('flashbacks', { body: {} });
      assert.ifError(after.error);
      assert.equal(after.data.id, null);
      const unauthorized = await client().functions.invoke('flashbacks', { body: {} });
      assert.ok(unauthorized.error);
      const scheduler = await a.functions.invoke('recall-scheduler', { body: {} });
      assert.ok(scheduler.error);
      console.log(
        'Live recall passed; wording mode:',
        item.wording,
        '(fallback remains valid if AI is unavailable). No push token was registered or notification sent.',
      );
    } finally {
      assert.ifError((await a.from('notes').delete().eq('id', noteId)).error);
      await Promise.all([a, b, fresh].map((api) => api.auth.signOut({ scope: 'local' })));
    }
  },
);
