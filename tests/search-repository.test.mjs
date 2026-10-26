import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { createSearchRepository, normalizeSearch, SEARCH_PAGE_SIZE } from '../src/lib/search-repository.ts';

function fixture(response = [], status = 200) {
  const requests = [];
  const client = createClient('https://test.supabase.co', 'sb_publishable_test', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url, init) => {
      requests.push({ url: new URL(url), method: init.method, body: JSON.parse(init.body), signal: init.signal });
      return new Response(JSON.stringify(response), { status, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  return { repository: createSearchRepository(client), requests };
}
test('empty, whitespace and punctuation searches do not send requests', async () => {
  const { repository, requests } = fixture();
  for (const value of ['', ' \t\n\u2003', '💭 ! % _ "'])
    assert.deepEqual(await repository.search(value), { results: [], hasMore: false, nextOffset: 0 });
  assert.equal(requests.length, 0);
  assert.equal(normalizeSearch('  Atlas\n\t workshop  '), 'Atlas workshop');
});
test('search uses a bounded POST RPC without owner, note text or query in the URL', async () => {
  const { repository, requests } = fixture();
  await repository.search('  private\nphrase  ', 20);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url.pathname, '/rest/v1/rpc/search_notes');
  assert.equal(requests[0].url.search, '');
  assert.deepEqual(requests[0].body, { search_text: 'private phrase', page_limit: 21, page_offset: 20 });
});
test('one extra result determines pagination without downloading original notes', async () => {
  const rows = Array.from({ length: 21 }, (_, i) => ({ id: String(i), preview: '<b>literal text</b>' }));
  const page = await fixture(rows).repository.search('Atlas');
  assert.equal(page.results.length, SEARCH_PAGE_SIZE);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextOffset, 20);
  const shifted = await fixture(rows).repository.search('Atlas', 20);
  assert.equal(shifted.nextOffset, 40, 'Advance the server offset even when edits cause duplicate result IDs');
  assert.equal(page.results[0].preview, '<b>literal text</b>');
  assert.equal((await fixture(rows.slice(0, 20)).repository.search('Atlas')).hasMore, false);
  assert.equal((await fixture(rows).repository.search('Atlas', 980)).hasMore, false);
});
test('oversized queries and invalid pagination fail before a network request', async () => {
  const { repository, requests } = fixture();
  await assert.rejects(repository.search('x'.repeat(201)), /200/);
  for (const offset of [-1, 1.5, 1000, NaN]) await assert.rejects(repository.search('Atlas', offset));
  assert.equal(requests.length, 0);
});
test('server errors surface for retry and cancellation reaches the HTTP request', async () => {
  await assert.rejects(fixture({ message: 'Offline', code: '503' }, 503).repository.search('Atlas'), { message: 'Offline' });
  const { repository, requests } = fixture();
  const controller = new AbortController();
  await repository.search('Atlas', 0, controller.signal);
  assert.equal(requests[0].signal, controller.signal);
});
