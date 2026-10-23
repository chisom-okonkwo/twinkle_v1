import assert from 'node:assert/strict';
import test from 'node:test';
import { createChunkedStorage } from '../src/lib/chunked-storage.ts';

function fixture() {
  const items = new Map();
  let fail = false;
  const adapter = createChunkedStorage({
    async getItem(key) { return items.get(key) ?? null; },
    async setItem(key, value) {
      if (fail) throw new Error('Device storage unavailable');
      assert.ok(Buffer.byteLength(value) < 2048);
      items.set(key, value);
    },
    async removeItem(key) { items.delete(key); },
  });
  return { items, adapter, failWrites: () => { fail = true; } };
}

test('large Unicode sessions survive save, restore, refresh, and sign-out', async () => {
  const { items, adapter } = fixture();
  const session = JSON.stringify({ access_token: 'a'.repeat(3500), metadata: '✨🌻'.repeat(1200) });
  assert.equal(await adapter.getItem('session'), null);
  await adapter.setItem('session', session);
  assert.equal(await adapter.getItem('session'), session);
  await adapter.setItem('session', 'refreshed');
  assert.equal(await adapter.getItem('session'), 'refreshed');
  assert.equal(items.size, 2);
  await adapter.removeItem('session');
  assert.equal(await adapter.getItem('session'), null);
  assert.equal(items.size, 0);
});

test('failed refresh preserves the previously stored session', async () => {
  const { adapter, failWrites } = fixture();
  await adapter.setItem('session', 'previous session');
  failWrites();
  await assert.rejects(adapter.setItem('session', 'replacement'), /unavailable/);
  assert.equal(await adapter.getItem('session'), 'previous session');
});

test('partial session is reported rather than returned as valid credentials', async () => {
  const { items, adapter } = fixture();
  await adapter.setItem('session', 'a'.repeat(3000));
  items.delete([...items.keys()].find((key) => key !== 'session'));
  await assert.rejects(adapter.getItem('session'), /restore/);
});
