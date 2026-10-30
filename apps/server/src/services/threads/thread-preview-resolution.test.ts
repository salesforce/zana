import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
const h = vi.hoisted(() => ({ thread: null as any, environment: null as any }));
vi.mock('@zana-ai/zcc-db', () => ({
  getConversationThread: () => h.thread,
  getEnvironment: () => h.environment
}));
import { resolvePreviewPathCandidate, resolveThreadPreviewPath } from './thread-preview-resolution.js';

describe('resolvePreviewPathCandidate', () => {
  it('keeps explicit relative paths exact', async () => {
    const exists = vi.fn(async (path: string) => path === 'output/report.md');
    const search = vi.fn(async () => ({ paths: ['other/report.md'], truncated: false }));
    await expect(resolvePreviewPathCandidate('output/report.md', [], exists, search, true))
      .resolves.toEqual({ kind: 'resolved', path: 'output/report.md' });
    expect(search).not.toHaveBeenCalled();
  });

  it('does not search for another basename after an explicit absolute path misses', async () => {
    const exists = vi.fn(async () => false);
    const search = vi.fn(async () => ({ paths: ['other/report.md'], truncated: false }));
    await expect(resolvePreviewPathCandidate('output/report.md', [], exists, search, true))
      .resolves.toEqual({ kind: 'not_found' });
    expect(search).not.toHaveBeenCalled();
  });

  it('uses the exact root file before searching for a bare name', async () => {
    const exists = vi.fn(async (path: string) => path === 'report.md');
    const search = vi.fn();
    await expect(resolvePreviewPathCandidate('report.md', [], exists, search))
      .resolves.toEqual({ kind: 'resolved', path: 'report.md' });
    expect(search).not.toHaveBeenCalled();
  });

  it('returns ambiguity instead of selecting a duplicate basename', async () => {
    const exists = vi.fn(async () => false);
    const search = vi.fn(async () => ({ paths: ['docs/report.md', 'output/report.md'], truncated: false }));
    await expect(resolvePreviewPathCandidate('report.md', [], exists, search))
      .resolves.toEqual({ kind: 'ambiguous', paths: ['docs/report.md', 'output/report.md'] });
  });

  it('checks duplicate hints and falls through when they are stale', async () => {
    const exists = vi.fn(async (path: string) => path === 'docs/report.md');
    const search = vi.fn(async () => ({ paths: ['docs/report.md'], truncated: false }));
    await expect(resolvePreviewPathCandidate('report.md', ['old/report.md', 'docs/report.md'], exists, search))
      .resolves.toEqual({ kind: 'resolved', path: 'docs/report.md' });
    expect(search).toHaveBeenCalledOnce();
  });

  it('returns ambiguous when a single surviving hint has another match in checkout search', async () => {
    const exists = vi.fn(async (path: string) => path === 'docs/report.md');
    const search = vi.fn(async () => ({ paths: ['output/report.md'], truncated: false }));
    await expect(resolvePreviewPathCandidate('report.md', ['old/report.md', 'docs/report.md'], exists, search))
      .resolves.toEqual({ kind: 'ambiguous', paths: ['docs/report.md', 'output/report.md'] });
  });

  it('preserves distinct directory matches differing only by case on case-sensitive filesystems', async () => {
    const exists = vi.fn(async () => false);
    const search = vi.fn(async () => ({ paths: ['Docs/guide.md', 'docs/guide.md'], truncated: false }));
    await expect(resolvePreviewPathCandidate('guide.md', [], exists, search, false, false))
      .resolves.toEqual({ kind: 'ambiguous', paths: ['Docs/guide.md', 'docs/guide.md'] });
  });

  it('deduplicates case-differing hint and search matches, preferring the on-disk casing on case-insensitive filesystems', async () => {
    const exists = vi.fn(async (path: string) => path.toLowerCase() === 'docs/guide.md');
    const search = vi.fn(async () => ({ paths: ['docs/Guide.md'], truncated: false }));
    await expect(resolvePreviewPathCandidate('guide.md', ['docs/guide.md'], exists, search, false, true))
      .resolves.toEqual({ kind: 'resolved', path: 'docs/Guide.md' });
  });

  it('matches hints with differing basename casing when caseInsensitive is true', async () => {
    const exists = vi.fn(async (path: string) => path === 'docs/Guide.md');
    const search = vi.fn(async () => ({ paths: ['docs/Guide.md'], truncated: false }));
    await expect(resolvePreviewPathCandidate('guide.md', ['docs/Guide.md'], exists, search, false, true))
      .resolves.toEqual({ kind: 'resolved', path: 'docs/Guide.md' });
    expect(exists).toHaveBeenCalledWith('docs/Guide.md');
  });

  it('returns ambiguous when a single hint matches and a root file also exists', async () => {
    const exists = vi.fn(async (path: string) => path === 'docs/report.md' || path === 'report.md');
    const search = vi.fn();
    await expect(resolvePreviewPathCandidate('report.md', ['docs/report.md'], exists, search))
      .resolves.toEqual({ kind: 'ambiguous', paths: ['docs/report.md', 'report.md'] });
    expect(search).not.toHaveBeenCalled();
  });

  it('searches when every duplicate hint is stale', async () => {
    const exists = vi.fn(async () => false);
    const search = vi.fn(async () => ({ paths: ['live/report.md'], truncated: false }));
    await expect(resolvePreviewPathCandidate('report.md', ['old/report.md', 'removed/report.md'], exists, search))
      .resolves.toEqual({ kind: 'resolved', path: 'live/report.md' });
    expect(search).toHaveBeenCalledOnce();
  });

  it('does not infer uniqueness from a truncated search', async () => {
    const exists = vi.fn(async () => false);
    const search = vi.fn(async () => ({ paths: ['docs/report.md'], truncated: true }));
    await expect(resolvePreviewPathCandidate('report.md', [], exists, search))
      .resolves.toEqual({ kind: 'incomplete', paths: ['docs/report.md'] });
  });

  it('returns all existing matching hints when three or more choices exist', async () => {
    const exists = vi.fn(async (path: string) => ['docs/guide.md', 'examples/guide.md', 'archive/guide.md'].includes(path));
    const search = vi.fn();
    await expect(resolvePreviewPathCandidate('guide.md', ['docs/guide.md', 'examples/guide.md', 'archive/guide.md'], exists, search))
      .resolves.toEqual({ kind: 'ambiguous', paths: ['docs/guide.md', 'examples/guide.md', 'archive/guide.md'] });
    expect(search).not.toHaveBeenCalled();
    expect(exists).toHaveBeenCalledTimes(3);
  });

  it('caps hint search at LOOKUP_LIMIT', async () => {
    let checked = 0;
    const exists = vi.fn(async () => { checked++; return true; });
    const search = vi.fn();
    const hints = Array.from({ length: 60 }, (_, i) => `dir${i}/report.md`);
    const result = await resolvePreviewPathCandidate('report.md', hints, exists, search);
    expect(result.kind).toBe('ambiguous');
    expect(checked).toBe(50);
  });

  it('resolves unique search match and handles empty search match', async () => {
    const exists = vi.fn(async () => false);
    const search1 = vi.fn(async () => ({ paths: ['unique/report.md'], truncated: false }));
    await expect(resolvePreviewPathCandidate('report.md', [], exists, search1))
      .resolves.toEqual({ kind: 'resolved', path: 'unique/report.md' });

    const search2 = vi.fn(async () => ({ paths: [], truncated: false }));
    await expect(resolvePreviewPathCandidate('report.md', [], exists, search2))
      .resolves.toEqual({ kind: 'not_found' });
  });
});

