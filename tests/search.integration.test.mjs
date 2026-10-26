import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { createNotesRepository } from '../src/lib/notes-repository.ts';
import { createSearchRepository } from '../src/lib/search-repository.ts';

// Two empty confirmed disposable accounts; only public app configuration is used.
test('live search: authenticated retrieval, context, edits, deletion, pagination and owner isolation', {
  skip: !process.env.TWINKLE_TEST_FIXTURES,
}, async () => {
  const users = JSON.parse(await readFile(process.env.TWINKLE_TEST_FIXTURES, 'utf8'));
  const makeClient = () => createClient(process.env.EXPO_PUBLIC_SUPABASE_URL,
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const a = makeClient(), b = makeClient(), fresh = makeClient(), anonymous = makeClient();
  const ids = [];
  const notes = createNotesRepository(a), search = createSearchRepository(a);
  async function login(api, user) {
    const result = await api.auth.signInWithPassword({ email: user.email, password: user.password });
    assert.ifError(result.error);
    assert.equal(result.data.user.id, user.id);
  }
  try {
    await login(a, users[0]); await login(b, users[1]);
    assert.equal((await notes.list(users[0].id)).length, 0, 'Use empty disposable accounts');
    assert.equal((await createNotesRepository(b).list(users[1].id)).length, 0, 'Use empty disposable accounts');
    const note = await notes.save(users[0].id, 'Orion internship\nI plan to compare mentorship and portfolio experience.');
    ids.push(note.id);
    const other = await createNotesRepository(b).save(users[1].id, 'Orion telescope belongs only to the second account.');
    ids.push(other.id);
    const first = await search.search('Orion intern');
    assert.equal(first.results[0].id, note.id);
    assert.equal((await notes.get(users[0].id, first.results[0].id)).content, note.content);
    assert.equal((await search.search('"Orion internship"')).results[0].id, note.id);
    assert.ifError((await a.from('note_contexts').update({ user_context: 'Camden fellowship application' }).eq('note_id', note.id)).error);
    const context = await search.search('Camden');
    assert.equal(context.results[0].id, note.id);
    assert.equal(context.results[0].matched_context, true);
    assert.equal((await notes.get(users[0].id, note.id)).updated_at, note.updated_at);
    assert.ifError((await a.from('note_contexts').update({ user_context: '' }).eq('note_id', note.id)).error);
    assert.deepEqual((await search.search('Camden')).results, []);
    const edited = await notes.save(users[0].id, 'Basalt research\nA revised thought about a rock collection.', note);
    assert.deepEqual((await search.search('internship')).results, []);
    assert.equal((await search.search('Basalt')).results[0].id, edited.id);
    await login(fresh, users[0]);
    assert.equal((await createSearchRepository(fresh).search('Basalt')).results[0].id, edited.id);
    assert.deepEqual((await createSearchRepository(b).search('Basalt')).results, []);
    assert.deepEqual((await b.from('note_search_documents').select('note_id').eq('note_id', note.id)).data, []);
    assert.ok((await b.from('note_search_documents').update({ title: 'Forged' }).eq('note_id', note.id)).error);
    assert.ok((await anonymous.rpc('search_notes', { search_text: 'Basalt' })).error);
    const created = await Promise.all(Array.from({ length: 35 }, (_, i) => notes.save(users[0].id, `Searchfixture fragment ${i}\nAn idea about stargazing.`)));
    ids.push(...created.map((row) => row.id));
    const p1 = await search.search('searchfixture');
    const p2 = await search.search('searchfixture', 20);
    assert.equal(p1.results.length, 20); assert.equal(p1.hasMore, true);
    assert.equal(p2.results.length, 15); assert.equal(p2.hasMore, false);
    assert.equal(new Set([...p1.results, ...p2.results].map((row) => row.id)).size, 35);
    await notes.delete(users[0].id, edited);
    assert.deepEqual((await search.search('Basalt')).results, []);
    assert.deepEqual((await a.from('note_search_documents').select('note_id').eq('note_id', note.id)).data, []);
    assert.deepEqual((await search.search('unrelatedunknownword')).results, []);
  } finally {
    if (ids.length) {
      assert.ifError((await a.from('notes').delete().in('id', ids)).error);
      assert.ifError((await b.from('notes').delete().in('id', ids)).error);
    }
    await Promise.all([a, b, fresh].map((api) => api.auth.signOut()));
  }
});
