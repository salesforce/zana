// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BASIC_UI_SESSION_KEY, basicUiModeFromSearch, createBasicUiStore, getBasicUiMode, isBasicUiRouteSupported, setBasicUiMode, useBasicUi } from './basic-ui.js';

function memoryStorage(initial?: string) {
  const values = new Map<string, string>(initial ? [[BASIC_UI_SESSION_KEY, initial]] : []);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

afterEach(() => { cleanup(); setBasicUiMode('advanced'); window.sessionStorage.clear(); vi.unstubAllGlobals(); });

describe('Basic view window preference', () => {
  it.each([undefined, {}])('loads safely outside a full browser window: %s', async browserWindow => {
    vi.resetModules();
    vi.stubGlobal('window', browserWindow);
    try {
      const isolated = await import('./basic-ui.js');
      expect(isolated.getBasicUiMode()).toBe('advanced');
      isolated.setBasicUiMode('basic');
      expect(isolated.getBasicUiMode()).toBe('basic');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('defaults to Advanced and never changes another window', () => {
    const first = createBasicUiStore('', memoryStorage());
    const other = createBasicUiStore('', memoryStorage());
    expect(first.getSnapshot()).toBe('advanced');
    first.setMode('basic');
    expect(first.getSnapshot()).toBe('basic');
    expect(other.getSnapshot()).toBe('advanced');
  });

  it.each(['', '?ui=Basic', '?ui=', '?ui=basic&ui=advanced', '?ui=basic&ui=basic', '?ui=%20basic', '?something=basic'])('ignores malformed query %s', search => {
    expect(basicUiModeFromSearch(search)).toBeNull();
    expect(createBasicUiStore(search).getSnapshot()).toBe('advanced');
  });

  it('applies a strict query once, remembers the choice through same-query reload, and accepts a changed hint', () => {
    const storage = memoryStorage();
    const first = createBasicUiStore('?ui=basic&projectId=p', storage);
    expect(first.getSnapshot()).toBe('basic');
    first.setMode('advanced');
    expect(createBasicUiStore('?ui=basic', storage).getSnapshot()).toBe('advanced');
    expect(createBasicUiStore('', storage).getSnapshot()).toBe('advanced');
    const changed = createBasicUiStore('?ui=advanced', storage);
    changed.setMode('basic');
    expect(createBasicUiStore('?ui=advanced', storage).getSnapshot()).toBe('basic');
    expect(createBasicUiStore('?ui=basic', storage).getSnapshot()).toBe('basic');
  });

  it.each(['{broken', 'null', '"basic"', '{"mode":"unknown"}', '{"mode":"basic","queryMode":"invalid"}'])('confines malformed stored state %s', raw => {
    const store = createBasicUiStore('', memoryStorage(raw));
    expect(store.getSnapshot()).toBe(raw.includes('"mode":"basic"') ? 'basic' : 'advanced');
  });

  it('keeps working when reads and writes fail or storage is unavailable', () => {
    const broken = { getItem: () => { throw Error('unavailable'); }, setItem: () => { throw Error('full'); } };
    for (const store of [createBasicUiStore('?ui=basic', broken), createBasicUiStore('?ui=basic')]) {
      expect(store.getSnapshot()).toBe('basic');
      store.setMode('advanced');
      expect(store.getSnapshot()).toBe('advanced');
    }
  });

  it('notifies only valid changes and releases subscriptions', () => {
    const store = createBasicUiStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.setMode('advanced');
    store.setMode('invalid' as never);
    expect(listener).not.toHaveBeenCalled();
    store.setMode('basic');
    expect(listener).toHaveBeenCalledOnce();
    off();
    store.setMode('advanced');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('updates hook subscribers without changing the route', () => {
    window.history.replaceState(null, '', '/threads/current?kept=1#anchor');
    const { result } = renderHook(useBasicUi);
    expect(result.current).toBe(false);
    act(() => setBasicUiMode('basic'));
    expect(result.current).toBe(true);
    expect(getBasicUiMode()).toBe('basic');
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/threads/current?kept=1#anchor');
  });
});

describe('Basic route presentation policy', () => {
  it.each(['/', '/threads/new', '/threads/a', '/projects/p/threads/new', '/projects/p/threads/t'])('supports %s', path => {
    expect(isBasicUiRouteSupported(path)).toBe(true);
  });
  it.each(['/agents', '/inbox', '/scheduler', '/schedules/new', '/settings', '/projects/p', '/projects/p/terminals', '/projects/p/inbox', '/sessions/legacy', '/projects/p/sessions/legacy', '/tools/plugins', '/plugins/custom', '/not-a-route'])('requires Advanced for %s', path => {
    expect(isBasicUiRouteSupported(path)).toBe(false);
  });
});
