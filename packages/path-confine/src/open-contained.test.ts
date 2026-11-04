import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openContainedFile } from './index.js';

let base: string;
let root: string;
let outside: string;

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'open-contained-')));
  root = join(base, 'root');
  outside = join(base, 'outside');
  await mkdir(join(root, 'dir'), { recursive: true });
  await mkdir(outside);
  await writeFile(join(root, 'dir', 'a.md'), 'inside');
  await writeFile(join(outside, 'secret.md'), 'SECRET');
  await writeFile(join(outside, 'a.md'), 'SECRET');
});
afterEach(() => rm(base, { recursive: true, force: true }));

async function read(root: string, entry: string, afterResolve?: (real: string) => Promise<void>) {
  const file = await openContainedFile(root, entry, { afterResolve });
  if (!file) return null;
  try { return (await file.handle.readFile('utf8')); } finally { await file.handle.close(); }
}

describe('openContainedFile', () => {
  it('reads a regular file inside the root', async () => {
    expect(await read(root, join(root, 'dir', 'a.md'))).toBe('inside');
    expect(await read(root, 'dir/a.md')).toBe('inside');
  });

  it('allows a symlink that stays inside the root', async () => {
    await symlink(join(root, 'dir', 'a.md'), join(root, 'alias.md'));
    expect(await read(root, join(root, 'alias.md'))).toBe('inside');
  });

  it('rejects traversal, sibling-prefix paths and symlink escapes', async () => {
    await symlink(join(outside, 'secret.md'), join(root, 'escape.md'));
    await mkdir(join(base, 'root-evil'));
    await writeFile(join(base, 'root-evil', 'x.md'), 'x');
    expect(await read(root, join(root, '..', 'outside', 'secret.md'))).toBeNull();
    expect(await read(root, join(root, 'escape.md'))).toBeNull();
    expect(await read(root, join(base, 'root-evil', 'x.md'))).toBeNull();
  });

  it('rejects missing roots, missing files, dangling links and directories', async () => {
    await symlink(join(root, 'gone.md'), join(root, 'dangling.md'));
    expect(await read(join(base, 'nope'), join(base, 'nope', 'a.md'))).toBeNull();
    expect(await read(root, join(root, 'missing.md'))).toBeNull();
    expect(await read(root, join(root, 'dangling.md'))).toBeNull();
    expect(await read(root, join(root, 'dir'))).toBeNull();
  });

  it.skipIf(process.platform === 'win32')('rejects a FIFO without blocking', async () => {
    const fifo = join(root, 'pipe');
    execFileSync('mkfifo', [fifo]);
    expect(await read(root, fifo)).toBeNull();
  });

  it.skipIf(process.platform === 'win32')('rejects a device node', async () => {
    await symlink('/dev/null', join(root, 'null'));
    expect(await read(root, join(root, 'null'))).toBeNull();
  });

  it.skipIf(process.platform === 'win32')('fails closed when the file becomes a symlink after resolution', async () => {
    const target = join(root, 'dir', 'a.md');
    const result = await read(root, target, async (real) => {
      await rm(real);
      await symlink(join(outside, 'secret.md'), real);
    });
    expect(result).toBeNull();
  });

  it.skipIf(process.platform === 'win32')('fails closed when a parent directory is swapped for a link after resolution', async () => {
    const result = await read(root, join(root, 'dir', 'a.md'), async () => {
      await rename(join(root, 'dir'), join(root, 'dir-moved'));
      await symlink(outside, join(root, 'dir'));
    });
    expect(result).toBeNull();
  });

  it('reads the replacement when it is swapped for another contained file before the open', async () => {
    const result = await read(root, join(root, 'dir', 'a.md'), async (real) => {
      await rm(real);
      await writeFile(real, 'replacement');
      await writeFile(join(root, 'dir', 'b.md'), 'b');
    });
    // Replacement happened before open, so the opened inode is the named one: allowed and consistent.
    expect(result).toBe('replacement');
  });
});
