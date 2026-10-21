import { afterEach, describe, expect, it, vi } from 'vitest';
import { link, mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Redirects the registry's open() to another file, as a folder swapped for a symlink between
// the realpath check and the open would.
const redirect = vi.hoisted(() => ({ to: undefined as string | undefined, before: undefined as (() => Promise<void>) | undefined }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: async (path: string, ...rest: unknown[]) => {
      const before = redirect.before;
      redirect.before = undefined;
      await before?.();
      return (actual.open as (...args: unknown[]) => unknown)(redirect.to ?? path, ...rest);
    } };
});

const { createExecutionSourceRegistry } = await import('../source-registry.js');

afterEach(() => { redirect.to = undefined; redirect.before = undefined; });

describe('execution source registry read handle', () => {
  it('refuses a handle that is not the file the canonical path names', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'zcc-execution-handle-')));
    try {
      await mkdir(join(dir, 'project'));
      await writeFile(join(dir, 'project', 'plan.md'), '# plan');
      await writeFile(join(dir, 'secret.md'), 'secret');
      const registry = createExecutionSourceRegistry({ rootDir: join(dir, 'store') });
      redirect.to = join(dir, 'secret.md');
      await expect(registry.issue({ windowId: 7, projectId: 'p', paths: [join(dir, 'project', 'plan.md')], policy: { roots: [join(dir, 'project')], home: join(dir, 'home') } }))
        .rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
      redirect.to = undefined;
      await expect(registry.issue({ windowId: 7, projectId: 'p', paths: [join(dir, 'project', 'plan.md')], policy: { roots: [join(dir, 'project')], home: join(dir, 'home') } }))
        .resolves.toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses a file renamed over the path between the check and the read (a hard link to a secret)', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'zcc-execution-handle-')));
    try {
      await mkdir(join(dir, 'home', '.ssh'), { recursive: true });
      await writeFile(join(dir, 'home', 'notes.md'), 'notes');
      await writeFile(join(dir, 'home', '.ssh', 'id_rsa'), 'PRIVATE');
      await link(join(dir, 'home', '.ssh', 'id_rsa'), join(dir, 'home', 'swap.md'));
      const registry = createExecutionSourceRegistry({ rootDir: join(dir, 'store') });
      redirect.before = () => rename(join(dir, 'home', 'swap.md'), join(dir, 'home', 'notes.md'));
      await expect(registry.issue({ windowId: 7, projectId: 'p', paths: [join(dir, 'home', 'notes.md')], policy: { roots: [join(dir, 'home')], home: join(dir, 'home') } }))
        .rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
