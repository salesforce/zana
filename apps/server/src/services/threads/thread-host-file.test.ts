import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ThreadCreateError } from '../../http/thread-create.js';
import { ProjectFsError } from '../../http/project-fs-via-host.js';

vi.mock('@zana-ai/zcc-db', () => ({
  getConversationThread: vi.fn(),
  getEnvironment: vi.fn()
}));

import { getConversationThread, getEnvironment } from '@zana-ai/zcc-db';
import { IMAGE_READ_MAX_BYTES, readThreadHostFile } from './thread-host-file.js';
import type { ProductHttpContext } from '../../http/product-context.js';

describe('readThreadHostFile', () => {
  it('404s for an unknown thread', async () => {
    vi.mocked(getConversationThread).mockReturnValueOnce(null);
    await expect(readThreadHostFile({ db: {} } as ProductHttpContext, 'missing', 'README.md'))
      .rejects.toBeInstanceOf(ThreadCreateError);
  });

  it('rejects paths outside the environment root', async () => {
    vi.mocked(getConversationThread).mockReturnValueOnce({
      id: 't1',
      environmentId: 'e1',
      hostId: 'h1'
    } as never);
    vi.mocked(getEnvironment).mockReturnValueOnce({ path: '/tmp/env' } as never);
    await expect(readThreadHostFile({ db: {} } as ProductHttpContext, 't1', '../secret'))
      .rejects.toBeInstanceOf(ProjectFsError);
  });

  it('409s when the environment is not ready', async () => {
    vi.mocked(getConversationThread).mockReturnValueOnce({
      id: 't1',
      environmentId: 'e1',
      hostId: 'h1'
    } as never);
    vi.mocked(getEnvironment).mockReturnValueOnce({ path: null } as never);
    await expect(readThreadHostFile({ db: {} } as ProductHttpContext, 't1', 'README.md'))
      .rejects.toBeInstanceOf(ThreadCreateError);
  });

  it('maps host path_not_found and too_large errors', async () => {
    vi.mocked(getConversationThread).mockReturnValue({
      id: 't1',
      environmentId: 'e1',
      hostId: 'h1'
    } as never);
    vi.mocked(getEnvironment).mockReturnValue({ path: '/tmp/env' } as never);
    const missing = {
      db: {},
      hostHub: {
        callHostOnlineRpc: vi.fn(async () => {
          throw { code: 'path_not_found' };
        })
      }
    } as unknown as ProductHttpContext;
    await expect(readThreadHostFile(missing, 't1', 'gone.ts')).rejects.toBeInstanceOf(ProjectFsError);
    const huge = {
      db: {},
      hostHub: {
        callHostOnlineRpc: vi.fn(async () => {
          throw { code: 'too_large' };
        })
      }
    } as unknown as ProductHttpContext;
    await expect(readThreadHostFile(huge, 't1', 'big.bin')).rejects.toBeInstanceOf(ProjectFsError);
  });

  it('reads a confined file through the host', async () => {
    vi.mocked(getConversationThread).mockReturnValueOnce({
      id: 't1',
      environmentId: 'e1',
      hostId: 'h1'
    } as never);
    vi.mocked(getEnvironment).mockReturnValueOnce({ path: '/tmp/env' } as never);
    const ctx = {
      db: {},
      hostHub: {
        callHostOnlineRpc: vi.fn(async () => ({ content: '<svg />', encoding: 'utf8' }))
      }
    } as unknown as ProductHttpContext;
    const file = await readThreadHostFile(ctx, 't1', 'logo.svg');
    expect(file.relPath).toBe('logo.svg');
    expect(file.contentType).toBe('image/svg+xml');
    expect(file.encoding).toBe('utf8');
    expect(file.content).toContain('svg');
  });

  it('passes through host base64 encoding for raster images', async () => {
    vi.mocked(getConversationThread).mockReturnValueOnce({
      id: 't1',
      environmentId: 'e1',
      hostId: 'h1'
    } as never);
    vi.mocked(getEnvironment).mockReturnValueOnce({ path: '/tmp/env' } as never);
    const ctx = {
      db: {},
      hostHub: {
        callHostOnlineRpc: vi.fn(async () => ({ content: 'iVBORw0KGgo=', encoding: 'base64' }))
      }
    } as unknown as ProductHttpContext;
    const file = await readThreadHostFile(ctx, 't1', 'shot.png');
    expect(file.contentType).toBe('image/png');
    expect(file.encoding).toBe('base64');
    expect(file.content).toBe('iVBORw0KGgo=');
  });
});

