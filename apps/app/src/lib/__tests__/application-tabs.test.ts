import { beforeEach, expect, it } from 'vitest';
import {
  applicationTabId,
  closeApplicationTab,
  moveApplicationTab,
  openApplicationTab,
  readApplicationTabs,
  saveApplicationTabs,
  useApplicationTabs,
  type ApplicationTabsState,
  type ThreadApplicationTab
} from '../application-tabs.js';
const thread = (id: string, projectId = 'p'): ThreadApplicationTab => ({
  kind: 'thread',
  threadId: id,
  projectId,
  projectScoped: false
});
const setup = { kind: 'setup', setupId: 'clone' } as const;
const empty = (): ApplicationTabsState => ({ open: [], closed: [] });
beforeEach(() =>
  useApplicationTabs.setState({ ...empty(), initializedScope: undefined })
);

it('orders all tab kinds together, deduplicates identity and updates thread scope without moving the tab', () => {
  let state = openApplicationTab(empty(), thread('clone'));
  state = openApplicationTab(state, setup);
  expect(state.open.map(applicationTabId)).toEqual([
    'thread:clone',
    'setup:clone'
  ]);
  expect(openApplicationTab(state, setup)).toBe(state);
  state = openApplicationTab(state, {
    ...thread('clone'),
    projectScoped: true
  });
  expect(state.open[0]).toMatchObject({ projectScoped: true });
  expect(
    moveApplicationTab(state, 'setup:clone', 'thread:clone').open.map(
      applicationTabId
    )
  ).toEqual(['setup:clone', 'thread:clone']);
  expect(moveApplicationTab(state, 'missing', 'thread:clone')).toBe(state);
  expect(moveApplicationTab(state, 'setup:clone', 'missing')).toBe(state);
  expect(moveApplicationTab(state, 'setup:clone', 'setup:clone')).toBe(state);
});
it('bounds conversation shortcuts and recent history without evicting setup drafts', () => {
  let state = openApplicationTab(empty(), setup);
  for (let i = 0; i < 45; i++)
    state = openApplicationTab(state, thread(String(i)));
  expect(state.open).toHaveLength(41);
  expect(state.open[0]).toEqual(setup);
  expect(state.open[1]).toEqual(thread('5'));
  for (let i = 5; i < 45; i++)
    state = closeApplicationTab(state, `thread:${i}`);
  expect(state.closed).toHaveLength(10);
  expect(state.closed.at(-1)).toEqual(thread('44'));
  state = closeApplicationTab(state, 'setup:clone');
  expect(state.open).toEqual([]);
  expect(state.closed).toHaveLength(10);
  state = openApplicationTab(state, thread('44'));
  expect(state.closed).not.toContainEqual(thread('44'));
  state = closeApplicationTab(state, 'thread:43', false);
  expect(state.closed).not.toContainEqual(thread('43'));
  expect(closeApplicationTab(state, 'missing')).toEqual(state);
});
it('migrates validated legacy thread shortcuts, confines project windows and never serializes setup or plugin state', () => {
  const legacy = JSON.stringify({
    open: [thread('a'), thread('b', 'q'), {}, thread('a')],
    closed: [thread('a'), thread('c')]
  });
  const storage = new Map<string, string>([
    ['zcc.thread-tabs.v1:main', legacy]
  ]);
  const io = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    }
  };
  expect(readApplicationTabs(io, null)).toEqual({
    open: [thread('a'), thread('b', 'q')],
    closed: [thread('c')]
  });
  const state = { open: [setup, thread('a')], closed: [thread('c')] };
  saveApplicationTabs(io, null, state);
  expect(storage.get('zcc.application-tabs.v1:main')).not.toContain('setup');
  expect(readApplicationTabs(io, null)).toEqual({
    open: [thread('a')],
    closed: [thread('c')]
  });
  storage.set('zcc.application-tabs.v1:p', legacy);
  expect(readApplicationTabs(io, 'p').open).toEqual([thread('a')]);
  storage.set('zcc.application-tabs.v1:main', '{broken');
  expect(readApplicationTabs(io, null)).toEqual(empty());
  const unavailable = {
    getItem() {
      throw new Error('disabled');
    },
    setItem() {
      throw new Error('disabled');
    }
  };
  expect(readApplicationTabs(unavailable, null)).toEqual(empty());
  expect(() => saveApplicationTabs(unavailable, null, state)).not.toThrow();
});
it('initializes a window once, merges live drafts, and isolates other project windows', () => {
  const store = useApplicationTabs.getState();
  store.openTab(setup);
  const storage = {
    getItem: () => JSON.stringify({ open: [thread('a')], closed: [] })
  };
  store.initialize(storage, null);
  expect(useApplicationTabs.getState().open).toEqual([thread('a'), setup]);
  store.moveTab('setup:clone', 'thread:a');
  store.initialize(storage, null);
  expect(useApplicationTabs.getState().open[0]).toEqual(setup);
  store.closeTab('thread:a');
  expect(useApplicationTabs.getState().closed).toEqual([thread('a')]);
  store.initialize({ getItem: () => null }, 'q');
  expect(useApplicationTabs.getState().open).toEqual([]);
});
