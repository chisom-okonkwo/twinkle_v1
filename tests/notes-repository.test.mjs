import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { createNotesRepository, MAX_NOTE_LENGTH, NoteConflictError, validateNoteContent } from '../src/lib/notes-repository.ts';

function fixture(response, status = 200) {
  const requests = [];
  const client = createClient('https://test.supabase.co', 'sb_publishable_test', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url, init) => {
      requests.push({ url: new URL(url), method: init.method, body: init.body ? JSON.parse(init.body) : null });
      return new Response(JSON.stringify(response), { status, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  return { repository: createNotesRepository(client), requests };
}

test('blank and oversized notes are rejected, while Unicode and original whitespace remain valid', () => {
  for (const content of ['', ' \t\n', '\u2003']) assert.throws(() => validateNoteContent(content), /Write something/);
  assert.throws(() => validateNoteContent('a'.repeat(MAX_NOTE_LENGTH + 1)), /100,000/);
  assert.doesNotThrow(() => validateNoteContent('🌻'.repeat(MAX_NOTE_LENGTH)));
});

test('creation preserves original content and binds the authenticated owner', async () => {
  const content = '  A thought\n🌻 Keep the original spacing.\n';
  const { repository, requests } = fixture({ id: 'note', content });
  const saved = await repository.save('owner', content);
  assert.equal(saved.content, content);
  assert.deepEqual(requests[0].body, { user_id: 'owner', content });
  assert.equal(requests[0].method, 'POST');
});

test('pagination orders by edited time and ID, scopes ownership, and uses a stable cursor', async () => {
  const { repository, requests } = fixture([]);
  const cursor = { id: 'abc', updated_at: '2026-10-23T10:20:30.123456+00:00' };
  await repository.list('owner', cursor);
  const params = requests[0].url.searchParams;
  assert.equal(params.get('user_id'), 'eq.owner');
  assert.equal(params.get('order'), 'updated_at.desc,id.desc');
  assert.equal(params.get('limit'), '30');
  assert.match(params.get('or'), /updated_at\.lt\./);
  assert.match(params.get('or'), /id\.lt\.abc/);
  assert.equal(params.has('offset'), false);
});

test('stale edits and deletes raise a conflict instead of claiming success', async () => {
  const { repository, requests } = fixture(null);
  const previous = { id: 'note', updated_at: '2026-10-23T10:20:30Z' };
  await assert.rejects(repository.save('owner', 'Updated', previous), NoteConflictError);
  await assert.rejects(repository.delete('owner', previous), NoteConflictError);
  for (const request of requests) {
    assert.equal(request.url.searchParams.get('id'), 'eq.note');
    assert.equal(request.url.searchParams.get('user_id'), 'eq.owner');
    assert.equal(request.url.searchParams.get('updated_at'), `eq.${previous.updated_at}`);
  }
});

test('missing notes and API errors are surfaced for retry', async () => {
  await assert.rejects(fixture([]).repository.get('owner', 'missing'), /no longer available/);
  const { repository } = fixture({ message: 'Network unavailable', code: '503' }, 503);
  await assert.rejects(repository.list('owner'), { message: 'Network unavailable' });
});
