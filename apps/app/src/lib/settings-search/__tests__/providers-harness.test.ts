import { describe, expect, it, vi } from 'vitest';

const catalog = vi.hoisted(() => ({ subscribe: vi.fn(() => () => {}) }));
vi.mock('@/components/thread/pickers/thread-model-catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/thread/pickers/thread-model-catalog')>()),
  subscribeThreadModelCatalog: catalog.subscribe
}));

import { useData } from '@/store';
import { buildCorpus } from '../corpus';
import { getSettingsSearchProviders, getSettingsSearchSourcesVersion } from '../registry';
import { harnessSearchProvider, registerHarnessSearchProvider, rememberHarnessDescriptors } from '../providers/harness';

const snapshot = { config: {} as never };

describe('harness provider freshness', () => {
  it('follows harness status and reported descriptors through revision, never by subscribing', () => {
    const before = getSettingsSearchProviders();
    const v0 = getSettingsSearchSourcesVersion();
    const dispose = registerHarnessSearchProvider();
    try {
      expect(getSettingsSearchProviders()).toContain(harnessSearchProvider);
      const first = buildCorpus(snapshot);
      expect(buildCorpus(snapshot)).toBe(first);
      // The boot probe resolves after a search may already be open: a new status
      // array is enough for the next search to rebuild, with no listener.
      useData.setState({ harnessStatus: [...useData.getState().harnessStatus] });
      const second = buildCorpus(snapshot);
      expect(second).not.toBe(first);
      useData.setState({ projects: [...useData.getState().projects] }); // unrelated store churn
      expect(buildCorpus(snapshot)).toBe(second);
      rememberHarnessDescriptors([]); // the page reported its descriptors
      expect(buildCorpus(snapshot)).not.toBe(second);
      // A catalogue listener would keep its background refresh loop alive all session.
      expect(catalog.subscribe).not.toHaveBeenCalled();
      expect(getSettingsSearchSourcesVersion()).toBe(v0);
    } finally {
      rememberHarnessDescriptors(null);
      dispose();
    }
    expect(getSettingsSearchProviders()).toEqual(before);
  });
});
