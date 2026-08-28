/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import type { ModuleHost } from './host.js';
import PrMonitorBackground from './PrMonitorBackground.js';
import {
  SETTINGS_STORAGE_KEY,
  DEFAULT_PR_MONITOR_SETTINGS,
  PREFETCH_AUTHOR_CACHE_KEY,
  PREFETCH_ORGS_CACHE_KEY,
  PREFETCH_REPOS_CACHE_KEY,
  type MonitoredPr,
  type MonitoredRepo,
  type PrMonitorSettings,
  type PrStatusDelta,
} from '../../lib/types.js';

/**
 * Behavior tests for the always-mounted delivery loop: the R-NOTIF-002/003
 * AND-chain (in-app toast + inbox) and the R-SYS-002 auto-sync gate.
 */

function repo(over: Partial<MonitoredRepo> = {}): MonitoredRepo {
  return {
    owner: 'acme',
    repo: 'widgets',
    host: 'github.com',
    orgLogin: 'acme',
    active: true,
    tisPreset: 'standard',
    createdAt: 0,
    notifyInApp: true,
    ...over,
  };
}

function delta(over: Partial<MonitoredPr> = {}): PrStatusDelta {
  const pr = {
    url: 'https://github.com/acme/widgets/pull/1',
    repo: 'acme/widgets',
    number: 1,
    title: 'Add thing',
    status: 'green',
    addedAt: 0,
    projectId: 'p1',
    ...over,
  } as MonitoredPr;
  return { url: pr.url, oldStatus: 'yellow', newStatus: 'green', pr };
}

function makeHost(opts: {
  settings?: Partial<PrMonitorSettings>;
  deltas?: PrStatusDelta[];
}) {
  const settings: PrMonitorSettings = {
    ...DEFAULT_PR_MONITOR_SETTINGS,
    repositories: [repo()],
    ...opts.settings,
  };
  const toast = vi.fn();
  const pushInbox = vi.fn(async (_input: { comments: string; projectId?: string }) => ({ id: 'x' }));
  const call = vi.fn(async (cap: string) => {
    if (cap === 'listPrs') return [] as MonitoredPr[];
    if (cap === 'pollAll') {
      const prs = (opts.deltas ?? []).map((d) => d.pr);
      return { ok: true, prs, deltas: opts.deltas ?? [] };
    }
    return undefined;
  });
  const host = {
    moduleId: 'pr-monitor',
    call: call as unknown as ModuleHost['call'],
    storage: {
      get: async (k: string) => (k === SETTINGS_STORAGE_KEY ? settings : undefined),
      set: async () => {},
    },
    pushInbox,
    toast,
    cache: { get: () => undefined, set: () => {}, delete: () => {}, refreshBadge: () => {} },
  } as unknown as ModuleHost;
  return { host, toast, pushInbox, call };
}

/** Advance past the 2s first-tick delay and flush the async tick body. */
async function runFirstTick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_100);
  });
}

