import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentDigest, createExecutionArtifactStore } from '../artifact-store.js';

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-execution-artifacts-'));
  try { await run(join(dir, 'artifacts.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const artifact = { executionId: 'execution-1', attempt: 1, projectId: 'project-1', name: 'result.json', mediaType: 'application/json', content: '{"ok":true}' };

describe('execution artifact store', () => {
  it('stores content-addressed records and replays identical writes', async () => fixture(async (filePath) => {
    const store = createExecutionArtifactStore({ filePath, id: () => 'artifact-1' });
    const first = await store.put(artifact);
    expect(first).toMatchObject({ outcome: 'stored', record: { id: 'artifact-1', contentDigest: contentDigest(artifact.content) } });
    expect(await store.put(artifact)).toMatchObject({ outcome: 'replay', record: { id: 'artifact-1' } });
  }));

  it('rejects same artifact name with changed content and isolates projects', async () => fixture(async (filePath) => {
    const store = createExecutionArtifactStore({ filePath });
    await store.put(artifact);
    expect(await store.put({ ...artifact, content: '{"ok":false}' })).toMatchObject({ outcome: 'conflict' });
    expect(await store.list('execution-1', 'other-project')).toEqual([]);
    expect(await store.get('execution-1', 'other-project', 'result.json')).toBeUndefined();
  }));

  it('rejects content exceeding the UTF-8 byte limit', async () => fixture(async (filePath) => {
    const store = createExecutionArtifactStore({ filePath });
    await expect(store.put({ ...artifact, content: '€'.repeat(30_000) })).rejects.toThrow('invalid execution artifact content');
  }));

  it('bounds artifacts per execution without another execution bricking the store', async () => fixture(async (filePath) => {
    let id = 0;
    const store = createExecutionArtifactStore({ filePath, id: () => `artifact-${++id}`, maxRecords: 4, maxRecordsPerExecution: 2 });
    for (let index = 0; index < 5; index += 1) await store.put({ ...artifact, name: `one-${index}.json`, content: String(index) });
    await expect(store.put({ ...artifact, executionId: 'execution-2', name: 'two.json' })).resolves.toMatchObject({ outcome: 'stored' });
    expect(await store.list('execution-1', 'project-1')).toHaveLength(2);
    expect(await store.list('execution-2', 'project-1')).toHaveLength(1);
  }));
});
