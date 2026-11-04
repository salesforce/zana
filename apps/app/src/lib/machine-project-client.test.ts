import { expect, it, vi } from 'vitest';
import { createProjectFolder, readProjectAvailability } from './machine-project-client.js';
const h = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('./fetch-with-app-surface.js', () => ({ apiJson: h.api }));
it('batches availability and sends explicit creation authority', async () => {
  h.api.mockResolvedValueOnce({ statuses: { p: 'ready' } }).mockResolvedValueOnce({ statuses: { q: 'missing' } });
  expect(await readProjectAvailability(Array.from({ length: 101 }, (_, i) => `p${i}`))).toEqual({ p: 'ready', q: 'missing' });
  expect(JSON.parse(h.api.mock.calls[0][1].body).projectIds).toHaveLength(100);
  expect(JSON.parse(h.api.mock.calls[1][1].body).projectIds).toHaveLength(1);
  h.api.mockResolvedValueOnce({ project: { id: 'new' } });
  const input = { hostId: 'host', parentPath: '/home', name: 'api', operationId: 'id' };
  expect(await createProjectFolder(input)).toEqual({ id: 'new' });
  expect(h.api).toHaveBeenLastCalledWith('/projects/create-folder', { method: 'POST', body: JSON.stringify(input) });
});
