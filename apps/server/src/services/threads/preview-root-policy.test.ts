import { openContainedFile } from '@zana-ai/zcc-path-confine';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const primary = vi.hoisted(() => ({ id: 'host-local' as string | null }));
vi.mock('@zana-ai/zcc-db', () => ({
  getPrimaryHost: () => (primary.id ? { id: primary.id } : undefined)
}));

import {
  effectivePreviewRoots,
  effectivePreviewRootsFor,
  isLocalDesktopHost,
  matchPreviewRoots, matchPreviewRootsAsync,
  openLocalPreviewFile,
  trustedFoldersForTarget
} from './preview-root-policy.js';

const db = {} as never;
let base: string;
let trusted: string;
let outside: string;

beforeEach(() => {
  primary.id = 'host-local';
  base = realpathSync(mkdtempSync(join(tmpdir(), 'trusted-policy-')));
  trusted = join(base, 'trusted');
  outside = join(base, 'outside');
  mkdirSync(trusted);
  mkdirSync(outside);
  writeFileSync(join(trusted, 'a.md'), '# a');
  writeFileSync(join(outside, 'secret.md'), 'secret');
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const ctx = (folders: string[], projects: unknown[] = []) => ({
  db,
  config: { getConfig: () => ({ trustedPreviewFolders: folders }) },
  toProjects: () => projects as never
});

describe('thread storage roots', () => {
  it('opens storage belonging to the registered thread even when its host is remote', async () => {
    const dataDir = join(base, 'data');
    const storage = join(dataDir, 'thread-storage', 't1');
    mkdirSync(storage, { recursive: true });
    const report = join(storage, 'index.html');
    writeFileSync(report, '<h1>Recording and results</h1>');
    const roots = effectivePreviewRootsFor(
      { ...ctx([trusted]), dataDir },
      { thread: { id: 't1', hostId: 'remote-host' }, projectId: null }
    );
    expect(roots).toContainEqual({ path: storage, trusted: false });
    expect(roots.some((root) => root.trusted)).toBe(false);
    const result = await openLocalPreviewFile(roots, report);
    expect(result.kind).toBe('opened');
    if (result.kind === 'opened') {
      expect(await result.file.handle.readFile('utf8')).toContain('Recording and results');
      await result.file.handle.close();
    }
    expect(matchPreviewRoots(roots, join(dataDir, 'thread-storage', 't2', 'index.html'))).toEqual([]);
    expect(matchPreviewRoots(roots, `${storage}-other/index.html`)).toEqual([]);
    const threadless = effectivePreviewRootsFor({ ...ctx([]), dataDir }, { thread: null, projectId: null });
    expect(matchPreviewRoots(threadless, report)).toEqual([]);
  });
});

describe('trustedFoldersForTarget', () => {
  it('returns folders for a local desktop thread', () => {
    expect(trustedFoldersForTarget(ctx(['/x'], [{ id: 'p', remote: false }]), { thread: { hostId: 'host-local' }, projectId: 'p' })).toEqual(['/x']);
    expect(trustedFoldersForTarget(ctx(['/x']), { thread: { hostId: 'host-local' }, projectId: null })).toEqual(['/x']);
  });
  it('omits folders for threads in SSH-remote or unknown projects even on the primary host', () => {
    expect(trustedFoldersForTarget(ctx(['/x'], [{ id: 'p', remote: true }]), { thread: { hostId: 'host-local' }, projectId: 'p' })).toEqual([]);
    expect(trustedFoldersForTarget(ctx(['/x'], []), { thread: { hostId: 'host-local' }, projectId: 'p' })).toEqual([]);
  });
  it('omits folders for remote threads and hostless threads', () => {
    expect(trustedFoldersForTarget(ctx(['/x']), { thread: { hostId: 'other' }, projectId: 'p' })).toEqual([]);
    expect(trustedFoldersForTarget(ctx(['/x']), { thread: { hostId: null }, projectId: 'p' })).toEqual([]);
  });
  it('omits folders when nothing is configured', () => {
    expect(trustedFoldersForTarget(ctx([]), { thread: { hostId: 'host-local' }, projectId: 'p' })).toEqual([]);
  });
  it('uses the project for threadless owners and never for remote projects', () => {
    const local = { id: 'p', remote: false };
    expect(trustedFoldersForTarget(ctx(['/x'], [local]), { thread: null, projectId: 'p' })).toEqual(['/x']);
    expect(trustedFoldersForTarget(ctx(['/x'], [{ ...local, hostId: 'host-local' }]), { thread: null, projectId: 'p' })).toEqual(['/x']);
    expect(trustedFoldersForTarget(ctx(['/x'], [{ ...local, remote: true }]), { thread: null, projectId: 'p' })).toEqual([]);
    expect(trustedFoldersForTarget(ctx(['/x'], [{ ...local, hostId: 'other' }]), { thread: null, projectId: 'p' })).toEqual([]);
    expect(trustedFoldersForTarget(ctx(['/x'], [local]), { thread: null, projectId: 'missing' })).toEqual([]);
  });
});

describe('isLocalDesktopHost', () => {
  it('requires a matching primary host', () => {
    expect(isLocalDesktopHost(db, 'host-local')).toBe(true);
    expect(isLocalDesktopHost(db, null)).toBe(false);
    primary.id = null;
    expect(isLocalDesktopHost(db, 'host-local')).toBe(false);
  });
});

describe('openLocalPreviewFile', () => {
  const roots = () => effectivePreviewRoots(join(base, 'data'), null, [trusted]);

  it('opens a regular file under a trusted root', async () => {
    const result = await openLocalPreviewFile(roots(), join(trusted, 'a.md'));
    expect(result.kind).toBe('opened');
    if (result.kind === 'opened') {
      expect((await result.file.handle.readFile('utf8'))).toBe('# a');
      await result.file.handle.close();
    }
  });
  it('reports paths outside every root', async () => {
    expect((await openLocalPreviewFile(roots(), join(outside, 'secret.md'))).kind).toBe('outside');
    expect((await openLocalPreviewFile(roots(), `${trusted}-evil/a.md`)).kind).toBe('outside');
  });
  it('reports missing files and directories under a root', async () => {
    mkdirSync(join(trusted, 'dir'));
    expect((await openLocalPreviewFile(roots(), join(trusted, 'nope.md'))).kind).toBe('missing');
    expect((await openLocalPreviewFile(roots(), join(trusted, 'dir'))).kind).toBe('missing');
  });
  it('refuses a symlink that escapes the root', async () => {
    symlinkSync(join(outside, 'secret.md'), join(trusted, 'link.md'));
    expect((await openLocalPreviewFile(roots(), join(trusted, 'link.md'))).kind).toBe('missing');
  });
  it('denies a removed root', async () => {
    expect((await openLocalPreviewFile(effectivePreviewRoots(join(base, 'data'), null, []), join(trusted, 'a.md'))).kind).toBe('outside');
  });
  it('refuses when the trusted root no longer exists', async () => {
    rmSync(trusted, { recursive: true });
    expect((await openLocalPreviewFile(roots(), join(trusted, 'a.md'))).kind).toBe('outside');
  });
  it('stops honoring a trusted root that was swapped for a symlink', () => {
    const elsewhere = join(base, 'elsewhere');
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, 'a.md'), 'x');
    rmSync(trusted, { recursive: true });
    symlinkSync(elsewhere, trusted);
    expect(matchPreviewRoots(roots(), join(trusted, 'a.md'))).toEqual([]);
  });
  it('agrees with the sync matcher, including symlinked directories and swapped roots', async () => {
    const alias = join(base, 'alias-async');
    symlinkSync(trusted, alias);
    const candidates = [join(trusted, 'a.md'), join(alias, 'a.md'), join(base, 'nope', 'a.md')];
    for (const candidate of candidates) {
      expect(await matchPreviewRootsAsync(roots(), candidate)).toEqual(matchPreviewRoots(roots(), candidate));
    }
    const elsewhere = join(base, 'elsewhere-async');
    mkdirSync(elsewhere);
    rmSync(trusted, { recursive: true });
    symlinkSync(elsewhere, trusted);
    expect(await matchPreviewRootsAsync(roots(), join(trusted, 'a.md'))).toEqual([]);
  });

  it('matches a file reached through a symlinked directory on the resolved form', () => {
    const alias = join(base, 'alias');
    symlinkSync(trusted, alias);
    expect(matchPreviewRoots(roots(), join(alias, 'a.md'))).toEqual([{ root: trusted, rel: 'a.md', trusted: true }]);
  });
  it('denies a swap of the file for an escaping symlink after the match', async () => {
    const target = join(trusted, 'swap.md');
    writeFileSync(target, 'ok');
    const matched = matchPreviewRoots(roots(), target);
    expect(matched).toHaveLength(1);
    rmSync(target);
    symlinkSync(join(outside, 'secret.md'), target);
    expect((await openLocalPreviewFile(roots(), target)).kind).toBe('missing');
  });
  it('refuses a trusted root swapped for a symlink after the match, before the open', async () => {
    const elsewhere = join(base, 'elsewhere-open');
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, 'a.md'), 'SECRET');
    const matched = await matchPreviewRootsAsync(roots(), join(trusted, 'a.md'));
    expect(matched).toHaveLength(1);
    rmSync(trusted, { recursive: true });
    symlinkSync(elsewhere, trusted);
    // Matching already ran; the open itself must still refuse the swapped root.
    const result = await openContainedFile(trusted, 'a.md', { expectedRoot: trusted });
    expect(result).toBeNull();
    expect((await openLocalPreviewFile(roots(), join(trusted, 'a.md'))).kind).toBe('outside');
  });
});
