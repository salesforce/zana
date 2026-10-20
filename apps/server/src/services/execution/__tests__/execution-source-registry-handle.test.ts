import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Redirects the registry's open() to another file, as a folder swapped for a symlink between
// the realpath check and the open would.
const redirect = vi.hoisted(() => ({ to: undefined as string | undefined }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: (path: string, ...rest: unknown[]) => (actual.open as (...args: unknown[]) => unknown)(redirect.to ?? path, ...rest) };
});

const { createExecutionSourceRegistry } = await import('../source-registry.js');

afterEach(() => { redirect.to = undefined; });

describe('execution source registry read handle', () => {
  it('refuses a handle that is not the file the canonical path names', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'zcc-execution-handle-')));
    try {
      await mkdir(join(dir, 'project'));
      await writeFile(join(dir, 'project', 'plan.md'), '# plan');
      await writeFile(join(dir, 'secret.md'), 'secret');
      const registry = createExecutionSourceRegistry({ rootDir: join(dir, 'store') });
      redirect.to = join(dir, 'secret.md');
      await expect(registry.issue({ windowId: 7, projectId: 'p', paths: [join(dir, 'project', 'plan.md')], withinRoot: join(dir, 'project') }))
        .rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
      redirect.to = undefined;
      await expect(registry.issue({ windowId: 7, projectId: 'p', paths: [join(dir, 'project', 'plan.md')], withinRoot: join(dir, 'project') }))
        .resolves.toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
