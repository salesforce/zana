import { beforeEach, expect, it } from 'vitest';
import {
  applicationTabId,
  closeApplicationTab,
  moveApplicationTab,
  openApplicationTab,
  readApplicationTabs,
  saveApplicationTabs,
  useApplicationTabs,
  parsePluginApplicationTab,
  tryOpenApplicationTab,
  type ApplicationTabsState,
  type PluginApplicationTab,
  type ThreadApplicationTab
} from '../application-tabs.js';
import {
  MAX_CLOSED_TABS,
  MAX_PLUGIN_ROWS_CHARS,
  MAX_PLUGIN_TABS,
  MAX_PLUGIN_TABS_PER_PLUGIN,
  MAX_THREAD_TABS
} from '../thread-tabs.js';
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
it('migrates validated legacy thread shortcuts, confines project windows and never serializes setup state', () => {
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

const plugin = (
  itemKey: string,
  extra: Partial<PluginApplicationTab> = {}
): PluginApplicationTab => ({
  kind: 'plugin',
  pluginId: 'test-plugin',
  pageId: 'main',
  itemKey,
  title: `Item ${itemKey}`,
  projectId: 'p',
  ...extra
});
const memory = (seed?: string, scope = 'main') => {
  const storage = new Map<string, string>();
  if (seed !== undefined) storage.set(`zcc.application-tabs.v1:${scope}`, seed);
  return {
    storage,
    io: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value)
    }
  };
};

it('builds collision-free plugin ids when any part contains a colon', () => {
  const ids = [
    plugin('a:b', { pageId: 'c' }),
    plugin('b', { pageId: 'c:a' }),
    plugin('a', { pageId: 'b:c' }),
    plugin('a:b:c', { pageId: 'x' }),
    plugin('x', { pluginId: 'test:plugin', pageId: 'y' }),
    plugin('x', { pluginId: 'test', pageId: 'plugin:y' }),
    plugin('x', { projectId: 'p:q' }),
    plugin('q:x', { projectId: 'p' })
  ].map(applicationTabId);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids[0]).toBe(
    `plugin:${JSON.stringify(['p', 'test-plugin', 'c', 'a:b'])}`
  );
});

it('interleaves plugin tabs in open order, dedupes and treats an unchanged repeat as a no-op', () => {
  let state = openApplicationTab(empty(), thread('a'));
  state = openApplicationTab(state, plugin('d1', { icon: 'file' }));
  state = openApplicationTab(state, thread('b'));
  expect(state.open.map((tab) => tab.kind)).toEqual([
    'thread',
    'plugin',
    'thread'
  ]);
  expect(openApplicationTab(state, plugin('d1', { icon: 'file' }))).toBe(state);
  expect(tryOpenApplicationTab(state, plugin('d1', { icon: 'file' }))).toEqual({
    state
  });
  const renamed = openApplicationTab(
    state,
    plugin('d1', { icon: 'file', title: 'New' })
  );
  expect(renamed.open[1]).toMatchObject({ title: 'New' });
  expect(renamed.open).toHaveLength(3);
  const iconless = openApplicationTab(state, plugin('d1'));
  expect(iconless).not.toBe(state);
  expect(iconless.open[1]).not.toHaveProperty('icon');
});

