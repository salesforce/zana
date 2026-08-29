import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceError } from './error.js';
import { readWorkspaceDiff, readWorkspaceStatus, runGit, truncateToMaxBytes } from './git.js';
import {
  parseNameStatusSourceEntries,
  parseNumstatEntriesZ,
  readWorkspaceDiffFiles,
  readWorkspaceDiffPatch,
  splitPatchIntoSections
} from './git-diff.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function initRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'zcc-git-'));
  dirs.push(repo);
  await runGit(repo, ['init', '-b', 'main']);
  await runGit(repo, ['config', 'user.name', 'Test']);
  await runGit(repo, ['config', 'user.email', 'test@example.com']);
  await writeFile(join(repo, 'README.md'), 'hello\n');
  await runGit(repo, ['add', '.']);
  await runGit(repo, ['commit', '-m', 'init']);
  return repo;
}

describe('git buffer overflow', () => {
  it('throws when a command exceeds the cap', async () => {
    const repo = await initRepo();
    await writeFile(join(repo, 'README.md'), `${'x'.repeat(8_000)}\n`);
    await expect(runGit(repo, ['diff', 'HEAD'], { maxBuffer: 64 })).rejects.toBeInstanceOf(WorkspaceError);
    await expect(runGit(repo, ['diff', 'HEAD'], { maxBuffer: 64 })).rejects.toThrow('buffer cap');
  });

  it('returns a truncated workspace diff instead of failing', async () => {
    const repo = await initRepo();
    await writeFile(join(repo, 'README.md'), `${'x'.repeat(8_000)}\n`);
    const diff = await readWorkspaceDiff(repo, { type: 'uncommitted' }, 256);
    expect(diff.truncated).toBe(true);
    expect(diff.diff.length).toBeLessThanOrEqual(256);
    expect(diff.diff.length).toBeGreaterThan(0);
  });
});

describe('utf-8 truncate', () => {
  it('cuts on a codepoint boundary', () => {
    const value = 'éééé';
    const truncated = truncateToMaxBytes(value, 3);
    expect(truncated).toBe('é');
    expect(Buffer.byteLength(truncated, 'utf8')).toBeLessThanOrEqual(3);
    expect(truncated.includes('\uFFFD')).toBe(false);
  });
});

describe('paged workspace diffs', () => {
  it('record-limits untracked files in the TOC', async () => {
    const repo = await initRepo();
    await writeFile(join(repo, 'tracked.ts'), 'one\n');
    await runGit(repo, ['add', 'tracked.ts']);
    await writeFile(join(repo, 'u1.txt'), 'a\n');
    await writeFile(join(repo, 'u2.txt'), 'b\n');
    await writeFile(join(repo, 'u3.txt'), 'c\n');
    const files = await readWorkspaceDiffFiles(repo, { type: 'uncommitted' }, 2);
    expect(files.truncated).toBe(true);
    expect(files.files.length).toBe(2);
  });

  it('record-limits an untracked-only tree without double-counting the cap', async () => {
    const repo = await initRepo();
    await writeFile(join(repo, 'u1.txt'), 'a\n');
    await writeFile(join(repo, 'u2.txt'), 'b\n');
    await writeFile(join(repo, 'u3.txt'), 'c\n');
    const files = await readWorkspaceDiffFiles(repo, { type: 'uncommitted' }, 2);
    expect(files.truncated).toBe(true);
    expect(files.files).toHaveLength(2);
    expect(files.files.every((file) => file.origin === 'untracked')).toBe(true);
  });

  it('marks the TOC truncated when tracked files fill the cap', async () => {
    const repo = await initRepo();
    await writeFile(join(repo, 'README.md'), 'changed\n');
    await writeFile(join(repo, 'extra.txt'), 'x\n');
    const files = await readWorkspaceDiffFiles(repo, { type: 'uncommitted' }, 1);
    expect(files.truncated).toBe(true);
    expect(files.files).toHaveLength(1);
  });

  it('loads a tracked file patch and recovers a missing path without throwing', async () => {
    const repo = await initRepo();
    await writeFile(join(repo, 'README.md'), 'changed\n');
    const patches = await readWorkspaceDiffPatch(
      repo,
      { type: 'uncommitted' },
      ['README.md', 'ghost.ts'],
      64 * 1024
    );
    expect(patches).toHaveLength(2);
    expect(patches[0]?.path).toBe('README.md');
    expect(patches[0]?.patch.length).toBeGreaterThan(0);
    expect(patches[1]?.path).toBe('ghost.ts');
  });

  it('returns a truncated per-file patch instead of throwing', async () => {
    const repo = await initRepo();
    await writeFile(join(repo, 'big.ts'), `${'x'.repeat(8_000)}\n`);
    const patches = await readWorkspaceDiffPatch(repo, { type: 'uncommitted' }, ['big.ts'], 80);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.truncated).toBe(true);
    expect(Buffer.byteLength(patches[0]?.patch ?? '', 'utf8')).toBeLessThanOrEqual(80);
  });

  it('returns a prefix when a combined page exceeds the budget', async () => {
    const repo = await initRepo();
    await writeFile(join(repo, 'a.ts'), `${'a'.repeat(4_000)}\n`);
    await writeFile(join(repo, 'b.ts'), `${'b'.repeat(4_000)}\n`);
    const patches = await readWorkspaceDiffPatch(repo, { type: 'uncommitted' }, ['a.ts', 'b.ts'], 120);
    expect(patches).toHaveLength(2);
    expect(patches.some((entry) => entry.patch.length > 0 || entry.truncated)).toBe(true);
    for (const entry of patches) {
      expect(Buffer.byteLength(entry.patch, 'utf8')).toBeLessThanOrEqual(120);
    }
  });

  it('recovers oversized status porcelain without throwing', async () => {
    const repo = await initRepo();
    await writeFile(join(repo, 'README.md'), `${'x'.repeat(200)}\n`);
    const status = await readWorkspaceStatus(repo, 1);
    expect(status.filesTruncated || status.files.length <= 1).toBe(true);
  });
});

describe('diff parsers', () => {
  it('parses rename name-status records and binary numstat', () => {
    expect(parseNameStatusSourceEntries('R100\0old.ts\0new.ts\0M\0kept.ts\0')).toEqual([
      { path: 'new.ts', status: 'R', previousPath: 'old.ts' },
      { path: 'kept.ts', status: 'M', previousPath: null }
    ]);
    expect(parseNumstatEntriesZ('-\t-\t\0old.bin\0new.bin\0')).toEqual([
      { path: 'new.bin', insertions: null, deletions: null }
    ]);
    expect(parseNumstatEntriesZ('3\t1\tapp.ts\0')).toEqual([
      { path: 'app.ts', insertions: 3, deletions: 1 }
    ]);
  });

  it('splits a combined page into per-file sections', () => {
    const combined = [
      'diff --git a/a.ts b/a.ts',
      '+++ b/a.ts',
      '+one',
      'diff --git a/b.ts b/b.ts',
      '+++ b/b.ts',
      '+two',
      ''
    ].join('\n');
    const sections = splitPatchIntoSections(combined);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain('a/a.ts');
    expect(sections[1]).toContain('a/b.ts');
  });
});
