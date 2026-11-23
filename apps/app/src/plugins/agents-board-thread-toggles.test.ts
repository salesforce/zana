// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENTS_BOARD_THREAD_TOGGLES_KEY, isThreadHiddenByPluginToggle } from './agents-board-thread-toggles.js';

async function freshStore() {
  vi.resetModules();
  return (await import('./agents-board-thread-toggles.js')).useAgentsBoardThreadToggles;
}

describe('agents board thread toggles', () => {
  beforeEach(() => localStorage.clear());

  it('starts with every plugin hidden and persists choices', async () => {
    const store = await freshStore();
    expect(store.getState().shown).toEqual({});
    store.getState().setShown('alpha', true);
    store.getState().setShown('beta', true);
    store.getState().setShown('beta', false);
    expect(store.getState().shown).toEqual({ alpha: true });
    expect(JSON.parse(localStorage.getItem(AGENTS_BOARD_THREAD_TOGGLES_KEY)!)).toEqual(['alpha']);
    expect((await freshStore()).getState().shown).toEqual({ alpha: true });
  });

  it('ignores malformed stored values', async () => {
    localStorage.setItem(AGENTS_BOARD_THREAD_TOGGLES_KEY, '{"not":"a list"}');
    expect((await freshStore()).getState().shown).toEqual({});
    localStorage.setItem(AGENTS_BOARD_THREAD_TOGGLES_KEY, '[1,"",null,"ok"]');
    expect((await freshStore()).getState().shown).toEqual({ ok: true });
    localStorage.setItem(AGENTS_BOARD_THREAD_TOGGLES_KEY, '{broken');
    expect((await freshStore()).getState().shown).toEqual({});
  });

  it('keeps the in-memory choice when storage writes fail', async () => {
    const store = await freshStore();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    store.getState().setShown('alpha', true);
    expect(store.getState().shown).toEqual({ alpha: true });
    spy.mockRestore();
  });

  it('hides only threads owned by a toggle plugin that is off', () => {
    const toggles = new Set(['alpha']);
    expect(isThreadHiddenByPluginToggle({ originPluginId: 'alpha' }, toggles, {})).toBe(true);
    expect(isThreadHiddenByPluginToggle({ originPluginId: 'alpha' }, toggles, { alpha: true })).toBe(false);
    expect(isThreadHiddenByPluginToggle({ originPluginId: 'other' }, toggles, {})).toBe(false);
    expect(isThreadHiddenByPluginToggle({ originPluginId: null }, toggles, {})).toBe(false);
    expect(isThreadHiddenByPluginToggle({}, toggles, {})).toBe(false);
  });
});
