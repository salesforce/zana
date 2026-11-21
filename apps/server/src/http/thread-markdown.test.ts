import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
vi.mock('@zana-ai/zcc-db', () => ({ getConversationThread: vi.fn(), getEnvironment: vi.fn(), getPrimaryHost: vi.fn(() => ({ id: 'h1' })) }));
import { getConversationThread, getEnvironment } from '@zana-ai/zcc-db';
import { readThreadMarkdown, writeThreadMarkdown } from './thread-markdown.js';
import type { ProductHttpContext } from './product-context.js';

const hash = 'a'.repeat(64);
const rpc = vi.fn();
const ctx = { db: {}, toProjects: () => [{ id: 'p1', path: '/project', hostId: 'h1', name: 'P' }], hostHub: { callHostOnlineRpc: rpc, resolveHostId: (id: string) => id } } as unknown as ProductHttpContext;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getConversationThread).mockReturnValue({ id: 't1', projectId: 'p1', hostId: 'h1', environmentId: 'e1' } as never);
  vi.mocked(getEnvironment).mockReturnValue({ id: 'e1', path: '/worktree', hostId: 'h1', projectId: 'p1', status: 'ready' } as never);
});

describe('thread Markdown authority', () => {
  it('reads the owning environment and hashes the exact bytes', async () => {
    rpc.mockResolvedValueOnce({ content: '\uFEFF# One\r\n', encoding: 'utf8' });
    expect(await readThreadMarkdown(ctx, 't1', { path: 'README.md', projectId: 'ignored' })).toEqual({ ok: true, content: '\uFEFF# One\r\n', bytes: Buffer.byteLength('\uFEFF# One\r\n'), sha256: createHash('sha256').update('\uFEFF# One\r\n').digest('hex') });
    expect(rpc).toHaveBeenCalledWith({ hostId: 'h1', command: { type: 'host.read_file', root: '/worktree', relPath: 'README.md' } });
  });
  it('writes atomically through the same host root and required revision', async () => {
    rpc.mockResolvedValueOnce({ outcome: 'written', sha256: hash, sizeBytes: 5 });
    expect(await writeThreadMarkdown(ctx, 't1', { path: 'README.md', content: 'draft', expectedSha256: hash })).toEqual({ ok: true, sha256: hash, bytes: 5 });
    expect(rpc).toHaveBeenCalledWith({ hostId: 'h1', command: { type: 'host.write_file', rootPath: '/worktree', path: '/worktree/README.md', content: 'draft', contentEncoding: 'utf8', createParents: false, expectedSha256: hash } });
  });
  it('reports conflict without overwriting or retrying', async () => {
    rpc.mockResolvedValueOnce({ outcome: 'conflict', currentSha256: 'b'.repeat(64) });
    expect(await writeThreadMarkdown(ctx, 't1', { path: 'README.md', content: 'draft', expectedSha256: hash })).toMatchObject({ ok: false, message: expect.stringContaining('changed') });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each(['../secret.md', '/project/README.md', '/etc/file.md', 'file.txt', 'file.mdx', 'file.md\0', ''])('rejects untrusted path %s before dispatch', async path => {
    await expect(readThreadMarkdown(ctx, 't1', { path })).rejects.toMatchObject({ status: expect.any(Number) });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{ path: 'a.md', content: 'draft' }, { path: 'a.md', content: 'draft', expectedSha256: null }, { path: 'a.md', content: 'draft', expectedSha256: hash, root: '/elsewhere' }, { path: 'a.md', content: 'é'.repeat(1_000_001), expectedSha256: hash }])('rejects missing revision, supplied roots, and oversized bytes', async input => {
    await expect(writeThreadMarkdown(ctx, 't1', input)).rejects.toMatchObject({ status: 400 }); expect(rpc).not.toHaveBeenCalled();
  });
  it('rejects unavailable, mismatched and unknown environments', async () => {
    for (const patch of [{ status: 'failed' }, { hostId: 'other' }, { projectId: 'other' }, { path: '' }]) {
      vi.mocked(getEnvironment).mockReturnValue({ id: 'e1', path: '/worktree', hostId: 'h1', projectId: 'p1', status: 'ready', ...patch } as never);
      await expect(readThreadMarkdown(ctx, 't1', { path: 'a.md' })).rejects.toMatchObject({ status: 409 });
    }
    vi.mocked(getConversationThread).mockReturnValue({ projectId: 'missing' } as never);
    await expect(readThreadMarkdown(ctx, 't1', { path: 'a.md' })).rejects.toMatchObject({ status: 403 });
    expect(rpc).not.toHaveBeenCalled();
  });
  it('uses the registered project for CLI previews and fails closed for missing scope', async () => {
    vi.mocked(getConversationThread).mockReturnValue(null);
    await expect(readThreadMarkdown(ctx, 'cli', { path: 'a.md' })).rejects.toMatchObject({ status: 403 });
    rpc.mockResolvedValueOnce({ content: 'CLI', encoding: 'utf8' });
    await readThreadMarkdown(ctx, 'cli', { path: 'a.md', projectId: 'p1' });
    expect(rpc).toHaveBeenCalledWith({ hostId: 'h1', command: { type: 'host.read_file', root: '/project', relPath: 'a.md' } });
  });
  it('retains Windows host path semantics on a POSIX server', async () => {
    vi.mocked(getEnvironment).mockReturnValue({ id: 'e1', path: 'C:\\repo', hostId: 'h1', projectId: 'p1', status: 'ready' } as never);
    rpc.mockResolvedValueOnce({ outcome: 'written', sha256: hash, sizeBytes: 5 });
    await writeThreadMarkdown(ctx, 't1', { path: 'docs/a.md', content: 'draft', expectedSha256: hash });
    expect(rpc.mock.lastCall![0].command.path).toBe('C:\\repo\\docs\\a.md');
  });
  it.each([{ content: 'binary', encoding: 'base64' }, { content: 'x'.repeat(2_000_001), encoding: 'utf8' }])('rejects binary and oversized host results', async result => {
    rpc.mockResolvedValueOnce(result);
    await expect(readThreadMarkdown(ctx, 't1', { path: 'a.md' })).rejects.toMatchObject({ status: 413 });
  });
  it('propagates host disconnection without another dispatch', async () => {
    rpc.mockRejectedValueOnce(new Error('offline'));
    await expect(readThreadMarkdown(ctx, 't1', { path: 'a.md' })).rejects.toThrow('offline');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
