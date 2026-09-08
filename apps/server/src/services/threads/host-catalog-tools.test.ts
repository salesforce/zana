import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ProductHttpContext } from '../../http/product-context.js';
import { invokeHostCatalogTool } from './host-catalog-tools.js';

vi.mock('../extensions/local-extension.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../extensions/local-extension.js')>();
  return {
    ...actual,
    mintLocalId: () => 'demo-abcd',
    workingDirFor: () => join(tmpdir(), 'zcc-ext-demo-abcd'),
    scaffoldLocalExtension: vi.fn(async () => ({ ok: true, value: { manifestPath: '/tmp/pkg.json' } }))
  };
});

function ctx(over: Partial<ProductHttpContext> = {}): ProductHttpContext {
  const events: Array<{ type: string; payload: unknown }> = [];
  return {
    toProjects: () => [],
    config: { getConfig: () => ({}) },
    hub: {
      emit: (type: string, payload: unknown) => events.push({ type, payload }),
      size: () => 1,
      events
    },
    projects: {
      add: async (path: string) => ({ id: 'p-new', name: 'added', path }),
      list: () => []
    },
    ...over
  } as unknown as ProductHttpContext;
}

describe('invokeHostCatalogTool', () => {
  it('lists non-sensitive project summaries', async () => {
    const result = await invokeHostCatalogTool(ctx({
      toProjects: () => [{ id: 'proj-1', name: 'Demo', path: '/tmp/demo', tag: 'demo' }]
    }), {
      name: 'list_projects',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: {}
    });
    expect(result.success).toBe(true);
    expect(JSON.parse(result.contentItems[0]?.text ?? '[]')).toEqual([
      { id: 'proj-1', name: 'Demo', path: '/tmp/demo', tag: 'demo' }
    ]);
  });

  it('registers a path under cloneRoot and rejects one outside every allowed base', async () => {
    const home = mkdtempSync(join(tmpdir(), 'zcc-home-'));
    const nested = join(home, 'src', 'app');
    mkdirSync(nested, { recursive: true });
    const product = ctx({
      config: { getConfig: () => ({ cloneRoot: home }) },
      toProjects: () => [{ id: 'proj-1', name: 'Demo', path: join(home, 'src') }]
    });
    const ok = await invokeHostCatalogTool(product, {
      name: 'register_project',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { path: 'app' }
    });
    expect(ok.success).toBe(true);

    const outside = mkdtempSync(join(tmpdir(), 'zcc-outside-'));
    const rejected = await invokeHostCatalogTool(product, {
      name: 'register_project',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { path: outside }
    });
    expect(rejected.success).toBe(false);
    expect(rejected.contentItems[0]?.text).toContain('outside HOME');
  });

  it('rejects a missing plugin name', async () => {
    const result = await invokeHostCatalogTool(ctx(), {
      name: 'create_local_extension',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { name: '   ' }
    });
    expect(result.success).toBe(false);
    expect(result.contentItems[0]?.text).toContain('A name is required');
  });

  it('scaffolds a local plugin and registers its project', async () => {
    const install = vi.fn(async () => ({ id: 'demo-abcd' }));
    const add = vi.fn(async (path: string) => ({ id: 'p-ext', name: 'Ext: Demo', path }));
    const result = await invokeHostCatalogTool(ctx({
      plugins: { list: () => [], install },
      projects: { add, list: () => [] }
    } as never), {
      name: 'create_local_extension',
      threadId: 'thr-1',
      projectId: 'proj-1',
      input: { name: 'Demo', kind: 'panel' }
    });
    expect(result.success).toBe(true);
    expect(install).toHaveBeenCalled();
    expect(add).toHaveBeenCalled();
    expect(JSON.parse(result.contentItems[0]?.text ?? '{}')).toMatchObject({
      ok: true,
      id: 'demo-abcd',
      projectId: 'p-ext'
    });
  });
});
