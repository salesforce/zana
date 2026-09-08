import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProductHttpContext } from '../../http/product-context.js';
import { invokeHostLibraryTool } from './host-library-tools.js';

function ctx(root: string): ProductHttpContext {
  return {
    toProjects: () => [{ id: 'proj-1', name: 'Demo', path: root }],
    hub: { emit: () => undefined, size: () => 1 }
  } as unknown as ProductHttpContext;
}

describe('invokeHostLibraryTool', () => {
  it('refuses to clobber or delete a user-authored doc', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-lib-user-'));
    const dir = join(root, '.zcc', 'library');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'notes.md'), '# user notes\n');
    writeFileSync(join(dir, 'index.json'), JSON.stringify({
      version: 1,
      docs: [{
        id: 'd1',
        relPath: 'notes.md',
        title: 'Notes',
        kind: 'md',
        createdAt: 1,
        updatedAt: 1,
        source: { kind: 'user' }
      }]
    }));
    const product = ctx(root);
    const write = await invokeHostLibraryTool(product, {
      name: 'library_write',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { relPath: 'notes.md', content: 'nope' }
    });
    expect(write.success).toBe(false);
    const remove = await invokeHostLibraryTool(product, {
      name: 'library_remove',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { relPath: 'notes.md' }
    });
    expect(remove.success).toBe(false);
    const missing = await invokeHostLibraryTool(product, {
      name: 'library_remove',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { relPath: 'gone.md' }
    });
    expect(JSON.parse(missing.contentItems[0]?.text ?? '{}').removed).toBe(false);
  });

  it('updates metadata of an agent doc and lists untracked files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-lib-meta-'));
    const product = ctx(root);
    await invokeHostLibraryTool(product, {
      name: 'library_write',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { relPath: 'a.md', content: 'body', title: 'A' }
    });
    const updated = await invokeHostLibraryTool(product, {
      name: 'library_write',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { relPath: 'a.md', title: 'Renamed', summary: 's' }
    });
    expect(updated.success).toBe(true);
    const extra = join(root, '.zcc', 'library', 'loose.txt');
    writeFileSync(extra, 'loose');
    const listed = await invokeHostLibraryTool(product, {
      name: 'library_list',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: {}
    });
    const docs = JSON.parse(listed.contentItems[0]?.text ?? '[]') as Array<{ relPath: string }>;
    expect(docs.some((d) => d.relPath === 'loose.txt')).toBe(true);
  });
});