describe('uploaded attachment previews', () => {
  let dataDir: string;
  let root: string;
  let ctx: ProductHttpContext;
  const hostRead = vi.fn(async () => ({ content: 'checkout file', encoding: 'utf8' }));

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'thread-attachment-preview-'));
    root = join(dataDir, 'attachments', 'p1');
    await mkdir(root, { recursive: true });
    vi.mocked(getConversationThread).mockReturnValue({
      id: 't1', projectId: 'p1', environmentId: 'e1', hostId: 'remote-host'
    } as never);
    vi.mocked(getEnvironment).mockReturnValue({ path: '/remote/checkout' } as never);
    hostRead.mockClear();
    ctx = { db: {}, dataDir, hostHub: { callHostOnlineRpc: hostRead } } as unknown as ProductHttpContext;
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('reads an uploaded image even when the remote environment is unavailable', async () => {
    const path = join(root, 'pasted.png');
    const bytes = Buffer.from([137, 80, 78, 71, 0, 255]);
    await writeFile(path, bytes);
    vi.mocked(getEnvironment).mockReturnValue(null);
    expect(await readThreadHostFile(ctx, 't1', path)).toEqual({
      path, relPath: 'pasted.png', content: bytes.toString('base64'),
      encoding: 'base64', contentType: 'image/png'
    });
    expect(hostRead).not.toHaveBeenCalled();
  });

  it('reads uploaded text but keeps relative paths scoped to the host checkout', async () => {
    const path = join(root, 'notes.txt');
    await writeFile(path, 'Uploaded notes');
    expect(await readThreadHostFile(ctx, 't1', path)).toMatchObject({
      content: 'Uploaded notes', encoding: 'utf8', contentType: null
    });
    expect(await readThreadHostFile(ctx, 't1', 'notes.txt')).toMatchObject({ content: 'checkout file' });
    expect(hostRead).toHaveBeenCalledWith({
      hostId: 'remote-host', command: { type: 'host.read_file', root: '/remote/checkout', relPath: 'notes.txt' }
    });
  });

  it('rejects another project, sibling-prefix paths and traversal outside the attachment root', async () => {
    for (const candidate of [
      join(dataDir, 'attachments', 'p2', 'private.png'),
      join(dataDir, 'attachments', 'p1-other', 'private.png'),
      `${root}/../../secret.png`,
      root
    ]) {
      await expect(readThreadHostFile(ctx, 't1', candidate)).rejects.toMatchObject({ status: 403 });
    }
    expect(hostRead).not.toHaveBeenCalled();
  });

  it('rejects symlink escapes, missing files and directories', async () => {
    const outside = join(dataDir, 'private.png');
    await writeFile(outside, 'secret');
    await symlink(outside, join(root, 'escape.png'));
    await mkdir(join(root, 'directory'));
    for (const name of ['escape.png', 'missing.png', 'directory']) {
      await expect(readThreadHostFile(ctx, 't1', join(root, name))).rejects.toMatchObject({ status: 404 });
    }
    expect(hostRead).not.toHaveBeenCalled();
  });

  it.each([['huge.png', IMAGE_READ_MAX_BYTES], ['huge.txt', 2_000_000]])(
    'bounds %s reads', async (name, cap) => {
      const path = join(root, name);
      await writeFile(path, Buffer.alloc(cap + 1));
      await expect(readThreadHostFile(ctx, 't1', path)).rejects.toMatchObject({ status: 413 });
    }
  );

  it('allows an image at the exact read cap', async () => {
    const path = join(root, 'limit.png');
    await writeFile(path, Buffer.alloc(IMAGE_READ_MAX_BYTES));
    const file = await readThreadHostFile(ctx, 't1', path);
    expect(Buffer.from(file.content, 'base64')).toHaveLength(IMAGE_READ_MAX_BYTES);
  });
});