describe('resolveThreadPreviewPath', () => {
  let rpc: ReturnType<typeof vi.fn>;
  let ctx: any;
  beforeEach(() => {
    h.thread = { id: 'thread-1', projectId: 'project-1', environmentId: 'env-1', hostId: 'linux-host' };
    h.environment = { path: '/srv/checkouts/feature' };
    rpc = vi.fn();
    ctx = { db: {}, hostHub: { callHostOnlineRpc: rpc }, toProjects: vi.fn() };
  });

  it('confines timeline hints and reads them from the thread host and environment', async () => {
    rpc.mockImplementation(async ({ command }: any) => {
      if (command.type === 'host.file_metadata') {
        if (command.path === '/srv/checkouts/feature/docs/guide.md') {
          return { sizeBytes: 12, modifiedAtMs: 1 };
        }
        throw { code: 'path_not_found' };
      }
      return { paths: [], truncated: false };
    });
    await expect(resolveThreadPreviewPath(ctx, 'thread-1', {
      path: 'guide.md', hints: ['../secret/guide.md', 'docs/guide.md']
    })).resolves.toEqual({ kind: 'resolved', path: 'docs/guide.md' });
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({
      hostId: 'linux-host',
      command: { type: 'host.file_metadata', path: '/srv/checkouts/feature/docs/guide.md', rootPath: '/srv/checkouts/feature' }
    }));
  });

  it('does not search after an explicit path is missing', async () => {
    rpc.mockRejectedValue({ code: 'path_not_found' });
    await expect(resolveThreadPreviewPath(ctx, 'thread-1', { path: 'output/report.md' }))
      .resolves.toEqual({ kind: 'not_found', path: 'output/report.md', checkedPath: '/srv/checkouts/feature/output/report.md' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]![0].command.type).toBe('host.file_metadata');
  });

  it('omits checkedPath when a bare filename is not found anywhere in checkout', async () => {
    rpc.mockImplementation(async ({ command }: any) => {
      if (command.type === 'host.file_metadata') throw { code: 'path_not_found' };
      return { paths: [], truncated: false };
    });
    await expect(resolveThreadPreviewPath(ctx, 'thread-1', { path: 'nowhere.md' }))
      .resolves.toEqual({ kind: 'not_found', path: 'nowhere.md' });
  });

  it('uses the thread environment on a Windows server when the thread host is Linux', async () => {
    h.environment.path = '/srv/checkouts/feature';
    rpc.mockRejectedValueOnce({ code: 'path_not_found' }).mockResolvedValueOnce({
      paths: [
        { kind: 'file', path: 'docs/guide.md', name: 'guide.md', score: 0, positions: [] },
        { kind: 'file', path: 'examples/guide.md', name: 'guide.md', score: 0, positions: [] }
      ], truncated: false
    });
    await expect(resolveThreadPreviewPath(ctx, 'thread-1', { path: 'guide.md' }))
      .resolves.toEqual({ kind: 'ambiguous', paths: ['docs/guide.md', 'examples/guide.md'] });
    expect(rpc.mock.calls[1]![0]).toMatchObject({
      hostId: 'linux-host',
      command: { type: 'host.list_paths', path: '/srv/checkouts/feature', exactName: 'guide.md' }
    });
  });

  it('keeps a host-confirmed Windows case-equivalent filename', async () => {
    h.environment.path = 'D:\\\\srv\\\\checkouts\\\\feature';
    rpc.mockRejectedValueOnce({ code: 'path_not_found' }).mockResolvedValueOnce({
      paths: [{ kind: 'file', path: 'docs/Guide.md', name: 'Guide.md', score: 0, positions: [] }],
      truncated: false
    });
    await expect(resolveThreadPreviewPath(ctx, 'thread-1', { path: 'guide.md' }))
      .resolves.toEqual({ kind: 'resolved', path: 'docs/Guide.md' });
  });

  it('decrements the live host search count when requests overlap', async () => {
    let releaseFirst!: (value: unknown) => void;
    let releaseSecond!: (value: unknown) => void;
    let searches = 0;
    rpc.mockImplementation((request: any) => {
      if (request.command.type === 'host.file_metadata') return Promise.reject({ code: 'path_not_found' });
      searches += 1;
      return new Promise((resolve) => {
        if (searches === 1) releaseFirst = resolve;
        else if (searches === 2) releaseSecond = resolve;
        else resolve({ paths: [], truncated: false });
      });
    });
    const first = resolveThreadPreviewPath(ctx, 'thread-1', { path: 'one.md' });
    await vi.waitFor(() => expect(searches).toBe(1));
    const second = resolveThreadPreviewPath(ctx, 'thread-1', { path: 'two.md' });
    await vi.waitFor(() => expect(searches).toBe(2));
    await expect(resolveThreadPreviewPath(ctx, 'thread-1', { path: 'blocked.md' }))
      .rejects.toMatchObject({ status: 429, code: 'preview-busy' });
    releaseFirst({ paths: [], truncated: false });
    await first;
    const third = resolveThreadPreviewPath(ctx, 'thread-1', { path: 'three.md' });
    await vi.waitFor(() => expect(searches).toBe(3));
    releaseSecond({ paths: [], truncated: false });
    await Promise.all([second, third]);
    await expect(resolveThreadPreviewPath(ctx, 'thread-1', { path: 'four.md' }))
      .resolves.toMatchObject({ kind: 'not_found' });
  });

  it('does not let the renderer substitute a different project for a thread', async () => {
    await expect(resolveThreadPreviewPath(ctx, 'thread-1', { path: 'guide.md', projectId: 'other-project' }))
      .rejects.toMatchObject({ status: 403, code: 'scope-mismatch' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('resolves attachments under the product data dir for thread previews', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'preview-data-dir-'));
    ctx.dataDir = dataDir;
    const filePath = join(dataDir, 'attachments', 'project-1', 'image.png');
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, 'png-bytes');
    await expect(resolveThreadPreviewPath(ctx, 'thread-1', { path: filePath }))
      .resolves.toEqual({ kind: 'resolved', path: filePath });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('resolves attachments under the product data dir for project-only previews', async () => {
    h.thread = null;
    ctx.toProjects = vi.fn(() => [{ id: 'project-1', path: '/srv/checkouts/project-1', remote: false, hostId: 'linux-host' }]);
    const dataDir = mkdtempSync(join(tmpdir(), 'preview-data-dir-'));
    ctx.dataDir = dataDir;
    const path = join(dataDir, 'attachments', 'project-1', 'image.png');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'png-bytes');
    await expect(resolveThreadPreviewPath(ctx, 'orphan-thread', { path, projectId: 'project-1' }))
      .resolves.toEqual({ kind: 'resolved', path });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns all existing choices when three or more duplicate hints match', async () => {
    rpc.mockResolvedValue({ sizeBytes: 12, modifiedAtMs: 1 });
    await expect(resolveThreadPreviewPath(ctx, 'thread-1', {
      path: 'guide.md',
      hints: ['docs/guide.md', 'examples/guide.md', 'archive/guide.md']
    })).resolves.toEqual({
      kind: 'ambiguous',
      paths: ['docs/guide.md', 'examples/guide.md', 'archive/guide.md']
    });
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it('falls through from a stale single hint to a live search match elsewhere', async () => {
    rpc
      .mockRejectedValueOnce({ code: 'path_not_found' })
      .mockRejectedValueOnce({ code: 'path_not_found' })
      .mockResolvedValueOnce({
        paths: [{ kind: 'file', path: 'docs/guide.md', name: 'guide.md', score: 0, positions: [] }],
        truncated: false
      });
    await expect(resolveThreadPreviewPath(ctx, 'thread-1', {
      path: 'guide.md',
      hints: ['old/guide.md']
    })).resolves.toEqual({ kind: 'resolved', path: 'docs/guide.md' });
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls[0]![0].command).toMatchObject({ type: 'host.file_metadata', path: '/srv/checkouts/feature/old/guide.md' });
    expect(rpc.mock.calls[1]![0].command).toMatchObject({ type: 'host.file_metadata', path: '/srv/checkouts/feature/guide.md' });
    expect(rpc.mock.calls[2]![0].command).toMatchObject({ type: 'host.list_paths', exactName: 'guide.md' });
  });

  it('falls through when metadata throws invalid_path or ENOTDIR for directory matches', async () => {
    rpc
      .mockRejectedValueOnce({ code: 'invalid_path' })
      .mockRejectedValueOnce({ code: 'ENOTDIR' })
      .mockResolvedValueOnce({
        paths: [{ kind: 'file', path: 'src/guide.md', name: 'guide.md', score: 0, positions: [] }],
        truncated: false
      });
    await expect(resolveThreadPreviewPath(ctx, 'thread-1', {
      path: 'guide.md',
      hints: ['docs/guide.md']
    })).resolves.toEqual({ kind: 'resolved', path: 'src/guide.md' });
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it('times out when deadline expires before checking existence', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    const start = 1_000_000;
    nowSpy.mockReturnValueOnce(start).mockReturnValue(start + 6000);
    await expect(resolveThreadPreviewPath(ctx, 'thread-1', { path: 'slow.md' }))
      .rejects.toMatchObject({ status: 504, code: 'preview-timeout' });
    nowSpy.mockRestore();
  });

  it('rethrows host errors other than path_not_found', async () => {
    rpc.mockRejectedValue({ code: 'permission_denied', message: 'EACCES' });
    await expect(resolveThreadPreviewPath(ctx, 'thread-1', { path: 'secret.md' }))
      .rejects.toMatchObject({ code: 'permission_denied' });
  });

  it('resolves via local project when thread is unknown', async () => {
    h.thread = null;
    ctx.toProjects = vi.fn(() => [{ id: 'proj-local', path: '/srv/checkouts/proj', remote: false, hostId: 'linux-host' }]);
    ctx.hostHub.resolveHostId = vi.fn(() => 'linux-host');
    rpc.mockResolvedValue({ sizeBytes: 12, modifiedAtMs: 1 });
    await expect(resolveThreadPreviewPath(ctx, 'unknown-thread', { path: 'guide.md', projectId: 'proj-local' }))
      .resolves.toEqual({ kind: 'resolved', path: 'guide.md' });
  });

  it('rejects unknown thread when project is remote or missing', async () => {
    h.thread = null;
    ctx.toProjects = vi.fn(() => [{ id: 'proj-remote', path: '/srv/remote', remote: true, hostId: 'remote-host' }]);
    await expect(resolveThreadPreviewPath(ctx, 'unknown-thread', { path: 'guide.md', projectId: 'proj-remote' }))
      .rejects.toMatchObject({ status: 404, code: 'unknown-thread' });
    await expect(resolveThreadPreviewPath(ctx, 'unknown-thread', { path: 'guide.md', projectId: 'missing-proj' }))
      .rejects.toMatchObject({ status: 404, code: 'unknown-thread' });
  });

  it('rejects unprovisioned environment', async () => {
    h.thread.environmentId = null;
    await expect(resolveThreadPreviewPath(ctx, 'thread-1', { path: 'guide.md' }))
      .rejects.toMatchObject({ status: 409, code: 'environment_not_ready' });
  });

  it('rejects paths escaping thread workspace', async () => {
    await expect(resolveThreadPreviewPath(ctx, 'thread-1', { path: 'docs/../../secret.txt' }))
      .rejects.toMatchObject({ status: 403, code: 'path-escape' });
  });

  it('rejects local preview paths that are not files or not found', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'preview-local-err-'));
    ctx.dataDir = dataDir;
    const dirPath = join(dataDir, 'attachments', 'project-1', 'sub-dir');
    mkdirSync(dirPath, { recursive: true });
    await expect(resolveThreadPreviewPath(ctx, 'thread-1', { path: dirPath }))
      .rejects.toMatchObject({ status: 404, code: 'path_not_found' });
    const missingPath = join(dataDir, 'attachments', 'project-1', 'missing.png');
    await expect(resolveThreadPreviewPath(ctx, 'thread-1', { path: missingPath }))
      .rejects.toMatchObject({ status: 404, code: 'path_not_found' });
  });
});
