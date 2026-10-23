import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { createNotesRepository, NoteConflictError } from '../src/lib/notes-repository.ts';

// Opt-in only. Supply two confirmed, disposable accounts in a private fixture file.
// No service-role key is used. The test deletes only notes created by these accounts.
test('live notes: owner CRUD, new-session persistence, pagination, conflicts, and RLS', {
  skip: !process.env.TWINKLE_TEST_FIXTURES,
}, async () => {
  const users = JSON.parse(await readFile(process.env.TWINKLE_TEST_FIXTURES, 'utf8'));
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  assert.ok(url && key && users.length === 2, 'Public configuration and two test accounts are required');
  const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const a = client();
  const b = client();
  const fresh = client();
  const clients = [a, b, fresh];
  const ids = [];
  const repo = createNotesRepository(a);

  async function login(api, user) {
    const { data, error } = await api.auth.signInWithPassword({ email: user.email, password: user.password });
    assert.ifError(error);
    assert.equal(data.user.id, user.id);
  }

  try {
    await login(a, users[0]);
    await login(b, users[1]);
    const content = '  Original thought\nA little room for 🌻 ideas.\n';
    const first = await repo.save(users[0].id, content);
    ids.push(first.id);
    assert.equal(first.content, content);
    assert.equal(first.user_id, users[0].id);
    assert.equal(first.capture_method, 'text');
    assert.ok(first.created_at && first.updated_at);
    const second = await repo.save(users[0].id, 'A second thought');
    ids.push(second.id);
    const edited = await repo.save(users[0].id, `${content}Edited.`, first);
    assert.equal(edited.created_at, first.created_at);
    assert.ok(Date.parse(edited.updated_at) > Date.parse(first.updated_at));
    assert.equal((await repo.list(users[0].id))[0].id, first.id);
    await assert.rejects(repo.save(users[0].id, 'Stale overwrite', first), NoteConflictError);
    await assert.rejects(repo.delete(users[0].id, first), NoteConflictError);

    // Use raw requests to test RLS itself, without the repository's owner filters.
    const foreignRead = await b.from('notes').select('*').eq('id', first.id);
    assert.ifError(foreignRead.error);
    assert.deepEqual(foreignRead.data, []);
    for (const query of [
      b.from('notes').update({ content: 'Intruder' }).eq('id', first.id).select(),
      b.from('notes').delete().eq('id', first.id).select(),
    ]) {
      const result = await query;
      assert.ifError(result.error);
      assert.deepEqual(result.data, []);
    }
    assert.ok((await b.from('notes').insert({ user_id: users[0].id, content: 'Spoof' })).error);
    assert.ok((await a.from('notes').update({ user_id: users[1].id }).eq('id', first.id)).error);
    assert.ok((await client().from('notes').select('id')).error);

    await login(fresh, users[0]);
    assert.equal((await createNotesRepository(fresh).get(users[0].id, first.id)).content, edited.content);

    for (let batch = 0; batch < 4; batch++) {
      const created = await Promise.all(Array.from({ length: 8 }, (_, index) =>
        repo.save(users[0].id, `Pagination fixture ${batch * 8 + index}`)));
      ids.push(...created.map((note) => note.id));
    }
    const page1 = await repo.list(users[0].id);
    const page2 = await repo.list(users[0].id, page1.at(-1));
    assert.equal(page1.length, 30);
    const all = [...page1, ...page2];
    assert.equal(all.length, 34);
    assert.equal(new Set(all.map((note) => note.id)).size, 34);
    assert.deepEqual(new Set(all.map((note) => note.id)), new Set(ids));
    for (let index = 1; index < all.length; index++) {
      assert.ok(all[index].updated_at <= all[index - 1].updated_at);
    }
    await repo.delete(users[0].id, edited);
    await assert.rejects(repo.get(users[0].id, first.id), /no longer available/);
    const { error } = await fresh.auth.signOut({ scope: 'local' });
    assert.ifError(error);
    assert.equal((await fresh.auth.getSession()).data.session, null);
  } finally {
    if (ids.length) {
      const { error } = await a.from('notes').delete().in('id', ids);
      assert.ifError(error);
    }
    await Promise.all(clients.map((api) => api.auth.signOut({ scope: 'local' })));
  }
});
