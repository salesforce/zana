import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useData } from '../store.js';
import {
  resetThreadModelCatalog, threadModelCatalogForHost,
  type ThreadExecutionOptionsFetcher
} from '../components/thread/pickers/thread-model-catalog.js';

const verify = vi.hoisted(() => vi.fn(async () => []));
vi.mock('../lib/product-client.js', () => ({ product: { harness: { verify } } }));

const body = {
  providers: [{ id: 'codex', displayName: 'Codex', available: true,
    composerActions: [], capabilities: { permissionModes: ['full'] } }],
  permissionCeiling: 'full' as const, models: [], selectedOnlyModels: [], modelLoadError: null
};
beforeEach(() => { verify.mockReset().mockResolvedValue([]); });
afterEach(() => resetThreadModelCatalog());

it('reuses fresh models for automatic checks without refreshing other project scopes', async () => {
  const fetcher = vi.fn<ThreadExecutionOptionsFetcher>(async () => body);
  resetThreadModelCatalog(fetcher);
  await threadModelCatalogForHost('local', 'project').ensure();
  await useData.getState().refreshHarnessStatus({ refreshModels: false });
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(fetcher.mock.calls.every(([query]) => !query?.refresh)).toBe(true);
  fetcher.mockClear();
  await useData.getState().refreshHarnessStatus({ refreshModels: false });
  expect(verify).toHaveBeenCalledTimes(2);
  expect(fetcher).not.toHaveBeenCalled();
});

it('forces discovery across cached scopes for an explicit check', async () => {
  const fetcher = vi.fn<ThreadExecutionOptionsFetcher>(async () => body);
  resetThreadModelCatalog(fetcher);
  await threadModelCatalogForHost('local', 'project').ensure();
  await useData.getState().refreshHarnessStatus({ refreshModels: false });
  fetcher.mockClear();
  await useData.getState().refreshHarnessStatus();
  expect(fetcher).toHaveBeenCalledTimes(4);
  const discoveries = fetcher.mock.calls.filter(([query]) => query?.providerId);
  expect(discoveries).toHaveLength(2);
  expect(discoveries.every(([query]) => query?.refresh === true)).toBe(true);
});

it('finishes automatic checks when installation or model discovery fails', async () => {
  verify.mockRejectedValueOnce(new Error('host unavailable'));
  resetThreadModelCatalog(async () => { throw new Error('discovery unavailable'); });
  await expect(useData.getState().refreshHarnessStatus({ refreshModels: false })).resolves.toBeUndefined();
  expect(useData.getState().harnessStatus).toEqual([]);
  expect(threadModelCatalogForHost().getSnapshot().rosterError).toBe('discovery unavailable');
});
