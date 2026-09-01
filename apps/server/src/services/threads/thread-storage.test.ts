import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@zana-ai/zcc-db', () => ({
  getConversationThread: vi.fn()
}));

import { getConversationThread } from '@zana-ai/zcc-db';
import { listThreadStorageFiles, readThreadStorageFile, threadStorageRoot } from './thread-storage.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { ProjectFsError } from '../../http/project-fs-via-host.js';
import type { ProductHttpContext } from '../../http/product-context.js';

describe('thread storage', () => {
  it('lists confined files and reads content', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-storage-'));
    vi.mocked(getConversationThread).mockReturnValue({ id: 'thr_storage' } as never);
    const ctx = { dataDir, db: {} } as unknown as ProductHttpContext;
    const root = threadStorageRoot(dataDir, 'thr_storage');
    mkdirSync(join(root, 'notes'), { recursive: true });
    writeFileSync(join(root, 'notes', 'a.md'), '# hello');
    const listed = await listThreadStorageFiles(ctx, 'thr_storage');
    expect(listed.files).toEqual([{ path: 'notes/a.md', name: 'a.md' }]);
    const file = await readThreadStorageFile(ctx, 'thr_storage', 'notes/a.md');
    expect(file.content).toContain('hello');
    expect(file.encoding).toBe('utf8');
  });

  it('reads a confined image as base64', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-storage-img-'));
    vi.mocked(getConversationThread).mockReturnValue({ id: 'thr_storage' } as never);
    const ctx = { dataDir, db: {} } as unknown as ProductHttpContext;
    const root = threadStorageRoot(dataDir, 'thr_storage');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const file = await readThreadStorageFile(ctx, 'thr_storage', 'shot.png');
    expect(file.encoding).toBe('base64');
    expect(file.contentType).toBe('image/png');
    expect(Buffer.from(file.content, 'base64')).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it('rejects missing threads and path escapes', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-storage-'));
    vi.mocked(getConversationThread).mockReturnValueOnce(null);
    const ctx = { dataDir, db: {} } as unknown as ProductHttpContext;
    await expect(listThreadStorageFiles(ctx, 'missing')).rejects.toBeInstanceOf(ThreadCreateError);
    vi.mocked(getConversationThread).mockReturnValue({ id: 'thr_storage' } as never);
    await expect(readThreadStorageFile(ctx, 'thr_storage', '../secret')).rejects.toBeInstanceOf(ProjectFsError);
  });
});
