// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  bridge: true,
  projects: [] as Array<{ id: string }>,
  list: vi.fn(),
  remove: vi.fn(),
  recoveryApply: null as null | { terminals: (projectId: string, sessions: unknown[]) => void }
}));
vi.mock('../lib/app-surface.js', () => ({ hasDesktopBridge: () => h.bridge }));
vi.mock('../lib/client-recovery.js', () => ({
  subscribeClientRecovery: (_p: unknown, apply: { terminals: (projectId: string, sessions: unknown[]) => void }) => {
    h.recoveryApply = apply;
    return () => {};
  }
}));
vi.mock('../lib/product-client.js', () => ({ product: new Proxy({}, { get: (_t, group) => new Proxy({}, {
  get: (_t2, method) => {
    if (method === 'groups') return { list: async () => [], onChanged: () => () => {} };
    if (group === 'projects' && method === 'list') return async () => h.projects;
    if (group === 'projects' && method === 'remove') return (...a: unknown[]) => h.remove(...a);
    if (group === 'terminals' && method === 'list') return (...a: unknown[]) => h.list(...a);
    if (group === 'config' && method === 'get') return async () => ({ walkthroughCompleted: true, setupDismissed: true });
    if (group === 'config' && method === 'set') return async () => ({});
    if (String(method).startsWith('on')) return () => () => {};
    if (method === 'history') return async () => ({ entries: [] });
    if (method === 'getReadState') return async () => ({ readIds: {}, migratedFromLocalStorage: true });
    if (method === 'consumeWhatsNew') return async () => null;
    return async () => [];
  }
}) }) }));
import { useData } from '../store.js';

const sess = (id: string, projectId: string) => ({ id, projectId, title: id, profile: 'shell', cwd: '/', status: 'running', createdAt: 1 });

beforeEach(() => {
  h.bridge = true;
  h.projects = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  h.list.mockReset();
  h.remove.mockReset();
  h.recoveryApply = null;
  useData.setState({ terminals: {}, terminalsLoaded: {} });
});

it('starts empty, then flags each project whose list resolved (even empty); failed list stays unflagged', async () => {
  expect(useData.getState().terminalsLoaded).toEqual({});
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  h.list.mockImplementation(async (id: string) => {
    if (id === 'a') { await gate; return [sess('s1', 'a')]; }
    if (id === 'b') return [];
    throw new Error('boom');
  });
  const pending = useData.getState().init();
  await vi.waitFor(() => expect(h.list).toHaveBeenCalledTimes(3));
  expect(useData.getState().terminalsLoaded.a).toBeUndefined();
  release();
  await pending;
  const s = useData.getState();
  expect(s.terminalsLoaded).toEqual({ a: true, b: true });
  expect(s.terminalsLoaded.c).toBeUndefined();
  expect(s.terminals.a).toHaveLength(1);
  expect(s.terminals.b).toBeUndefined();
});

it('client-recovery hydration path flags the project', async () => {
  h.bridge = false;
  h.list.mockResolvedValue([]);
  await useData.getState().init();
  h.recoveryApply!.terminals('a', [sess('s1', 'a')]);
  expect(useData.getState().terminalsLoaded.a).toBe(true);
  expect(useData.getState().terminals.a).toHaveLength(1);
});

it('removeProject deletes the flag; failed remove keeps it', async () => {
  useData.setState({
    projects: [{ id: 'a', name: 'A', path: '/a', createdAt: 1, lastActiveAt: 1 }] as never,
    terminals: { a: [] },
    terminalsLoaded: { a: true, b: true }
  });
  h.remove.mockRejectedValueOnce(new Error('busy'));
  await useData.getState().removeProject('a');
  expect(useData.getState().terminalsLoaded.a).toBe(true);
  h.remove.mockResolvedValueOnce(undefined);
  await useData.getState().removeProject('a');
  expect(useData.getState().terminalsLoaded).toEqual({ b: true });
});
