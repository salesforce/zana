// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
const config = vi.hoisted(() => ({ value: {} as Record<string, unknown>, changed: null as null | ((value: any) => void), set: null as null | ((patch: unknown) => Promise<unknown>) }));
vi.mock('../lib/app-surface.js', () => ({ hasDesktopBridge: () => true }));
vi.mock('../lib/product-client.js', () => ({ product: new Proxy({}, { get: (_target, group) => new Proxy({}, {
  get: (_target, method) => {
    if (method === 'groups') return { list: async () => [], onChanged: () => () => {} };
    if (group === 'config' && method === 'get') return async () => config.value;
    if (group === 'config' && method === 'set') return (patch: unknown) => config.set ? config.set(patch) : Promise.resolve();
    if (group === 'config' && method === 'onChanged') return (listener: any) => { config.changed = listener; return () => {}; };
    if (String(method).startsWith('on')) return () => () => {};
    if (method === 'history') return async () => ({ entries: [] });
    if (method === 'getReadState') return async () => ({ readIds: {}, migratedFromLocalStorage: true });
    if (method === 'consumeWhatsNew') return async () => null;
    return async () => [];
  }
}) }) }));
import { useData, useUi } from '../store.js';
afterEach(() => vi.restoreAllMocks());

it.each(['board', 'list', 'flow', 'plugin:city/world', 'invalid', undefined])('hydrates only valid saved Agents views: %s', async preferred => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  config.value = { agentsBoardView: preferred, walkthroughCompleted: true, setupDismissed: true };
  useUi.setState({ agentsBoardView: 'board' });
  await useData.getState().init();
  expect(useData.getState().configLoaded).toBe(true);
  expect(useUi.getState().agentsBoardView).toBe(['board', 'list', 'flow', 'plugin:city/world'].includes(preferred ?? '') ? preferred : 'board');
});


it.each([undefined, true, false])('hydrates thread tabs with default enabled: %s', async enabled => {
  config.value = { threadTabsEnabled: enabled, walkthroughCompleted: true, setupDismissed: true };
  await useData.getState().init();
  expect(useData.getState().threadTabsEnabled).toBe(enabled ?? true);
  config.changed?.({ ...config.value, threadTabsEnabled: false });
  expect(useData.getState().threadTabsEnabled).toBe(false);
  config.changed?.({ ...config.value, threadTabsEnabled: true });
  expect(useData.getState().threadTabsEnabled).toBe(true);
  useData.getState().setThreadTabsEnabled(false);
  expect(useData.getState().threadTabsEnabled).toBe(false);
});


it.each([undefined, true, false])('hydrates dockable thread tools with default enabled: %s', async enabled => {
  config.value = { dockableThreadToolsEnabled: enabled, walkthroughCompleted: true, setupDismissed: true };
  await useData.getState().init();
  expect(useData.getState().dockableThreadToolsEnabled).toBe(enabled ?? true);
  config.changed?.({ ...config.value, dockableThreadToolsEnabled: false });
  expect(useData.getState().dockableThreadToolsEnabled).toBe(false);
  config.changed?.({ ...config.value, dockableThreadToolsEnabled: true });
  expect(useData.getState().dockableThreadToolsEnabled).toBe(true);
  useData.getState().setDockableThreadToolsEnabled(false);
  expect(useData.getState().dockableThreadToolsEnabled).toBe(false);
});
it('hydrates and live-syncs projectExpanded and collapsedSections from config', async () => {
  config.value = {
    collapsedSections: { 'sidebar:machine:local': true },
    projectExpanded: { 'proj-1': false, 'local:default': false },
    walkthroughCompleted: true,
    setupDismissed: true
  };
  await useData.getState().init();
  expect(useUi.getState().collapsedSections).toEqual({ 'sidebar:machine:local': true });
  expect(useUi.getState().projectExpanded).toEqual({ 'proj-1': false, 'local:default': false });

  config.changed?.({
    ...config.value,
    collapsedSections: {},
    projectExpanded: { 'proj-1': true }
  });
  expect(useUi.getState().collapsedSections).toEqual({});
  expect(useUi.getState().projectExpanded).toEqual({ 'proj-1': true });
});