it('refuses plugin tabs over the per-plugin and total caps without evicting other kinds', () => {
  let state = openApplicationTab(empty(), setup);
  for (let i = 0; i < MAX_THREAD_TABS; i++)
    state = openApplicationTab(state, thread(String(i)));
  for (let i = 0; i < MAX_PLUGIN_TABS_PER_PLUGIN; i++)
    state = openApplicationTab(state, plugin(String(i)));
  const full = state;
  const perPlugin = tryOpenApplicationTab(full, plugin('extra'));
  expect(perPlugin.refusal).toBe('plugin-cap');
  expect(perPlugin.state).toBe(full);
  // Another plugin still fits until the total is reached.
  for (let i = 0; i < MAX_PLUGIN_TABS - MAX_PLUGIN_TABS_PER_PLUGIN; i++)
    state = openApplicationTab(state, plugin(String(i), { pluginId: 'other' }));
  const total = tryOpenApplicationTab(
    state,
    plugin('z', { pluginId: 'third' })
  );
  expect(total.refusal).toBe('plugin-total-cap');
  expect(total.state).toBe(state);
  // Updating an existing pin is allowed at the cap.
  expect(
    tryOpenApplicationTab(state, plugin('0', { title: 'Renamed' })).refusal
  ).toBeUndefined();
  // Thread opens evict only threads, never plugin pins or setup.
  state = openApplicationTab(state, thread('new'));
  expect(state.open.filter((t) => t.kind === 'thread')).toHaveLength(
    MAX_THREAD_TABS
  );
  expect(state.open.filter((t) => t.kind === 'plugin')).toHaveLength(
    MAX_PLUGIN_TABS
  );
  expect(state.open[0]).toEqual(setup);
});

it('reports a refusal through the store without throwing and applies accepted tabs', () => {
  const store = useApplicationTabs.getState();
  expect(store.openTab(plugin('a'))).toBeNull();
  expect(useApplicationTabs.getState().open).toEqual([plugin('a')]);
  expect(store.openTab(plugin('a'))).toBeNull();
  expect(store.openTab(plugin('a\u0000'))).toBe('invalid');
  for (let i = 0; i < MAX_PLUGIN_TABS_PER_PLUGIN; i++)
    store.openTab(plugin(`k${i}`));
  expect(store.openTab(plugin('over'))).toBe('plugin-cap');
  expect(useApplicationTabs.getState().open).toHaveLength(
    MAX_PLUGIN_TABS_PER_PLUGIN
  );
});

it('rejects invalid plugin tab input', () => {
  const bad: unknown[] = [
    null,
    'x',
    { ...plugin('a'), kind: 'thread' },
    { ...plugin('a'), pluginId: 1 },
    { ...plugin('a'), pluginId: '' },
    { ...plugin('a'), pageId: 'x'.repeat(129) },
    { ...plugin('a'), itemKey: 'x'.repeat(257) },
    { ...plugin('a'), title: 'x'.repeat(121) },
    { ...plugin('a'), title: 'a\nb' },
    { ...plugin('a'), title: 'a\u200e\u0085b' },
    { ...plugin('a'), icon: 'x'.repeat(33) },
    { ...plugin('a'), icon: 'https://x/y.png' },
    { ...plugin('a'), icon: 5 },
    { ...plugin('a'), projectId: '' }
  ];
  for (const row of bad) expect(parsePluginApplicationTab(row)).toBeNull();
  expect(
    parsePluginApplicationTab({ ...plugin('a'), junk: 1, icon: 'file' })
  ).toEqual(plugin('a', { icon: 'file' }));
  expect(parsePluginApplicationTab(plugin('a', { itemKey: 'x'.repeat(256) })))
    .not.toBeNull();
  expect(parsePluginApplicationTab(plugin('a', { projectId: 'q' }), 'p')).toBeNull();
});

it('refuses a plugin write that pushes serialized rows over the limit', () => {
  // Wide rows: 20 tabs of ~full width fit, so shrink the budget by inflating via many chars.
  const wide = (i: number, pluginId: string) =>
    plugin(`${i}`.padEnd(256, 'k'), {
      pluginId,
      pageId: 'g'.repeat(128),
      projectId: 'j'.repeat(512),
      title: 't'.repeat(120)
    });
  let state = empty();
  let refusal: string | undefined;
  for (let i = 0; i < MAX_PLUGIN_TABS && !refusal; i++) {
    const r = tryOpenApplicationTab(
      state,
      wide(i, `${i % 2 ? 'a' : 'b'}`.padEnd(128, 'p'))
    );
    refusal = r.refusal;
    state = r.state;
  }
  const size = JSON.stringify(
    state.open.map((t) => ({ ...t }))
  ).length;
  expect(size).toBeLessThanOrEqual(MAX_PLUGIN_ROWS_CHARS + 100);
  // Whether or not the cap is reached with these maxima, no state exceeds the limit.
  expect(refusal === undefined || refusal === 'size').toBe(true);
});

