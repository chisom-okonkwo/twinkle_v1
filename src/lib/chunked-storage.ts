export type AsyncKeyValueStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

type Manifest = { generation: string; count: number };

// Keep each encrypted value below the historical iOS 2 KB limit, even for Unicode.
// Publish the manifest last so a failed write cannot replace the previous session.
export function createChunkedStorage(store: AsyncKeyValueStore): AsyncKeyValueStore {
  async function manifest(key: string): Promise<Manifest | null> {
    const raw = await store.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }

  async function removeChunks(key: string, entry: Manifest | null) {
    if (!entry) return;
    await Promise.all(Array.from({ length: entry.count }, (_, index) =>
      store.removeItem(`${key}.${entry.generation}.${index}`)));
  }

  return {
    async getItem(key) {
      const entry = await manifest(key);
      if (!entry) return null;
      const chunks = await Promise.all(Array.from({ length: entry.count }, (_, index) =>
        store.getItem(`${key}.${entry.generation}.${index}`)));
      if (chunks.some((chunk) => chunk === null)) {
        throw new Error('Unable to restore the saved session. Please sign in again.');
      }
      return chunks.join('');
    },
    async setItem(key, value) {
      const previous = await manifest(key);
      const characters = Array.from(value);
      const generation = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const chunks = Array.from({ length: Math.ceil(characters.length / 450) }, (_, index) =>
        characters.slice(index * 450, (index + 1) * 450).join(''));
      try {
        // Sequential writes also make failure cleanup deterministic.
        for (let index = 0; index < chunks.length; index++) {
          await store.setItem(`${key}.${generation}.${index}`, chunks[index]);
        }
        await store.setItem(key, JSON.stringify({ generation, count: chunks.length }));
      } catch (error) {
        await removeChunks(key, { generation, count: chunks.length }).catch(() => {});
        throw error;
      }
      // Cleanup failure must not turn a successfully saved session into an auth failure.
      await removeChunks(key, previous).catch(() => {});
    },
    async removeItem(key) {
      const previous = await manifest(key);
      await store.removeItem(key);
      await removeChunks(key, previous);
    },
  };
}