it('migrates a legacy collapse key once, letting an existing new key win', () => {
  useUi.setState({ collapsedSections: { 'sidebar:machine:host-1': true } });
  const before = useUi.getState();
  useUi.getState().migrateSectionKey('sidebar:machine:absent', 'sidebar:machine:local');
  useUi.getState().migrateSectionKey('sidebar:machine:host-1', 'sidebar:machine:host-1');
  expect(useUi.getState()).toBe(before);
  useUi.getState().migrateSectionKey('sidebar:machine:host-1', 'sidebar:machine:local');
  expect(useUi.getState().collapsedSections).toEqual({ 'sidebar:machine:local': true });
  useUi.setState({ collapsedSections: { 'sidebar:machine:host-1': true, 'sidebar:machine:local': false } });
  useUi.getState().migrateSectionKey('sidebar:machine:host-1', 'sidebar:machine:local');
  expect(useUi.getState().collapsedSections).toEqual({ 'sidebar:machine:local': false });
});

it('keeps local disclosure maps while a debounced write is pending', async () => {
  // Let debounced writes from earlier tests land so init hydrates from config.
  await new Promise(resolve => setTimeout(resolve, 250));
  config.value = { collapsedSections: {}, projectExpanded: {}, walkthroughCompleted: true, setupDismissed: true };
  await useData.getState().init();
  vi.useFakeTimers();
  try {
    useUi.getState().setProjectExpanded('proj-a', true);
    useUi.getState().toggleSection('sec-a');
    config.changed?.({ ...config.value, hideIdleProjects: true });
    expect(useUi.getState().projectExpanded).toEqual({ 'proj-a': true });
    expect(useUi.getState().collapsedSections).toEqual({ 'sec-a': true });
    expect(useUi.getState().hideIdleProjects).toBe(true);
    vi.advanceTimersByTime(250);
    await vi.waitFor(() => {
      config.changed?.({ ...config.value, projectExpanded: { 'proj-b': false }, collapsedSections: {} });
      expect(useUi.getState().projectExpanded).toEqual({ 'proj-b': false });
      expect(useUi.getState().collapsedSections).toEqual({});
    });
  } finally {
    vi.useRealTimers();
  }
});

it('keeps local disclosure maps while the config write is still in flight', async () => {
  await new Promise(resolve => setTimeout(resolve, 250));
  config.value = { collapsedSections: {}, projectExpanded: {}, walkthroughCompleted: true, setupDismissed: true };
  await useData.getState().init();
  const settle: Array<(ok: boolean) => void> = [];
  const patches: unknown[] = [];
  config.set = patch => { patches.push(patch); return new Promise((resolve, reject) => settle.push(ok => ok ? resolve(undefined) : reject(new Error('write failed')))); };
  vi.useFakeTimers();
  try {
    useUi.getState().setProjectExpanded('proj-a', true);
    useUi.getState().toggleSection('sec-a');
    vi.advanceTimersByTime(250);
    await vi.waitFor(() => expect(settle).toHaveLength(2));
    // Debounce has fired but neither write has settled: a stale broadcast must not win.
    config.changed?.({ ...config.value, projectExpanded: {}, collapsedSections: {} });
    expect(useUi.getState().projectExpanded).toEqual({ 'proj-a': true });
    expect(useUi.getState().collapsedSections).toEqual({ 'sec-a': true });
    useUi.getState().setProjectExpanded('proj-b', false);
    vi.advanceTimersByTime(250);
    await vi.waitFor(() => expect(patches.at(-1)).toEqual({ projectExpanded: { 'proj-a': true, 'proj-b': false } }));
    settle.forEach((done, index) => done(index !== 1));
    await vi.waitFor(() => {
      config.changed?.({ ...config.value, projectExpanded: { 'proj-c': true }, collapsedSections: { 'sec-b': true } });
      expect(useUi.getState().projectExpanded).toEqual({ 'proj-c': true });
      expect(useUi.getState().collapsedSections).toEqual({ 'sec-b': true });
    });
  } finally {
    config.set = null;
    vi.useRealTimers();
  }
});

it('moves the latest projectExpanded toggle to the end and caps the map', () => {
  const seeded: Record<string, boolean> = {};
  for (let i = 0; i < 200; i += 1) seeded[`p${i}`] = true;
  useUi.setState({ projectExpanded: seeded });
  useUi.getState().setProjectExpanded('p0', false);
  expect(Object.keys(useUi.getState().projectExpanded).at(-1)).toBe('p0');
  useUi.getState().toggleProjectExpanded('fresh');
  const keys = Object.keys(useUi.getState().projectExpanded);
  expect(keys).toHaveLength(200);
  expect(keys.at(-1)).toBe('fresh');
  expect(useUi.getState().projectExpanded.p1).toBeUndefined();
});
