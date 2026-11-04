// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeThreadTab, MAX_THREAD_TABS, openThreadTab, readThreadTabs, saveThreadTabs, type ThreadTab, type ThreadTabsState } from './thread-tabs.js';

const tab = (id: string, projectId = 'p'): ThreadTab => ({ threadId: id, projectId, projectScoped: false });
const empty = (): ThreadTabsState => ({ open: [], closed: [] });
beforeEach(() => sessionStorage.clear());

describe('thread tab history', () => {
  it('keeps visit order stable, updates route scope and avoids duplicates', () => {
    let state = openThreadTab(empty(), tab('a'));
    state = openThreadTab(state, tab('b'));
    expect(openThreadTab(state, tab('a'))).toBe(state);
    state = openThreadTab(state, { ...tab('a'), projectScoped: true });
    expect(state.open.map(row => row.threadId)).toEqual(['a', 'b']);
    expect(state.open[0]!.projectScoped).toBe(true);
    expect(closeThreadTab(state, 'missing')).toBe(state);
  });

  it('caps the strip and closed history, restores a shortcut and forgets archived entries', () => {
    let state = empty();
    for (let n = 0; n < MAX_THREAD_TABS + 5; n++) state = openThreadTab(state, tab(String(n)));
    expect(state.open).toHaveLength(MAX_THREAD_TABS);
    expect(state.open[0]!.threadId).toBe('5');
    for (let n = 5; n < 20; n++) state = closeThreadTab(state, String(n));
    expect(state.closed).toHaveLength(10);
    state = openThreadTab(state, tab('19'));
    expect(state.closed.some(row => row.threadId === '19')).toBe(false);
    state = closeThreadTab(state, '19', false);
    expect(state.open.some(row => row.threadId === '19')).toBe(false);
    state = closeThreadTab(state, '18', false);
    expect(state.closed.some(row => row.threadId === '18')).toBe(false);
  });

  it('restores separate per-window/scope state and accepts no foreign-project entries in a scoped window', () => {
    const state = { open: [tab('a'), tab('b', 'q')], closed: [tab('c')] };
    saveThreadTabs(sessionStorage, null, state);
    expect(readThreadTabs(sessionStorage, null)).toEqual(state);
    expect(readThreadTabs(sessionStorage, 'p')).toEqual(empty());
    saveThreadTabs(sessionStorage, 'p', state);
    expect(readThreadTabs(sessionStorage, 'p')).toEqual({ open: [tab('a')], closed: [tab('c')] });
  });

  it('bounds and validates stored rows, deduplicating open/closed entries', () => {
    const invalid = [null, {}, tab(''), { ...tab('a'), projectScoped: 'yes' }, tab('x'.repeat(513)), tab('p', ''), tab('p', 'x'.repeat(513))];
    saveThreadTabs(sessionStorage, null, { open: [...invalid, tab('a'), tab('a'), ...Array.from({ length: 50 }, (_, n) => tab(String(n)))], closed: [tab('49'), ...Array.from({ length: 20 }, (_, n) => tab(`c${n}`))] } as ThreadTabsState);
    const state = readThreadTabs(sessionStorage, null);
    expect(state.open).toHaveLength(MAX_THREAD_TABS);
    expect(state.open[0]!.threadId).toBe('10');
    expect(state.closed).toHaveLength(10);
    saveThreadTabs(sessionStorage, null, { open: [tab('a')], closed: [tab('a'), tab('b'), tab('b')] });
    expect(readThreadTabs(sessionStorage, null)).toEqual({ open: [tab('a')], closed: [tab('b')] });
  });

  it('survives corrupt, missing, wrong-shaped and unavailable storage', () => {
    for (const data of ['no json', 'null', '0', '"oops"', '{}', '{"open":1,"closed":{}}']) {
      sessionStorage.setItem('zcc.thread-tabs.v1:main', data);
      expect(readThreadTabs(sessionStorage, null)).toEqual(empty());
    }
    expect(readThreadTabs({ getItem: () => { throw new Error('denied'); } }, null)).toEqual(empty());
    expect(readThreadTabs({ getItem: () => 'x'.repeat(128_001) }, null)).toEqual(empty());
    const setItem = vi.fn(() => { throw new Error('full'); });
    expect(() => saveThreadTabs({ setItem }, null, empty())).not.toThrow();
    expect(setItem).toHaveBeenCalledOnce();
  });
});