describe('PrMonitorBackground — delivery loop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('AC-NOTIF-2.2: in-app on → raises a toast on an interesting change', async () => {
    const { host, toast } = makeHost({
      settings: { notifyInApp: true, sendToInbox: false },
      deltas: [delta()],
    });
    render(<PrMonitorBackground host={host} />);
    await runFirstTick();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('acme/widgets#1'), 'info');
  });

  it('AC-NOTIF-3.2: send-to-inbox on + project → posts an inbox entry', async () => {
    const { host, pushInbox } = makeHost({
      settings: { notifyInApp: false, sendToInbox: true },
      deltas: [delta({ projectId: 'p1' })],
    });
    render(<PrMonitorBackground host={host} />);
    await runFirstTick();
    expect(pushInbox).toHaveBeenCalledTimes(1);
    expect(pushInbox.mock.calls[0][0]).toMatchObject({ projectId: 'p1' });
  });

  it('AC-NOTIF-3.6 / AC-LIST-18.1: a muted PR is silenced on both surfaces', async () => {
    const { host, toast, pushInbox } = makeHost({
      settings: { notifyInApp: true, sendToInbox: true },
      deltas: [delta({ muted: true })],
    });
    render(<PrMonitorBackground host={host} />);
    await runFirstTick();
    expect(toast).not.toHaveBeenCalled();
    expect(pushInbox).not.toHaveBeenCalled();
  });

  it('AC-INBOX-2.3: no project → no inbox entry (in-app still fires)', async () => {
    const { host, toast, pushInbox } = makeHost({
      settings: { notifyInApp: true, sendToInbox: true },
      deltas: [delta({ projectId: undefined })],
    });
    render(<PrMonitorBackground host={host} />);
    await runFirstTick();
    expect(pushInbox).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalled();
  });

  it('AC-SYS-2.2: auto-sync off → pollAll is never called', async () => {
    const { host, call } = makeHost({
      settings: { autoSyncEnabled: false },
      deltas: [delta()],
    });
    render(<PrMonitorBackground host={host} />);
    await runFirstTick();
    const pollCalls = call.mock.calls.filter((c) => c[0] === 'pollAll');
    expect(pollCalls).toHaveLength(0);
  });

  it('AC-SYS-6.2: auto-sync on → pollAll runs from the background loop', async () => {
    const { host, call } = makeHost({
      settings: { autoSyncEnabled: true },
      deltas: [],
    });
    render(<PrMonitorBackground host={host} />);
    await runFirstTick();
    const pollCalls = call.mock.calls.filter((c) => c[0] === 'pollAll');
    expect(pollCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('wake/foreground: window focus re-polls immediately (no waiting for the interval)', async () => {
    const { host, call } = makeHost({ settings: { autoSyncEnabled: true }, deltas: [] });
    render(<PrMonitorBackground host={host} />);
    await runFirstTick();
    const before = call.mock.calls.filter((c) => c[0] === 'pollAll').length;
    expect(before).toBeGreaterThanOrEqual(1);

    // Focus regained (app brought to foreground) → immediate extra poll, well
    // before the 15-minute interval would fire.
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(0);
    });
    const after = call.mock.calls.filter((c) => c[0] === 'pollAll').length;
    expect(after).toBe(before + 1);
  });

  it('wake/foreground: back-to-back visibility+focus collapse to one poll (cooldown)', async () => {
    const { host, call } = makeHost({ settings: { autoSyncEnabled: true }, deltas: [] });
    render(<PrMonitorBackground host={host} />);
    await runFirstTick();
    const before = call.mock.calls.filter((c) => c[0] === 'pollAll').length;

    // happy-dom defaults visibilityState to 'visible'; both events fire on the
    // same unlock but the 5s cooldown lets only the first through.
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(0);
    });
    const after = call.mock.calls.filter((c) => c[0] === 'pollAll').length;
    expect(after).toBe(before + 1);
  });

  it('badge: primes `settings` into cache + refreshes badge on mount (before any poll)', async () => {
    // The nav badge resolves `badgeMode` from host.cache('settings'). If prime
    // doesn't seed it, the first badge paint falls back to the 'total' default
    // even when the user chose 'unread'. Assert prime seeds it and refreshes.
    const cacheStore = new Map<string, unknown>();
    const refreshBadge = vi.fn();
    const settings: PrMonitorSettings = { ...DEFAULT_PR_MONITOR_SETTINGS, badgeMode: 'unread' };
    const call = vi.fn(async (cap: string) => (cap === 'listPrs' ? ([] as MonitoredPr[]) : undefined));
    const host = {
      moduleId: 'pr-monitor',
      call: call as unknown as ModuleHost['call'],
      storage: {
        get: async (k: string) => (k === SETTINGS_STORAGE_KEY ? settings : undefined),
        set: async () => {},
      },
      pushInbox: vi.fn(),
      toast: vi.fn(),
      cache: {
        get: (k: string) => cacheStore.get(k),
        set: (k: string, v: unknown) => void cacheStore.set(k, v),
        delete: (k: string) => void cacheStore.delete(k),
        refreshBadge,
      },
    } as unknown as ModuleHost;

    render(<PrMonitorBackground host={host} />);
    // Prime runs on mount, before the 2s first-tick delay — flush microtasks.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect((cacheStore.get('settings') as PrMonitorSettings | undefined)?.badgeMode).toBe('unread');
    expect(refreshBadge).toHaveBeenCalled();
  });

  it('R-SET-005: prefetches orgs / repos / author into cache at app start', async () => {
    // The three Settings collections are fetched once on mount (before the first
    // poll tick) and stashed in host.cache under the PREFETCH_* keys so the
    // Settings areas paint from cache with no gh-backed spinner on first open.
    const cacheStore = new Map<string, unknown>();
    const call = vi.fn(async (cap: string) => {
      switch (cap) {
        case 'listPrs':
          return [] as MonitoredPr[];
        case 'listOrgs':
          return { ok: true, orgs: [{ host: 'github.com', login: 'acme' }] };
        case 'listRepos':
          return { ok: true, repos: [{ host: 'github.com', owner: 'acme', repo: 'widgets' }] };
        case 'getAuthor':
          return { ok: true, author: { login: 'octocat', identities: [] } };
        default:
          return undefined;
      }
    });
    const host = {
      moduleId: 'pr-monitor',
      call: call as unknown as ModuleHost['call'],
      storage: {
        get: async (k: string) =>
          k === SETTINGS_STORAGE_KEY ? DEFAULT_PR_MONITOR_SETTINGS : undefined,
        set: async () => {},
      },
      pushInbox: vi.fn(),
      toast: vi.fn(),
      cache: {
        get: (k: string) => cacheStore.get(k),
        set: (k: string, v: unknown) => void cacheStore.set(k, v),
        delete: (k: string) => void cacheStore.delete(k),
        refreshBadge: () => {},
      },
    } as unknown as ModuleHost;

    render(<PrMonitorBackground host={host} />);
    // The prefetch fires on mount (no 2s tick delay) — flush microtasks.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(call.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(['listOrgs', 'listRepos', 'getAuthor'])
    );
    expect(cacheStore.get(PREFETCH_ORGS_CACHE_KEY)).toMatchObject({ ok: true });
    expect(cacheStore.get(PREFETCH_REPOS_CACHE_KEY)).toMatchObject({ ok: true });
    expect(cacheStore.get(PREFETCH_AUTHOR_CACHE_KEY)).toMatchObject({ ok: true });
  });
});
