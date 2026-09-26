import { afterEach, expect, it, vi } from 'vitest';
import { product } from '../product-client.js';

afterEach(() => vi.unstubAllGlobals());

it('hydrates each project with only its own terminals so mobile lists and portals do not duplicate sessions', async () => {
  const first = { id: 'one', projectId: 'project-a', title: 'First agent' };
  const second = { id: 'two', projectId: 'project-b', title: 'Second agent' };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ sessions: [first, second] })));
  await expect(product.terminals.list('project-a')).resolves.toEqual([first]);
  await expect(product.terminals.list('project-b')).resolves.toEqual([second]);
  await expect(product.terminals.list('empty-project')).resolves.toEqual([]);
});

it('preserves terminal hydration failures rather than claiming an empty project', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: 'Host unavailable' }, { status: 503 })));
  await expect(product.terminals.list('project-a')).rejects.toThrow();
});