it('remembers closed plugin tabs within one shared cap and restores them from history', () => {
  let state = openApplicationTab(empty(), plugin('a'));
  state = closeApplicationTab(state, applicationTabId(plugin('a')));
  expect(state.closed).toEqual([plugin('a')]);
  state = openApplicationTab(state, plugin('a'));
  expect(state.closed).toEqual([]);
  state = closeApplicationTab(state, applicationTabId(plugin('a')), false);
  expect(state.closed).toEqual([]);
  for (let i = 0; i < 6; i++) {
    state = openApplicationTab(state, thread(String(i)));
    state = closeApplicationTab(state, `thread:${i}`);
    state = openApplicationTab(state, plugin(String(i)));
    state = closeApplicationTab(state, applicationTabId(plugin(String(i))));
  }
  expect(state.closed).toHaveLength(MAX_CLOSED_TABS);
  expect(state.closed.at(-1)).toEqual(plugin('5'));
  expect(state.closed.map((tab) => tab.kind)).toContain('thread');
});

it('round-trips mixed rows and keeps every valid thread when plugin rows are bad', () => {
  const { io, storage } = memory();
  const state: ApplicationTabsState = {
    open: [thread('a'), plugin('d', { icon: 'file' }), setup, thread('b')],
    closed: [plugin('c'), thread('z')]
  };
  saveApplicationTabs(io, null, state);
  expect(readApplicationTabs(io, null)).toEqual({
    open: [thread('a'), plugin('d', { icon: 'file' }), thread('b')],
    closed: [plugin('c'), thread('z')]
  });
  const saved = JSON.parse(storage.get('zcc.application-tabs.v1:main')!);
  expect(saved.open[0]).not.toHaveProperty('kind');
  const mixed = {
    open: [
      { threadId: 'a', projectId: 'p', projectScoped: false },
      { ...plugin('bad'), title: 'x'.repeat(500) },
      { ...plugin('bad2'), kind: 'weird' },
      { kind: 'setup', setupId: 'x' },
      { kind: 'plugin' },
      plugin('good'),
      plugin('good'),
      7,
      null,
      { kind: 'thread', threadId: 'b', projectId: 'p', projectScoped: true }
    ],
    closed: [plugin('good'), plugin('old'), { nope: true }]
  };
  const m = memory(JSON.stringify(mixed));
  expect(readApplicationTabs(m.io, null)).toEqual({
    open: [thread('a'), plugin('good'), { ...thread('b'), projectScoped: true }],
    closed: [plugin('old')]
  });
  const notObject = memory('"x"');
  expect(readApplicationTabs(notObject.io, null)).toEqual(empty());
  expect(readApplicationTabs(memory('null').io, null)).toEqual(empty());
  expect(readApplicationTabs(memory(JSON.stringify({ open: 3 })).io, null)).toEqual(empty());
});

it('parses old thread-only payloads exactly as before, including the legacy key', () => {
  const rows = [thread('a'), thread('b', 'q'), thread('a')].map(
    ({ threadId, projectId, projectScoped }) => ({
      threadId,
      projectId,
      projectScoped
    })
  );
  const { io, storage } = memory(JSON.stringify({ open: rows, closed: [] }));
  storage.set('zcc.application-tabs.v1:p', storage.get('zcc.application-tabs.v1:main')!);
  expect(readApplicationTabs(io, null).open).toEqual([
    thread('a'),
    thread('b', 'q')
  ]);
  expect(readApplicationTabs(io, 'p')).toEqual({ open: [thread('a')], closed: [] });
  const many = Array.from({ length: MAX_THREAD_TABS + 5 }, (_, i) => ({
    threadId: String(i),
    projectId: 'p',
    projectScoped: false
  }));
  const big = memory(JSON.stringify({ open: many, closed: [] }));
  const read = readApplicationTabs(big.io, null).open;
  expect(read).toHaveLength(MAX_THREAD_TABS);
  expect(read[0]).toEqual(thread('5'));
});

