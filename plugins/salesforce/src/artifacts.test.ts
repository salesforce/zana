import { describe, expect, it } from 'vitest';
import { createMemoryArtifactStore } from '../lib/artifacts.js';

describe('artifacts', () => {
  it('stores compact payloads by id', async () => {
    const store = createMemoryArtifactStore();
    const id = await store.put('soql', { records: [1, 2, 3] });
    expect(id).toMatch(/^soql-/);
    await expect(store.get(id)).resolves.toEqual({ records: [1, 2, 3] });
  });
});
