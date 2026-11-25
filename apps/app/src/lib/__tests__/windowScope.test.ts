import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * windowScope reads `?projectId=` ONCE at module load, so each case must set
 * `window.location.search` and then re-import the module with a fresh registry
 * (resetModules) to re-run that top-level read.
 */
async function loadWith(
  search: string,
  sessionStore?: Map<string, string>
) {
  vi.resetModules();
  const store = sessionStore ?? new Map<string, string>();
  vi.stubGlobal('window', {
    location: { search, href: 'http://localhost/agents' + search },
    history: { state: null, replaceState: vi.fn() },
    sessionStorage: {
      removeItem: (key: string) => store.delete(key),
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      }
    }
  } as unknown as Window);
  return import('../windowScope.js');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('windowScope', () => {
  it('returns the projectId when present', async () => {
    const { getScopedProjectId, isScopedWindow } = await loadWith('?projectId=p-123');
    expect(getScopedProjectId()).toBe('p-123');
    expect(isScopedWindow()).toBe(true);
  });

  it('is unscoped when no projectId param', async () => {
    const { getScopedProjectId, isScopedWindow } = await loadWith('');
    expect(getScopedProjectId()).toBeNull();
    expect(isScopedWindow()).toBe(false);
  });

  it('drops the saved project after Back and keeps the destination on reload', async () => {
    const stored = new Map([['zcc.scopedProjectId', 'old']]);
    const scope = await loadWith('?tab=all&projectId=', stored);
    expect(scope.getScopedProjectId()).toBeNull();
    expect(String(vi.mocked(window.history.replaceState).mock.calls[0][2])).toBe('http://localhost/agents?tab=all');
    expect((await loadWith('', stored)).getScopedProjectId()).toBeNull();
  });

  it('treats a blank/whitespace projectId as unscoped', async () => {
    const { getScopedProjectId, isScopedWindow } = await loadWith('?projectId=%20');
    expect(getScopedProjectId()).toBeNull();
    expect(isScopedWindow()).toBe(false);
  });

  it('decodes a percent-encoded projectId and ignores other params', async () => {
    const { getScopedProjectId } = await loadWith('?foo=bar&projectId=a%2Db');
    expect(getScopedProjectId()).toBe('a-b');
  });

  it('keeps the lock from sessionStorage when a later load drops the query', async () => {
    const store = new Map<string, string>();
    const first = await loadWith('?projectId=p-123', store);
    expect(first.getScopedProjectId()).toBe('p-123');
    const second = await loadWith('', store);
    expect(second.getScopedProjectId()).toBe('p-123');
    expect(second.isScopedWindow()).toBe(true);
  });

  describe('isProjectFocusedView', () => {
    it('is true in a scoped window regardless of focusedProjectId', async () => {
      const { isProjectFocusedView } = await loadWith('?projectId=p-123');
      expect(isProjectFocusedView(null)).toBe(true);
      expect(isProjectFocusedView('p-other')).toBe(true);
    });

    it('in the main window, tracks focusedProjectId', async () => {
      const { isProjectFocusedView } = await loadWith('');
      expect(isProjectFocusedView(null)).toBe(false);
      expect(isProjectFocusedView('p-123')).toBe(true);
    });
  });
});