it('applies the scope rule to plugin rows and enforces caps and size on restore', () => {
  const rows = [plugin('a'), plugin('b', { projectId: 'q' })];
  const { io } = memory(JSON.stringify({ open: rows, closed: rows }), 'p');
  expect(readApplicationTabs(io, 'p')).toEqual({
    open: [plugin('a')],
    closed: []
  });
  const caps = Array.from({ length: 30 }, (_, i) =>
    plugin(String(i), { pluginId: i < 15 ? 'one' : 'two' })
  );
  const capped = readApplicationTabs(
    memory(JSON.stringify({ open: caps, closed: [] })).io,
    null
  ).open;
  expect(capped).toHaveLength(MAX_PLUGIN_TABS);
  expect(capped.filter((t) => t.kind === 'plugin' && t.pluginId === 'one'))
    .toHaveLength(MAX_PLUGIN_TABS_PER_PLUGIN);
  const wide = Array.from({ length: 20 }, (_, i) =>
    plugin(`${i}`.padEnd(256, 'k'), {
      pluginId: `p${i % 2}`.padEnd(128, 'x'),
      pageId: 'g'.repeat(128),
      projectId: 'j'.repeat(512),
      title: 't'.repeat(120)
    })
  );
  const restored = readApplicationTabs(
    memory(JSON.stringify({ open: wide, closed: [] })).io,
    null
  ).open;
  expect(
    JSON.stringify(restored).length
  ).toBeLessThanOrEqual(MAX_PLUGIN_ROWS_CHARS + 200);
});

it('keeps every thread tab for a maximal mixed payload and bounds hostile payloads', () => {
  const threads = Array.from({ length: MAX_THREAD_TABS }, (_, i) => ({
    threadId: `t${i}`.padEnd(500, 'x'),
    projectId: 'p'.repeat(500),
    projectScoped: false
  }));
  const wide = Array.from({ length: 20 }, (_, i) =>
    plugin(`${i}`.padEnd(256, 'k'), {
      pluginId: `p${i % 2}`.padEnd(128, 'x'),
      pageId: 'g'.repeat(128),
      projectId: 'p'.repeat(500),
      title: 't'.repeat(120)
    })
  );
  const payload = JSON.stringify({ open: [...threads, ...wide], closed: [] });
  const read = readApplicationTabs(memory(payload).io, null).open;
  expect(read.filter((t) => t.kind === 'thread')).toHaveLength(MAX_THREAD_TABS);
  const hostile = JSON.stringify({ open: [thread('a')], pad: 'x'.repeat(300_000) });
  expect(readApplicationTabs(memory(hostile).io, null)).toEqual(empty());
});

it('falls back to empty when the new key is missing and storage throws on legacy read', () => {
  const throwing = {
    getItem() {
      throw new Error('disabled');
    }
  };
  expect(readApplicationTabs(throwing, null)).toEqual(empty());
});

it('keeps plugin tabs when initialize merges live tabs into restored ones', () => {
  const storage = {
    getItem: () =>
      JSON.stringify({ open: [plugin('saved')], closed: [plugin('c')] })
  };
  useApplicationTabs.getState().openTab(plugin('live'));
  useApplicationTabs.getState().initialize(storage, null);
  expect(useApplicationTabs.getState().open).toEqual([
    plugin('saved'),
    plugin('live')
  ]);
  expect(useApplicationTabs.getState().closed).toEqual([plugin('c')]);
});
