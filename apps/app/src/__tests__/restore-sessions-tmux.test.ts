import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';

const listTmuxRestoreCandidates = vi.fn();
const restore = vi.fn();

vi.mock('../lib/product-client.js', () => ({
  product: {
    terminals: {
      listTmuxRestoreCandidates: (...args: unknown[]) => listTmuxRestoreCandidates(...args),
      restore: (...args: unknown[]) => restore(...args)
    },
    threads: { list: vi.fn().mockResolvedValue([]) },
    git: { status: vi.fn().mockRejectedValue(new Error('no git')) }
  }
}));

function session(id: string, over: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id,
    projectId: 'project-1',
    title: id,
    profile: 'shell',
    cwd: '/tmp/p',
    status: 'running',
    createdAt: 1,
    ...over
  } as TerminalSession;
}

async function loadStore() {
  const { useData } = await import('../store.js');
  return useData;
}

// Same dynamic-import-per-test isolation pattern as inboxNavigation.test.ts
// and project-focus-navigation.test.ts: `beforeEach`'s vi.resetModules() only
// clears the module-INSTANTIATION cache, not Vite's compiled-code transform
// cache, so whichever test runs first still pays the one-time COLD TRANSFORM
// of the ~3600-line store.ts (+ transitive deps) — a cost that can spike past
// the default 5s test timeout under full-suite CPU contention. Warm it here,
// in a hook with its own generous timeout, before any test's budget starts.
beforeAll(async () => {
  await import('../store.js');
}, 20_000);

beforeEach(() => {
  vi.resetModules();
  listTmuxRestoreCandidates.mockReset();
  restore.mockReset();
  listTmuxRestoreCandidates.mockResolvedValue([]);
});

describe('useData.restoreSessions tmux reattach', () => {
  it('restores surviving tmux sessions via capability id and does not read zcc.openSessions', async () => {
    const store = new Map<string, string>([[
      'zcc.openSessions',
      JSON.stringify({ 'project-1': [{ profile: 'claude', title: 'Hello' }] })
    ]]);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
        removeItem: (key: string) => { store.delete(key); },
        clear: () => { store.clear(); },
        key: (index: number) => [...store.keys()][index] ?? null,
        get length() { return store.size; }
      }
    });
    listTmuxRestoreCandidates.mockResolvedValue([
      { capabilityId: 'cap-1', projectId: 'project-1' }
    ]);
    restore.mockResolvedValue({
      ok: true,
      value: session('tmux-1')
    });
    const useData = await loadStore();
    useData.setState({
      projects: [{ id: 'project-1', name: 'P', path: '/tmp/p', createdAt: 1, lastActiveAt: 1 }],
      terminals: {}
    });

    await useData.getState().restoreSessions();

    expect(restore).toHaveBeenCalledWith({ capabilityId: 'cap-1' });
    expect(restore.mock.calls[0][0].legacyRequest).toBeUndefined();
    expect(useData.getState().terminals['project-1'].map((row) => row.id)).toEqual(['tmux-1']);
    expect(localStorage.getItem('zcc.openSessions')).toContain('Hello');
  });

  it('does not restore tmux when the project already has live sessions', async () => {
    listTmuxRestoreCandidates.mockResolvedValue([
      { capabilityId: 'cap-1', projectId: 'project-1' }
    ]);
    const useData = await loadStore();
    useData.setState({
      projects: [{ id: 'project-1', name: 'P', path: '/tmp/p', createdAt: 1, lastActiveAt: 1 }],
      terminals: { 'project-1': [session('already-live')] }
    });

    await useData.getState().restoreSessions();

    expect(restore).not.toHaveBeenCalled();
  });

  it('skips a project whose hydration failed', async () => {
    listTmuxRestoreCandidates.mockResolvedValue([
      { capabilityId: 'cap-1', projectId: 'project-1' }
    ]);
    const useData = await loadStore();
    useData.setState({
      projects: [{ id: 'project-1', name: 'P', path: '/tmp/p', createdAt: 1, lastActiveAt: 1 }],
      terminals: {}
    });

    await useData.getState().restoreSessions(new Set(['project-1']));

    expect(restore).not.toHaveBeenCalled();
  });
});
