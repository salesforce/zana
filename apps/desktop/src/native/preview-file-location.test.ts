import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewFileLocation, type PreviewFileLocationDeps } from './preview-file-location.js';

let base: string;
let root: string;
let deps: PreviewFileLocationDeps;
beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'preview-location-')));
  root = join(base, 'project');
  await mkdir(root);
  await writeFile(join(root, 'installer #1.dmg'), 'binary');
  deps = { dataDir: join(base, 'data'), localHostId: 'local', projects: [{ id: 'p1', path: root }] as never,
    thread: vi.fn(async () => ({ hostId: 'local', cwd: root })), trustedRoot: vi.fn(async path => path === root ? root : null) };
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });
const request = (extra = {}) => ({ path: 'installer #1.dmg', source: 'workspace' as const, projectId: 'p1', ...extra });

describe('native preview file location', () => {
  it('resolves project files, absolute files and recorded thread roots without reading contents', async () => {
    const path = join(root, 'installer #1.dmg');
    await expect(previewFileLocation(request(), deps)).resolves.toEqual({ ok: true, path });
    await expect(previewFileLocation(request({ path, projectId: undefined }), deps)).resolves.toEqual({ ok: true, path });
    await expect(previewFileLocation(request({ threadId: 'thread-1' }), deps)).resolves.toEqual({ ok: true, path });
    expect(deps.trustedRoot).toHaveBeenCalledWith(root);
    // A CLI panel has a PTY id, so resolves its registered project instead.
    vi.mocked(deps.thread).mockResolvedValueOnce(null);
    await expect(previewFileLocation(request({ threadId: 'cli-session' }), deps)).resolves.toEqual({ ok: true, path });
  });

  it('uses the recorded worktree instead of a project-root file with the same name', async () => {
    const worktree = join(base, 'worktree');
    await mkdir(worktree); await writeFile(join(worktree, 'installer #1.dmg'), 'other');
    vi.mocked(deps.thread).mockResolvedValue({ hostId: 'local', cwd: worktree });
    vi.mocked(deps.trustedRoot).mockResolvedValue(worktree);
    await expect(previewFileLocation(request({ threadId: 'thread-1' }), deps)).resolves.toEqual({ ok: true, path: join(worktree, 'installer #1.dmg') });
  });

  it('rejects SSH projects and other host owners even if the same paths exist here', async () => {
    for (const extra of [{ remote: { host: 'ssh.example' } }, { hostId: 'remote' }]) {
      const remote = { ...deps, projects: [{ ...deps.projects[0], ...extra }] as never };
      expect((await previewFileLocation(request(), remote)).ok).toBe(false);
      expect((await previewFileLocation(request({ path: join(root, 'installer #1.dmg'), projectId: undefined }), remote)).ok).toBe(false);
    }
    vi.mocked(deps.thread).mockResolvedValueOnce({ hostId: 'local', cwd: root, projectId: 'unregistered' });
    expect((await previewFileLocation(request({ threadId: 't1' }), deps)).ok).toBe(false);
  });

  it('accepts a registered symlink root using either its registered or physical path', async () => {
    const alias = join(base, 'alias'); await symlink(root, alias, 'dir');
    const linked = { ...deps, projects: [{ ...deps.projects[0], path: alias }] };
    for (const path of [join(alias, 'installer #1.dmg'), join(root, 'installer #1.dmg')]) {
      await expect(previewFileLocation(request({ path }), linked)).resolves.toEqual({ ok: true, path: join(root, 'installer #1.dmg') });
    }
    linked.projects.unshift({ ...deps.projects[0], id: 'gone', path: join(base, 'deleted-project') });
    await expect(previewFileLocation(request({ path: join(root, 'installer #1.dmg'), projectId: undefined }), linked))
      .resolves.toEqual({ ok: true, path: join(root, 'installer #1.dmg') });
  });

  it('confines thread storage including the thread directory itself', async () => {
    const storage = join(deps.dataDir, 'thread-storage');
    const directory = join(storage, 'thread-1');
    await mkdir(directory, { recursive: true }); await writeFile(join(directory, 'result.zip'), 'archive');
    await expect(previewFileLocation(request({ source: 'thread-storage', threadId: 'thread-1', path: 'result.zip' }), deps))
      .resolves.toEqual({ ok: true, path: join(directory, 'result.zip') });
    await symlink(root, join(storage, 'escaped'), 'dir');
    expect((await previewFileLocation(request({ source: 'thread-storage', threadId: 'escaped' }), deps)).ok).toBe(false);
    expect((await previewFileLocation(request({ source: 'thread-storage' }), deps)).ok).toBe(false);
    vi.mocked(deps.thread).mockResolvedValue(null);
    expect((await previewFileLocation(request({ source: 'thread-storage', threadId: 'thread-1' }), deps)).ok).toBe(false);
  });

  it.each([
    null, {}, { path: 5 }, { path: '' }, { path: 'x'.repeat(32_769) }, { path: 'a\0b' },
    { source: 'other' }, { projectId: 2 }, { threadId: 2 }, { threadId: '..' }, { threadId: '../escape' },
    { path: '../outside.txt' }, { path: 'missing.txt' }, { path: '.' }, { projectId: 'remote-project' },
    { projectId: undefined }
  ])('rejects malformed, missing, unregistered or escaping input %#', async extra => {
    const input = extra === null ? null : Object.keys(extra).length === 0 ? {} : request(extra);
    expect((await previewFileLocation(input as never, deps)).ok).toBe(false);
  });

  it('rejects remote threads, unknown hosts, untrusted roots and symlink escapes', async () => {
    const req = request({ threadId: 'thread-1' });
    vi.mocked(deps.thread).mockResolvedValueOnce({ hostId: 'remote', cwd: root });
    expect((await previewFileLocation(req, deps)).ok).toBe(false);
    expect((await previewFileLocation(req, { ...deps, localHostId: undefined })).ok).toBe(false);
    vi.mocked(deps.thread).mockResolvedValueOnce({ hostId: 'local', cwd: null });
    expect((await previewFileLocation(req, deps)).ok).toBe(false);
    vi.mocked(deps.trustedRoot).mockResolvedValueOnce(null);
    expect((await previewFileLocation(req, deps)).ok).toBe(false);
    await writeFile(join(base, 'outside.txt'), 'outside');
    await symlink(join(base, 'outside.txt'), join(root, 'escape.dmg'));
    expect((await previewFileLocation(request({ path: 'escape.dmg' }), deps)).ok).toBe(false);
    expect((await previewFileLocation(request({ path: join(base, 'outside.txt'), projectId: undefined }), deps)).ok).toBe(false);
    vi.mocked(deps.thread).mockRejectedValueOnce(new Error('offline'));
    expect((await previewFileLocation(req, deps)).ok).toBe(false);
  });
});
