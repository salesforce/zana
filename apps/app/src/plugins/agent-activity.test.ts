import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ data: { configLoaded: true, terminals: {} as Record<string, any[]> }, threads: { loading: false, threads: [] as any[] }, states: { byId: {} }, scoped: false, thread: false, plugin: false,
  listeners: [new Set<() => void>(), new Set<() => void>(), new Set<() => void>()] }));
vi.mock('../store.js', () => ({ useData: { getState: () => h.data, subscribe: (fn: () => void) => { h.listeners[0]!.add(fn); return () => h.listeners[0]!.delete(fn); } } }));
vi.mock('../thread-store.js', () => ({ useThreads: { getState: () => h.threads, subscribe: (fn: () => void) => { h.listeners[1]!.add(fn); return () => h.listeners[1]!.delete(fn); } } }));
vi.mock('../stores/live.js', () => ({ useAgentStatus: { getState: () => h.states, subscribe: (fn: () => void) => { h.listeners[2]!.add(fn); return () => h.listeners[2]!.delete(fn); } } }));
vi.mock('../lib/windowScope.js', () => ({ isScopedWindow: () => h.scoped }));
vi.mock('../lib/threadViewSurface.js', () => ({ isThreadViewSurface: () => h.thread }));
vi.mock('../lib/pluginViewSurface.js', () => ({ getPluginViewTarget: () => h.plugin }));
import { projectAgentActivity, observeAgentActivity } from './agent-activity.js';
const thread = (id: string, status: string, extra = {}) => ({ id, status, ...extra }) as any;
const cli = (id: string, extra = {}) => ({ id, profile: 'codex', status: 'running', ...extra }) as any;
beforeEach(() => { h.data = { configLoaded: true, terminals: {} }; h.threads = { loading: false, threads: [] }; h.states = { byId: {} }; h.scoped = h.thread = h.plugin = false; h.listeners.forEach(set => set.clear()); });
describe('generic plugin agent activity', () => {
  it('projects thread work, input, idle, background work and unknown states without content', () => {
    const agents = projectAgentActivity([thread('1', 'active'), thread('2', 'idle', { hasPendingInteraction: true }), thread('3', 'idle'), thread('4', 'error', { hasPendingInteraction: true }), thread('5', 'stopping'), thread('6', 'idle', { activity: { activeBackgroundCommandCount: 1 } }), thread('7', 'active', { runtime: { displayStatus: 'host-reconnecting' } }), thread('8', 'new'), thread('9', 'starting'), thread('10', 'provisioning')], [], {});
    expect(agents.map(a => a.state)).toEqual(['working', 'needs-you', 'idle', 'unknown', 'unknown', 'working', 'unknown', 'unknown', 'working', 'working']);
    expect(Object.keys(agents[0]!)).toEqual(['id', 'kind', 'state']);
  });
  it('excludes hidden and archived threads, and invisible, scheduled, exited or shell sessions', () => {
    expect(projectAgentActivity([thread('1', 'idle', { archivedAt: 0 }), thread('2', 'idle', { visibility: 'hidden' })], [cli('1', { headless: true }), cli('2', { scheduled: true }), cli('3', { status: 'exited' }), cli('4', { profile: 'shell' })], {})).toEqual([]);
  });
  it('uses already-authorized CLI display states and treats uncertain waits as unknown', () => {
    expect(projectAgentActivity([], ['blocked', 'working', 'idle', 'done', 'waiting', 'unknown'].map(id => cli(id)), { blocked: 'blocked', working: 'working', idle: 'idle', done: 'done', waiting: 'waiting', unknown: 'unknown' }).map(a => a.state)).toEqual(['needs-you', 'working', 'idle', 'idle', 'unknown', 'unknown']);
  });
  it('bounds both projections', () => {
    expect(projectAgentActivity(Array.from({ length: 1100 }, (_, i) => thread(String(i), 'idle')), [], {})).toHaveLength(1000);
    expect(projectAgentActivity([], Array.from({ length: 1100 }, (_, i) => cli(String(i))), {})).toHaveLength(1000);
  });
  it('emits initial and changed snapshots only and releases every subscription', () => {
    const listener = vi.fn(), off = observeAgentActivity(listener); expect(listener).toHaveBeenCalledExactlyOnceWith({ ready: true, agents: [] });
    h.listeners[0]!.forEach(fn => fn()); expect(listener).toHaveBeenCalledTimes(1);
    h.threads.threads = [thread('new', 'active')]; h.listeners[1]!.forEach(fn => fn()); expect(listener).toHaveBeenCalledTimes(2);
    h.data.configLoaded = false; h.listeners[2]!.forEach(fn => fn()); expect(listener.mock.lastCall?.[0].ready).toBe(false);
    off(); h.listeners.forEach(set => expect(set.size).toBe(0));
  });
  it.each(['scoped', 'thread', 'plugin'] as const)('does not claim a fleet from a %s window', surface => {
    h[surface] = true; const listener = vi.fn(), off = observeAgentActivity(listener); expect(listener).toHaveBeenCalledExactlyOnceWith({ ready: false, agents: [] }); off(); h.listeners.forEach(set => expect(set.size).toBe(0));
  });
  it('cleans subscriptions if an initial listener throws', () => {
    expect(() => observeAgentActivity(() => { throw new Error('broken plugin'); })).toThrow('broken plugin'); h.listeners.forEach(set => expect(set.size).toBe(0));
  });
  it('waits for initial hydration but preserves readiness during routine roster refreshes', () => {
    h.threads.loading = true; const listener = vi.fn(), off = observeAgentActivity(listener);
    expect(listener.mock.lastCall?.[0].ready).toBe(false);
    h.threads.loading = false; h.listeners[1]!.forEach(fn => fn()); expect(listener.mock.lastCall?.[0].ready).toBe(true);
    h.threads.loading = true; h.listeners[1]!.forEach(fn => fn()); expect(listener).toHaveBeenCalledTimes(2);
    h.threads.threads = [thread('a', 'idle')]; h.listeners[1]!.forEach(fn => fn()); expect(listener.mock.lastCall?.[0]).toEqual({ ready: true, agents: [{ id: 'a', kind: 'thread', state: 'idle' }] }); off();
  });
});
